# Web3 Daily Updates — Content Command Center

A daily command center for tracking crypto and Web3 market developments, receiving automated curated digests on Telegram, importing summaries into the dashboard, and drafting X/Twitter threads ready to post.

## Key Features

1. **Market Pulse & Top 10 Watchlist**
   - Live price tracking and 24-hour percentage changes for `$BTC`, `$ETH`, and `$SOL`, paired with a *Fear & Greed Gauge*.
   - Top 10 watchlists across **Top 10 Crypto**, **Top 10 RWA**, and **Top 10 US Stocks** with one-click insertion into market analysis.

2. **5 Daily Curation Sectors**
   - **Web3 Cybersecurity** (*exploits*, *audits*, *phishing*)
   - **AI x Web3** (*AI agents*, *DePIN*, *compute*)
   - **Market Analysis & On-Chain Flow** (*ETF flows*, *liquidity*, *macro*)
   - **Airdrop Hunting & Creator Campaign** (*airdrops*, *quests*, *creator programs*)
   - **General Web3 & Regulation** (*adoption*, *regulation*, *infra*)

3. **X Thread Studio & Quick Import**
   - **Quick Import Telegram Digest:** Paste messages from your Telegram bot to split content into the 5 sector cards with clear per-sector status badges.
   - **Style & Hook/CTA Presets:** Switch between writing styles (*Crypto Twitter Native*, *Sharp & Bullet Brief*, *Santai & Tajam*), output formats (*Multi-Tweet Thread* or *Single Long Post*), and *Hook & CTA* presets.
   - **Content Evaluation Notes:** Save daily evaluation notes locally in your browser (`localStorage`).

## Telegram Automation via GitHub Actions

The `.github/workflows/daily_web3_telegram.yml` workflow runs `scripts/send_daily_update.js` automatically:
- **Morning Brief:** `10:00 WIB` (`03:00 UTC`)
- **Evening Recap:** `20:00 WIB` (`13:00 UTC`)
- **Manual Run:** Trigger anytime via **Actions > Daily Web3 Updates to Telegram > Run workflow**.

### Required GitHub Secrets
Configure these two repository secrets under **Settings > Secrets and variables > Actions**:
- `TELEGRAM_BOT_TOKEN` — Bot token generated from `@BotFather`
- `TELEGRAM_CHAT_ID` — Target chat, group, or private channel ID

## Repository Structure

```text
├── .github/workflows/daily_web3_telegram.yml
├── scripts/send_daily_update.js
├── index.html
└── README.md
```
