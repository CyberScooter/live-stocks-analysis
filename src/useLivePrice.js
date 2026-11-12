import { useEffect, useState } from 'react';

/** US-style tickers (AAPL, BRK.B). Finnhub's free real-time stream only covers these. */
export const isStreamable = (symbol) => /^[A-Z]{1,6}(\.[ABC])?$/.test(symbol);

/**
 * Subscribes to real-time trades for several symbols via the server's SSE relay.
 * Non-US symbols are ignored. Returns { connected, trades: { [symbol]: { p, t } } }.
 */
export function useLivePrices(symbols) {
  const key = [...new Set(symbols.filter(isStreamable))].sort().join(',');
  const [state, setState] = useState({ connected: false, trades: {} });

  useEffect(() => {
    setState({ connected: false, trades: {} });
    if (!key) return;

    const es = new EventSource(`/api/stream?symbols=${encodeURIComponent(key)}`);
    es.addEventListener('status', (e) => {
      const { connected } = JSON.parse(e.data);
      setState((s) => ({ ...s, connected }));
    });
    es.addEventListener('trades', (e) => {
      const batch = JSON.parse(e.data);
      setState((s) => {
        const trades = { ...s.trades };
        for (const t of batch) trades[t.s] = { p: t.p, t: t.t };
        return { ...s, trades };
      });
    });
    // EventSource reconnects by itself after network errors.
    es.onerror = () => setState((s) => ({ ...s, connected: false }));
    return () => es.close();
  }, [key]);

  return state;
}

/** Single-symbol convenience wrapper. */
export function useLivePrice(symbol) {
  const enabled = isStreamable(symbol);
  const { connected, trades } = useLivePrices(enabled ? [symbol] : []);
  return { connected, trade: trades[symbol] || null, enabled };
}
