import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StockView from './StockView.jsx';
import { api } from '../api.js';
import { liveStream } from '../test/setup.js';
import { makeHistory, makeMaxHistory, makeStock, newsItem } from '../test/fixtures.js';

vi.mock('../api.js', () => ({
  api: {
    stock: vi.fn(),
    history: vi.fn(),
    historyMax: vi.fn(),
    news: vi.fn(),
    fx: vi.fn(),
    fxOn: vi.fn(),
  },
}));

function renderStock(props = {}) {
  const handlers = { onToggleStar: vi.fn(), onSavePosition: vi.fn(), onRemovePosition: vi.fn() };
  const view = render(<StockView symbol="AAPL" starred={false} position={null} {...handlers} {...props} />);
  return { ...view, ...handlers };
}

/** The value shown next to a stat label, e.g. statValue('P/E (TTM)') -> "30.5". */
const statValue = (label, root = screen) => root.getByText(label).nextElementSibling;
const bigPrice = (container) => container.querySelector('.big-price');

beforeEach(() => {
  api.stock.mockResolvedValue(makeStock());
  api.history.mockResolvedValue(makeHistory());
  api.historyMax.mockResolvedValue(makeMaxHistory());
  api.news.mockResolvedValue([newsItem(1, 'Apple unveils new iPhone'), newsItem(2, 'Apple beats earnings')]);
  api.fx.mockResolvedValue({ USD: 0.8 });
  api.fxOn.mockResolvedValue({ rate: 0.5 });
});

describe('Stock tab', () => {
  describe('main card', () => {
    it('shows the company, price and today’s change', async () => {
      const { container } = renderStock();

      expect(await screen.findByRole('heading', { name: 'Apple Inc' })).toBeInTheDocument();
      expect(screen.getByText(/AAPL · NASDAQ · Technology/)).toBeInTheDocument();
      await waitFor(() => expect(bigPrice(container)).toHaveTextContent('$110.00'));
      expect(screen.getByText(/\+\$10\.00 \(\+10\.00%\) today/)).toBeInTheDocument();
    });

    it('requests data for the selected symbol', async () => {
      renderStock({ symbol: 'MSFT' });
      await waitFor(() => expect(api.stock).toHaveBeenCalledWith('MSFT'));
      expect(api.history).toHaveBeenCalledWith('MSFT');
      expect(api.historyMax).toHaveBeenCalledWith('MSFT');
      expect(api.news).toHaveBeenCalledWith('MSFT');
    });

    it('shows key stats, the 52-week range and analyst consensus inside the main card', async () => {
      renderStock();
      await screen.findByText('P/E (TTM)');

      expect(statValue('P/E (TTM)')).toHaveTextContent('30.5');
      expect(statValue('EPS (TTM)')).toHaveTextContent('6.1');
      expect(statValue('Beta')).toHaveTextContent('1.2');
      expect(statValue('Div. yield')).toHaveTextContent('0.5%');
      expect(statValue('Market cap')).toHaveTextContent('3T');
      // (110 - 60) / (120 - 60) = 83%
      expect(await screen.findByText(/Trading at 83% of its 52-week range/)).toBeInTheDocument();
      expect(screen.getByText('Analyst consensus').parentElement).toHaveTextContent('Strong buy');
      expect(screen.getByText(/32 analysts/)).toBeInTheDocument();
    });

    it('toggles the watchlist star', async () => {
      const user = userEvent.setup();
      const { onToggleStar } = renderStock();
      await user.click(screen.getByRole('button', { name: '☆ Watch' }));
      expect(onToggleStar).toHaveBeenCalledTimes(1);
    });

    it('shows “Watching” for a starred stock', () => {
      renderStock({ starred: true });
      expect(screen.getByRole('button', { name: '★ Watching' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows both errors when neither data source responds', async () => {
      api.stock.mockRejectedValue(new Error('Finnhub is down'));
      api.history.mockRejectedValue(new Error('Yahoo is down'));
      renderStock();
      expect(await screen.findByText('Finnhub is down')).toBeInTheDocument();
      expect(screen.getByText('Yahoo is down')).toBeInTheDocument();
    });

    it('still shows price and performance when only Finnhub fails', async () => {
      api.stock.mockRejectedValue(new Error('Finnhub is down'));
      const { container } = renderStock();
      await waitFor(() => expect(bigPrice(container)).toHaveTextContent('$110.00'));
      expect(screen.getByRole('tab', { name: /^1 year/ })).toHaveTextContent('+120.00%');
      expect(screen.queryByText('P/E (TTM)')).not.toBeInTheDocument();
    });
  });

  describe('performance', () => {
    it('shows a tile for every period, from 1 day to Max', async () => {
      renderStock();
      const tiles = await screen.findAllByRole('tab');
      expect(tiles.map((t) => t.querySelector('.perf-label').textContent)).toEqual([
        '1 day', '1 week', '1 month', '3 months', '6 months', '1 year', 'Max',
      ]);
    });

    it('calculates the gain or loss for each period', async () => {
      renderStock();
      await screen.findAllByRole('tab');

      for (const period of ['1 day', '1 week', '1 month', '3 months', '6 months']) {
        const tile = screen.getByRole('tab', { name: new RegExp(`^${period}`) });
        expect(tile).toHaveTextContent('+10.00%'); // 100 -> 110
        expect(tile).toHaveTextContent('+$10.00');
      }
      const year = screen.getByRole('tab', { name: /^1 year/ });
      expect(year).toHaveTextContent('+120.00%'); // 50 -> 110
      expect(year).toHaveTextContent('+$60.00');
      await waitFor(() => expect(screen.getByRole('tab', { name: /^Max/ })).toHaveTextContent('+900.00%')); // 11 -> 110
    });

    it('shows a loss with a minus sign and a down arrow', async () => {
      api.history.mockResolvedValue(makeHistory({ price: 90 }));
      api.stock.mockResolvedValue(makeStock({ quote: null }));
      renderStock();
      const day = await screen.findByRole('tab', { name: /^1 day/ });
      expect(day).toHaveTextContent('▼');
      expect(day).toHaveTextContent('-10.00%');
      expect(day).toHaveTextContent('-$10.00');
    });

    it('charts 1 month by default and switches period when a tile is clicked', async () => {
      const user = userEvent.setup();
      renderStock();
      const month = await screen.findByRole('tab', { name: /^1 month/ });
      expect(month).toHaveAttribute('aria-selected', 'true');
      expect(statValue('Start price')).toHaveTextContent('$100.00');

      const year = screen.getByRole('tab', { name: /^1 year/ });
      await user.click(year);
      expect(year).toHaveAttribute('aria-selected', 'true');
      expect(month).toHaveAttribute('aria-selected', 'false');
      expect(statValue('Start price')).toHaveTextContent('$50.00');
      expect(statValue('Period low')).toHaveTextContent('$50.00');
      expect(statValue('Period high')).toHaveTextContent('$110.00');
    });

    it('labels the 1 day start as the previous close', async () => {
      const user = userEvent.setup();
      renderStock();
      await user.click(await screen.findByRole('tab', { name: /^1 day/ }));
      expect(statValue('Prev close')).toHaveTextContent('$100.00');
    });

    it('draws the chart and offers zoom', async () => {
      renderStock();
      expect(await screen.findByRole('img', { name: /Price chart, up over the period/ })).toBeInTheDocument();
      expect(screen.getByText('Drag across the chart to zoom in')).toBeInTheDocument();
    });

    it('can be collapsed and expanded', async () => {
      const user = userEvent.setup();
      renderStock();
      await screen.findAllByRole('tab');
      const toggle = screen.getByRole('button', { name: 'Performance' });

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryAllByRole('tab')).toHaveLength(0);

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getAllByRole('tab')).toHaveLength(7);
    });
  });

  describe('news', () => {
    it('lists the latest headlines as links to the articles', async () => {
      renderStock();
      const link = await screen.findByRole('link', { name: /Apple unveils new iPhone/ });
      expect(link).toHaveAttribute('href', 'https://news.example/1');
      expect(link).toHaveAttribute('target', '_blank');
      expect(screen.getByRole('link', { name: /Apple beats earnings/ })).toBeInTheDocument();
    });

    it('says so when there is no recent news', async () => {
      api.news.mockResolvedValue([]);
      renderStock();
      expect(await screen.findByText('No news in the last 14 days.')).toBeInTheDocument();
    });

    it('warns that news may be missing for non-US listings', async () => {
      api.history.mockResolvedValue(makeHistory({ currency: 'GBp' }));
      renderStock({ symbol: 'VOD.L' });
      expect(await screen.findByText(/only has company news for North American listings/)).toBeInTheDocument();
    });
  });

  describe('live prices', () => {
    it('opens a live stream for US stocks and updates the price on each trade', async () => {
      const { container } = renderStock();
      await waitFor(() => expect(bigPrice(container)).toHaveTextContent('$110.00'));

      const stream = liveStream();
      expect(stream.url).toBe('/api/stream?symbols=AAPL');
      expect(container.querySelector('.feed')).toHaveTextContent('Updates every 15s');

      act(() => {
        stream.emit('status', { connected: true });
        stream.emit('trades', [{ s: 'AAPL', p: 121, t: Date.now() + 1000 }]);
      });

      await waitFor(() => expect(bigPrice(container)).toHaveTextContent('$121.00'));
      expect(container.querySelector('.feed')).toHaveTextContent(/^\s*Live/);
      // 100 -> 121
      expect(screen.getByRole('tab', { name: /^1 day/ })).toHaveTextContent('+21.00%');
    });

    it('ignores trades for other symbols', async () => {
      const { container } = renderStock();
      await waitFor(() => expect(bigPrice(container)).toHaveTextContent('$110.00'));
      act(() => liveStream().emit('trades', [{ s: 'MSFT', p: 999, t: Date.now() + 1000 }]));
      expect(bigPrice(container)).toHaveTextContent('$110.00');
    });

    it('does not open a live stream for non-US stocks', async () => {
      api.history.mockResolvedValue(makeHistory({ currency: 'GBp' }));
      const { container } = renderStock({ symbol: 'VOD.L' });
      await waitFor(() => expect(bigPrice(container)).toHaveTextContent('110p'));
      expect(liveStream()).toBeUndefined();
      expect(container.querySelector('.feed')).toHaveTextContent('Updates every minute');
    });

    it('closes the stream when leaving the stock', async () => {
      const { unmount } = renderStock();
      await screen.findAllByRole('tab');
      const stream = liveStream();
      unmount();
      expect(stream.closed).toBe(true);
    });
  });

  describe('your position', () => {
    it('lets you add a buy price', async () => {
      const user = userEvent.setup();
      const { onSavePosition } = renderStock();
      await screen.findAllByRole('tab');

      await user.click(screen.getByRole('button', { name: '+ Add buy price' }));
      await user.type(screen.getByLabelText(/Buy price per share/), '100');
      await user.type(screen.getByLabelText(/Shares/), '10');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(onSavePosition).toHaveBeenCalledWith({ price: 100, shares: 10, date: null, currency: 'USD' });
    });

    it('rejects a missing or zero buy price', async () => {
      const user = userEvent.setup();
      const { onSavePosition } = renderStock();
      await screen.findAllByRole('tab');

      await user.click(screen.getByRole('button', { name: '+ Add buy price' }));
      await user.type(screen.getByLabelText(/Buy price per share/), '0');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(screen.getByText('Enter the price you paid per share.')).toBeInTheDocument();
      expect(onSavePosition).not.toHaveBeenCalled();
    });

    it('shows your return, gain, cost and value', async () => {
      renderStock({ position: { price: 55, shares: 10, date: null, currency: 'USD' } });
      await screen.findByText('Your return');

      // bought at 55, now 110
      await waitFor(() => expect(statValue('Your return')).toHaveTextContent('+100.00%'));
      expect(statValue('Gain')).toHaveTextContent('+$550.00');
      expect(statValue('Buy price')).toHaveTextContent('$55.00');
      expect(statValue('Current price')).toHaveTextContent('$110.00');
      expect(statValue('Shares')).toHaveTextContent('10');
      expect(statValue('Cost')).toHaveTextContent('$550.00');
      expect(statValue('Value now')).toHaveTextContent('$1,100.00');
    });

    it('labels a losing position as a loss', async () => {
      renderStock({ position: { price: 220, shares: 2, date: null, currency: 'USD' } });
      await waitFor(() => expect(statValue('Your return')).toHaveTextContent('-50.00%'));
      expect(statValue('Loss')).toHaveTextContent('-$220.00');
    });

    it('marks your buy price on the chart', async () => {
      renderStock({ position: { price: 105, shares: 1, date: null, currency: 'USD' } });
      expect(await screen.findByText(/Your buy \$105\.00/)).toBeInTheDocument();
    });

    it('projects the return at a target price without saving it', async () => {
      const user = userEvent.setup();
      const { onSavePosition } = renderStock({ position: { price: 55, shares: 10, date: null, currency: 'USD' } });
      await waitFor(() => expect(statValue('Your return')).toHaveTextContent('+100.00%'));

      await user.type(screen.getByLabelText(/Target price/), '165');

      // bought at 55, target 165
      expect(statValue('Return at target')).toHaveTextContent('+200.00%');
      expect(statValue('Value at target')).toHaveTextContent('$1,650.00');
      expect(onSavePosition).not.toHaveBeenCalled();
    });

    it('asks before removing a position', async () => {
      const user = userEvent.setup();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
      const { onRemovePosition } = renderStock({ position: { price: 55, shares: 10, date: null, currency: 'USD' } });
      await screen.findByText('Your return');

      await user.click(screen.getByRole('button', { name: 'Remove' }));
      expect(onRemovePosition).not.toHaveBeenCalled(); // answered "Cancel"

      await user.click(screen.getByRole('button', { name: 'Remove' }));
      expect(onRemovePosition).toHaveBeenCalledTimes(1);
      confirm.mockRestore();
    });
  });

  describe('£ GBP display', () => {
    it('converts prices at today’s rate and keeps percentages unchanged', async () => {
      const { container } = renderStock({ displayMode: 'GBP' });

      // $110 x 0.8
      await waitFor(() => expect(bigPrice(container)).toHaveTextContent('£88.00'));
      expect(api.fx).toHaveBeenCalledWith(['USD']);
      expect(screen.getByText(/Converted from USD · 1 USD = £0\.8000/)).toBeInTheDocument();
      const day = screen.getByRole('tab', { name: /^1 day/ });
      expect(day).toHaveTextContent('+10.00%');
      expect(day).toHaveTextContent('+£8.00');
    });

    it('does not ask for exchange rates in local-currency mode', async () => {
      renderStock();
      await screen.findAllByRole('tab');
      expect(api.fx).not.toHaveBeenCalled();
    });

    it('includes exchange-rate moves in your return when you entered a buy date', async () => {
      renderStock({
        displayMode: 'GBP',
        position: { price: 100, shares: 10, date: '2024-03-01', currency: 'USD' },
      });

      // cost 10 x $100 x 0.5 = £500, value 10 x $110 x 0.8 = £880
      await waitFor(() => expect(statValue('Your return')).toHaveTextContent('+76.00%'));
      expect(api.fxOn).toHaveBeenCalledWith('USD', '2024-03-01');
      expect(statValue('Gain')).toHaveTextContent('+£380.00');
      expect(statValue('Cost')).toHaveTextContent('£500.00');
      expect(statValue('Value now')).toHaveTextContent('£880.00');
      expect(statValue('Stock move (USD)')).toHaveTextContent('+10.00%');
      expect(statValue('FX effect')).toHaveTextContent('+£300.00'); // 10 x $100 x (0.8 - 0.5)
    });
  });
});
