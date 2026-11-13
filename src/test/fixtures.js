/** Shared fake API responses. Prices are chosen so the expected percentages are round numbers. */

const DAY = 86_400_000;

export const now = () => Date.now();

/**
 * AAPL-like history. Current price 110, previous close 100.
 *  - older than 200 days: closes at 50   -> 1 year  = +120%
 *  - last 200 days:       closes at 100  -> 1W/1M/3M/6M = +10%
 */
export function makeHistory(overrides = {}) {
  const t = now();
  const daily = [];
  for (let age = 499; age >= 0; age--) daily.push({ t: t - age * DAY, c: age > 200 ? 50 : 100 });
  return {
    symbol: 'AAPL',
    currency: 'USD',
    price: 110,
    priceTime: t,
    previousClose: 100,
    daily,
    intraday: [
      { t: t - 3 * 3_600_000, c: 101 },
      { t: t - 2 * 3_600_000, c: 105 },
      { t: t - 1 * 3_600_000, c: 108 },
    ],
    week: [
      { t: t - 6 * DAY, c: 100 },
      { t: t - 4 * DAY, c: 100 },
      { t: t - 2 * DAY, c: 100 },
    ],
    ...overrides,
  };
}

/** First price 11 ten years ago -> Max = +900%. */
export function makeMaxHistory() {
  const t = now();
  return {
    symbol: 'AAPL',
    points: [
      { t: t - 3650 * DAY, c: 11 },
      { t: t - 1800 * DAY, c: 50 },
      { t: t - 7 * DAY, c: 100 },
    ],
  };
}

export function makeStock(overrides = {}) {
  return {
    symbol: 'AAPL',
    quote: { c: 110, d: 10, dp: 10, h: 111, l: 99, o: 100, pc: 100, t: Math.floor(now() / 1000) - 120 },
    profile: {
      name: 'Apple Inc',
      exchange: 'NASDAQ',
      finnhubIndustry: 'Technology',
      currency: 'USD',
      marketCapitalization: 3_000_000, // in millions
    },
    metrics: { week52High: 120, week52Low: 60, peTTM: 30.5, epsTTM: 6.1, beta: 1.2, dividendYield: 0.5 },
    // (20*5 + 10*4 + 2*3) / 32 = 4.56 -> "Strong buy"
    recommendation: { strongBuy: 20, buy: 10, hold: 2, sell: 0, strongSell: 0, period: '2026-11-01' },
    ...overrides,
  };
}

export const newsItem = (id, headline, extra = {}) => ({
  id,
  headline,
  summary: '',
  source: 'Reuters',
  url: `https://news.example/${id}`,
  image: null,
  datetime: Math.floor(now() / 1000) - 600,
  ...extra,
});

const rated = (symbol, name, region, country, label, score, counts) => ({
  symbol, name, region, country, label, score,
  sector: 'x',
  analysts: Object.values(counts).reduce((a, b) => a + b, 0),
  buyPct: 90,
  trend: 0,
  period: '2026-11-01',
  counts,
});

export function makeTopRated(overrides = {}) {
  return {
    scanning: false,
    done: 344,
    total: 344,
    updatedAt: now(),
    error: null,
    sectors: [
      {
        name: 'Technology',
        stocks: [
          rated('NVDA', 'Nvidia', 'US', 'US', 'Strong buy', 4.3, { strongBuy: 25, buy: 41, hold: 2, sell: 1, strongSell: 0 }),
          rated('TSM', 'TSMC', 'Asia', 'Taiwan', 'Strong buy', 4.24, { strongBuy: 12, buy: 28, hold: 2, sell: 0, strongSell: 0 }),
          rated('ASML', 'ASML', 'Europe', 'Netherlands', 'Buy', 4.02, { strongBuy: 9, buy: 27, hold: 4, sell: 2, strongSell: 0 }),
        ],
      },
      {
        name: 'Energy',
        stocks: [
          rated('XOM', 'Exxon Mobil', 'US', 'US', 'Hold', 3.4, { strongBuy: 3, buy: 8, hold: 14, sell: 2, strongSell: 0 }),
        ],
      },
    ],
    ...overrides,
  };
}
