import { useEffect, useState } from 'react';
import { api } from '../api.js';

const REC_PARTS = [
  ['strongBuy', 'Strong buy'],
  ['buy', 'Buy'],
  ['hold', 'Hold'],
  ['sell', 'Sell'],
  ['strongSell', 'Strong sell'],
];
// [value in the data, label on the button]. "Rest of world" = Canada, Latin America, Australia, Middle East, Africa.
const REGIONS = [
  ['All', 'Worldwide'],
  ['US', 'US'],
  ['Europe', 'Europe'],
  ['Asia', 'Asia'],
  ['Rest of world', 'Rest of world'],
];
const badgeClass = (label) => `rating rating-${label.toLowerCase().replace(/\s+/g, '-')}`;

/** Strong buys by sector, from analyst consensus on a fixed list of large companies worldwide. */
export default function TopRated({ onOpenStock }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sector, setSector] = useState('All');
  const [region, setRegion] = useState('All');
  const [onlyStrong, setOnlyStrong] = useState(true);

  // Poll quickly while the server is still scanning, slowly once it has finished.
  useEffect(() => {
    let alive = true;
    let timer;
    const load = async () => {
      let scanning = false;
      try {
        const d = await api.topRated();
        if (!alive) return;
        setData(d);
        setError(null);
        scanning = d.scanning;
      } catch (e) {
        if (alive) setError(e.message);
      }
      if (alive) timer = setTimeout(load, scanning ? 4000 : 10 * 60_000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  if (!data) {
    return (
      <section className="panel">
        <h2>Strong buys</h2>
        {error ? <p className="error-text">{error}</p> : <p className="muted">Loading analyst ratings…</p>}
      </section>
    );
  }

  const isStrong = (s) => s.label === 'Strong buy';
  // Apply the region filter first so every count below reflects it.
  const byRegion = data.sectors.map((s) => ({
    ...s,
    stocks: s.stocks.filter((st) => region === 'All' || st.region === region),
  }));
  const sectors = byRegion.filter((s) => sector === 'All' || s.name === sector);
  const strongTotal = byRegion.reduce((n, s) => n + s.stocks.filter(isStrong).length, 0);
  const progress = data.total ? Math.round((data.done / data.total) * 100) : 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          Strong buys <span className="muted">({strongTotal})</span>
        </h2>
        <div className="btn-row">
          <div className="tabs" role="group" aria-label="Region">
            {REGIONS.map(([value, label]) => (
              <button
                key={value}
                className={region === value ? 'active' : ''}
                onClick={() => setRegion(value)}
                aria-pressed={region === value}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={onlyStrong} onChange={(e) => setOnlyStrong(e.target.checked)} />
            Strong buys only
          </label>
        </div>
      </div>

      {data.error && <p className="error-text">{data.error}</p>}
      {error && <p className="error-text small">{error}</p>}
      {data.scanning ? (
        <div className="scan">
          <div className="scan-track">
            <div className="scan-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="muted small">
            Checking analyst ratings… {data.done} of {data.total} stocks (takes about 9 minutes the first time; US stocks come first)
          </span>
        </div>
      ) : (
        data.updatedAt && (
          <p className="muted small">
            Ratings checked {new Date(data.updatedAt).toLocaleString()} · refreshed every 12 hours
          </p>
        )
      )}

      <div className="watchlist sector-chips" role="group" aria-label="Sector">
        {['All', ...byRegion.map((s) => s.name)].map((name) => {
          const count =
            name === 'All' ? strongTotal : byRegion.find((s) => s.name === name).stocks.filter(isStrong).length;
          return (
            <button
              key={name}
              className={`chip ${sector === name ? 'active' : ''}`}
              onClick={() => setSector(name)}
              aria-pressed={sector === name}
            >
              {name} <span className="chip-count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="sector-grid">
        {sectors.map((s) => {
          const shown = onlyStrong ? s.stocks.filter(isStrong) : s.stocks;
          const closest = onlyStrong && !shown.length ? s.stocks[0] : null;
          return (
            <div className="sector-card" key={s.name}>
              <h3>{s.name}</h3>
              {shown.map((st) => (
                <StockRow key={st.symbol} stock={st} onOpen={onOpenStock} />
              ))}
              {!shown.length && (
                <p className="muted small">
                  {s.stocks.length
                    ? `No strong-buy consensus${region === 'All' ? '' : ` among ${region} companies`} in this sector right now.`
                    : data.scanning
                      ? 'Not checked yet…'
                      : 'No analyst data available.'}
                </p>
              )}
              {closest && (
                <>
                  <p className="muted small closest-label">Highest rated:</p>
                  <StockRow stock={closest} onOpen={onOpenStock} />
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="rec-legend muted small">
        {REC_PARTS.map(([k, name]) => (
          <span key={k}>
            <i className={`rec-${k}`} /> {name}
          </span>
        ))}
      </div>
      <p className="muted small">
        Based on the consensus of Wall Street analysts covering each stock (via Finnhub, updated monthly). “Strong
        buy” means the average rating is 4.2 or higher out of 5. Covers {data.total} large companies worldwide
        across 11 sectors, not the whole market. “Rest of world” is Canada, Latin America, Australia, the
        Middle East and Africa. Companies outside the US are shown by their US-listed shares, so they open with
        a US ticker and a price in dollars. Analyst ratings are opinions and are often
        wrong: this is not financial advice.
      </p>
    </section>
  );
}

function StockRow({ stock: st, onOpen }) {
  return (
    <button className="top-row" onClick={() => onOpen(st.symbol)} title={`Open ${st.symbol}`}>
      <div className="top-row-head">
        <span className="top-name">
          <strong>{st.symbol}</strong>{' '}
          <span className="muted">
            {st.name}
            {st.region !== 'US' && ` · ${st.country}`}
          </span>
        </span>
        <span className={badgeClass(st.label)}>{st.label}</span>
      </div>
      <div className="rec-bar slim" aria-hidden="true">
        {REC_PARTS.map(([k]) => (st.counts[k] ? <span key={k} className={`rec-${k}`} style={{ flexGrow: st.counts[k] }} /> : null))}
      </div>
      <div className="muted small top-meta">
        <span>
          {st.score.toFixed(2)} / 5 · {st.buyPct}% buy · {st.analysts} analysts
        </span>
        {Math.abs(st.trend) >= 0.05 && (
          <span title="Change in average rating since last month">
            {st.trend > 0 ? '▲ improving' : '▼ weakening'}
          </span>
        )}
      </div>
    </button>
  );
}
