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

async function fetchLiveTvlMetrics() {
  let cryptoTvl = '$118.42B';
  try {
    const res = await fetch('https://api.llama.fi/v2/chains');
    if (res.ok) {
      const chains = await res.json();
      if (Array.isArray(chains) && chains.length > 0) {
        const totalUsd = chains.reduce((acc, c) => acc + (Number(c.tvl) || 0), 0);
        if (totalUsd > 0) {
          cryptoTvl = `$${(totalUsd / 1e9).toFixed(2)}B`;
        }
      }
    }
  } catch (err) {
    console.warn('DefiLlama TVL fallback used:', err.message);
  }

  return {
    cryptoTvl,
    rwaTvl: '$18.65B',
    stocksCap: '$58.90T'
  };
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

async function fetchSectorHeadlines(feeds, keywords = [], fallbackItems = [], seenSet = new Set(), newlySeen = [], maxItems = 3) {
  const matched = [];
  const fallbackCandidates = [];

  for (const url of feeds) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Web3DailyBot/1.2)' }
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
          if (!seenSet.has(title) && matched.length < maxItems) {
            matched.push(title);
            newlySeen.push(title);
          } else if (fallbackCandidates.length < maxItems) {
            fallbackCandidates.push(title);
          }
        }
      }
    } catch (e) {
      console.warn(`RSS fetch skipped (${url}):`, e.message);
    }
  }

  for (const cand of fallbackCandidates) {
    if (matched.length >= maxItems) break;
    if (!matched.includes(cand)) matched.push(cand);
  }

  for (const fb of fallbackItems) {
    if (matched.length >= maxItems) break;
    const cleanFb = shortenTitle(fb);
    if (!matched.includes(cleanFb)) matched.push(cleanFb);
  }

  return matched
    .slice(0, maxItems)
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
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
    'https://decrypt.co/feed',
    'https://thedefiant.io/feed',
    'https://www.dlnews.com/arc/outboundfeeds/rss/'
  ];

  const [prices, tvlData, sentiment, marketNews, securityNews, aiNews, generalNews] = await Promise.all([
    fetchCryptoPrices(),
    fetchLiveTvlMetrics(),
    fetchFearAndGreed(),
    fetchSectorHeadlines(
      feeds,
      ['bitcoin', 'ethereum', 'solana', 'tvl', 'etf', 'market', 'rwa', 'inflow', 'treasury'],
      [
        'Total Crypto DeFi TVL holds steady as Tokenized RWA TVL expands on-chain Treasury demand.',
        'Traders watch key support across BTC, ETH, and SOL alongside US crypto equities ($COIN, $MSTR).',
        'Spot ETF inflows and derivatives funding rates remain key signals for short-term momentum.'
      ],
      seenSet,
      newlySeen
    ),
    fetchSectorHeadlines(
      feeds,
      ['hack', 'exploit', 'phishing', 'security', 'scam', 'vulnerability', 'drain', 'breach', 'audit', 'drainer'],
      [
        'Spoofed claim portals and phishing ads continue circulating across social feeds.',
        'Revoke unused token approvals on legacy router contracts regularly.',
        'Address poisoning targets high-value transfers—verify full start & end characters.'
      ],
      seenSet,
      newlySeen
    ),
    fetchSectorHeadlines(
      feeds,
      ['ai', 'agent', 'depin', 'compute', 'gpu', 'bittensor', 'render', 'fetch', 'model', 'inference'],
      [
        'Autonomous on-chain AI agents see growing use in automated liquidity and risk alerts.',
        'Decentralized compute and DePIN networks expand distributed GPU inference capacity.',
        'Verifiable AI proof systems gain traction as protocols validate model outputs.'
      ],
      seenSet,
      newlySeen
    ),
    fetchSectorHeadlines(
      feeds,
      ['sec', 'regulation', 'stablecoin', 'layer 2', 'l2', 'adoption', 'bank', 'policy', 'wallet', 'mica'],
      [
        'Stablecoin rails and L1/L2 cross-border payment settlement continue expanding.',
        'Clearer regional rules support institutional custody and tokenization adoption.',
        'Smart wallets and account abstraction keep lowering user onboarding friction.'
      ],
      seenSet,
      newlySeen
    )
  ]);

  const airdropCampaignPoints = [
    '• Ambassador: Active regional & content ambassador tracks open across emerging L1/L2 & DePIN ecosystems.',
    '• Upcoming Airdrop (Existing Projects): Variational (VAR) mainnet trading radar & Tzero ($T0) 11% mission supply allocation.',
    '• Testnet Program: Flop Labs / Network incentivized testnet interactions & early validator/bridge quests.',
    '• Creator Campaign: Kaito Katalyst (80% creator pool), ChainGPT Buzz quests, & Wanted Network (WNTD) 22% creator missions.'
  ].join('\n');

  const threadPosts = [
    [
      `Web3 Daily Notes (${dateStrEn}) • ${sessionLabel}:`,
      ``,
      formatLine('$BTC', prices.btc),
      formatLine('$ETH', prices.eth),
      formatLine('$SOL', prices.sol),
      `• TVL & Cap: Crypto TVL ${tvlData.cryptoTvl} | RWA TVL ${tvlData.rwaTvl} | US Stocks ${tvlData.stocksCap}`,
      `• Sentiment: ${sentiment}`,
      ``,
      `Daily market & ecosystem breakdown 🧵👇`
    ].join('\n'),

    `1/ Market Analysis & TVL Flow\n\n${marketNews}`,

    `2/ Web3 Cybersecurity Radar\n\n${securityNews}\n\nVerify domains & check approvals first.`,

    `3/ AI x Web3 & DePIN\n\n${aiNews}`,

    `4/ Airdrop Hunter & Campaign Radar\n\n${airdropCampaignPoints}`,

    `5/ General Web3 & Regulation\n\n${generalNews}`,

    `That's the wrap for today.\n\nWhich sector or campaign are you focusing on this week?`
  ];

  for (const post of threadPosts) {
    await sendTelegramMessage(post);
    await new Promise((r) => setTimeout(r, 400));
  }

  saveSeenHeadlines([...seenList, ...newlySeen]);
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Selesai (${sessionLabel}) dalam ${elapsedSec}s | ${threadPosts.length} pesan terkirim.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
