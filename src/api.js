async function getJson(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

const enc = encodeURIComponent;

export const api = {
  search: (q) => getJson(`/api/search?q=${enc(q)}`),
  stock: (symbol) => getJson(`/api/stock/${enc(symbol)}`),
  history: (symbol) => getJson(`/api/history/${enc(symbol)}`),
  historyMax: (symbol) => getJson(`/api/history-max/${enc(symbol)}`),
  fx: (currencies) => getJson(`/api/fx?currencies=${enc(currencies.join(','))}`),
  fxOn: (currency, date) => getJson(`/api/fx/on?currency=${enc(currency)}&date=${enc(date)}`),
  quotes: (symbols) => getJson(`/api/quotes?symbols=${enc(symbols.join(','))}`),
  news: (symbol) => getJson(`/api/news/${enc(symbol)}`),
  marketNews: () => getJson('/api/market-news'),
};
