const fs = require('fs');
const path = require('path');

const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const SEEN_FILE = path.join(__dirname, '.seen_headlines.json');

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID kosong!');
  process.exit(1);
}

function decodeXmlEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortenTitle(title, maxLen = 115) {
  if (title.length <= maxLen) return title;
  return `${title.slice(0, maxLen - 1).trim()}…`;
}

function loadSeenHeadlines() {
  try {
    if (!fs.existsSync(SEEN_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSeenHeadlines(list) {
  try {
    const trimmed = list.slice(-120);
    fs.writeFileSync(SEEN_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (err) {
    console.warn('Could not write seen headlines cache:', err.message);
  }
}

async function fetchCryptoPrices() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true'
    );
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = await res.json();
    return {
      btc: { price: data.bitcoin.usd, change: data.bitcoin.usd_24h_change },
      eth: { price: data.ethereum.usd, change: data.ethereum.usd_24h_change },
      sol: { price: data.solana.usd, change: data.solana.usd_24h_change }
    };
  } catch (err) {
    console.warn('Fallback prices used:', err.message);
    return {
      btc: { price: 94250, change: 2.45 },
      eth: { price: 3340, change: 1.82 },
      sol: { price: 212.40, change: -0.64 }
    };
  }
}

async function fetchFearAndGreed() {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    if (!res.ok) throw new Error(`FNG HTTP ${res.status}`);
    const data = await res.json();
    const item = data?.data?.[0];
    return item ? `${item.value} (${item.value_classification})` : '22 (Extreme Fear)';
  } catch {
    return '22 (Extreme Fear)';
  }
}

async function fetchSectorHeadlines(feeds, keywords = [], fallbackItems = [], seenSet = new Set(), newlySeen = []) {
  const matched = [];
  const fallbackCandidates = [];

  for (const url of feeds) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Web3DailyBot/1.1)' }
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const titles = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?<\/item>/g)]
        .map((m) => shortenTitle(decodeXmlEntities(m[1])));

      for (const title of titles) {
        if (!title || matched.includes(title)) continue;
        const isMatch =
          keywords.length === 0 ||
          keywords.some((kw) => title.toLowerCase().includes(kw.toLowerCase()));

        if (isMatch) {
          if (!seenSet.has(title) && matched.length < 3) {
            matched.push(title);
            newlySeen.push(title);
          } else if (fallbackCandidates.length < 3) {
            fallbackCandidates.push(title);
          }
        }
      }
    } catch (e) {
      console.warn(`RSS fetch skipped (${url}):`, e.message);
    }
  }

  for (const cand of fallbackCandidates) {
    if (matched.length >= 3) break;
    if (!matched.includes(cand)) matched.push(cand);
  }

  for (const fb of fallbackItems) {
    if (matched.length >= 3) break;
    const cleanFb = shortenTitle(fb);
    if (!matched.includes(cleanFb)) matched.push(cleanFb);
  }

  return matched
    .slice(0, 3)
    .map((item, idx) => `${idx + 1}. ${item}`)
    .join('\n');
}

function formatLine(symbol, info) {
  const priceStr = info.price >= 100
    ? `$${info.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${info.price.toFixed(2)}`;
  const sign = info.change >= 0 ? '+' : '';
  return `• ${symbol} ${priceStr} (${sign}${info.change.toFixed(1)}%)`;
}

// ... existing code ...
async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      disable_web_page_preview: true
    })
  });

  const result = await res.json();
  if (!result.ok) {
    throw new Error(`Telegram API Error (${result.error_code}): ${result.description}`);
  }
}

function getSessionLabel() {
  if (process.env.RUN_SESSION && process.env.RUN_SESSION.trim()) {
    return process.env.RUN_SESSION.trim();
  }
  const utcHour = new Date().getUTCHours();
  if (utcHour >= 0 && utcHour < 8) return 'Morning Brief (10:00 WIB)';
  if (utcHour >= 11 && utcHour < 16) return 'Evening Recap (20:00 WIB)';
  return 'Scheduled Digest';
}

async function main() {
  const startTime = Date.now();
  const seenList = loadSeenHeadlines();
  const seenSet = new Set(seenList);
  const newlySeen = [];
  const sessionLabel = getSessionLabel();

  const dateStrEn = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  const feeds = [
// ... existing code ...
  const threadPosts = [
    [
      `Web3 Daily Notes (${dateStrEn}) • ${sessionLabel}:`,
      ``,
      formatLine('$BTC', prices.btc),
      formatLine('$ETH', prices.eth),
      formatLine('$SOL', prices.sol),
      `• Sentiment: ${sentiment}`,
      ``,
      `Top 3 updates per vertical today 🧵👇`
    ].join('\n'),

    `1/ Market & On-Chain Flow\n\n${marketNews}`,
// ... existing code ...
  for (const post of threadPosts) {
    await sendTelegramMessage(post);
    await new Promise((r) => setTimeout(r, 400));
  }

  saveSeenHeadlines([...seenList, ...newlySeen]);
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Selesai (${sessionLabel}) dalam ${elapsedSec}s | ${threadPosts.length} pesan terkirim | ${newlySeen.length} headline baru.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
