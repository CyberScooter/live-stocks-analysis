import { useEffect, useState } from 'react';
import Search from './components/Search.jsx';
import StockView from './components/StockView.jsx';
import MarketNews from './components/MarketNews.jsx';
import MyStocks from './components/MyStocks.jsx';
import TopRated from './components/TopRated.jsx';
import { usePositions } from './positions.js';
import { useDisplayCurrency } from './currency.js';

const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN'];

function loadWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem('watchlist'));
    return Array.isArray(saved) ? saved : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

const symbolFromHash = () => decodeURIComponent(location.hash.replace(/^#\/?/, '')).toUpperCase() || null;

export default function App() {
  const [watchlist, setWatchlist] = useState(loadWatchlist);
  const [symbol, setSymbol] = useState(() => symbolFromHash() || loadWatchlist()[0] || 'AAPL');
  const [view, setView] = useState('stock');
  const { positions, save, remove, importData } = usePositions();
  const [displayMode, setDisplayMode] = useDisplayCurrency();

  // Keep the URL in sync (#/AAPL) so back/forward and bookmarks work.
  useEffect(() => {
    if (symbolFromHash() !== symbol) location.hash = `/${symbol}`;
  }, [symbol]);
  useEffect(() => {
    const onHash = () => {
      const s = symbolFromHash();
      if (s) setSymbol(s);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('watchlist', JSON.stringify(watchlist));
    } catch {
      /* storage unavailable: watchlist just won't persist */
    }
  }, [watchlist]);

  const open = (s) => {
    setSymbol(s);
    setView('stock');
  };
  const starred = watchlist.includes(symbol);
  const toggleStar = () =>
    setWatchlist((w) => (w.includes(symbol) ? w.filter((s) => s !== symbol) : [...w, symbol]));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">▲</span>
          <h1>Stock Analysis</h1>
        </div>
        <Search onSelect={open} />
        <div className="tabs currency-switch" role="group" aria-label="Display currency">
          <button
            className={displayMode === 'native' ? 'active' : ''}
            onClick={() => setDisplayMode('native')}
            aria-pressed={displayMode === 'native'}
            title="Show each stock in its own trading currency"
          >
            Local
          </button>
          <button
            className={displayMode === 'GBP' ? 'active' : ''}
            onClick={() => setDisplayMode('GBP')}
            aria-pressed={displayMode === 'GBP'}
            title="Convert everything to British pounds"
          >
            £ GBP
          </button>
        </div>
        <nav className="tabs">
          <button className={view === 'stock' ? 'active' : ''} onClick={() => setView('stock')}>
            Stock
          </button>
          <button className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}>
            My stocks
          </button>
          <button className={view === 'top' ? 'active' : ''} onClick={() => setView('top')}>
            Strong buys
          </button>
          <button className={view === 'market' ? 'active' : ''} onClick={() => setView('market')}>
            Market news
          </button>
        </nav>
      </header>

      {watchlist.length > 0 && (
        <div className="watchlist" aria-label="Watchlist">
          <span className="muted small">Watchlist</span>
          {watchlist.map((s) => (
            <button
              key={s}
              className={`chip ${s === symbol && view === 'stock' ? 'active' : ''}`}
              onClick={() => open(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {view === 'market' ? (
        <section className="panel">
          <h2>Market news</h2>
          <MarketNews onOpenStock={open} />
        </section>
      ) : view === 'top' ? (
        <TopRated onOpenStock={open} />
      ) : view === 'mine' ? (
        <MyStocks positions={positions} onOpenStock={open} onImport={importData} displayMode={displayMode} />
      ) : (
        <StockView
          key={symbol}
          symbol={symbol}
          starred={starred}
          onToggleStar={toggleStar}
          position={positions[symbol] || null}
          onSavePosition={(p) => save(symbol, p)}
          onRemovePosition={() => remove(symbol)}
          displayMode={displayMode}
        />
      )}

      <footer className="footer muted">
        Quotes, company data and news from Finnhub · price history from Yahoo Finance · not financial advice
      </footer>
    </div>
  );
}
