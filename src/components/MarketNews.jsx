import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import NewsList from './NewsList.jsx';

/**
 * Market news with a stock filter. Typing a company name or ticker:
 *  1. resolves it to a symbol (Finnhub search) and loads that company's own news;
 *  2. keyword-filters the general market feed for headlines mentioning it.
 */
export default function MarketNews({ onOpenStock }) {
  const [market, setMarket] = useState({ loading: true });
  const [query, setQuery] = useState('');
  const [company, setCompany] = useState(null); // { match, loading, items, error }

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .marketNews()
        .then((items) => alive && setMarket({ items }))
        .catch((e) => alive && setMarket((s) => (s.items ? s : { error: e.message })));
    load();
    const id = setInterval(() => !document.hidden && load(), 120_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Resolve the query to a stock and load its company news (debounced).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setCompany(null);
      return;
    }
    let alive = true;
    const id = setTimeout(async () => {
      setCompany((c) => ({ ...c, loading: true }));
      try {
        const results = await api.search(q);
        const upper = q.toUpperCase();
        const match = results.find((r) => r.symbol === upper) || results[0];
        if (!match) {
          if (alive) setCompany({ match: null, items: [] });
          return;
        }
        const items = await api.news(match.symbol);
        if (alive) setCompany({ match, items });
      } catch (e) {
        if (alive) setCompany({ match: null, error: e.message });
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query]);

  const marketMatches = useMemo(() => {
    const items = market.items || [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const terms = [q];
    if (company?.match) {
      terms.push(company.match.symbol.toLowerCase());
      // "Apple Inc" -> "apple": match on the first word of the company name too
      const first = company.match.name?.split(/\s+/)[0]?.toLowerCase();
      if (first && first.length > 2) terms.push(first);
    }
    return items.filter((n) => {
      const text = `${n.headline} ${n.summary}`.toLowerCase();
      return terms.some((t) => (t.length <= 4 ? new RegExp(`\\b${escapeRe(t)}\\b`).test(text) : text.includes(t)));
    });
  }, [market.items, query, company?.match]);

  const searching = query.trim().length > 0;

  return (
    <div className="market-news">
      <div className="news-filter">
        <input
          type="search"
          placeholder="Filter by stock — e.g. Nvidia, AAPL, Tesla"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter news by stock"
        />
        {searching && company?.loading && <span className="muted small">Searching…</span>}
      </div>

      {searching && (
        <section className="news-section">
          {company?.match ? (
            <div className="news-section-head">
              <h3>
                {company.match.symbol} · {company.match.name}
              </h3>
              <button className="link-btn" onClick={() => onOpenStock(company.match.symbol)}>
                Open stock →
              </button>
            </div>
          ) : (
            <h3>Company news</h3>
          )}
          {company?.error ? (
            <p className="error-text">{company.error}</p>
          ) : company && !company.loading && !company.match ? (
            <p className="muted">No stock found for “{query.trim()}”.</p>
          ) : (
            <NewsList
              items={company?.items}
              loading={!company || (company.loading && !company.items)}
              emptyText="No company news in the last 14 days (free plan covers North American listings)."
            />
          )}
        </section>
      )}

      <section className="news-section">
        {searching && <h3>Mentions in market headlines ({marketMatches.length})</h3>}
        <NewsList
          items={marketMatches}
          loading={market.loading}
          error={market.error}
          emptyText={searching ? 'No current market headlines mention this stock.' : 'No market news right now.'}
        />
      </section>
    </div>
  );
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
