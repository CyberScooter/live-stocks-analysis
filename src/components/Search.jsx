import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function Search({ onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const box = useRef(null);

  // Debounced lookup
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const id = setTimeout(() => {
      api
        .search(q)
        .then((r) => alive && (setResults(r), setActive(0)))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query]);

  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const choose = (symbol) => {
    if (!symbol) return;
    onSelect(symbol.toUpperCase());
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      choose(results[active]?.symbol || query.trim());
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="search" ref={box}>
      <input
        type="search"
        placeholder="Search stocks — e.g. Apple, TSLA, VOD.L"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Search stocks"
      />
      {open && query.trim() && (
        <ul className="search-results" role="listbox">
          {loading && !results.length && <li className="muted">Searching…</li>}
          {!loading && !results.length && (
            <li className="muted">No matches. Press Enter to open “{query.trim().toUpperCase()}”.</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.symbol}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => {
                e.preventDefault();
                choose(r.symbol);
              }}
            >
              <strong>{r.symbol}</strong>
              <span className="muted">{r.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
