import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyStocks from './MyStocks.jsx';
import { api } from '../api.js';
import { liveStream } from '../test/setup.js';

vi.mock('../api.js', () => ({
  api: { quotes: vi.fn(), fx: vi.fn(), fxOn: vi.fn() },
}));

const POSITIONS = {
  AAPL: { price: 100, shares: 10, date: null, currency: 'USD' }, // now 110 -> +10%
  'VOD.L': { price: 100, shares: 100, date: null, currency: 'GBp' }, // now 80p -> -20%
};

const QUOTES = {
  AAPL: { price: 110, previousClose: 100, currency: 'USD', priceTime: 1_000 },
  'VOD.L': { price: 80, previousClose: 100, currency: 'GBp', priceTime: 1_000 },
};

function renderMyStocks(props = {}) {
  const handlers = { onOpenStock: vi.fn(), onImport: vi.fn() };
  const view = render(<MyStocks positions={POSITIONS} {...handlers} {...props} />);
  return { ...view, ...handlers };
}

/** Table row for a symbol, as { cell(columnName) }. */
function row(symbol) {
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
  const tr = screen.getByRole('row', { name: new RegExp(`^${symbol.replace('.', '\\.')}`) });
  const cells = within(tr).getAllByRole('cell');
  return { tr, cell: (name) => cells[headers.indexOf(name)] };
}

/** Summary card whose label starts with e.g. "USD holdings". */
const card = (currency) => screen.getByText(new RegExp(`^${currency} holdings`)).closest('.card');

beforeEach(() => {
  api.quotes.mockResolvedValue(QUOTES);
  api.fx.mockResolvedValue({ USD: 0.8, GBp: 0.01 });
  api.fxOn.mockResolvedValue({ rate: 0.5 });
});

describe('My stocks tab', () => {
  describe('with no positions', () => {
    it('explains how to add one and does not fetch prices', () => {
      renderMyStocks({ positions: {} });
      expect(screen.getByText(/No positions yet/)).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /My stocks \(0\)/ })).toBeInTheDocument();
      expect(api.quotes).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    });
  });

  describe('holdings table', () => {
    it('fetches prices for every position', async () => {
      renderMyStocks();
      await waitFor(() => expect(api.quotes).toHaveBeenCalledWith(['AAPL', 'VOD.L']));
      expect(screen.getByRole('heading', { name: /My stocks \(2\)/ })).toBeInTheDocument();
    });

    it('shows price, today’s move, return, gain and value for a winning stock', async () => {
      renderMyStocks();
      await waitFor(() => expect(row('AAPL').cell('Price')).toHaveTextContent('$110.00'));

      const aapl = row('AAPL');
      expect(aapl.cell('Shares')).toHaveTextContent('10');
      expect(aapl.cell('Buy price')).toHaveTextContent('$100.00');
      expect(aapl.cell('Today')).toHaveTextContent('+10.00%');
      expect(aapl.cell('Return')).toHaveTextContent('+10.00%');
      expect(aapl.cell('Gain / loss')).toHaveTextContent('+$100.00');
      expect(aapl.cell('Value')).toHaveTextContent('$1,100.00');
    });

    it('shows a losing London stock in pence', async () => {
      renderMyStocks();
      await waitFor(() => expect(row('VOD.L').cell('Price')).toHaveTextContent('80p'));

      const vod = row('VOD.L');
      expect(vod.cell('Buy price')).toHaveTextContent('100p');
      expect(vod.cell('Today')).toHaveTextContent('-20.00%');
      expect(vod.cell('Return')).toHaveTextContent('-20.00%');
      expect(vod.cell('Gain / loss')).toHaveTextContent('-2,000p');
      expect(vod.cell('Value')).toHaveTextContent('8,000p');
    });

    it('shows only a return when the number of shares is unknown', async () => {
      renderMyStocks({ positions: { AAPL: { price: 100, shares: null, date: null, currency: 'USD' } } });
      await waitFor(() => expect(row('AAPL').cell('Return')).toHaveTextContent('+10.00%'));
      expect(row('AAPL').cell('Shares')).toHaveTextContent('—');
      expect(row('AAPL').cell('Gain / loss')).toHaveTextContent('—');
      expect(row('AAPL').cell('Value')).toHaveTextContent('—');
      expect(screen.queryByText(/holdings/)).not.toBeInTheDocument(); // nothing to total
    });

    it('flags a stock whose price could not be loaded', async () => {
      api.quotes.mockResolvedValue({ ...QUOTES, AAPL: { error: 'No price history found for AAPL.' } });
      renderMyStocks();
      await waitFor(() => expect(row('AAPL').tr).toHaveTextContent('Price unavailable'));
      expect(row('AAPL').cell('Return')).toHaveTextContent('—');
    });

    it('asks you to re-enter the buy price if the stock’s currency changed', async () => {
      api.quotes.mockResolvedValue({ ...QUOTES, AAPL: { ...QUOTES.AAPL, currency: 'EUR' } });
      renderMyStocks();
      await waitFor(() => expect(row('AAPL').tr).toHaveTextContent('Currency changed: edit buy price'));
      expect(row('AAPL').cell('Return')).toHaveTextContent('—');
    });

    it('opens a stock when its row is clicked', async () => {
      const user = userEvent.setup();
      const { onOpenStock } = renderMyStocks();
      await waitFor(() => expect(row('AAPL').cell('Price')).toHaveTextContent('$110.00'));

      await user.click(row('VOD.L').tr);
      expect(onOpenStock).toHaveBeenCalledWith('VOD.L');
    });

    it('shows an error if prices cannot be loaded', async () => {
      api.quotes.mockRejectedValue(new Error('Price history provider (Yahoo) unavailable'));
      renderMyStocks();
      expect(await screen.findByText('Price history provider (Yahoo) unavailable')).toBeInTheDocument();
    });
  });

  describe('totals', () => {
    it('adds up holdings separately per currency in local mode', async () => {
      renderMyStocks();
      await waitFor(() => expect(card('USD')).toBeInTheDocument());

      expect(card('USD')).toHaveTextContent('USD holdings · 1 stock');
      expect(card('USD')).toHaveTextContent('$1,100.00');
      expect(card('USD')).toHaveTextContent('+$100.00 (+10.00%) on $1,000.00 invested');

      // London pence are totalled in pounds: 8,000p = £80
      expect(card('GBP')).toHaveTextContent('£80.00');
      expect(card('GBP')).toHaveTextContent('-£20.00 (-20.00%) on £100.00 invested');
      expect(api.fx).not.toHaveBeenCalled();
    });

    it('combines everything into one £ total in GBP mode', async () => {
      renderMyStocks({ displayMode: 'GBP' });
      // AAPL: $1,100 x 0.8 = £880 (cost £800). VOD.L: £80 (cost £100).
      await waitFor(() => expect(card('GBP')).toHaveTextContent('GBP holdings · 2 stocks'));

      expect(card('GBP')).toHaveTextContent('£960.00');
      expect(card('GBP')).toHaveTextContent('+£60.00 (+6.67%) on £900.00 invested');
      expect(screen.queryByText(/^USD holdings/)).not.toBeInTheDocument();
      expect(row('AAPL').cell('Price')).toHaveTextContent('£88.00');
      expect(row('AAPL').cell('Value')).toHaveTextContent('£880.00');
      expect(row('VOD.L').cell('Price')).toHaveTextContent('£0.80');
    });

    it('uses the exchange rate on the buy date and reports the FX effect', async () => {
      renderMyStocks({
        displayMode: 'GBP',
        positions: { AAPL: { price: 100, shares: 10, date: '2024-03-01', currency: 'USD' } },
      });

      // cost 10 x $100 x 0.5 = £500; value 10 x $110 x 0.8 = £880
      await waitFor(() => expect(row('AAPL').cell('Return')).toHaveTextContent('+76.00%'));
      expect(api.fxOn).toHaveBeenCalledWith('USD', '2024-03-01');
      expect(row('AAPL').cell('Buy price')).toHaveTextContent('£50.00');
      expect(row('AAPL').cell('Gain / loss')).toHaveTextContent('+£380.00');
      expect(card('GBP')).toHaveTextContent('incl. +£300.00 from exchange-rate moves');
    });
  });

  describe('live prices', () => {
    it('streams US holdings only and updates the table on each trade', async () => {
      renderMyStocks();
      await waitFor(() => expect(row('AAPL').cell('Price')).toHaveTextContent('$110.00'));

      const stream = liveStream();
      expect(stream.url).toBe('/api/stream?symbols=AAPL'); // VOD.L isn't streamable
      expect(row('AAPL').tr.querySelector('.live-dot')).toBeNull();

      act(() => stream.emit('trades', [{ s: 'AAPL', p: 120, t: 2_000 }]));

      expect(row('AAPL').cell('Price')).toHaveTextContent('$120.00');
      expect(row('AAPL').cell('Return')).toHaveTextContent('+20.00%');
      expect(row('AAPL').cell('Value')).toHaveTextContent('$1,200.00');
      expect(row('AAPL').tr.querySelector('.live-dot')).not.toBeNull();
      expect(card('USD')).toHaveTextContent('$1,200.00');
    });

    it('ignores a trade that is older than the latest quote', async () => {
      renderMyStocks();
      await waitFor(() => expect(row('AAPL').cell('Price')).toHaveTextContent('$110.00'));
      act(() => liveStream().emit('trades', [{ s: 'AAPL', p: 120, t: 500 }]));
      expect(row('AAPL').cell('Price')).toHaveTextContent('$110.00');
    });
  });

  describe('backup', () => {
    it('exports positions as a JSON file', async () => {
      const user = userEvent.setup();
      let exported;
      URL.createObjectURL = vi.fn((blob) => {
        exported = blob;
        return 'blob:test';
      });
      URL.revokeObjectURL = vi.fn();
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
        click.download = this.download;
      });

      renderMyStocks();
      await user.click(screen.getByRole('button', { name: 'Export' }));

      expect(click).toHaveBeenCalledTimes(1);
      expect(click.download).toMatch(/^my-stocks-\d{4}-\d{2}-\d{2}\.json$/);
      const file = JSON.parse(await exported.text());
      expect(file.version).toBe(1);
      expect(file.positions).toEqual(POSITIONS);
      click.mockRestore();
    });

    it('imports positions from a file', async () => {
      const user = userEvent.setup();
      const { container, onImport } = renderMyStocks();
      onImport.mockReturnValue(2);
      const backup = { version: 1, positions: { MSFT: { price: 300 }, NVDA: { price: 90 } } };

      await user.upload(
        container.querySelector('input[type="file"]'),
        new File([JSON.stringify(backup)], 'my-stocks.json', { type: 'application/json' })
      );

      await waitFor(() => expect(onImport).toHaveBeenCalledWith(backup));
      expect(await screen.findByText('Imported 2 positions.')).toBeInTheDocument();
    });

    it('rejects a file that is not valid JSON', async () => {
      const user = userEvent.setup();
      const { container, onImport } = renderMyStocks();

      await user.upload(
        container.querySelector('input[type="file"]'),
        new File(['not json'], 'broken.json', { type: 'application/json' })
      );

      expect(await screen.findByText('That file isn’t a valid export.')).toBeInTheDocument();
      expect(onImport).not.toHaveBeenCalled();
    });

    it('says when a file contains no usable positions', async () => {
      const user = userEvent.setup();
      const { container, onImport } = renderMyStocks();
      onImport.mockReturnValue(0);

      await user.upload(
        container.querySelector('input[type="file"]'),
        new File(['{}'], 'empty.json', { type: 'application/json' })
      );

      expect(await screen.findByText('No valid positions found in that file.')).toBeInTheDocument();
    });
  });
});
