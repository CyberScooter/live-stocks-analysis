import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MarketNews from './MarketNews.jsx';
import { api } from '../api.js';
import { newsItem } from '../test/fixtures.js';

vi.mock('../api.js', () => ({
  api: { marketNews: vi.fn(), search: vi.fn(), news: vi.fn() },
}));

const MARKET = [
  newsItem(1, 'Fed holds interest rates steady', { source: 'CNBC' }),
  newsItem(2, 'Nvidia unveils new AI chip', { summary: 'The chipmaker announced its next processor.' }),
  newsItem(3, 'Oil prices slide on supply worries'),
];
const COMPANY = [newsItem(10, 'Nvidia earnings beat expectations'), newsItem(11, 'Analysts raise Nvidia targets')];

function renderNews() {
  const onOpenStock = vi.fn();
  const view = render(<MarketNews onOpenStock={onOpenStock} />);
  return { ...view, onOpenStock };
}

const filterBox = () => screen.getByRole('searchbox', { name: 'Filter news by stock' });
const headline = (text) => screen.queryByRole('link', { name: new RegExp(text) });

beforeEach(() => {
  api.marketNews.mockResolvedValue(MARKET);
  api.search.mockResolvedValue([
    { symbol: 'NVDA', name: 'NVIDIA Corp', type: 'Common Stock' },
    { symbol: 'NVD', name: 'GraniteShares 2x Short NVDA', type: 'ETP' },
  ]);
  api.news.mockResolvedValue(COMPANY);
});

describe('Market news tab', () => {
  describe('market headlines', () => {
    it('shows a loading message, then the general market headlines', async () => {
      renderNews();
      expect(screen.getByText('Loading news…')).toBeInTheDocument();

      expect(await screen.findByRole('link', { name: /Fed holds interest rates steady/ })).toBeInTheDocument();
      expect(headline('Nvidia unveils new AI chip')).toBeInTheDocument();
      expect(headline('Oil prices slide on supply worries')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });

    it('links each headline to its article in a new tab, with source and age', async () => {
      renderNews();
      const link = await screen.findByRole('link', { name: /Fed holds interest rates steady/ });
      expect(link).toHaveAttribute('href', 'https://news.example/1');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveTextContent('CNBC · 10m ago');
    });

    it('shows the summary when an article has one', async () => {
      renderNews();
      expect(await screen.findByText('The chipmaker announced its next processor.')).toBeInTheDocument();
    });

    it('shows a placeholder with the source’s initial when an article has no image', async () => {
      const { container } = renderNews();
      await screen.findByRole('link', { name: /Fed holds/ });
      expect(container.querySelectorAll('.news-thumb-fallback')[0]).toHaveTextContent('C'); // CNBC
      expect(container.querySelector('.news-thumb img')).toBeNull();
    });

    it('shows the article image when there is one', async () => {
      api.marketNews.mockResolvedValue([newsItem(1, 'Fed holds rates', { image: 'https://img.example/fed.jpg' })]);
      const { container } = renderNews();
      await screen.findByRole('link', { name: /Fed holds rates/ });
      expect(container.querySelector('.news-thumb img')).toHaveAttribute('src', 'https://img.example/fed.jpg');
    });

    it('says so when there is no market news', async () => {
      api.marketNews.mockResolvedValue([]);
      renderNews();
      expect(await screen.findByText('No market news right now.')).toBeInTheDocument();
    });

    it('shows an error if market news cannot be loaded', async () => {
      api.marketNews.mockRejectedValue(new Error('Finnhub rate limit hit. Try again in a moment.'));
      renderNews();
      expect(await screen.findByText('Finnhub rate limit hit. Try again in a moment.')).toBeInTheDocument();
    });
  });

  describe('filtering by stock', () => {
    it('does not search until something is typed', async () => {
      renderNews();
      await screen.findByRole('link', { name: /Fed holds/ });
      expect(api.search).not.toHaveBeenCalled();
      expect(screen.queryByText(/Mentions in market headlines/)).not.toBeInTheDocument();
    });

    it('looks up the stock and shows its own news', async () => {
      const user = userEvent.setup();
      renderNews();
      await screen.findByRole('link', { name: /Fed holds/ });

      await user.type(filterBox(), 'nvidia');

      expect(await screen.findByRole('heading', { name: 'NVDA · NVIDIA Corp' })).toBeInTheDocument();
      expect(api.search).toHaveBeenCalledWith('nvidia');
      expect(api.news).toHaveBeenCalledWith('NVDA');
      expect(headline('Nvidia earnings beat expectations')).toBeInTheDocument();
      expect(headline('Analysts raise Nvidia targets')).toBeInTheDocument();
    });

    it('waits for you to stop typing before searching', async () => {
      const user = userEvent.setup();
      renderNews();
      await screen.findByRole('link', { name: /Fed holds/ });

      await user.type(filterBox(), 'nvidia');
      await screen.findByRole('heading', { name: 'NVDA · NVIDIA Corp' });

      expect(api.search).toHaveBeenCalledTimes(1); // not once per letter
    });

    it('keeps only the market headlines that mention the stock', async () => {
      const user = userEvent.setup();
      renderNews();
      await screen.findByRole('link', { name: /Fed holds/ });

      await user.type(filterBox(), 'nvidia');

      expect(await screen.findByRole('heading', { name: 'Mentions in market headlines (1)' })).toBeInTheDocument();
      expect(headline('Nvidia unveils new AI chip')).toBeInTheDocument();
      expect(headline('Fed holds interest rates steady')).not.toBeInTheDocument();
      expect(headline('Oil prices slide')).not.toBeInTheDocument();
    });

    it('matches market headlines by company name when a ticker is typed', async () => {
      const user = userEvent.setup();
      renderNews();
      await screen.findByRole('link', { name: /Fed holds/ });

      await user.type(filterBox(), 'NVDA'); // headline says "Nvidia", not "NVDA"

      expect(await screen.findByRole('heading', { name: 'Mentions in market headlines (1)' })).toBeInTheDocument();
      expect(headline('Nvidia unveils new AI chip')).toBeInTheDocument();
    });

    it('prefers an exact ticker match over the first search result', async () => {
      const user = userEvent.setup();
      api.search.mockResolvedValue([
        { symbol: 'FORD', name: 'Forward Industries' },
        { symbol: 'F', name: 'Ford Motor Co' },
      ]);
      renderNews();
      await screen.findByRole('link', { name: /Fed holds/ });

      await user.type(filterBox(), 'f');

      expect(await screen.findByRole('heading', { name: 'F · Ford Motor Co' })).toBeInTheDocument();
      expect(api.news).toHaveBeenCalledWith('F');
    });

    it('opens the stock from the “Open stock” link', async () => {
      const user = userEvent.setup();
      const { onOpenStock } = renderNews();
      await screen.findByRole('link', { name: /Fed holds/ });

      await user.type(filterBox(), 'nvidia');
      await user.click(await screen.findByRole('button', { name: 'Open stock →' }));

      expect(onOpenStock).toHaveBeenCalledWith('NVDA');
    });

    it('says when no stock matches', async () => {
      const user = userEvent.setup();
      api.search.mockResolvedValue([]);
      renderNews();
      await screen.findByRole('link', { name: /Fed holds/ });

      await user.type(filterBox(), 'zzzz');

      expect(await screen.findByText('No stock found for “zzzz”.')).toBeInTheDocument();
      expect(api.news).not.toHaveBeenCalled();
      expect(screen.getByText('No current market headlines mention this stock.')).toBeInTheDocument();
    });

    it('says when the stock has no recent company news', async () => {
      const user = userEvent.setup();
      api.news.mockResolvedValue([]);
      renderNews();
      await screen.findByRole('link', { name: /Fed holds/ });

      await user.type(filterBox(), 'nvidia');

      expect(await screen.findByText(/No company news in the last 14 days/)).toBeInTheDocument();
    });

    it('shows an error if the stock’s news cannot be loaded', async () => {
      const user = userEvent.setup();
      api.news.mockRejectedValue(new Error('This data is not included in Finnhub’s free plan for this symbol.'));
      renderNews();
      await screen.findByRole('link', { name: /Fed holds/ });

      await user.type(filterBox(), 'nvidia');

      expect(await screen.findByText(/not included in Finnhub’s free plan/)).toBeInTheDocument();
    });

    it('brings back every market headline when the filter is cleared', async () => {
      const user = userEvent.setup();
      renderNews();
      await screen.findByRole('link', { name: /Fed holds/ });

      await user.type(filterBox(), 'nvidia');
      await screen.findByRole('heading', { name: 'Mentions in market headlines (1)' });
      await user.clear(filterBox());

      await waitFor(() => expect(headline('Fed holds interest rates steady')).toBeInTheDocument());
      expect(headline('Oil prices slide')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /NVDA/ })).not.toBeInTheDocument();
      expect(screen.queryByText(/Mentions in market headlines/)).not.toBeInTheDocument();
    });
  });
});
