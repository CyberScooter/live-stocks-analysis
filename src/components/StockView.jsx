import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLivePrice } from '../useLivePrice.js';
import { compact, money, num, pct, signed, tone } from '../format.js';
import { PERIODS, computePerformance } from '../performance.js';
import { toDisplay, useFxOn, useFxRates } from '../currency.js';
import NewsList from './NewsList.jsx';
import PriceChart from './PriceChart.jsx';
import PositionPanel from './PositionPanel.jsx';
import Section from './Section.jsx';

const QUOTE_REFRESH_MS = 15_000;
const HISTORY_REFRESH_MS = 60_000;
const NEWS_REFRESH_MS = 120_000;
const MAX_REFRESH_MS = 6 * 60 * 60_000; // all-time history barely changes

/** Fetch `loader` now and every `ms` while the tab is visible. Keeps last good data on errors. */
function usePolling(loader, ms, deps) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    const load = () =>
      loader()
        .then((data) => alive && setState({ data }))
        .catch((e) => alive && setState((s) => (s.data ? s : { error: e.message })));
    load();
    const id = setInterval(() => !document.hidden && load(), ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export default function StockView({
  symbol, starred, onToggleStar, position, onSavePosition, onRemovePosition, displayMode = 'native',
}) {
  const [periodKey, setPeriodKey] = useState('1M');
  const info = usePolling(() => api.stock(symbol), QUOTE_REFRESH_MS, [symbol]);
  const hist = usePolling(() => api.history(symbol), HISTORY_REFRESH_MS, [symbol]);
  const news = usePolling(() => api.news(symbol), NEWS_REFRESH_MS, [symbol]);
  const maxHist = usePolling(() => api.historyMax(symbol), MAX_REFRESH_MS, [symbol]);

  const live = useLivePrice(symbol);

  const d = info.data;
  const profile = d?.profile || {};

  // Use the newest price we have: live trade, Finnhub quote (15s) or Yahoo (~1 min).
  // Finnhub sources are only mixed in for US tickers, where both use the same currency as Yahoo.
  const latest = useMemo(() => {
    const candidates = [
      hist.data?.price != null && { p: hist.data.price, t: hist.data.priceTime || 0, source: 'yahoo' },
      live.enabled && d?.quote && { p: d.quote.c, t: (d.quote.t || 0) * 1000, source: 'quote' },
      live.enabled && live.trade && { ...live.trade, source: 'live' },
    ].filter(Boolean);
    return candidates.sort((a, b) => b.t - a.t)[0] || null;
  }, [hist.data, d?.quote, live.enabled, live.trade]);
  const price = latest?.p ?? null;

  // Extend the charts with the newest price so the last point moves in real time.
  const h = useMemo(() => {
    const base = hist.data;
    if (!base || !latest) return base;
    return {
      ...base,
      intraday: withLatest(base.intraday, latest, false),
      week: withLatest(base.week, latest, false),
      daily: withLatest(base.daily, latest, true),
      max: withLatest(maxHist.data?.points, latest, false),
    };
  }, [hist.data, maxHist.data, latest]);

  const currency = h?.currency || profile.currency;
  const perf = useMemo(() => computePerformance(h, price), [h, price]);
  // Only draw your buy price where it's in the same currency as the chart.
  const cost = position && (!position.currency || position.currency === currency) ? position.price : null;

  // Display currency: amounts are converted at today's rate; % changes stay the stock's own.
  const fxRates = useFxRates(displayMode === 'GBP' && currency ? [currency] : []);
  const conv = toDisplay(displayMode, currency, fxRates);
  const fm = (v) => money(v == null ? v : v * conv.rate, conv.currency);
  const fs = (v) => signed(v == null ? v : v * conv.rate, conv.currency);
  const buyFx = useFxOn(
    conv.converted && position?.date ? [{ currency: position.currency || currency, date: position.date }] : []
  );
  const buyRate = position?.date ? buyFx[`${position.currency || currency}@${position.date}`] : undefined;

  // Flash the price green/red when it ticks.
  const prevPrice = useRef(null);
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    if (prevPrice.current != null && price != null && price !== prevPrice.current) {
      setFlash({ dir: price > prevPrice.current ? 'up' : 'down', key: Date.now() });
    }
    prevPrice.current = price;
  }, [price]);

  const isLive = live.connected && latest?.source === 'live' && Date.now() - latest.t < 5 * 60e3;
  const feedLabel = isLive
    ? 'Live'
    : live.enabled
      ? 'Updates every 15s · live when trading'
      : 'Updates every minute · may be delayed';
  const day = perf['1D'];
  const dayChange = day ? { d: day.change, dp: day.changePct } : d?.quote ? { d: d.quote.d, dp: d.quote.dp } : null;
  const active = perf[periodKey];

  if (info.error && hist.error) {
    return (
      <section className="panel">
        <h2>{symbol}</h2>
        <p className="error-text">{info.error}</p>
        <p className="error-text">{hist.error}</p>
      </section>
    );
  }

  return (
    <div className="stock-grid">
      <div className="stock-main">
        <section className="panel">
          <div className="detail-head">
            <div className="detail-title">
              {profile.logo && <img className="logo-img" src={profile.logo} alt="" />}
              <div>
                <h2>{profile.name || symbol}</h2>
                <div className="muted small">
                  {symbol}
                  {profile.exchange ? ` · ${profile.exchange}` : ''}
                  {profile.finnhubIndustry ? ` · ${profile.finnhubIndustry}` : ''}
                </div>
              </div>
            </div>
            <button
              className={`star-btn ${starred ? 'on' : ''}`}
              onClick={onToggleStar}
              aria-pressed={starred}
              title={starred ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              {starred ? '★ Watching' : '☆ Watch'}
            </button>
          </div>

          <div className="quote-row">
            <div key={flash?.key} className={`big-price ${flash ? `flash-${flash.dir}` : ''}`}>
              {price != null ? fm(price) : '—'}
            </div>
            {dayChange && (
              <div className={`change ${tone(dayChange.d)}`}>
                {arrow(dayChange.d)} {fs(dayChange.d)} ({pct(dayChange.dp)}) today
              </div>
            )}
            {conv.converted && (
              <span className="muted small fx-note" title="Amounts converted at today's exchange rate">
                {currency === 'GBp' || currency === 'GBX'
                  ? 'Converted from pence'
                  : `Converted from ${currency} · 1 ${currency} = £${conv.rate.toFixed(4)}`}
              </span>
            )}
            <span className={`feed ${isLive ? 'on' : ''}`}>
              <span className="dot" /> {feedLabel}
              {latest?.t ? <span className="muted"> · {new Date(latest.t).toLocaleTimeString()}</span> : null}
            </span>
          </div>

          {d && <Analysis data={d} price={price} fm={fm} cost={cost} />}
        </section>

        <Section id="performance" title="Performance">
          {hist.loading ? (
            <p className="muted">Loading price history…</p>
          ) : hist.error && !h ? (
            <p className="error-text">{hist.error}</p>
          ) : (
            <>
              <div className="perf-grid" role="tablist" aria-label="Chart period">
                {PERIODS.map((p) => {
                  const r = perf[p.key];
                  return (
                    <button
                      key={p.key}
                      role="tab"
                      aria-selected={periodKey === p.key}
                      className={`perf-tile ${periodKey === p.key ? 'active' : ''}`}
                      onClick={() => setPeriodKey(p.key)}
                    >
                      <span className="perf-label">{p.label}</span>
                      {r ? (
                        <>
                          <span className={`perf-pct ${tone(r.change)}`}>
                            {arrow(r.change)} {pct(r.changePct)}
                          </span>
                          <span className={`perf-abs ${tone(r.change)}`}>{fs(r.change)}</span>
                        </>
                      ) : (
                        <span className="muted">n/a</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <PriceChart
                points={active?.series}
                baseline={active?.startPrice}
                currency={conv.currency}
                rate={conv.rate}
                periodKey={periodKey}
                cost={cost}
              />
              {active && (
                <div className="period-stats">
                  <Stat
                    label={
                      periodKey === '1D'
                        ? 'Prev close'
                        : periodKey === 'MAX' && active.startTime
                          ? `Price in ${new Date(active.startTime).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
                          : 'Start price'
                    }
                    value={fm(active.startPrice)}
                  />
                  <Stat label="Period high" value={fm(active.high)} />
                  <Stat label="Period low" value={fm(active.low)} />
                  <Stat
                    label="Low → now"
                    value={pct((price / active.low - 1) * 100)}
                    tone={tone(price - active.low)}
                  />
                  <Stat
                    label="Below high"
                    value={pct((price / active.high - 1) * 100)}
                    tone={tone(price - active.high)}
                  />
                </div>
              )}
            </>
          )}
        </Section>

        <Section id="news" title="Latest news" className="stock-news">
          {!live.enabled && (
            <p className="muted small">
              Finnhub’s free plan only has company news for North American listings, so news may be missing here.
            </p>
          )}
          <NewsList {...(news.data ? { items: news.data } : news)} emptyText="No news in the last 14 days." />
        </Section>

        <PositionPanel
          symbol={symbol}
          position={position}
          price={price}
          currency={currency}
          conv={conv}
          buyRate={buyRate}
          onSave={onSavePosition}
          onRemove={onRemovePosition}
        />
      </div>
    </div>
  );
}

function Analysis({ data, price, fm, cost }) {
  const { metrics: m, recommendation: r, profile } = data;
  const hasRange = m.week52High && m.week52Low && price && data.quote; // metrics are in Finnhub's currency
  const rangePos = hasRange ? ((price - m.week52Low) / (m.week52High - m.week52Low)) * 100 : null;
  const costPos = hasRange && cost ? ((cost - m.week52Low) / (m.week52High - m.week52Low)) * 100 : null;
  const hasAny =
    hasRange || r || profile?.marketCapitalization || m.peTTM != null || m.beta != null || m.dividendYield != null;
  if (!hasAny) return null;

  return (
    <div className="card-analysis">
      {hasRange && (
        <div className="range">
          <div className="range-labels muted small">
            <span>52w low {fm(m.week52Low)}</span>
            <span>52w high {fm(m.week52High)}</span>
          </div>
          <div className="range-track">
            {costPos != null && costPos >= 0 && costPos <= 100 && (
              <span className="range-cost" style={{ left: `${costPos}%` }} title={`Your buy price ${fm(cost)}`} />
            )}
            <span className="range-marker" style={{ left: `${clamp(rangePos)}%` }} title="Current price" />
          </div>
          <div className="muted small">
            Trading at {Math.round(clamp(rangePos))}% of its 52-week range
            {costPos != null && (costPos >= 0 && costPos <= 100 ? ' · bar marks your buy price' : ' · your buy price is outside this range')}
          </div>
        </div>
      )}

      <div className="stats">
        <Stat label="Market cap" value={profile?.marketCapitalization ? compact(profile.marketCapitalization * 1e6) : '—'} />
        <Stat label="P/E (TTM)" value={num(m.peTTM)} />
        <Stat label="EPS (TTM)" value={num(m.epsTTM)} />
        <Stat label="Beta" value={num(m.beta)} />
        <Stat label="Div. yield" value={m.dividendYield != null ? `${num(m.dividendYield)}%` : '—'} />
      </div>

      {r && <Consensus rec={r} />}
    </div>
  );
}

const REC_PARTS = [
  ['strongBuy', 'Strong buy'],
  ['buy', 'Buy'],
  ['hold', 'Hold'],
  ['sell', 'Sell'],
  ['strongSell', 'Strong sell'],
];

function Consensus({ rec }) {
  const total = REC_PARTS.reduce((s, [k]) => s + (rec[k] || 0), 0);
  if (!total) return null;
  const weights = { strongBuy: 5, buy: 4, hold: 3, sell: 2, strongSell: 1 };
  const score = REC_PARTS.reduce((s, [k]) => s + (rec[k] || 0) * weights[k], 0) / total;
  const label = score >= 4.2 ? 'Strong buy' : score >= 3.5 ? 'Buy' : score >= 2.5 ? 'Hold' : score >= 1.8 ? 'Sell' : 'Strong sell';

  return (
    <div className="consensus">
      <div className="consensus-head">
        <span>Analyst consensus</span>
        <strong>{label}</strong>
        <span className="muted small">
          {total} analysts · {rec.period}
        </span>
      </div>
      <div className="rec-bar">
        {REC_PARTS.map(([k, name]) =>
          rec[k] ? (
            <span key={k} className={`rec-${k}`} style={{ flexGrow: rec[k] }} title={`${name}: ${rec[k]}`}>
              {rec[k]}
            </span>
          ) : null
        )}
      </div>
      <div className="rec-legend muted small">
        {REC_PARTS.map(([k, name]) => (
          <span key={k}>
            <i className={`rec-${k}`} /> {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = '' }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone}`}>{value}</div>
    </div>
  );
}

/**
 * Append the latest price to a series. For daily data, update today's bar
 * instead of adding a second point for the same day.
 */
function withLatest(points, latest, daily) {
  if (!points?.length || !latest?.t) return points;
  const last = points[points.length - 1];
  if (latest.t <= last.t && !daily) return points;
  if (daily && new Date(last.t).toDateString() === new Date(latest.t).toDateString()) {
    return [...points.slice(0, -1), { t: last.t, c: latest.p }];
  }
  if (latest.t <= last.t) return points;
  return [...points, { t: latest.t, c: latest.p }];
}

const arrow = (v) => (v > 0 ? '▲' : v < 0 ? '▼' : '■');
const clamp = (v) => Math.max(0, Math.min(100, v));
