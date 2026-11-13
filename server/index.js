import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createTopRated } from './topRated.js';

const PORT = Number(process.env.PORT) || 5174;
// Only reachable from this machine by default; put a reverse proxy (Tailscale, Caddy) in front.
const HOST = process.env.HOST || '127.0.0.1';
const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/';

const app = express();

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HttpError(res.status, body.slice(0, 300) || res.statusText);
  }
  return res.json();
}

/** In-memory cache with in-flight de-duplication; serves stale data on 429s. */
const cache = new Map();
function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && 'value' in hit && Date.now() - hit.time < ttlMs) return Promise.resolve(hit.value);
  if (hit?.pending) return hit.pending;

  const pending = loader()
    .then((value) => {
      cache.set(key, { value, time: Date.now() });
      return value;
    })
    .catch((err) => {
      if (hit && 'value' in hit) {
        cache.set(key, { value: hit.value, time: hit.time });
        if (err.status === 429) return hit.value;
      } else {
        cache.delete(key);
      }
      throw err;
    });
  cache.set(key, { ...hit, pending });
  return pending;
}

function validSymbol(req) {
  const s = String(req.params.symbol || '').toUpperCase();
  if (!/^[A-Z0-9.\-^=]{1,20}$/.test(s)) throw new HttpError(400, 'Invalid symbol');
  return s;
}

const isoDate = (d) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Finnhub: search, quote, profile, metrics, analyst ratings, news
// ---------------------------------------------------------------------------

const MISSING_KEY = 'FINNHUB_API_KEY is not set. Get a free key at finnhub.io and add it to .env.';
function finnhubKey() {
  const token = process.env.FINNHUB_API_KEY;
  return token && !token.startsWith('your_') ? token : null;
}

function finnhub(endpoint, params = {}) {
  const token = finnhubKey();
  if (!token) return Promise.reject(new HttpError(500, MISSING_KEY));
  const url = new URL(FINNHUB_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('token', token);
  return fetchJson(url).catch((err) => {
    if (err.status === 401) throw new HttpError(401, 'Finnhub rejected the API key. Check FINNHUB_API_KEY in .env.');
    if (err.status === 403) throw new HttpError(403, 'This data is not included in Finnhub’s free plan for this symbol.');
    if (err.status === 429) throw new HttpError(429, 'Finnhub rate limit hit. Try again in a moment.');
    throw err;
  });
}

app.get('/api/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    if (q.length > 40) throw new HttpError(400, 'Query too long');
    const data = await cached(`fh:search:${q.toLowerCase()}`, 60 * 60e3, () => finnhub('/search', { q }));
    const results = (data.result || [])
      .filter((r) => r.symbol && ['Common Stock', 'ETP', 'ADR', 'REIT', ''].includes(r.type ?? ''))
      .slice(0, 12)
      .map((r) => ({ symbol: r.symbol, name: r.description, type: r.type }));
    res.json(results);
  } catch (err) {
    next(err);
  }
});

app.get('/api/stock/:symbol', async (req, res, next) => {
  try {
    const symbol = validSymbol(req);
    const [quote, profile, metrics, recs] = await Promise.allSettled([
      cached(`fh:quote:${symbol}`, 15e3, () => finnhub('/quote', { symbol })),
      cached(`fh:profile:${symbol}`, 24 * 60 * 60e3, () => finnhub('/stock/profile2', { symbol })),
      cached(`fh:metric:${symbol}`, 60 * 60e3, () => finnhub('/stock/metric', { symbol, metric: 'all' })),
      cached(`fh:rec:${symbol}`, 6 * 60 * 60e3, () => finnhub('/stock/recommendation', { symbol })),
    ]);
    // Surface a bad API key instead of silently showing an empty page.
    const authErr = [quote, profile].find((r) => r.status === 'rejected' && r.reason.status === 401);
    if (authErr) throw authErr.reason;

    const m = metrics.status === 'fulfilled' ? metrics.value.metric || {} : {};
    const q = quote.status === 'fulfilled' && quote.value.c > 0 ? quote.value : null;
    res.json({
      symbol,
      quote: q, // c=current, d=change, dp=%change, h, l, o, pc=prev close
      profile: profile.status === 'fulfilled' ? profile.value : {},
      metrics: {
        week52High: m['52WeekHigh'],
        week52Low: m['52WeekLow'],
        peTTM: m.peTTM ?? m.peBasicExclExtraTTM,
        epsTTM: m.epsTTM,
        beta: m.beta,
        dividendYield: m.currentDividendYieldTTM ?? m.dividendYieldIndicatedAnnual,
      },
      recommendation: recs.status === 'fulfilled' && Array.isArray(recs.value) ? recs.value[0] || null : null,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/news/:symbol', async (req, res, next) => {
  try {
    const symbol = validSymbol(req);
    const to = new Date();
    const from = new Date(Date.now() - 14 * 24 * 60 * 60e3);
    const [fh, yh] = await Promise.allSettled([
      cached(`fh:news:${symbol}`, 2 * 60e3, () =>
        finnhub('/company-news', { symbol, from: isoDate(from), to: isoDate(to) })
      ),
      cached(`yh:news:${symbol}`, 2 * 60e3, () => yahooNews(symbol)),
    ]);
    if (fh.status === 'rejected' && yh.status === 'rejected') throw fh.reason;
    const finnhubItems = fh.status === 'fulfilled' ? fh.value : [];
    const yahooItems = yh.status === 'fulfilled' ? yh.value : [];
    res.json(dedupeNews(mergeYahooNews(finnhubItems, yahooItems)).slice(0, 40));
  } catch (err) {
    next(err);
  }
});

// Yahoo's news search (same unofficial API as the charts) includes each
// article's real thumbnail, unlike Yahoo's web pages, which sit behind a
// cookie-consent wall in the UK/EU.
const headlineKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function pickThumbnail(thumbnail) {
  const sizes = (thumbnail?.resolutions || []).filter((r) => r.url && r.width);
  if (!sizes.length) return null;
  sizes.sort((a, b) => a.width - b.width);
  return (sizes.find((r) => r.width >= 400) || sizes[sizes.length - 1]).url;
}

async function yahooNews(symbol) {
  const url =
    'https://query1.finance.yahoo.com/v1/finance/search?' +
    new URLSearchParams({ q: toYahooSymbol(symbol), quotesCount: '0', newsCount: '25', enableFuzzyQuery: 'false' });
  const data = await fetchJson(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  return (data.news || [])
    .filter((n) => n.title && n.link)
    .map((n) => ({
      id: n.uuid,
      headline: n.title,
      summary: '',
      source: n.publisher || 'Yahoo',
      url: n.link,
      image: pickThumbnail(n.thumbnail),
      datetime: n.providerPublishTime,
    }));
}

/** Give Finnhub articles Yahoo's image when the headline matches, and add Yahoo-only articles. */
function mergeYahooNews(finnhubItems, yahooItems) {
  const byHeadline = new Map(yahooItems.map((n) => [headlineKey(n.headline), n]));
  const merged = finnhubItems.map((n) => {
    const match = byHeadline.get(headlineKey(n.headline));
    if (!match) return n;
    byHeadline.delete(headlineKey(n.headline));
    return { ...n, image: match.image || n.image };
  });
  return [...merged, ...byHeadline.values()];
}

app.get('/api/market-news', async (_req, res, next) => {
  try {
    const news = await cached('fh:market-news', 2 * 60e3, () => finnhub('/news', { category: 'general' }));
    res.json(dedupeNews(news).slice(0, 40));
  } catch (err) {
    next(err);
  }
});

function dedupeNews(items = []) {
  const seen = new Set();
  const out = items
    .filter((n) => n.headline && !seen.has(n.headline) && seen.add(n.headline))
    .sort((a, b) => b.datetime - a.datetime)
    .map(({ id, headline, summary, source, url, image, datetime }) => ({
      id, headline, summary, source, url, image: /^https?:\/\//.test(image || '') ? image : null, datetime,
    }));
  for (const n of out) if (/^https?:\/\//.test(n.url || '')) rememberNewsUrl(n.url);
  return out;
}

// ---------------------------------------------------------------------------
// News images: many articles come without an image, so look up the article's
// preview image (og:image / twitter:image). Only URLs that came from our own
// news results are fetched, so this can't be used to make the server request
// arbitrary addresses.
// ---------------------------------------------------------------------------

const knownNewsUrls = new Set();
const imageUsers = new Map(); // image URL -> Set of article URLs that returned it
function rememberNewsUrl(url) {
  if (knownNewsUrls.size > 5000) {
    knownNewsUrls.clear();
    imageUsers.clear();
  }
  knownNewsUrls.add(url);
}

const decodeHtml = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function findMetaImage(html) {
  for (const name of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) {
    const n = name.replace(/[.:]/g, '\\$&');
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${n}["']`,
      'i'
    );
    const m = html.match(re);
    if (m) return decodeHtml(m[1] || m[2]);
  }
  return null;
}

async function fetchArticleImage(articleUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(articleUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    });
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return null;
    // Landed on a cookie-consent wall (e.g. Yahoo in the UK/EU): its image is just a logo.
    if (/(^|\.)(consent|guce)\.yahoo\.com$/i.test(new URL(res.url).hostname)) return null;

    // The meta tags are in <head>: read at most ~300KB.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    while (html.length < 300_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});

    const found = findMetaImage(html);
    if (!found) return null;
    const abs = new URL(found, res.url).href;
    return /^https?:\/\//.test(abs) ? abs : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/news-image', async (req, res, next) => {
  try {
    const url = String(req.query.url || '');
    if (!knownNewsUrls.has(url)) throw new HttpError(404, 'Unknown article');
    const image = await cached(`img:${url}`, 24 * 60 * 60e3, async () => {
      const img = await fetchArticleImage(url);
      if (img) {
        const users = imageUsers.get(img) || new Set();
        users.add(url);
        imageUsers.set(img, users);
      }
      return img;
    });
    // The same image on several different articles is a site logo, not a photo.
    const isLogo = image && (imageUsers.get(image)?.size || 0) >= 3;
    res.set('Cache-Control', 'public, max-age=3600').json({ image: isLogo ? null : image });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Yahoo (unofficial, no key): price history for charts and period performance.
// If Yahoo changes or blocks this endpoint, only charts/performance stop working.
// ---------------------------------------------------------------------------

/** Finnhub uses "BRK.B" for share classes; Yahoo uses "BRK-B". Exchange suffixes (".L") stay. */
const toYahooSymbol = (s) => s.replace(/^([A-Z]+)\.([ABC])$/, '$1-$2');

/** `range` is a Yahoo range ("1d", "2y") or { period1, period2 } in unix seconds. */
async function yahooChart(symbol, range, interval) {
  const span =
    typeof range === 'string' ? `range=${range}` : `period1=${range.period1}&period2=${range.period2}`;
  const url = `${YAHOO_CHART}${encodeURIComponent(toYahooSymbol(symbol))}?${span}&interval=${interval}&includePrePost=false`;
  let data;
  try {
    data = await fetchJson(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  } catch (err) {
    if (err.status === 404) throw new HttpError(404, `No price history found for ${symbol}.`);
    throw new HttpError(502, `Price history provider (Yahoo) unavailable: ${err.status || err.message}`);
  }
  const r = data?.chart?.result?.[0];
  if (!r || !r.timestamp) throw new HttpError(404, `No price history found for ${symbol}.`);
  const closes = r.indicators?.quote?.[0]?.close || [];
  const points = r.timestamp
    .map((t, i) => ({ t: t * 1000, c: closes[i] }))
    .filter((p) => p.c != null);
  return {
    currency: r.meta?.currency,
    price: r.meta?.regularMarketPrice,
    priceTime: r.meta?.regularMarketTime ? r.meta.regularMarketTime * 1000 : null,
    previousClose: r.meta?.chartPreviousClose ?? r.meta?.previousClose,
    exchange: r.meta?.exchangeName,
    points,
  };
}

/** Full price history (weekly closes), for the "Max" period. Loaded once per stock by the client. */
app.get('/api/history-max/:symbol', async (req, res, next) => {
  try {
    const symbol = validSymbol(req);
    const all = await cached(`yh:max:${symbol}`, 6 * 60 * 60e3, () =>
      // An explicit date range: with range=max Yahoo downgrades the interval to quarterly.
      yahooChart(symbol, { period1: 0, period2: Math.floor(Date.now() / 1000) }, '1wk')
    );
    res.json({ symbol, points: all.points });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Exchange rates to GBP (Yahoo "USDGBP=X" style pairs).
// ---------------------------------------------------------------------------

const PENCE = new Set(['GBp', 'GBX']);
const validCurrency = (c) => /^[A-Za-z]{3}$/.test(c);

/** GBP per 1 unit of `currency`, now. */
async function fxRateNow(currency) {
  if (currency === 'GBP') return 1;
  if (PENCE.has(currency)) return 0.01;
  const c = currency.toUpperCase();
  const r = await cached(`fx:${c}`, 5 * 60e3, () => yahooChart(`${c}GBP=X`, '1d', '1h'));
  if (!(r.price > 0)) throw new HttpError(502, `No exchange rate for ${c}`);
  return r.price;
}

/** GBP per 1 unit of `currency` at the close on (or just before) `date` (YYYY-MM-DD). */
async function fxRateOn(currency, date) {
  if (currency === 'GBP') return 1;
  if (PENCE.has(currency)) return 0.01;
  const c = currency.toUpperCase();
  const end = Math.floor(new Date(`${date}T23:59:59Z`).getTime() / 1000);
  const r = await cached(`fx:${c}:${date}`, 7 * 24 * 60 * 60e3, () =>
    yahooChart(`${c}GBP=X`, { period1: end - 10 * 86400, period2: end }, '1d')
  );
  const point = [...r.points].reverse().find((p) => p.t / 1000 <= end && p.c > 0);
  if (!point) throw new HttpError(404, `No ${c}/GBP rate around ${date}`);
  return point.c;
}

/** GET /api/fx?currencies=USD,EUR  ->  { USD: 0.79, EUR: 0.85 } (GBP per unit) */
app.get('/api/fx', async (req, res, next) => {
  try {
    const list = [...new Set(String(req.query.currencies || '').split(',').filter(validCurrency))].slice(0, 20);
    const rates = await Promise.allSettled(list.map(fxRateNow));
    const out = {};
    rates.forEach((r, i) => r.status === 'fulfilled' && (out[list[i]] = r.value));
    res.json(out);
  } catch (err) {
    next(err);
  }
});

/** GET /api/fx/on?currency=USD&date=2024-03-01  ->  { rate } */
app.get('/api/fx/on', async (req, res, next) => {
  try {
    const currency = String(req.query.currency || '');
    const date = String(req.query.date || '');
    if (!validCurrency(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Bad currency or date');
    res.json({ rate: await fxRateOn(currency, date) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/history/:symbol', async (req, res, next) => {
  try {
    const symbol = validSymbol(req);
    const [daily, day, week] = await Promise.all([
      // 2 years of daily closes, so the 1Y comparison always has a starting point
      cached(`yh:daily:${symbol}`, 30 * 60e3, () => yahooChart(symbol, '2y', '1d')),
      cached(`yh:1d:${symbol}`, 60e3, () => yahooChart(symbol, '1d', '5m')),
      cached(`yh:5d:${symbol}`, 5 * 60e3, () => yahooChart(symbol, '5d', '30m')),
    ]);
    res.json({
      symbol,
      currency: day.currency || daily.currency,
      price: day.price ?? daily.price,
      priceTime: day.priceTime ?? daily.priceTime,
      previousClose: day.previousClose,
      daily: daily.points,
      intraday: day.points,
      week: week.points,
    });
  } catch (err) {
    next(err);
  }
});

/** Latest price for several symbols at once (used by the "My stocks" summary). */
app.get('/api/quotes', async (req, res, next) => {
  try {
    const symbols = [
      ...new Set(
        String(req.query.symbols || '')
          .toUpperCase()
          .split(',')
          .filter((s) => /^[A-Z0-9.\-^=]{1,20}$/.test(s))
      ),
    ].slice(0, 50);
    const results = await Promise.allSettled(
      symbols.map((s) => cached(`yh:1d:${s}`, 60e3, () => yahooChart(s, '1d', '5m')))
    );
    const out = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        const { price, priceTime, previousClose, currency } = r.value;
        out[symbols[i]] = { price, priceTime, previousClose, currency };
      } else {
        out[symbols[i]] = { error: r.reason.message };
      }
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Real-time trades: one shared Finnhub WebSocket, relayed to browsers via
// Server-Sent Events so the API key never reaches the client.
// Free plan: US stocks only, max 50 symbols, trades arrive only while the
// market is trading.
// ---------------------------------------------------------------------------

// Finnhub allows one stream per API key, so the live stream is off in dev
// (`npm run dev`) to leave it free for the production copy. LIVE_STREAM=on/off overrides.
const STREAM_ENABLED = process.env.LIVE_STREAM
  ? !['off', 'false', '0'].includes(process.env.LIVE_STREAM.toLowerCase())
  : process.env.NODE_ENV === 'production';
const STREAM_MAX_SYMBOLS = 50;
const STREAM_FLUSH_MS = 500; // batch trades: busy stocks can print hundreds per second
const isStreamable = (s) => /^[A-Z]{1,6}(\.[ABC])?$/.test(s); // US-style tickers only

const live = {
  ws: null,
  connected: false,
  retry: 0,
  closeTimer: null,
  refs: new Map(), // symbol -> number of browser streams watching it
  latest: new Map(), // symbol -> { s, p, t }
  dirty: new Set(),
  clients: new Set(), // { res, symbols: Set }
};

function wsSend(msg) {
  if (live.ws?.readyState === WebSocket.OPEN) live.ws.send(JSON.stringify(msg));
}

function ensureSocket() {
  const token = finnhubKey();
  if (live.ws || !token || live.refs.size === 0) return;

  const ws = new WebSocket(`wss://ws.finnhub.io?token=${token}`);
  live.ws = ws;

  ws.on('open', () => {
    live.connected = true;
    live.retry = 0;
    for (const s of live.refs.keys()) wsSend({ type: 'subscribe', symbol: s });
    broadcastStatus();
  });

  ws.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf);
    } catch {
      return;
    }
    if (msg.type === 'trade') {
      for (const tr of msg.data || []) {
        const prev = live.latest.get(tr.s);
        if (!prev || tr.t >= prev.t) {
          live.latest.set(tr.s, { s: tr.s, p: tr.p, t: tr.t });
          live.dirty.add(tr.s);
        }
      }
    } else if (msg.type === 'error') {
      console.warn('Finnhub stream:', msg.msg);
    }
  });

  ws.on('close', () => {
    live.ws = null;
    live.connected = false;
    broadcastStatus();
    if (live.refs.size) {
      // 1s, 2s, 4s ... capped at 5 minutes
      const delay = Math.min(5 * 60_000, 1000 * 2 ** live.retry++);
      setTimeout(ensureSocket, delay);
    }
  });

  // 'close' always follows 'error'
  ws.on('error', (err) => {
    if (/\b429\b/.test(err.message)) {
      // Finnhub's free plan allows one stream per API key. Retrying quickly keeps
      // the block alive, so wait at least a minute and back off from there.
      live.retry = Math.max(live.retry, 6);
      console.warn(
        `Finnhub live stream refused (429): this API key is probably streaming somewhere else ` +
          `(e.g. another copy of this app). Prices fall back to 15s updates; retrying in ~${Math.round(Math.min(300, 2 ** live.retry))}s.`
      );
    } else {
      console.warn('Finnhub stream error:', err.message);
    }
  });
}

function subscribe(symbol) {
  clearTimeout(live.closeTimer);
  const n = live.refs.get(symbol) || 0;
  live.refs.set(symbol, n + 1);
  if (n === 0) wsSend({ type: 'subscribe', symbol });
}

function unsubscribe(symbol) {
  const n = (live.refs.get(symbol) || 1) - 1;
  if (n > 0) return live.refs.set(symbol, n);
  live.refs.delete(symbol);
  live.latest.delete(symbol);
  wsSend({ type: 'unsubscribe', symbol });
  // Keep the socket briefly so flicking between stocks doesn't reconnect each time.
  if (live.refs.size === 0) {
    live.closeTimer = setTimeout(() => !live.refs.size && live.ws?.close(), 30_000);
  }
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastStatus() {
  for (const c of live.clients) sse(c.res, 'status', { connected: live.connected });
}

setInterval(() => {
  if (!live.dirty.size) return;
  for (const c of live.clients) {
    const trades = [...live.dirty].filter((s) => c.symbols.has(s)).map((s) => live.latest.get(s));
    if (trades.length) sse(c.res, 'trades', trades);
  }
  live.dirty.clear();
}, STREAM_FLUSH_MS);

app.get('/api/stream', (req, res) => {
  // 204 tells the browser's EventSource to stop and not reconnect.
  if (!STREAM_ENABLED) return res.status(204).end();
  if (!finnhubKey()) return res.status(500).json({ error: MISSING_KEY });

  const symbols = [
    ...new Set(String(req.query.symbols || '').toUpperCase().split(',').filter(isStreamable)),
  ].slice(0, STREAM_MAX_SYMBOLS);
  if (!symbols.length) return res.status(400).json({ error: 'No streamable (US) symbols given.' });

  const newCount = symbols.filter((s) => !live.refs.has(s)).length;
  if (live.refs.size + newCount > STREAM_MAX_SYMBOLS) {
    return res.status(429).json({ error: `Live stream is limited to ${STREAM_MAX_SYMBOLS} symbols on the free plan.` });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const client = { res, symbols: new Set(symbols) };
  live.clients.add(client);
  symbols.forEach(subscribe);
  ensureSocket();

  sse(res, 'status', { connected: live.connected });
  const snapshot = symbols.map((s) => live.latest.get(s)).filter(Boolean);
  if (snapshot.length) sse(res, 'trades', snapshot);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    live.clients.delete(client);
    symbols.forEach(unsubscribe);
  });
});

// ---------------------------------------------------------------------------
// Errors + static build
// ---------------------------------------------------------------------------

// Strong buys by sector (analyst consensus over a fixed list of large US stocks)
app.get('/api/top-rated', createTopRated({ finnhub, cached }));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, HOST, () => {
  console.log(`Server on http://${HOST}:${PORT}`);
  console.log(`Live price stream: ${STREAM_ENABLED ? 'on' : 'off (dev mode; prices update every 15s). Set LIVE_STREAM=on to enable'}`);
});
