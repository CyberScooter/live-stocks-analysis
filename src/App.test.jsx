import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { api } from './api.js';
import { makeHistory, makeMaxHistory, makeStock, makeTopRated, newsItem } from './test/fixtures.js';

vi.mock('./api.js', () => ({
  api: {
    search: vi.fn(),
    stock: vi.fn(),
    history: vi.fn(),
    historyMax: vi.fn(),
    news: vi.fn(),
    marketNews: vi.fn(),
    topRated: vi.fn(),
    quotes: vi.fn(),
    fx: vi.fn(),
    fxOn: vi.fn(),
  },
}));

const tab = (name) => within(screen.getByRole('navigation')).getByRole('button', { name });

beforeEach(() => {
  api.search.mockResolvedValue([{ symbol: 'TSLA', name: 'Tesla Inc', type: 'Common Stock' }]);
  api.stock.mockResolvedValue(makeStock());
  api.history.mockResolvedValue(makeHistory());
  api.historyMax.mockResolvedValue(makeMaxHistory());
  api.news.mockResolvedValue([newsItem(1, 'Apple unveils new iPhone')]);
  api.marketNews.mockResolvedValue([newsItem(2, 'Fed holds interest rates steady')]);
  api.topRated.mockResolvedValue(makeTopRated());
  api.quotes.mockResolvedValue({ AAPL: { price: 110, previousClose: 100, currency: 'USD', priceTime: 1 } });
  api.fx.mockResolvedValue({ USD: 0.8 });
  api.fxOn.mockResolvedValue({ rate: 0.8 });
});

describe('App tabs', () => {
  it('has the four tabs and starts on Stock', async () => {
    render(<App />);
    const names = within(screen.getByRole('navigation')).getAllByRole('button').map((b) => b.textContent.trim());
    expect(names).toEqual(['Stock', 'My stocks', 'Strong buys', 'Market news']);
    expect(tab('Stock')).toHaveClass('active');
    expect(await screen.findByRole('heading', { name: 'Apple Inc' })).toBeInTheDocument();
  });

  it('switches to My stocks', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(tab('My stocks'));
    expect(tab('My stocks')).toHaveClass('active');
    expect(screen.getByRole('heading', { name: /My stocks \(0\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Apple Inc' })).not.toBeInTheDocument();
  });

  it('switches to Strong buys', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(tab('Strong buys'));
    expect(await screen.findByRole('heading', { name: 'Strong buys (2)' })).toBeInTheDocument();
  });

  it('switches to Market news', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(tab('Market news'));
    expect(screen.getByRole('heading', { name: 'Market news' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Fed holds interest rates steady/ })).toBeInTheDocument();
  });

  it('opens a stock from Strong buys and returns to the Stock tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(tab('Strong buys'));
    await user.click(await screen.findByTitle('Open NVDA'));

    expect(tab('Stock')).toHaveClass('active');
    await waitFor(() => expect(api.stock).toHaveBeenCalledWith('NVDA'));
    expect(window.location.hash).toBe('#/NVDA');
  });

  it('opens a stock from the watchlist', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'MSFT' }));
    await waitFor(() => expect(api.stock).toHaveBeenCalledWith('MSFT'));
  });

  it('finds and opens a stock from the search box', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole('searchbox', { name: 'Search stocks' }), 'tesla');
    await user.click(await screen.findByRole('option', { name: /TSLA/ }));

    await waitFor(() => expect(api.stock).toHaveBeenCalledWith('TSLA'));
    expect(api.search).toHaveBeenCalledWith('tesla');
  });

  it('saves a buy price and lists it under My stocks', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByRole('tab');

    await user.click(screen.getByRole('button', { name: '+ Add buy price' }));
    await user.type(screen.getByLabelText(/Buy price per share/), '100');
    await user.type(screen.getByLabelText(/Shares/), '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(JSON.parse(localStorage.getItem('positions'))).toEqual({
      AAPL: { price: 100, shares: 10, date: null, currency: 'USD' },
    });

    await user.click(tab('My stocks'));
    expect(screen.getByRole('heading', { name: /My stocks \(1\)/ })).toBeInTheDocument();
    expect(await screen.findByRole('row', { name: /^AAPL/ })).toHaveTextContent('+$100.00');
  });

  it('remembers the £ GBP switch', async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: '£ GBP' }));
    await waitFor(() => expect(container.querySelector('.big-price')).toHaveTextContent('£88.00'));
    unmount();

    render(<App />);
    expect(screen.getByRole('button', { name: '£ GBP' })).toHaveAttribute('aria-pressed', 'true');
  });
});
