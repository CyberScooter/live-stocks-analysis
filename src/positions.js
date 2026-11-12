import { useCallback, useEffect, useState } from 'react';

/**
 * Your own buy prices, kept in this browser only (localStorage).
 * Shape: { [symbol]: { price, shares|null, date 'YYYY-MM-DD'|null, currency|null, target|null } }
 */
const KEY = 'positions';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

/** Validate anything that came from storage or an imported file. */
export function sanitize(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [sym, p] of Object.entries(input)) {
    const symbol = String(sym).toUpperCase();
    if (!/^[A-Z0-9.\-^=]{1,20}$/.test(symbol)) continue;
    const price = Number(p?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const shares = p.shares == null || p.shares === '' ? null : Number(p.shares);
    const target = p.target == null || p.target === '' ? null : Number(p.target);
    out[symbol] = {
      price,
      shares: Number.isFinite(shares) && shares > 0 ? shares : null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : null,
      currency: typeof p.currency === 'string' ? p.currency.slice(0, 5) : null,
      target: Number.isFinite(target) && target > 0 ? target : null, // price you hope it reaches
    };
  }
  return out;
}

export function usePositions() {
  const [positions, setPositions] = useState(() => sanitize(read()));

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(positions));
    } catch {
      /* storage unavailable: positions last for this session only */
    }
  }, [positions]);

  // Stay in sync if the app is open in another tab.
  useEffect(() => {
    const onStorage = (e) => e.key === KEY && setPositions(sanitize(read()));
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const save = useCallback((symbol, p) => setPositions((ps) => ({ ...ps, ...sanitize({ [symbol]: p }) })), []);
  const remove = useCallback(
    (symbol) =>
      setPositions((ps) => {
        const next = { ...ps };
        delete next[symbol];
        return next;
      }),
    []
  );
  /** Merge an exported file into the current positions. Returns how many were imported. */
  const importData = useCallback((data) => {
    const clean = sanitize(data?.positions ?? data);
    setPositions((ps) => ({ ...ps, ...clean }));
    return Object.keys(clean).length;
  }, []);

  return { positions, save, remove, importData };
}

export function downloadPositions(positions) {
  const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), positions }, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `my-stocks-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Return / P&L of a position at `price`, in the display currency.
 * `rateNow` converts today's price; `rateBuy` converts the buy price (the
 * exchange rate on the buy date). With both = 1 everything is in the stock's
 * own currency. Amounts are only available when shares are known.
 */
export function positionStats(pos, price, rateNow = 1, rateBuy = rateNow) {
  if (!pos || price == null) return null;
  const buy = pos.price * rateBuy;
  const now = price * rateNow;
  const days = pos.date ? Math.floor((Date.now() - new Date(`${pos.date}T00:00:00`).getTime()) / 86_400_000) : null;
  const shares = pos.shares;
  return {
    buyPrice: buy,
    price: now,
    perShare: now - buy,
    returnPct: (now / buy - 1) * 100,
    stockReturnPct: (price / pos.price - 1) * 100, // ignoring currency moves
    cost: shares ? shares * buy : null,
    value: shares ? shares * now : null,
    pl: shares ? shares * (now - buy) : null,
    // Part of the gain/loss caused by the exchange rate moving since you bought
    fxPl: shares ? shares * pos.price * (rateNow - rateBuy) : null,
    days,
    // Annualising short holding periods gives silly numbers, so only from 1 year.
    annualized: days != null && days >= 365 ? (Math.pow(now / buy, 365 / days) - 1) * 100 : null,
  };
}

/**
 * What the position would be worth if the price reached `pos.target`.
 * The target is converted at today's rate (future exchange rates are unknown),
 * the cost at the buy-date rate, same as positionStats.
 */
export function projectionStats(pos, price, rateNow = 1, rateBuy = rateNow) {
  if (!pos?.target || price == null) return null;
  const buy = pos.price * rateBuy;
  const now = price * rateNow;
  const target = pos.target * rateNow;
  const shares = pos.shares;
  return {
    target,
    reached: price >= pos.target,
    movePct: (pos.target / price - 1) * 100, // from today's price to the target
    returnPct: (target / buy - 1) * 100, // total return on what you paid
    perShare: target - buy,
    profit: shares ? shares * (target - buy) : null,
    value: shares ? shares * target : null,
    fromNow: shares ? shares * (target - now) : null, // extra on top of today's gain/loss
  };
}

export function heldFor(days) {
  if (days == null) return '—';
  if (days < 1) return 'Today';
  if (days < 60) return `${days} days`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} months`;
  const years = Math.floor(days / 365.25);
  const rest = Math.floor((days - years * 365.25) / 30.44);
  return rest ? `${years}y ${rest}m` : `${years} years`;
}
