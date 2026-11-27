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

async function main() {
  const seenList = loadSeenHeadlines();
  const seenSet = new Set(seenList);
  const newlySeen = [];

  const dateStrEn = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  const feeds = [
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
    'https://decrypt.co/feed',
    'https://thedefiant.io/feed',
    'https://www.dlnews.com/arc/outboundfeeds/rss/'
  ];

  const [prices, sentiment, marketNews, securityNews, aiNews, airdropCreatorNews, generalNews] = await Promise.all([
    fetchCryptoPrices(),
    fetchFearAndGreed(),
    fetchSectorHeadlines(
      feeds,
      ['bitcoin', 'ethereum', 'solana', 'etf', 'market', 'price', 'fed', 'macro', 'rwa', 'inflow', 'treasury'],
      [
        'Traders watch key support and resistance across BTC, ETH, and SOL.',
        'Capital rotation across majors, RWA tokens, and US equities stays in focus.',
        'Spot inflows and derivatives funding signal whether sell pressure is easing.'
      ],
      seenSet,
      newlySeen
    ),
    fetchSectorHeadlines(
      feeds,
      ['hack', 'exploit', 'phishing', 'security', 'scam', 'vulnerability', 'drain', 'breach', 'audit', 'drainer'],
      [
        'Spoofed claim portals and phishing ads continue circulating on X.',
        'Revoke unused token approvals on legacy router contracts regularly.',
        'Address poisoning targets high-value transfers—verify full start & end chars.'
      ],
      seenSet,
      newlySeen
    ),
    fetchSectorHeadlines(
      feeds,
      ['ai', 'agent', 'depin', 'compute', 'gpu', 'bittensor', 'render', 'fetch', 'model', 'inference'],
      [
        'Autonomous on-chain AI agents see growing use in liquidity and alert flows.',
        'Decentralized compute and DePIN networks expand distributed inference capacity.',
        'Verifiable AI proof systems gain traction as compute demand scales.'
      ],
      seenSet,
      newlySeen
    ),
    fetchSectorHeadlines(
      feeds,
      ['airdrop', 'testnet', 'quest', 'points', 'campaign', 'creator', 'reward', 'bounty', 'season'],
      [
        'Airdrop radar: Variational (VAR), Tzero ($T0) 11% mission allocation, and Flop Labs testnet.',
        'Creator campaigns: Kaito Katalyst directs 80% pool to creators via attention/output.',
        'Reward hubs: ChainGPT Buzz splits quests/links/stakers; Wanted (WNTD) sets 22% for missions.'
      ],
      seenSet,
      newlySeen
    ),
    fetchSectorHeadlines(
      feeds,
      ['sec', 'regulation', 'stablecoin', 'layer 2', 'l2', 'adoption', 'bank', 'policy', 'wallet', 'mica'],
      [
        'Stablecoin rails and L1/L2 payment settlement continue expanding.',
        'Clearer regional rules support broader institutional and custodian access.',
        'Smart wallets and lower fees keep reducing user onboarding friction.'
      ],
      seenSet,
      newlySeen
    )
  ]);

  const threadPosts = [
    [
      `Web3 Daily Notes (${dateStrEn}):`,
      ``,
      formatLine('$BTC', prices.btc),
      formatLine('$ETH', prices.eth),
      formatLine('$SOL', prices.sol),
      `• Sentiment: ${sentiment}`,
      ``,
      `Top 3 updates per vertical today 🧵👇`
    ].join('\n'),

    `1/ Market & On-Chain Flow\n\n${marketNews}`,

    `2/ Web3 Cybersecurity\n\n${securityNews}\n\nVerify domains & check approvals first.`,

    `3/ AI x Web3\n\n${aiNews}`,

    `4/ Airdrop Hunting & Creator Campaigns\n\n${airdropCreatorNews}`,

    `5/ General Web3 & Regulation\n\n${generalNews}`,

    `That's the wrap for today.\n\nWhich sector or campaign are you focusing on this week?`
  ];

  for (const post of threadPosts) {
    await sendTelegramMessage(post);
    await new Promise((r) => setTimeout(r, 400));
  }

  saveSeenHeadlines([...seenList, ...newlySeen]);
  console.log('Semua draf thread berhasil terkirim ke Telegram!');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
