import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TopRated from './TopRated.jsx';
import { api } from '../api.js';
import { makeTopRated } from '../test/fixtures.js';

vi.mock('../api.js', () => ({ api: { topRated: vi.fn() } }));

// Fixture: Technology = NVDA (US, Strong buy), TSM (Asia, Strong buy), ASML (Europe, Buy)
//          Energy     = XOM (US, Hold)

async function renderTopRated() {
  const onOpenStock = vi.fn();
  const view = render(<TopRated onOpenStock={onOpenStock} />);
  await screen.findByRole('group', { name: 'Sector' });
  return { ...view, onOpenStock };
}

const sectorCard = (name) => screen.getByRole('heading', { name, level: 3 }).closest('.sector-card');
const stockRow = (symbol) => screen.queryByTitle(`Open ${symbol}`);
const region = (name) => within(screen.getByRole('group', { name: 'Region' })).getByRole('button', { name });
const sectorChip = (name) =>
  within(screen.getByRole('group', { name: 'Sector' })).getByRole('button', { name: new RegExp(`^${name}`) });
const strongOnly = () => screen.getByRole('checkbox', { name: 'Strong buys only' });

beforeEach(() => {
  api.topRated.mockResolvedValue(makeTopRated());
});

describe('Strong buys tab', () => {
  describe('loading', () => {
    it('shows a loading message until ratings arrive', async () => {
      render(<TopRated onOpenStock={() => {}} />);
      expect(screen.getByText('Loading analyst ratings…')).toBeInTheDocument();
      expect(await screen.findByRole('group', { name: 'Sector' })).toBeInTheDocument();
    });

    it('shows an error if ratings cannot be loaded', async () => {
      api.topRated.mockRejectedValue(new Error('Server unreachable'));
      render(<TopRated onOpenStock={() => {}} />);
      expect(await screen.findByText('Server unreachable')).toBeInTheDocument();
    });

    it('shows a problem reported by the server, such as a missing API key', async () => {
      api.topRated.mockResolvedValue(makeTopRated({ error: 'FINNHUB_API_KEY is not set.', sectors: [] }));
      render(<TopRated onOpenStock={() => {}} />);
      expect(await screen.findByText('FINNHUB_API_KEY is not set.')).toBeInTheDocument();
    });

    it('says when the ratings were last checked', async () => {
      await renderTopRated();
      expect(screen.getByText(/Ratings checked .* refreshed every 12 hours/)).toBeInTheDocument();
    });
  });

  describe('strong buys by sector', () => {
    it('shows only strong buys by default, grouped by sector', async () => {
      await renderTopRated();

      expect(screen.getByRole('heading', { name: 'Strong buys (2)' })).toBeInTheDocument();
      expect(strongOnly()).toBeChecked();

      const tech = within(sectorCard('Technology'));
      expect(tech.getByTitle('Open NVDA')).toBeInTheDocument();
      expect(tech.getByTitle('Open TSM')).toBeInTheDocument();
      expect(stockRow('ASML')).not.toBeInTheDocument(); // rated Buy, not Strong buy
    });

    it('shows each stock’s rating, score and analyst count', async () => {
      await renderTopRated();
      const nvda = stockRow('NVDA');
      expect(nvda).toHaveTextContent('NVDA');
      expect(nvda).toHaveTextContent('Nvidia');
      expect(nvda).toHaveTextContent('Strong buy');
      expect(nvda).toHaveTextContent('4.30 / 5 · 90% buy · 69 analysts');
    });

    it('shows the country for companies outside the US', async () => {
      await renderTopRated();
      expect(stockRow('TSM')).toHaveTextContent('TSMC · Taiwan');
      expect(stockRow('NVDA')).not.toHaveTextContent('· US');
    });

    it('shows the highest-rated stock when a sector has no strong buys', async () => {
      await renderTopRated();
      const energy = within(sectorCard('Energy'));
      expect(energy.getByText('No strong-buy consensus in this sector right now.')).toBeInTheDocument();
      expect(energy.getByText('Highest rated:')).toBeInTheDocument();
      expect(energy.getByTitle('Open XOM')).toHaveTextContent('Hold');
    });

    it('lists every rated stock, best first, when “Strong buys only” is unticked', async () => {
      const user = userEvent.setup();
      await renderTopRated();

      await user.click(strongOnly());

      const rows = within(sectorCard('Technology')).getAllByTitle(/^Open /);
      expect(rows.map((r) => r.title)).toEqual(['Open NVDA', 'Open TSM', 'Open ASML']);
      expect(stockRow('ASML')).toHaveTextContent('ASML · Netherlands');
      expect(stockRow('ASML')).toHaveTextContent('Buy');
      expect(within(sectorCard('Energy')).queryByText('Highest rated:')).not.toBeInTheDocument();
    });

    it('notes when a rating is improving or weakening', async () => {
      const data = makeTopRated();
      data.sectors[0].stocks[0].trend = 0.12;
      data.sectors[0].stocks[1].trend = -0.2;
      api.topRated.mockResolvedValue(data);
      await renderTopRated();

      expect(stockRow('NVDA')).toHaveTextContent('▲ improving');
      expect(stockRow('TSM')).toHaveTextContent('▼ weakening');
    });

    it('opens a stock when it is clicked', async () => {
      const user = userEvent.setup();
      const { onOpenStock } = await renderTopRated();
      await user.click(stockRow('TSM'));
      expect(onOpenStock).toHaveBeenCalledWith('TSM');
    });
  });

  describe('region filter', () => {
    it('offers Worldwide, US, Europe, Asia and Rest of world, starting on Worldwide', async () => {
      await renderTopRated();
      const buttons = within(screen.getByRole('group', { name: 'Region' })).getAllByRole('button');
      expect(buttons.map((b) => b.textContent)).toEqual(['Worldwide', 'US', 'Europe', 'Asia', 'Rest of world']);
      expect(region('Worldwide')).toHaveAttribute('aria-pressed', 'true');
    });

    it('filters to one region and updates the counts', async () => {
      const user = userEvent.setup();
      await renderTopRated();

      await user.click(region('Asia'));

      expect(region('Asia')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('heading', { name: 'Strong buys (1)' })).toBeInTheDocument();
      expect(stockRow('TSM')).toBeInTheDocument();
      expect(stockRow('NVDA')).not.toBeInTheDocument();
      expect(sectorChip('Technology')).toHaveTextContent('1');
    });

    it('explains when a region has no strong buys in a sector', async () => {
      const user = userEvent.setup();
      await renderTopRated();

      await user.click(region('Europe'));

      expect(screen.getByRole('heading', { name: 'Strong buys (0)' })).toBeInTheDocument();
      const tech = within(sectorCard('Technology'));
      expect(tech.getByText('No strong-buy consensus among Europe companies in this sector right now.')).toBeInTheDocument();
      expect(tech.getByTitle('Open ASML')).toBeInTheDocument(); // shown as "Highest rated"
      expect(within(sectorCard('Energy')).getByText('No analyst data available.')).toBeInTheDocument();
    });
  });

  describe('sector filter', () => {
    it('shows a button per sector with its number of strong buys', async () => {
      await renderTopRated();
      expect(sectorChip('All')).toHaveTextContent('2');
      expect(sectorChip('Technology')).toHaveTextContent('2');
      expect(sectorChip('Energy')).toHaveTextContent('0');
    });

    it('filters to a single sector and back', async () => {
      const user = userEvent.setup();
      await renderTopRated();

      await user.click(sectorChip('Energy'));
      expect(screen.getByRole('heading', { name: 'Energy', level: 3 })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Technology', level: 3 })).not.toBeInTheDocument();
      expect(stockRow('NVDA')).not.toBeInTheDocument();

      await user.click(sectorChip('All'));
      expect(screen.getByRole('heading', { name: 'Technology', level: 3 })).toBeInTheDocument();
      expect(stockRow('NVDA')).toBeInTheDocument();
    });
  });

  describe('while the server is still checking ratings', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it('shows progress and keeps refreshing until the check finishes', async () => {
      const partial = makeTopRated({ scanning: true, done: 10, total: 344, updatedAt: null });
      partial.sectors[1].stocks = []; // Energy not reached yet
      api.topRated.mockResolvedValueOnce(partial).mockResolvedValue(makeTopRated());

      await renderTopRated();
      expect(screen.getByText(/Checking analyst ratings… 10 of 344 stocks/)).toBeInTheDocument();
      expect(within(sectorCard('Energy')).getByText('Not checked yet…')).toBeInTheDocument();
      expect(api.topRated).toHaveBeenCalledTimes(1);

      await act(() => vi.advanceTimersByTimeAsync(4000));

      await waitFor(() => expect(api.topRated).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByText(/Checking analyst ratings/)).not.toBeInTheDocument());
      expect(within(sectorCard('Energy')).getByTitle('Open XOM')).toBeInTheDocument();
    });

    it('stops refreshing quickly once the check has finished', async () => {
      await renderTopRated();
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(api.topRated).toHaveBeenCalledTimes(1); // next refresh is 10 minutes away
    });
  });
});
