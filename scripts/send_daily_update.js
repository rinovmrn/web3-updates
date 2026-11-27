const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID kosong! Cek Settings > Secrets and variables > Actions.');
  process.exit(1);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeXmlEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
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
    return null;
  }
}

async function fetchFearAndGreed() {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    if (!res.ok) throw new Error(`FNG HTTP ${res.status}`);
    const data = await res.json();
    const item = data?.data?.[0];
    return item ? `${item.value} (${item.value_classification})` : 'N/A';
  } catch (err) {
    return 'N/A';
  }
}

async function fetchTopHeadlines() {
  const feeds = [
    { sector: 'Market & Macro', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    { sector: 'Ecosystem & DeFi', url: 'https://cointelegraph.com/rss' }
  ];

  const results = [];

  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Web3DailyBot/1.0)' }
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?<\/item>/g)]
        .slice(0, 3)
        .map((m, idx) => `${idx + 1}. ${escapeHtml(decodeXmlEntities(m[1]))}`);

      if (items.length > 0) {
        results.push(`<b>${escapeHtml(feed.sector)}:</b>\n${items.join('\n')}`);
      }
    } catch (e) {
      console.warn(`Failed fetching ${feed.sector}:`, e.message);
    }
  }

  return results.join('\n\n');
}

function formatLine(symbol, info) {
  if (!info) return `• ${symbol}: N/A`;
  const priceStr = info.price >= 100
    ? `$${info.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${info.price.toFixed(2)}`;
  const sign = info.change >= 0 ? '+' : '';
  return `• ${symbol}: ${priceStr} (${sign}${info.change.toFixed(2)}%)`;
}

async function sendToTelegram(htmlText) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });

  const result = await res.json();
  if (!result.ok) {
    throw new Error(`Telegram API Error (${result.error_code}): ${result.description}`);
  }
  console.log('Berhasil terkirim ke Telegram!');
}

async function main() {
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const [prices, sentiment, headlines] = await Promise.all([
    fetchCryptoPrices(),
    fetchFearAndGreed(),
    fetchTopHeadlines()
  ]);

  const message = [
    `🔥 <b>Web3 Daily Updates — ${escapeHtml(dateStr)}</b>`,
    ``,
    `<b>Market Snapshot:</b>`,
    formatLine('$BTC', prices?.btc),
    formatLine('$ETH', prices?.eth),
    formatLine('$SOL', prices?.sol),
    `• Sentiment: ${escapeHtml(sentiment)}`,
    ``,
    headlines || '<i>No headlines fetched today.</i>',
    ``,
    `👉 Open Command Center to polish your X thread.`
  ].join('\n');

  await sendToTelegram(message);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
