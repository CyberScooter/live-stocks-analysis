# Stock Analysis

A React app for looking up any stock: live price, gains/losses over several periods, an interactive chart, company metrics, analyst ratings and news.

- **Search** by company name or ticker (e.g. `Apple`, `TSLA`, `VOD.L`).
- **Performance**: change in % and in price over **1 day, 1 week, 1 month, 3 months, 6 months, 1 year and Max** (since the stock first traded). Click a period to chart it and see its start price, high and low.
- **Analysis**: 52-week range, market cap, P/E, EPS, beta, dividend yield and the analyst consensus.
- **News**: the last 14 days of company news, plus a general market news tab.
- **Watchlist**: star stocks to keep them one click away. It's saved in your browser.

## Your positions

On any stock, click **+ Add buy price** and enter what you paid per share. Shares and buy date are optional. You'll see:

- Your return in % and the gain/loss amount, updating live with the price
- Cost, current value, how long you've held it, and your yearly return (once you've held it a year)
- Your buy price as a dashed line on the chart and a marker on the 52-week range

The **My stocks** tab lists every position with today's move, return, gain/loss and value. Totals are grouped by currency, and London holdings are added up in GBP.

Positions are saved **only in this browser** (localStorage). Use **Export** to save a backup file and **Import** to restore it or move it to another browser. Enter prices in the stock's trading currency (London stocks are in pence). Returns don't include exchange-rate moves, so they can differ from your broker's figures.

## How it works

```
React (Vite, :5173)  ──/api──▶  Express server (:5174)  ──▶  Finnhub      (search, quotes, metrics, news)
                                                         └──▶  Yahoo chart  (price history, no key)
```

The small Express server keeps your Finnhub key out of the browser and caches responses so you stay within free-plan limits. Yahoo's chart data is unofficial. If Yahoo ever changes or blocks it, the chart and performance figures stop working, but everything else still works.

## Setup

1. Install Node.js 18 or later (`brew install node`).
2. Get a free Finnhub key at https://finnhub.io/register.
3. Run:

```bash
cp .env.example .env     # add your Finnhub key
npm install
npm run dev              # open http://localhost:5173
```

For a production build, run `npm run build && npm start`. One server then handles both the app and the API on port 5174.

## Currency (Local / £ GBP)

The switch in the header shows amounts either in each stock's own trading currency or converted to GBP. Exchange rates come from Yahoo and refresh every 5 minutes.

- **Stock page:** prices, changes, chart labels and stats are converted at today's rate. % changes are the stock's own performance.
- **Your position / My stocks:** if you entered a buy date, cost is converted at the exchange rate on that date and value at today's rate. Your £ return then includes currency moves, like Trading212's, and is split into the stock's own move and the FX effect. Without a date, today's rate is used for both.
- **My stocks** in GBP mode shows one combined £ total across all your holdings.

## News images

Company news combines Finnhub with Yahoo's news feed. Yahoo's feed includes each article's real thumbnail. Finnhub articles get the matching Yahoo image when the headlines match, and Yahoo-only articles are added. For articles that still have no image, the server fetches the article's preview image. It skips cookie-consent pages (Yahoo shows one in the UK/EU) and ignores any image used on several articles, since that's a site logo. If no real image is found, a placeholder is shown.

## Live prices

For US stocks, the server opens **one** WebSocket to Finnhub's real-time trade stream and relays it to the browser with Server-Sent Events (`/api/stream`), so the key never reaches the browser. The price, % changes and the chart's last point update with every trade (batched every 0.5s), and the price flashes green/red on each tick.

The app always shows the newest of three sources:

| Source | Covers | Freshness |
|---|---|---|
| Finnhub trade stream | US stocks, while trading | Real time |
| Finnhub quote | US stocks | Every 15s |
| Yahoo chart data | All markets | ~1 min, some exchanges delayed 15–20 min |

The badge next to the price shows **Live** when trades are streaming. Outside market hours no trades arrive, so the price stays at the last close. The free plan allows up to 50 streamed symbols and one stream connection per key.

## Hosting

The app has no login, so don't expose it directly to the internet. Put Tailscale (`tailscale serve 5174`) or Caddy with `basic_auth` ([deploy/Caddyfile.example](deploy/Caddyfile.example)) in front of it.

### Docker (recommended)

```bash
cp .env.example .env        # set FINNHUB_API_KEY
docker compose up -d --build
docker compose logs -f      # watch logs
```

The container only listens on `127.0.0.1:5174` on the host. It runs as a non-root user with a read-only filesystem, restarts automatically, and has a health check at `/api/health`.

To update: copy the new code over, then run `docker compose up -d --build`.

### Without Docker

The server listens on `127.0.0.1` only (set `HOST` to change that). [deploy/stock-analysis.service](deploy/stock-analysis.service) is a systemd unit for running `node server/index.js` after `npm ci && npm run build`.

## Notes

- Periods compare the current price with the last close on or before the start of the period. "1 day" compares with the previous close.
- Finnhub's free plan only has company news and metrics for North American listings. Price, chart and performance still work for other markets through Yahoo.
- London prices are shown in pence.
- Not financial advice.
