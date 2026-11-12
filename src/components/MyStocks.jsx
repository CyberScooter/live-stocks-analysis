import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { money, num, pct, signed, tone } from '../format.js';
import { downloadPositions, positionStats } from '../positions.js';
import { useLivePrices } from '../useLivePrice.js';
import { toDisplay, useFxOn, useFxRates } from '../currency.js';

const REFRESH_MS = 60_000;

/** Pence-quoted (London) amounts are summed in pounds. */
const totalCurrency = (c) => (c === 'GBp' || c === 'GBX' ? 'GBP' : c || '—');
const toTotal = (amount, c) => (c === 'GBp' || c === 'GBX' ? amount / 100 : amount);

export default function MyStocks({ positions, onOpenStock, onImport, displayMode = 'native' }) {
  const symbols = useMemo(() => Object.keys(positions).sort(), [positions]);
  const [quotes, setQuotes] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const live = useLivePrices(symbols);
  const fileInput = useRef(null);

  const symbolKey = symbols.join(',');
  useEffect(() => {
    if (!symbols.length) return;
    let alive = true;
    const load = () =>
      api
        .quotes(symbols)
        .then((q) => alive && (setQuotes(q), setError(null)))
        .catch((e) => alive && setError(e.message));
    load();
    const id = setInterval(() => !document.hidden && load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey]);

  // GBP mode: today's rate for prices, the rate on each buy date for costs.
  const gbp = displayMode === 'GBP';
  const currencies = symbols.map((s) => quotes[s]?.currency || positions[s].currency);
  const fxRates = useFxRates(gbp ? currencies : []);
  const buyFx = useFxOn(
    gbp
      ? symbols
          .filter((s) => positions[s].date)
          .map((s) => ({ currency: positions[s].currency || quotes[s]?.currency, date: positions[s].date }))
      : []
  );

  const rows = symbols.map((symbol) => {
    const pos = positions[symbol];
    const q = quotes[symbol] || {};
    const trade = live.trades[symbol];
    const useLive = trade && (!q.priceTime || trade.t > q.priceTime);
    const price = useLive ? trade.p : q.price ?? null;
    const currency = q.currency || pos.currency;
    const mismatch = pos.currency && q.currency && pos.currency !== q.currency;
    const conv = toDisplay(displayMode, currency, fxRates);
    const rateBuy = conv.converted ? (pos.date && buyFx[`${pos.currency || currency}@${pos.date}`]) || conv.rate : 1;
    return {
      symbol,
      pos,
      price,
      currency,
      dc: conv.currency, // display currency for this row
      rate: conv.rate,
      buyPrice: pos.price * rateBuy,
      mismatch,
      live: !!useLive,
      error: q.error,
      dayPct: price != null && q.previousClose ? (price / q.previousClose - 1) * 100 : null,
      stats: mismatch ? null : positionStats(pos, price, conv.rate, rateBuy),
    };
  });

  // Totals per currency. In GBP mode everything converts, so there's one combined total.
  const totals = {};
  for (const r of rows) {
    if (!r.stats || r.stats.value == null) continue;
    const c = totalCurrency(r.dc);
    const t = (totals[c] ||= { cost: 0, value: 0, fx: 0, count: 0 });
    t.cost += toTotal(r.stats.cost, r.dc);
    t.value += toTotal(r.stats.value, r.dc);
    t.fx += toTotal(r.stats.fxPl || 0, r.dc);
    t.count += 1;
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const n = onImport(JSON.parse(await file.text()));
      setNotice(n ? `Imported ${n} position${n === 1 ? '' : 's'}.` : 'No valid positions found in that file.');
    } catch {
      setNotice('That file isn’t a valid export.');
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          My stocks <span className="muted">({symbols.length})</span>
        </h2>
        <div className="btn-row">
          <button className="ghost-btn" onClick={() => fileInput.current.click()}>Import</button>
          <button className="ghost-btn" onClick={() => downloadPositions(positions)} disabled={!symbols.length}>
            Export
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onFile} />
        </div>
      </div>
      {notice && <p className="muted small">{notice}</p>}
      {error && <p className="error-text small">{error}</p>}

      {!symbols.length ? (
        <p className="muted">
          No positions yet. Search for a stock you own and click <strong>+ Add buy price</strong>, or import a file you
          exported earlier.
        </p>
      ) : (
        <>
          {Object.keys(totals).length > 0 && (
            <div className="summary">
              {Object.entries(totals).map(([c, t]) => {
                const pl = t.value - t.cost;
                return (
                  <div className="card" key={c}>
                    <div className="card-label">
                      {c} holdings · {t.count} stock{t.count === 1 ? '' : 's'}
                    </div>
                    <div className="card-value">{money(t.value, c)}</div>
                    <div className={`card-sub ${tone(pl)}`}>
                      {signed(pl, c)} ({pct(t.cost ? (pl / t.cost) * 100 : 0)}) on {money(t.cost, c)} invested
                    </div>
                    {gbp && Math.abs(t.fx) >= 0.005 && (
                      <div className="card-sub">incl. {signed(t.fx, c)} from exchange-rate moves</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="table-wrap">
            <table className="holdings">
              <thead>
                <tr>
                  <th>Stock</th>
                  <th className="num">Shares</th>
                  <th className="num">Buy price</th>
                  <th className="num">Price</th>
                  <th className="num">Today</th>
                  <th className="num">Return</th>
                  <th className="num">Gain / loss</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol} onClick={() => onOpenStock(r.symbol)}>
                    <td>
                      <strong>{r.symbol}</strong>
                      {r.live && <span className="live-dot" title="Live price" />}
                      {r.mismatch && <div className="error-text small">Currency changed: edit buy price</div>}
                      {r.error && <div className="error-text small">Price unavailable</div>}
                    </td>
                    <td className="num">{r.pos.shares != null ? num(r.pos.shares, 6) : '—'}</td>
                    <td className="num">{money(r.dc === r.currency ? r.pos.price : r.buyPrice, r.dc)}</td>
                    <td className="num">{money(r.price == null ? null : r.price * r.rate, r.dc)}</td>
                    <td className={`num ${tone(r.dayPct)}`}>{pct(r.dayPct)}</td>
                    <td className={`num ${tone(r.stats?.returnPct)}`}>{pct(r.stats?.returnPct)}</td>
                    <td className={`num ${tone(r.stats?.pl)}`}>
                      {r.stats?.pl != null ? signed(r.stats.pl, r.dc) : '—'}
                    </td>
                    <td className="num">{r.stats?.value != null ? money(r.stats.value, r.dc) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            {gbp
              ? 'Converted to GBP: costs at the exchange rate on each buy date (today’s rate if no date), values at today’s rate, so returns include currency moves.'
              : 'Returns are in each stock’s own currency and exclude exchange-rate moves. Switch to £ GBP to include them.'}{' '}
            Totals only include stocks with a share count. Click a row to open the stock.
          </p>
        </>
      )}
    </section>
  );
}
