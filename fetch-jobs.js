// fetch-jobs.js
// RSS Feeds se Government Jobs fetch karke Firebase mein save karta hai

const admin = require('firebase-admin');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const fs = require('fs');

const parser = new Parser({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; esewahub-bot/1.0)'
    }
});

// Firebase setup
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://ibad-csc-default-rtdb.firebaseio.com"
});

const db = admin.database();

// RSS Feeds load karein
const feedsData = JSON.parse(fs.readFileSync('./rss-feeds.json', 'utf8'));
const FEEDS = feedsData.feeds;

// Job keywords — sirf relevant jobs fetch honge
const JOB_KEYWORDS = [
    'recruitment', 'vacancy', 'bharti', 'job', 'result', 'admit card',
    'notification', 'apply', 'online form', 'sarkari', 'government',
    'ssc', 'upsc', 'railway', 'bank', 'police', 'army', 'navy',
    'teaching', 'teacher', 'clerk', 'officer', 'constable', 'vacancies'
];

// Image extract helper
function extractImage(item) {
    if (item.enclosure && item.enclosure.url) {
        return item.enclosure.url;
    }
    if (item.content || item['content:encoded']) {
        const content = item.content || item['content:encoded'];
        const $ = cheerio.load(content);
        const img = $('img').first().attr('src');
        if (img && img.startsWith('http')) return img;
    }
    return '';
}

// Last date extract
function extractLastDate(text) {
    if (!text) return '';
    const patterns = [
        /last date[:\s]+(\d{1,2}[\s\-\/]\w+[\s\-\/]\d{2,4})/i,
        /apply before[:\s]+(\d{1,2}[\s\-\/]\w+[\s\-\/]\d{2,4})/i,
        /closing date[:\s]+(\d{1,2}[\s\-\/]\w+[\s\-\/]\d{2,4})/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1];
    }
    return '';
}

// Relevance check
function isRelevantJob(title, content) {
    const text = (title + ' ' + (content || '')).toLowerCase();
    return JOB_KEYWORDS.some(keyword => text.includes(keyword));
}

// Main function
async function fetchJobs() {
    console.log('🚀 Government Job Fetch Started');
    console.log('='.repeat(50));
    
    let totalAdded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    
    for (const feed of FEEDS) {
        console.log(`\n📡 Fetching: ${feed.name}`);
        
        try {
            const feedData = await parser.parseURL(feed.url);
            console.log(`   ✅ Feed loaded: ${feedData.items.length} items`);
            
            const items = feedData.items.slice(0, 15);
            let feedAdded = 0;
            
            for (const item of items) {
                try {
                    if (!item.title || !item.link) continue;
                    if (!isRelevantJob(item.title, item.contentSnippet)) continue;
                    
                    // Duplicate check
                    const existing = await db.ref('posts')
                        .orderByChild('sourceUrl')
                        .equalTo(item.link)
                        .once('value');
                    
                    if (existing.exists()) {
                        totalSkipped++;
                        continue;
                    }
                    
                    let summary = item.contentSnippet || item.summary || '';
                    summary = summary.replace(/\s+/g, ' ').trim().substring(0, 300);
                    if (!summary) {
                        summary = item.title + ' — Complete details, eligibility, important dates, and online application link.';
                    }
                    
                    const fullText = (item.title + ' ' + (item.content || '')).substring(0, 2000);
                    const lastDate = extractLastDate(fullText);
                    
                    const postData = {
                        title: item.title.substring(0, 200),
                        summary: summary,
                        sourceUrl: item.link,
                        sourceName: feed.name,
                        category: feed.category,
                        categoryName: feed.categoryName,
                        image: extractImage(item),
                        timestamp: new Date().toISOString(),
                        pubDate: item.pubDate || new Date().toISOString(),
                        lastDate: lastDate,
                        links: [{ name: 'Apply Online / Read Full Details', url: item.link }],
                        education: 'Official notification mein eligibility check karein.',
                        steps: 'Official website par jaakar apply karein.',
                        documents: 'Official notification mein required documents ki list di gayi hai.',
                        faq: [
                            { q: 'Is this job official?', a: 'Yes, from ' + feed.name + '. Official link upar hai.' },
                            { q: 'What is the last date?', a: lastDate ? 'Last date: ' + lastDate : 'Check official notification.' }
                        ],
                        autoFetched: true,
                        fetchedAt: new Date().toISOString()
                    };
                    
                    await db.ref('posts').push(postData);
                    totalAdded++;
                    feedAdded++;
                    console.log(`   ✅ Added: ${item.title.substring(0, 60)}...`);
                    
                } catch (itemError) {
                    console.error(`   ❌ Item error: ${itemError.message}`);
                    totalErrors++;
                }
            }
            
            console.log(`   📊 ${feed.name}: ${feedAdded} new jobs added`);
            
        } catch (feedError) {
            console.error(`   ❌ Feed error (${feed.name}): ${feedError.message}`);
            totalErrors++;
        }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Total Added:    ${totalAdded}`);
    console.log(`⏭️  Total Skipped:  ${totalSkipped}`);
    console.log(`❌ Total Errors:   ${totalErrors}`);
    console.log('='.repeat(50));
    
    try {
        await db.ref('fetchLogs').push({
            date: new Date().toISOString(),
            added: totalAdded,
            skipped: totalSkipped,
            errors: totalErrors,
            status: totalAdded > 0 ? 'success' : 'no_new_jobs'
        });
    } catch (e) {
        console.error('Log save error:', e.message);
    }
    
    console.log('\n🎉 Job fetch complete!');
    process.exit(0);
}

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
    process.exit(1);
});

fetchJobs().catch(e => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
});
