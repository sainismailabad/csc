// generate-all.js
// Auto-generates static HTML pages + sitemap + robots.txt
// Runs via GitHub Actions daily

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const FIREBASE_DB_URL = "https://ibad-csc-default-rtdb.firebaseio.com";

let credential;
try {
    if (process.env.FIREBASE_CREDENTIALS) {
        const sa = JSON.parse(process.env.FIREBASE_CREDENTIALS);
        credential = admin.credential.cert(sa);
    } else {
        credential = admin.credential.applicationDefault();
    }
} catch (e) {
    console.error('Credential error:', e.message);
    process.exit(1);
}

admin.initializeApp({
    credential: credential,
    databaseURL: FIREBASE_DB_URL
});

const db = admin.database();

/* ==========================================
   HELPERS
   ========================================== */
function slugify(text) {
    var s = String(text || '').toLowerCase().trim()
        .replace(/[^\w\s-]/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 70);
    if (!s || s.length < 3) s = 'page-' + Date.now().toString(36);
    return s;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(text) {
    if (!text) return '';
    return String(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function extractKeywords(text, max) {
    max = max || 12;
    if (!text) return [];
    var clean = String(text).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    var stop = ['ka','ki','ke','ko','se','me','mein','hai','hain','ho','gaya','gayi','kya','aur','ya','par','for','the','a','an','and','or','of','to','in','on','is','are','was','were','be','been','has','have','had','do','does','did','will','would','should','could','can','may','might','this','that','these','those','it','its','as','at','by','with','from','but','if','then','than','so','up','down','out','only','also','very','much','many','some','any','all','one','two','three','new','more','most','less','least','not','no','yes','ok','well','just','even','still','yet','now','then','here','there','where','when','why','how','what','who','whom','which'];
    var words = clean.split(' ').filter(function (w) { return w.length > 2 && stop.indexOf(w) === -1; });
    var freq = {};
    words.forEach(function (w) { freq[w] = (freq[w] || 0) + 1; });
    return Object.keys(freq).sort(function (a, b) {
        if (freq[b] !== freq[a]) return freq[b] - freq[a];
        return b.length - a.length;
    }).slice(0, max);
}

function generateKeywords(item, type, category) {
    var keywords = [];
    extractKeywords(item.title || item.name, 6).forEach(function (w) { if (keywords.indexOf(w) === -1) keywords.push(w); });
    extractKeywords(item.summary || item.about, 5).forEach(function (w) { if (keywords.indexOf(w) === -1) keywords.push(w); });
    if (type === 'post') {
        ['sarkari job','sarkari naukri','govt job','recruitment 2026','apply online'].forEach(function (w) { if (keywords.indexOf(w) === -1) keywords.push(w); });
    } else {
        ['sarkari kaam','govt service','online apply','official portal'].forEach(function (w) { if (keywords.indexOf(w) === -1) keywords.push(w); });
    }
    if (category && keywords.indexOf(category.toLowerCase()) === -1) keywords.unshift(category.toLowerCase());
    var year = new Date().getFullYear().toString();
    if (keywords.indexOf(year) === -1) keywords.push(year);
    return keywords.slice(0, 15).join(', ');
}

function generateDescription(item, type, category) {
    var title = item.title || item.name || '';
    var summary = item.summary || item.about || '';
    var lastDate = item.lastDate || '';
    var desc = '';
    if (summary && summary.length > 30) desc = summary.trim();
    else if (type === 'post') desc = title + ' - Complete details with eligibility, important dates, application process and official links.';
    else desc = title + ' - Complete online guide with steps, required documents and official links.';
    if (type === 'post' && lastDate && desc.indexOf('Last date') === -1) desc += ' Last date: ' + lastDate + '.';
    if (desc.indexOf('Apply') === -1 && desc.indexOf('apply') === -1) desc += ' Apply now on official portal.';
    if (desc.length > 158) desc = desc.substring(0, 155).trim() + '...';
    return desc;
}

/* ==========================================
   HTML TEMPLATE
   ========================================== */
function buildHTML(opts) {
    var s = opts.siteSettings || {};
    var siteTitle = s.title || 'esewahub.in';
    var tagline = s.tagline || 'Sarkari Kaam & Digital Seva';
    var logo = s.logo || '';
    var whatsapp = s.whatsapp || '917056836166';
    var email = s.email || 'info@esewahub.in';
    var address = s.address || 'India';
    var type = opts.type;
    var canonical = 'https://esewahub.in/' + (type === 'post' ? 'posts' : 'services') + '/' + opts.slug + '.html';

    var logoHtml = logo
        ? '<img src="' + escapeAttr(logo) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:11px">'
        : '<i class="fas fa-shield-halved"></i>';

    var breadcrumbHtml = (opts.breadcrumb || []).map(function (b, i, arr) {
        if (i === arr.length - 1) return '<span>' + escapeHtml(b.name) + '</span>';
        return '<a href="' + b.url + '">' + escapeHtml(b.name) + '</a><span class="sep">/</span>';
    }).join('');

    var fdate = opts.timestamp ? new Date(opts.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    var h = '';
    h += '<!DOCTYPE html>\n<html lang="en">\n<head>\n';
    h += '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
    h += '<title>' + escapeHtml(opts.title) + ' | ' + escapeHtml(siteTitle) + '</title>\n';
    h += '<meta name="description" content="' + escapeAttr(opts.description) + '">\n';
    h += '<meta name="keywords" content="' + escapeAttr(opts.keywords) + '">\n';
    h += '<meta name="robots" content="index, follow, max-image-preview:large">\n';
    h += '<meta name="google-adsense-account" content="ca-pub-1336136297225442">\n';
    h += '<link rel="canonical" href="' + canonical + '">\n';
    if (opts.image) h += '<meta property="og:image" content="' + escapeAttr(opts.image) + '">\n';
    h += '<meta property="og:title" content="' + escapeAttr(opts.title) + '">\n';
    h += '<meta property="og:description" content="' + escapeAttr(opts.description) + '">\n';
    h += '<meta property="og:type" content="' + (type === 'post' ? 'article' : 'website') + '">\n';
    h += '<meta property="og:url" content="' + canonical + '">\n';
    h += '<meta name="twitter:card" content="summary_large_image">\n';
    if (logo) h += '<link rel="icon" href="' + escapeAttr(logo) + '">\n';
    h += '<link rel="preconnect" href="https://fonts.googleapis.com">\n';
    h += '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Merriweather:wght@700;900&display=swap" rel="stylesheet">\n';
    h += '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">\n';
    h += '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1336136297225442" crossorigin="anonymous"></script>\n';
    h += '<style>';
    h += ':root{--p50:#eff6ff;--p100:#dbeafe;--p200:#bfdbfe;--p500:#3b82f6;--p600:#2563eb;--p700:#1d4ed8;--p800:#1e40af;--s50:#f8fafc;--s100:#f1f5f9;--s200:#e2e8f0;--s300:#cbd5e1;--s400:#94a3b8;--s500:#64748b;--s600:#475569;--s700:#334155;--s800:#1e293b;--s900:#0f172a;--g50:#f0fdf4;--g600:#16a34a;--g700:#15803d;--y500:#f59e0b;--serif:Merriweather,serif}';
    h += '*{margin:0;padding:0;box-sizing:border-box}';
    h += 'body{font-family:Inter,sans-serif;background:var(--s100);color:var(--s800);line-height:1.6}';
    h += 'a{text-decoration:none;color:inherit}img{max-width:100%;height:auto;display:block}';
    h += '.container{max-width:1280px;margin:0 auto;padding:0 20px}';
    h += '.topbar{background:var(--s900);color:var(--s300);padding:10px 0;font-size:.82rem}';
    h += '.topbar .container{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}';
    h += '.topbar-left i{color:#60a5fa;margin-right:6px}';
    h += '.topbar-right a{padding:6px 12px;border-radius:6px;color:#22c55e;font-weight:600;font-size:.8rem}';
    h += '.header{background:#fff;padding:18px 0;border-bottom:1px solid var(--s200)}';
    h += '.header .container{display:flex;justify-content:space-between;align-items:center}';
    h += '.logo{display:flex;align-items:center;gap:12px}';
    h += '.logo-icon{width:48px;height:48px;background:linear-gradient(135deg,var(--p600),var(--p800));border-radius:11px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.3rem;flex-shrink:0;overflow:hidden}';
    h += '.logo-text h1{font-family:var(--serif);color:var(--p700);font-size:1.4rem;font-weight:900}';
    h += '.logo-text p{color:var(--s500);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em}';
    h += '.navbar{background:#fff;border-bottom:1px solid var(--s200);position:sticky;top:0;z-index:100;box-shadow:0 2px 4px rgba(0,0,0,.04)}';
    h += '.nav-list{display:flex;list-style:none;gap:4px;padding:10px 0;overflow-x:auto;scrollbar-width:none}';
    h += '.nav-list::-webkit-scrollbar{display:none}';
    h += '.nav-list li a{font-size:.8rem;font-weight:700;color:var(--s600);padding:9px 14px;border-radius:6px;text-transform:uppercase;display:flex;align-items:center;gap:6px;white-space:nowrap}';
    h += '.nav-list li a:hover{color:var(--p700);background:var(--p50)}';
    h += '.ad-container{background:var(--s50);border:1px dashed var(--s300);border-radius:10px;padding:16px 12px 12px;text-align:center;margin:20px 0;min-height:100px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}';
    h += '.ad-label{position:absolute;top:6px;left:12px;font-size:.6rem;text-transform:uppercase;letter-spacing:.15em;color:var(--s400);font-weight:800;background:#fff;padding:2px 8px;border-radius:3px}';
    h += '.layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:32px;margin:28px auto;max-width:1280px;padding:0 20px}';
    h += '.article{background:#fff;border-radius:14px;padding:36px;border:1px solid var(--s200);box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden}';
    h += '.breadcrumb{font-size:.78rem;color:var(--s500);margin-bottom:18px;font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap}';
    h += '.breadcrumb a{color:var(--p600)}.breadcrumb .sep{color:var(--s300)}';
    h += '.article-title{font-family:var(--serif);font-size:1.85rem;color:var(--s900);margin-bottom:16px;font-weight:900;line-height:1.3;word-wrap:break-word}';
    h += '.article-image{margin-bottom:22px;border-radius:12px;overflow:hidden;border:1px solid var(--s200);background:var(--s50);aspect-ratio:16/9}';
    h += '.article-image img{width:100%;height:100%;object-fit:cover;max-height:520px}';
    h += '.author-box{display:flex;align-items:center;gap:14px;padding:16px;background:var(--s50);border-radius:10px;margin-bottom:20px;border:1px solid var(--s200)}';
    h += '.author-av{width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--p600),var(--p800));display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.3rem;flex-shrink:0}';
    h += '.author-info h4{font-size:.9rem;font-weight:800;color:var(--s900);margin-bottom:3px}';
    h += '.author-info p{font-size:.78rem;color:var(--s500);line-height:1.5}';
    h += '.author-info .ver{display:inline-flex;align-items:center;gap:4px;font-size:.68rem;color:var(--g600);font-weight:700;margin-top:3px}';
    h += '.art-meta{display:flex;flex-wrap:wrap;gap:16px;background:var(--s50);padding:14px 20px;border-radius:10px;margin-bottom:22px;font-weight:600;border-left:4px solid var(--p600);font-size:.82rem}';
    h += '.art-meta span{display:flex;align-items:center;gap:6px;flex-wrap:wrap}';
    h += '.apply-box{background:linear-gradient(135deg,var(--p50),#eff6ff);border:1px solid var(--p200);padding:26px;border-radius:14px;text-align:center;margin-bottom:24px}';
    h += '.apply-box h3{margin-bottom:16px;font-size:1.05rem;color:var(--s900);font-weight:800;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}';
    h += '.link-btn{display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,var(--g600),var(--g700));color:#fff;padding:15px 22px;border-radius:10px;font-weight:700;font-size:.92rem;margin-bottom:10px;box-shadow:0 4px 12px rgba(22,163,74,.25)}';
    h += '.link-btn:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(22,163,74,.35)}';
    h += '.link-btn i:first-child{font-size:1.05rem;flex-shrink:0}';
    h += '.link-btn span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';
    h += '.link-btn i:last-child{margin-left:auto;opacity:.8;font-size:.85rem;flex-shrink:0}';
    h += '.art-content h3{font-size:1.05rem;color:var(--s900);margin:28px 0 14px;border-bottom:1px solid var(--s200);padding-bottom:10px;display:flex;align-items:center;gap:10px;font-weight:800;flex-wrap:wrap}';
    h += '.art-content h3 i{color:var(--p600)}';
    h += '.art-content ul{margin-left:8px;list-style:none}';
    h += '.art-content li{color:var(--s600);font-size:.92rem;line-height:1.8;margin-bottom:8px;display:flex;align-items:flex-start;gap:10px}';
    h += '.art-content li i{color:var(--p500);font-size:.75rem;margin-top:7px;flex-shrink:0}';
    h += '.art-content p{color:var(--s600);font-size:.92rem;line-height:1.8;margin-bottom:12px}';
    h += '.info-box{background:var(--p50);border-left:4px solid var(--p600);padding:14px 18px;border-radius:10px;margin-bottom:20px}';
    h += '.info-box p{margin:0;color:var(--p800);font-size:.9rem;font-weight:600;line-height:1.7}';
    h += '.steps-list{background:var(--s50);padding:20px;border-radius:12px;margin-bottom:20px}';
    h += '.step-item{display:flex;gap:14px;margin-bottom:14px;align-items:flex-start}';
    h += '.step-item:last-child{margin-bottom:0}';
    h += '.step-num{width:32px;height:32px;background:linear-gradient(135deg,var(--p600),var(--p800));color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.85rem;flex-shrink:0}';
    h += '.step-text{font-size:.92rem;color:var(--s700);line-height:1.6;padding-top:5px;flex:1}';
    h += '.side-widget{background:#fff;border:1px solid var(--s200);border-radius:14px;padding:20px;margin-bottom:22px}';
    h += '.side-title{font-size:.88rem;font-weight:800;margin-bottom:14px;color:var(--s900);border-bottom:2px solid var(--s200);padding-bottom:10px;text-transform:uppercase;display:flex;align-items:center;gap:10px}';
    h += '.side-title i{color:var(--p600)}';
    h += '.side-link{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px dashed var(--s200);font-size:.85rem;font-weight:600;color:var(--s600)}';
    h += '.side-link:last-child{border-bottom:none}';
    h += '.side-link:hover{color:var(--p600);padding-left:6px}';
    h += '.newsletter{background:linear-gradient(135deg,var(--p600),var(--p800));color:#fff;padding:24px 20px;border-radius:14px;text-align:center;margin-bottom:22px}';
    h += '.newsletter h3{font-size:.95rem;font-weight:800;margin-bottom:6px}';
    h += '.newsletter p{font-size:.78rem;opacity:.9;margin-bottom:14px}';
    h += '.newsletter input{width:100%;padding:11px 14px;border:none;border-radius:6px;font-size:.85rem;margin-bottom:8px;outline:none}';
    h += '.newsletter button{width:100%;padding:11px;background:#fff;color:var(--p700);border-radius:6px;font-weight:800;font-size:.82rem;text-transform:uppercase;cursor:pointer;border:none}';
    h += '.footer{background:var(--s900);color:var(--s400);padding:50px 0 24px;margin-top:50px}';
    h += '.foot-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:36px;margin-bottom:32px}';
    h += '.foot-brand h3{color:#fff;margin-bottom:14px;font-size:1.15rem;font-weight:800;font-family:var(--serif);display:flex;align-items:center;gap:10px}';
    h += '.foot-brand h3 i{color:#60a5fa}.foot-brand p{font-size:.86rem;line-height:1.7;margin-bottom:14px}';
    h += '.foot-grid h4{color:#fff;margin-bottom:16px;font-size:.88rem;font-weight:700;text-transform:uppercase}';
    h += '.foot-links a{display:block;margin-bottom:8px;font-size:.84rem;color:var(--s400)}';
    h += '.foot-links a:hover{color:#60a5fa}';
    h += '.foot-disc{background:var(--s800);padding:14px;border-radius:10px;margin-top:20px;font-size:.76rem;line-height:1.6;border-left:3px solid #f59e0b;color:var(--s400)}';
    h += '.foot-bottom{text-align:center;border-top:1px solid var(--s700);margin-top:24px;padding-top:20px;font-size:.8rem;color:var(--s500)}';
    h += '.foot-bottom .links{margin-top:8px;display:flex;justify-content:center;gap:16px;flex-wrap:wrap}';
    h += '.foot-bottom .links a{color:var(--s400);font-size:.78rem}';
    h += '@media(max-width:1024px){.container{padding:0 16px}.layout{grid-template-columns:1fr;padding:0 16px}.foot-grid{grid-template-columns:1fr 1fr}}';
    h += '@media(max-width:768px){.container{padding:0 14px}.header .container{flex-direction:column;text-align:center}.layout{display:block;padding:0 14px}.article{padding:16px}.article-title{font-size:1.25rem}.foot-grid{grid-template-columns:1fr;text-align:center}.foot-bottom .links{justify-content:center}}';
    h += '</style></head><body>';
    h += '<div class="topbar"><div class="container"><div class="topbar-left"><i class="fas fa-map-marker-alt"></i><span>' + escapeHtml(address) + '</span></div><div class="topbar-right"><a href="https://wa.me/' + escapeAttr(whatsapp) + '" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp Help</a></div></div></div>';
    h += '<div class="header"><div class="container"><a href="/index.html" class="logo"><div class="logo-icon">' + logoHtml + '</div><div class="logo-text"><h1>' + escapeHtml(siteTitle) + '</h1><p>' + escapeHtml(tagline) + '</p></div></a></div></div>';
    h += '<nav class="navbar"><div class="container"><ul class="nav-list"><li><a href="/index.html"><i class="fas fa-home"></i> Home</a></li><li><a href="/index.html#sarkari-kaam"><i class="fas fa-briefcase"></i> Sarkari Kaam</a></li><li><a href="/index.html"><i class="fas fa-newspaper"></i> Latest Jobs</a></li><li><a href="/index.html"><i class="fas fa-award"></i> Results</a></li></ul></div></nav>';
    h += '<div class="layout"><main><div class="article">';
    h += '<div class="breadcrumb">' + breadcrumbHtml + '</div>';
    h += '<h1 class="article-title">' + escapeHtml(opts.title) + '</h1>';
    if (opts.image) h += '<div class="article-image"><img src="' + escapeAttr(opts.image) + '" alt="' + escapeAttr(opts.title) + '" onerror="this.parentElement.style.display=\'none\'"></div>';
    h += '<div class="author-box"><div class="author-av"><i class="fas fa-user-tie"></i></div><div class="author-info"><h4>' + escapeHtml(siteTitle) + ' Editorial Team</h4><p>Government services expert with hands-on experience in CSC operations & Sarkari Kaam guidance.</p><div class="ver"><i class="fas fa-check-circle"></i> Verified Author</div></div></div>';
    h += '<div class="art-meta"><span><i class="fas fa-calendar" style="color:var(--p600)"></i> Published: <strong>' + fdate + '</strong></span>';
    if (opts.lastDate) h += '<span><i class="fas fa-clock" style="color:var(--p600)"></i> Last Date: <strong>' + escapeHtml(opts.lastDate) + '</strong></span>';
    h += '<span><i class="fas fa-check-circle" style="color:var(--g600)"></i> Verified</span></div>';
    h += '<div class="ad-container"><span class="ad-label">Advertisement</span><ins class="adsbygoogle" style="display:block;width:100%" data-ad-client="ca-pub-1336136297225442" data-ad-slot="1111111111" data-ad-format="auto" data-full-width-responsive="true"></ins></div>';
    h += opts.content;
    h += '<div class="ad-container"><span class="ad-label">Advertisement</span><ins class="adsbygoogle" style="display:block;width:100%" data-ad-client="ca-pub-1336136297225442" data-ad-slot="4444444444" data-ad-format="auto" data-full-width-responsive="true"></ins></div>';
    h += '</div></main>';
    h += '<aside><div class="newsletter"><h3>Never Miss an Update!</h3><p>Get latest Sarkari alerts in your inbox.</p><input type="email" placeholder="Enter your email" id="nlEmail"><button onclick="subscribeNL()">Subscribe Free</button></div>';
    h += '<div class="ad-container" style="min-height:250px"><span class="ad-label">Advertisement</span><ins class="adsbygoogle" style="display:block;width:100%" data-ad-client="ca-pub-1336136297225442" data-ad-slot="3333333333" data-ad-format="auto" data-full-width-responsive="true"></ins></div>';
    h += '<div class="side-widget"><h3 class="side-title"><i class="fas fa-link"></i> Important Portals</h3><a href="https://digitalseva.csc.gov.in" target="_blank" rel="noopener" class="side-link"><i class="fas fa-laptop-house"></i> CSC Digital Seva</a><a href="https://pmkisan.gov.in" target="_blank" rel="noopener" class="side-link"><i class="fas fa-tractor"></i> PM Kisan Yojana</a><a href="https://uidai.gov.in" target="_blank" rel="noopener" class="side-link"><i class="fas fa-id-card"></i> Aadhar Portal</a><a href="https://www.india.gov.in" target="_blank" rel="noopener" class="side-link"><i class="fas fa-landmark"></i> National Portal</a></div></aside>';
    h += '</div>';
    h += '<footer class="footer"><div class="container"><div class="foot-grid"><div class="foot-brand"><h3><i class="fas fa-shield-halved"></i> ' + escapeHtml(siteTitle) + '</h3><p>Your trusted Digital Seva Kendra for government jobs, schemes, and digital services.</p></div><div><h4>Quick Links</h4><div class="foot-links"><a href="/index.html">Home</a><a href="/index.html#sarkari-kaam">Sarkari Kaam</a><a href="/about.html">About Us</a><a href="/contact.html">Contact</a></div></div><div><h4>Information</h4><div class="foot-links"><a href="/privacy.html">Privacy Policy</a><a href="/disclaimer.html">Disclaimer</a><a href="/terms.html">Terms</a></div></div><div><h4>Support</h4><div class="foot-links"><a href="https://wa.me/' + escapeAttr(whatsapp) + '" target="_blank" rel="noopener">WhatsApp Help</a><a href="mailto:' + escapeAttr(email) + '">Email Support</a></div></div></div><div class="foot-disc"><strong>Disclaimer:</strong> This website is not an official government website. All information is provided for informational purposes only.</div><div class="foot-bottom"><div>&copy; ' + new Date().getFullYear() + ' ' + escapeHtml(siteTitle) + '. All Rights Reserved.</div><div class="links"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/disclaimer.html">Disclaimer</a><a href="/contact.html">Contact</a></div></div></div></footer>';
    h += '<script>function subscribeNL(){var e=document.getElementById("nlEmail").value.trim();if(!e||!e.includes("@")){alert("Enter valid email");return;}alert("Subscribed!");}</script>';
    h += '<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>';
    h += '</body></html>';
    return h;
}

function buildPostContent(post) {
    var links = (post.links && post.links.length > 0) ? post.links : (post.link ? [{ name: 'Apply Online', url: post.link }] : []);
    var linksHtml = '';
    if (links.length === 0) {
        linksHtml = '<button class="link-btn" style="background:#94a3b8;cursor:not-allowed;box-shadow:none" disabled><i class="fas fa-lock"></i> Link Not Available</button>';
    } else if (links.length === 1) {
        var url = links[0].url;
        if (url.indexOf('http') !== 0) url = 'https://' + url;
        linksHtml = '<a href="' + escapeAttr(url) + '" target="_blank" rel="noopener" class="link-btn"><i class="fas fa-external-link-alt"></i><span>' + escapeHtml(links[0].name) + '</span><i class="fas fa-arrow-right"></i></a>';
    } else {
        linksHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">';
        links.forEach(function (l) {
            var url = l.url;
            if (url.indexOf('http') !== 0) url = 'https://' + url;
            linksHtml += '<a href="' + escapeAttr(url) + '" target="_blank" rel="noopener" class="link-btn"><i class="fas fa-external-link-alt"></i><span>' + escapeHtml(l.name) + '</span><i class="fas fa-arrow-right"></i></a>';
        });
        linksHtml += '</div>';
    }
    function fmtList(txt, em) {
        if (!txt || !txt.trim()) return '<p style="color:#94a3b8;font-style:italic">' + em + '</p>';
        var items = txt.split('\n').filter(function (l) { return l.trim(); });
        if (!items.length) return '<p style="color:#94a3b8;font-style:italic">' + em + '</p>';
        return '<ul>' + items.map(function (l) { return '<li><i class="fas fa-check-circle"></i><span>' + escapeHtml(l.trim()) + '</span></li>'; }).join('') + '</ul>';
    }
    var faqs = (post.faq && post.faq.length) ? post.faq : [
        { q: 'Is this information verified?', a: 'Yes, all information is verified from official government sources.' },
        { q: 'What is the last date?', a: 'Last date is ' + (post.lastDate || 'mentioned in official notification') + '.' },
        { q: 'How can I get help?', a: 'Contact us via WhatsApp for assistance.' }
    ];
    var faqHtml = faqs.map(function (f) {
        return '<div class="info-box" style="margin-bottom:10px"><p><strong>Q: ' + escapeHtml(f.q) + '</strong><br>A: ' + escapeHtml(f.a) + '</p></div>';
    }).join('');
    var out = '<div class="apply-box"><h3><i class="fas fa-external-link-alt"></i> ' + (links.length > 1 ? 'Important Links (Official)' : 'Important Link') + '</h3>' + linksHtml + '</div>';
    out += '<div class="art-content">';
    out += '<h3><i class="fas fa-info-circle"></i> Eligibility / Details</h3>' + fmtList(post.education, 'No eligibility details provided.');
    out += '<div class="ad-container"><span class="ad-label">Advertisement</span><ins class="adsbygoogle" style="display:block;width:100%" data-ad-client="ca-pub-1336136297225442" data-ad-slot="2222222222" data-ad-format="auto" data-full-width-responsive="true"></ins></div>';
    out += '<h3><i class="fas fa-laptop"></i> How to Apply</h3>' + fmtList(post.steps, 'Application process not specified.');
    out += '<h3><i class="fas fa-file-upload"></i> Required Documents</h3>' + fmtList(post.documents, 'No documents listed.');
    out += '<h3><i class="fas fa-question-circle"></i> FAQ</h3>' + faqHtml;
    out += '</div>';
    return out;
}

function buildServiceContent(service) {
    var links = service.links || [];
    var linksHtml = links.length
        ? links.map(function (l) {
            var url = l.url || '#';
            if (url !== '#' && url.indexOf('http') !== 0) url = 'https://' + url;
            return '<a href="' + escapeAttr(url) + '" target="_blank" rel="noopener" class="link-btn"><i class="fas fa-external-link-alt"></i><span>' + escapeHtml(l.name) + '</span><i class="fas fa-arrow-right"></i></a>';
        }).join('')
        : '<p style="color:#94a3b8;font-style:italic">No links available.</p>';
    var stepsHtml = '';
    if (service.steps && service.steps.length) {
        stepsHtml = '<div class="steps-list">';
        service.steps.forEach(function (step, i) {
            stepsHtml += '<div class="step-item"><div class="step-num">' + (i + 1) + '</div><div class="step-text">' + escapeHtml(step) + '</div></div>';
        });
        stepsHtml += '</div>';
    } else {
        stepsHtml = '<p style="color:#94a3b8;font-style:italic">Steps not specified.</p>';
    }
    var docsHtml = '';
    if (service.docs && service.docs.length) {
        docsHtml = '<ul>' + service.docs.map(function (d) { return '<li><i class="fas fa-check-circle"></i><span>' + escapeHtml(d) + '</span></li>'; }).join('') + '</ul>';
    } else {
        docsHtml = '<p style="color:#94a3b8;font-style:italic">No documents listed.</p>';
    }
    var aboutHtml = service.about ? '<div class="info-box"><p><i class="fas fa-info-circle"></i> ' + escapeHtml(service.about) + '</p></div>' : '';
    var out = aboutHtml;
    out += '<div class="art-content">';
    out += '<h3><i class="fas fa-list-ol"></i> How to Apply (Step by Step)</h3>' + stepsHtml;
    out += '<div class="ad-container"><span class="ad-label">Advertisement</span><ins class="adsbygoogle" style="display:block;width:100%" data-ad-client="ca-pub-1336136297225442" data-ad-slot="2222222222" data-ad-format="auto" data-full-width-responsive="true"></ins></div>';
    out += '<h3><i class="fas fa-external-link-alt"></i> Official Links (Direct)</h3>' + linksHtml;
    out += '<h3><i class="fas fa-file-upload"></i> Required Documents</h3>' + docsHtml;
    out += '</div>';
    return out;
}

/* ==========================================
   MAIN GENERATION
   ========================================== */
async function generate() {
    console.log('🚀 Starting full generation...');

    // Fetch all data
    var results = await Promise.all([
        db.ref('posts').once('value'),
        db.ref('services').once('value'),
        db.ref('categories').once('value'),
        db.ref('settings/general').once('value')
    ]);

    var postsSnap = results[0], servicesSnap = results[1], catsSnap = results[2], settingsSnap = results[3];

    var posts = postsSnap.exists() ? postsSnap.val() : {};
    var services = servicesSnap.exists() ? servicesSnap.val() : {};
    var categories = catsSnap.exists() ? catsSnap.val() : {};
    var siteSettings = settingsSnap.exists() ? settingsSnap.val() : {};

    console.log('📊 Loaded:', Object.keys(posts).length, 'posts,', Object.keys(services).length, 'services');

    // Create folders if not exist
    ['posts', 'services'].forEach(function (dir) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    var generatedUrls = [];
    var today = new Date().toISOString().split('T')[0];

    // ========== GENERATE POSTS ==========
    var postEntries = Object.entries(posts).sort(function (a, b) {
        return new Date(b[1].timestamp || 0) - new Date(a[1].timestamp || 0);
    });

    postEntries.forEach(function (entry) {
        var id = entry[0];
        var post = entry[1];
        if (!post.title) return;

        var slug = slugify(post.title);
        var catName = post.categoryName || (categories[post.category] ? categories[post.category].name : 'Update');
        var keywords = generateKeywords(post, 'post', catName);
        var description = generateDescription(post, 'post', catName);
        var content = buildPostContent(post);

        var html = buildHTML({
            title: post.title,
            description: description,
            keywords: keywords,
            image: post.image || '',
            content: content,
            breadcrumb: [
                { name: 'Home', url: '/index.html' },
                { name: catName, url: '/index.html' },
                { name: post.title.substring(0, 50) }
            ],
            type: 'post',
            timestamp: post.timestamp,
            lastDate: post.lastDate || '',
            slug: slug,
            siteSettings: siteSettings
        });

        fs.writeFileSync('posts/' + slug + '.html', html);
        generatedUrls.push({
            url: 'https://esewahub.in/posts/' + slug + '.html',
            priority: '0.8',
            freq: 'weekly',
            lastmod: post.timestamp ? post.timestamp.split('T')[0] : today
        });
    });

    console.log('✅ Generated', postEntries.length, 'post pages');

    // ========== GENERATE SERVICES ==========
    var serviceEntries = Object.entries(services);
    serviceEntries.forEach(function (entry) {
        var key = entry[0];
        var service = entry[1];
        if (!service.name) return;

        var slug = slugify(service.name);
        var keywords = generateKeywords(service, 'service', service.sub || '');
        var description = generateDescription(service, 'service', service.sub || '');
        var content = buildServiceContent(service);

        var html = buildHTML({
            title: service.name + ' - Complete Guide',
            description: description,
            keywords: keywords,
            image: service.image || '',
            content: content,
            breadcrumb: [
                { name: 'Home', url: '/index.html' },
                { name: 'Sarkari Kaam', url: '/index.html#sarkari-kaam' },
                { name: service.name }
            ],
            type: 'service',
            timestamp: service.timestamp,
            slug: slug,
            siteSettings: siteSettings
        });

        fs.writeFileSync('services/' + slug + '.html', html);
        generatedUrls.push({
            url: 'https://esewahub.in/services/' + slug + '.html',
            priority: '0.7',
            freq: 'monthly',
            lastmod: today
        });
    });

    console.log('✅ Generated', serviceEntries.length, 'service pages');

    // ========== GENERATE SITEMAP ==========
    var sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    var staticPages = [
        { url: '/', priority: '1.0', freq: 'daily' },
        { url: '/about.html', priority: '0.5', freq: 'monthly' },
        { url: '/contact.html', priority: '0.5', freq: 'monthly' },
        { url: '/privacy.html', priority: '0.3', freq: 'yearly' },
        { url: '/disclaimer.html', priority: '0.3', freq: 'yearly' },
        { url: '/terms.html', priority: '0.3', freq: 'yearly' }
    ];
    staticPages.forEach(function (p) {
        sitemap += '  <url>\n    <loc>https://esewahub.in' + p.url + '</loc>\n    <lastmod>' + today + '</lastmod>\n    <changefreq>' + p.freq + '</changefreq>\n    <priority>' + p.priority + '</priority>\n  </url>\n';
    });
    generatedUrls.forEach(function (u) {
        sitemap += '  <url>\n    <loc>' + u.url + '</loc>\n    <lastmod>' + u.lastmod + '</lastmod>\n    <changefreq>' + u.freq + '</changefreq>\n    <priority>' + u.priority + '</priority>\n  </url>\n';
    });
    sitemap += '</urlset>';
    fs.writeFileSync('sitemap.xml', sitemap);
    console.log('✅ sitemap.xml updated (' + (generatedUrls.length + 6) + ' URLs)');

    // ========== GENERATE ROBOTS.TXT ==========
    fs.writeFileSync('robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: https://esewahub.in/sitemap.xml\n');
    console.log('✅ robots.txt updated');

    console.log('\n🎉 All done!');
    console.log('Total pages: ' + (postEntries.length + serviceEntries.length));
    console.log('Total URLs: ' + (generatedUrls.length + 6));

    process.exit(0);
}

generate().catch(function (e) {
    console.error('❌ Error:', e);
    process.exit(1);
});