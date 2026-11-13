import { useEffect, useState } from 'react';
import Section from './Section.jsx';
import { money, num, pct, signed, tone } from '../format.js';
import { heldFor, positionStats, projectionStats } from '../positions.js';

const currencyHint = (c) =>
  c === 'GBp' || c === 'GBX' ? 'in pence (p), e.g. 245.5, not £2.455' : c ? `in ${c}` : '';

export default function PositionPanel({ symbol, position, price, currency, conv, buyRate, onSave, onRemove }) {
  const [editing, setEditing] = useState(false);
  // What-if target price: typed here, never saved with the position.
  const [target, setTarget] = useState('');
  useEffect(() => setTarget(''), [symbol]);
  const mismatch = position?.currency && currency && position.currency !== currency;
  // In GBP mode: price converted at today's rate, cost at the rate on the buy date
  // (today's rate if no date was entered, so currency moves aren't included).
  const display = conv?.converted ? conv : { rate: 1, currency, converted: false };
  const rateBuy = display.converted ? (position?.date && buyRate) || display.rate : 1;
  const stats = mismatch ? null : positionStats(position, price, display.rate, rateBuy);
  const proj = mismatch ? null : projectionStats(position, target === '' ? null : Number(target), price, display.rate, rateBuy);
  const dc = display.currency;
  const isPence = currency === 'GBp' || currency === 'GBX'; // pence -> pounds is just /100, no FX
  const fxKnown = display.converted && !isPence && position?.date && buyRate;

  if (editing || !position) {
    return (
      <Section id="position" title="Your position">
        {!editing && !position ? (
          <div className="empty-position">
            <p className="muted">Own {symbol}? Add your buy price to see your gain or loss.</p>
            <button className="primary-btn" onClick={() => setEditing(true)}>
              + Add buy price
            </button>
          </div>
        ) : (
          <PositionForm
            initial={position}
            currency={currency}
            onCancel={() => setEditing(false)}
            onSubmit={(p) => {
              onSave({ ...p, currency });
              setEditing(false);
            }}
          />
        )}
      </Section>
    );
  }

  return (
    <Section
      id="position"
      title="Your position"
      actions={
        <>
          <button className="ghost-btn" onClick={() => setEditing(true)}>Edit</button>
          <button
            className="ghost-btn danger"
            onClick={() => window.confirm(`Remove your ${symbol} position?`) && onRemove()}
          >
            Remove
          </button>
        </>
      }
    >

      {mismatch && (
        <p className="error-text small">
          You entered this price in {position.currency}, but {symbol} is now quoted in {currency}. Edit it to
          re-enter the price in {currency}.
        </p>
      )}

      {!stats && !mismatch && <p className="muted">Loading price…</p>}
      {stats && (
        <>
          <div className="position-hero">
            <div>
              <div className="stat-label">Your return</div>
              <div className={`hero-value ${tone(stats.returnPct)}`}>{pct(stats.returnPct)}</div>
            </div>
            {stats.pl != null && (
              <div>
                <div className="stat-label">{stats.pl >= 0 ? 'Gain' : 'Loss'}</div>
                <div className={`hero-value ${tone(stats.pl)}`}>{signed(stats.pl, dc)}</div>
              </div>
            )}
          </div>

          <div className="stats">
            <Stat label="Buy price" value={money(stats.buyPrice, dc)} />
            <Stat label="Current price" value={money(stats.price, dc)} />
            <Stat label="Per share" value={signed(stats.perShare, dc)} tone={tone(stats.perShare)} />
            {position.shares != null && (
              <>
                <Stat label="Shares" value={num(position.shares, 6)} />
                <Stat label="Cost" value={money(stats.cost, dc)} />
                <Stat label="Value now" value={money(stats.value, dc)} />
              </>
            )}
            {fxKnown && (
              <>
                <Stat label={`Stock move (${currency})`} value={pct(stats.stockReturnPct)} tone={tone(stats.stockReturnPct)} />
                {position.shares != null && (
                  <Stat label="FX effect" value={signed(stats.fxPl, dc)} tone={tone(stats.fxPl)} />
                )}
              </>
            )}
            {position.date && (
              <>
                <Stat label="Bought" value={new Date(`${position.date}T00:00:00`).toLocaleDateString()} />
                <Stat label="Held for" value={heldFor(stats.days)} />
                <Stat
                  label="Yearly return"
                  value={stats.annualized != null ? pct(stats.annualized) : 'After 1 year'}
                  tone={tone(stats.annualized)}
                />
              </>
            )}
          </div>
          {position.shares == null && (
            <p className="muted small">Add the number of shares to see gain/loss amounts and value.</p>
          )}

          <div className="projection">
            <h3 className="sub-title">Price projection</h3>
            <label className="target-field">
              <span>Target price {currencyHint(currency) && <span className="muted">({currencyHint(currency).split(',')[0]})</span>}</span>
              <input
                type="number" step="any" min="0" inputMode="decimal" placeholder={price != null ? String(price) : ''}
                value={target} onChange={(e) => setTarget(e.target.value)}
              />
            </label>
            {!proj ? (
              <p className="muted small">
                Type a price to see the profit you’d make if {symbol} gets there. It isn’t saved.
              </p>
            ) : (
              <>
                <div className="position-hero">
                  <div>
                    <div className="stat-label">
                      {proj.profit != null ? (proj.profit >= 0 ? 'Profit at target' : 'Loss at target') : 'Return at target'}
                    </div>
                    <div className={`hero-value ${tone(proj.returnPct)}`}>
                      {proj.profit != null ? signed(proj.profit, dc) : pct(proj.returnPct)}
                    </div>
                  </div>
                  {proj.profit != null && (
                    <div>
                      <div className="stat-label">Return at target</div>
                      <div className={`hero-value ${tone(proj.returnPct)}`}>{pct(proj.returnPct)}</div>
                    </div>
                  )}
                </div>
                <div className="stats">
                  <Stat label="Target price" value={money(proj.target, dc)} />
                  <Stat
                    label={proj.reached ? 'Target reached' : 'Move needed'}
                    value={pct(proj.movePct)}
                    tone={tone(proj.movePct)}
                  />
                  <Stat label="Per share" value={signed(proj.perShare, dc)} tone={tone(proj.perShare)} />
                  {proj.value != null && (
                    <>
                      <Stat label="Value at target" value={money(proj.value, dc)} />
                      <Stat label="Vs today" value={signed(proj.fromNow, dc)} tone={tone(proj.fromNow)} />
                    </>
                  )}
                </div>
                {proj.reached && (
                  <p className="muted small">The price is already at or above your target.</p>
                )}
                {display.converted && !isPence && (
                  <p className="muted small">
                    Target converted from {currency} at today’s rate; the real figure will depend on the exchange rate then.
                  </p>
                )}
              </>
            )}
          </div>
          {display.converted && !isPence && !position.date && (
            <p className="muted small">
              Converted from {currency} at today’s rate. Add a buy date to include exchange-rate moves since you bought.
            </p>
          )}
          {fxKnown && (
            <p className="muted small">
              Cost converted at the {currency}→GBP rate on your buy date, value at today’s rate, so the return
              includes exchange-rate moves (like your broker shows).
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function PositionForm({ initial, currency, onSubmit, onCancel }) {
  const [price, setPrice] = useState(initial?.price ?? '');
  const [shares, setShares] = useState(initial?.shares ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [error, setError] = useState(null);
  const today = new Date().toISOString().slice(0, 10);

  const submit = (e) => {
    e.preventDefault();
    const p = Number(price);
    const s = shares === '' ? null : Number(shares);
    if (!(p > 0)) return setError('Enter the price you paid per share.');
    if (s != null && !(s > 0)) return setError('Shares must be more than 0, or leave it empty.');
    if (date && date > today) return setError('Buy date can’t be in the future.');
    onSubmit({ price: p, shares: s, date: date || null });
  };

  return (
    <form className="position-form" onSubmit={submit}>
      <label>
        <span>Buy price per share *</span>
        <input type="number" step="any" min="0" inputMode="decimal" value={price}
          onChange={(e) => setPrice(e.target.value)} autoFocus required />
        <small className="muted">{currencyHint(currency)}. Bought more than once? Use your average price.</small>
      </label>
      <label>
        <span>Shares (optional)</span>
        <input type="number" step="any" min="0" inputMode="decimal" value={shares}
          onChange={(e) => setShares(e.target.value)} />
        <small className="muted">Fractional shares are fine.</small>
      </label>
      <label>
        <span>Buy date (optional)</span>
        <input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        <small className="muted">Used for holding time and yearly return.</small>
      </label>
      {error && <p className="error-text small">{error}</p>}
      <div className="btn-row">
        <button type="submit" className="primary-btn">Save</button>
        <button type="button" className="ghost-btn" onClick={onCancel}>Cancel</button>
      </div>
      <p className="muted small">Saved only in this browser. Use Export on the My stocks tab to back it up.</p>
    </form>
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
