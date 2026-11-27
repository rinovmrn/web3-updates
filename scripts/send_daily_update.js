const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID kosong!');
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
    return item ? `${item.value} (${item.value_classification})` : '22 (Extreme Fear)';
  } catch (err) {
    return '22 (Extreme Fear)';
  }
}

async function fetchSectorHeadlines(feeds, keywords = [], fallbackItems = []) {
  const matched = [];

  for (const url of feeds) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Web3DailyBot/1.0)' }
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const titles = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?<\/item>/g)]
        .map((m) => decodeXmlEntities(m[1]));

      for (const title of titles) {
        if (matched.length >= 3) break;
        const isMatch = keywords.length === 0 || keywords.some((kw) => title.toLowerCase().includes(kw.toLowerCase()));
        if (isMatch && !matched.includes(title)) {
          matched.push(title);
        }
      }
    } catch (e) {
      console.warn(`RSS fetch skipped (${url}):`, e.message);
    }
  }

  // Lengkapi hingga 3 poin menggunakan kurasi riset sektor jika RSS kurang dari 3
  for (const fb of fallbackItems) {
    if (matched.length >= 3) break;
    if (!matched.includes(fb)) matched.push(fb);
  }

  return matched
    .slice(0, 3)
    .map((item, idx) => `${idx + 1}. ${escapeHtml(item)}`)
    .join('\n');
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
  console.log('Berhasil mengirim 5 sektor lengkap ke Telegram!');
}

async function main() {
  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const feeds = [
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
    'https://decrypt.co/feed'
  ];

  const [prices, sentiment, marketNews, securityNews, aiNews, airdropCreatorNews, generalNews] = await Promise.all([
    fetchCryptoPrices(),
    fetchFearAndGreed(),
    fetchSectorHeadlines(
      feeds,
      ['bitcoin', 'ethereum', 'solana', 'etf', 'market', 'price', 'fed', 'macro', 'rwa', 'inflow'],
      [
        'Traders are closely watching key support and resistance levels across BTC, ETH, and SOL.',
        'Capital rotation across majors, RWA tokens, and US tech equities remains a central focus.',
        'Derivatives volume and spot inflows are key signals to gauge whether sell pressure is cooling off.'
      ]
    ),
    fetchSectorHeadlines(
      feeds,
      ['hack', 'exploit', 'phishing', 'security', 'scam', 'vulnerability', 'drain', 'breach', 'audit'],
      [
        'Phishing campaigns using spoofed domains that mimic popular staking and reward claim portals continue to circulate on X.',
        'Security researchers highlight risks from unlimited token approvals on legacy router contracts—revoke unused allowances regularly.',
        'Address poisoning attacks are still targeting high-value stablecoin transfers; verify full recipient addresses.'
      ]
    ),
    fetchSectorHeadlines(
      feeds,
      ['ai', 'agent', 'depin', 'compute', 'gpu', 'bittensor', 'render', 'fetch', 'model'],
      [
        'On-chain autonomous AI agents are seeing rising activity for automated liquidity management and real-time market monitoring.',
        'Decentralized compute and DePIN networks are expanding distributed inference capacity for Web3 builders.',
        'Cryptographic proof systems for verifying AI model outputs are gaining traction as demand for verifiable compute grows.'
      ]
    ),
    fetchSectorHeadlines(
      feeds,
      ['airdrop', 'testnet', 'quest', 'points', 'campaign', 'creator', 'reward', 'bounty'],
      [
        'Airdrop Hunter Watch: Variational (VAR) is on airdrop radars following mainnet/trading activity, Tzero ($T0) allocates 11% supply to testnet/mission users, and Flop Labs/Network remains active on testnet.',
        'Creator Campaign Update: Kaito Katalyst directs 80% of its token pool to creators based on attention/output metrics (and 20% to stakers/YT-sKAITO).',
        'Campaign & Reward Platforms: ChainGPT Buzz splits rewards across trackable links, quests, and stakers, while Wanted Network (WNTD) allocates 22% supply to creator missions.'
      ]
    ),
    fetchSectorHeadlines(
      feeds,
      ['sec', 'regulation', 'stablecoin', 'layer 2', 'l2', 'adoption', 'bank', 'policy', 'wallet'],
      [
        'Stablecoin adoption and cross-border payment rails across Layer 1 and Layer 2 networks continue to expand.',
        'Clearer regulatory frameworks across major regions are encouraging participation from custodians and financial institutions.',
        'Wallet UX improvements—such as account abstraction and lower fees—are steadily lowering onboarding friction.'
      ]
    )
  ]);

  const message = [
    `🔥 <b>Web3 Daily Notes (${escapeHtml(dateStr)})</b>`,
    ``,
    `<b>Market Snapshot:</b>`,
    formatLine('$BTC', prices?.btc),
    formatLine('$ETH', prices?.eth),
    formatLine('$SOL', prices?.sol),
    `• Sentiment: ${escapeHtml(sentiment)}`,
    ``,
    `<b>1/ Market &amp; On-Chain Flow</b>`,
    marketNews,
    ``,
    `<b>2/ Web3 Cybersecurity</b>`,
    securityNews,
    ``,
    `<b>3/ AI x Web3</b>`,
    aiNews,
    ``,
    `<b>4/ Airdrop Hunting &amp; Creator Campaigns</b>`,
    airdropCreatorNews,
    ``,
    `<b>5/ General Web3 &amp; Regulation</b>`,
    generalNews,
    ``,
    `🧵 <i>Ready to copy &amp; post to X!</i>`
  ].join('\n');

  await sendToTelegram(message);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
