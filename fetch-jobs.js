// fetch-jobs.js
// RSS Feeds se Government Jobs fetch karke Firebase mein save karta hai

const admin = require('firebase-admin');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const fs = require('fs');

console.log('🚀 Job Fetcher starting...');

// ==========================================
// DEBUG: Environment check
// ==========================================
if (!process.env.FIREBASE_CREDENTIALS) {
    console.error('❌ ERROR: FIREBASE_CREDENTIALS is not set!');
    console.error('   GitHub Secrets mein FIREBASE_CREDENTIALS add karein.');
    process.exit(1);
}

if (!fs.existsSync('./rss-feeds.json')) {
    console.error('❌ ERROR: rss-feeds.json not found!');
    console.error('   File repo root mein honi chahiye.');
    process.exit(1);
}

console.log('✅ FIREBASE_CREDENTIALS found');
console.log('✅ rss-feeds.json found');

// ==========================================
// Firebase setup
// ==========================================
let serviceAccount;
try {
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    console.log('✅ Firebase credentials parsed');
} catch (e) {
    console.error('❌ ERROR: FIREBASE_CREDENTIALS is not valid JSON!');
    console.error('   Details:', e.message);
    process.exit(1);
}

try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: "https://ibad-csc-default-rtdb.firebaseio.com"
        });
    }
    console.log('✅ Firebase initialized');
} catch (e) {
    console.error('❌ ERROR: Firebase initialization failed!');
    console.error('   Details:', e.message);
    process.exit(1);
}

const db = admin.database();

// ==========================================
// RSS Parser setup
// ==========================================
const parser = new Parser({
    timeout: 15000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; esewahub-bot/1.0; +https://esewahub.in)'
    }
});

// ==========================================
// Load feeds
// ==========================================
let FEEDS = [];
try {
    const feedsData = JSON.parse(fs.readFileSync('./rss-feeds.json', 'utf8'));
    FEEDS = feedsData.feeds || [];
    console.log(`✅ Loaded ${FEEDS.length} RSS feeds`);
} catch (e) {
    console.error('❌ ERROR: rss-feeds.json parse failed!');
    console.error('   Details:', e.message);
    process.exit(1);
}

// ==========================================
// Job keywords
// ==========================================
const JOB_KEYWORDS = [
    'recruitment', 'vacancy', 'bharti', 'job', 'result', 'admit card',
    'notification', 'apply', 'online form', 'sarkari', 'government',
    'ssc', 'upsc', 'railway', 'bank', 'police', 'army', 'navy',
    'teaching', 'teacher', 'clerk', 'officer', 'constable', 'vacancies',
    'posts', 'opening', 'hiring', 'form', 'exam', 'merit'
];

// ==========================================
// Helper functions
// ==========================================
function extractImage(item) {
    if (item.enclosure && item.enclosure.url) {
        return item.enclosure.url;
    }
    if (item.content || item['content:encoded']) {
        try {
            const content = item.content || item['content:encoded'];
            const $ = cheerio.load(content);
            const img = $('img').first().attr('src');
            if (img && img.startsWith('http')) return img;
        } catch (e) {
            // ignore
        }
    }
    return '';
}

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

function isRelevantJob(title, content) {
    const text = ((title || '') + ' ' + (content || '')).toLowerCase();
    return JOB_KEYWORDS.some(keyword => text.includes(keyword));
}

// ==========================================
// Main function
// ==========================================
async function fetchJobs() {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Government Job Fetch Started');
    console.log('='.repeat(50));
    
    let totalAdded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let feedsSuccess = 0;
    let feedsFailed = 0;
    
    for (const feed of FEEDS) {
        console.log(`\n📡 Fetching: ${feed.name}`);
        console.log(`   URL: ${feed.url}`);
        
        try {
            const feedData = await parser.parseURL(feed.url);
            console.log(`   ✅ Feed loaded: ${feedData.items.length} items`);
            feedsSuccess++;
            
            const items = feedData.items.slice(0, 15);
            let feedAdded = 0;
            
            for (const item of items) {
                try {
                    if (!item.title || !item.link) continue;
                    if (!isRelevantJob(item.title, item.contentSnippet)) continue;
                    
                    // Duplicate check
                    let existing;
                    try {
                        existing = await db.ref('posts')
                            .orderByChild('sourceUrl')
                            .equalTo(item.link)
                            .once('value');
                    } catch (dbErr) {
                        console.error(`   ❌ DB error: ${dbErr.message}`);
                        totalErrors++;
                        continue;
                    }
                    
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
            feedsFailed++;
        }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Feeds Success:   ${feedsSuccess}/${FEEDS.length}`);
    console.log(`❌ Feeds Failed:    ${feedsFailed}`);
    console.log(`✅ Total Added:     ${totalAdded}`);
    console.log(`⏭️  Total Skipped:   ${totalSkipped}`);
    console.log(`❌ Total Errors:    ${totalErrors}`);
    console.log('='.repeat(50));
    
    // Save log
    try {
        await db.ref('fetchLogs').push({
            date: new Date().toISOString(),
            feedsSuccess: feedsSuccess,
            feedsFailed: feedsFailed,
            added: totalAdded,
            skipped: totalSkipped,
            errors: totalErrors,
            status: totalAdded > 0 ? 'success' : 'no_new_jobs'
        });
        console.log('✅ Log saved to Firebase');
    } catch (e) {
        console.error('⚠️  Log save error:', e.message);
    }
    
    console.log('\n🎉 Job fetch complete!');
    
    // Agar saare feeds fail hue to error exit
    if (feedsSuccess === 0) {
        console.error('\n❌ All feeds failed!');
        process.exit(1);
    }
    
    process.exit(0);
}

// ==========================================
// Error handlers
// ==========================================
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

// Run
fetchJobs().catch(e => {
    console.error('❌ Fatal error:', e);
    console.error('Stack:', e.stack);
    process.exit(1);
});
