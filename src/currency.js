import { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Display currency: 'native' (each stock's own currency) or 'GBP'.
 * Rates are GBP per 1 unit of the stock's currency (GBp/GBX = 0.01).
 */
const KEY = 'displayCurrency';

export function useDisplayCurrency() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem(KEY) === 'GBP' ? 'GBP' : 'native';
    } catch {
      return 'native';
    }
  });
  const update = (m) => {
    setMode(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* not persisted */
    }
  };
  return [mode, update];
}

/** Live rates to GBP for the given currencies, refreshed every 5 minutes. */
export function useFxRates(currencies) {
  const key = [...new Set(currencies.filter(Boolean))].sort().join(',');
  const [rates, setRates] = useState({});
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = () =>
      api
        .fx(key.split(','))
        .then((r) => alive && setRates((old) => ({ ...old, ...r })))
        .catch(() => {});
    load();
    const id = setInterval(() => !document.hidden && load(), 5 * 60e3);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [key]);
  return rates;
}

// Historical rates never change: cache them for the whole session.
const historical = new Map();
function rateOn(currency, date) {
  const k = `${currency}@${date}`;
  if (!historical.has(k)) {
    historical.set(
      k,
      api
        .fxOn(currency, date)
        .then((r) => r.rate)
        .catch(() => {
          historical.delete(k);
          return null;
        })
    );
  }
  return historical.get(k);
}

/** Rates to GBP on specific dates. `requests`: [{ currency, date }] -> { 'USD@2024-03-01': 0.79 } */
export function useFxOn(requests) {
  const key = [...new Set(requests.filter((r) => r.currency && r.date).map((r) => `${r.currency}@${r.date}`))]
    .sort()
    .join(',');
  const [rates, setRates] = useState({});
  useEffect(() => {
    if (!key) return;
    let alive = true;
    Promise.all(
      key.split(',').map(async (k) => {
        const [currency, date] = k.split('@');
        return [k, await rateOn(currency, date)];
      })
    ).then((pairs) => alive && setRates(Object.fromEntries(pairs.filter(([, v]) => v != null))));
    return () => {
      alive = false;
    };
  }, [key]);
  return rates;
}

/**
 * How to show amounts of `currency` in the chosen mode.
 * Returns { rate, currency, converted } — multiply amounts by `rate` and format in `currency`.
 * Falls back to the original currency until the rate has loaded.
 */
export function toDisplay(mode, currency, rates) {
  if (mode !== 'GBP' || !currency || currency === 'GBP') return { rate: 1, currency, converted: false };
  const rate = rates[currency];
  if (rate == null) return { rate: 1, currency, converted: false, pending: true };
  return { rate, currency: 'GBP', converted: true };
}
