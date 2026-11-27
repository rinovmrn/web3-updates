const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('Error: TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID belum diset di GitHub Secrets.');
  process.exit(1);
}

async function fetchCryptoPrices() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true'
    );
    if (!res.ok) throw new Error('CoinGecko API error');
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
    if (!res.ok) throw new Error('Fear & Greed API error');
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
      const res = await fetch(feed.url);
      if (!res.ok) continue;
      const xml = await res.text();
      const items = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?<\/item>/g)]
        .slice(0, 3)
        .map((m, idx) => `${idx + 1}. ${m[1].replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim()}`);

      if (items.length > 0) {
        results.push(`*${feed.sector}:*\n${items.join('\n')}`);
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

async function sendToTelegram(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    })
  });

  const result = await res.json();
  if (!result.ok) {
    throw new Error(`Telegram API Error: ${JSON.stringify(result)}`);
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
    `🔥 *Web3 Daily Updates — ${dateStr}*`,
    ``,
    `*Market Snapshot:*`,
    formatLine('$BTC', prices?.btc),
    formatLine('$ETH', prices?.eth),
    formatLine('$SOL', prices?.sol),
    `• Sentiment: ${sentiment}`,
    ``,
    headlines || '_No headlines fetched today._',
    ``,
    `👉 Open Command Center to polish your X thread.`
  ].join('\n');

  await sendToTelegram(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
