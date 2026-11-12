import { useEffect, useRef, useState } from 'react';
import { timeAgo } from '../format.js';

export default function NewsList({ items, loading, error, emptyText = 'No recent news.' }) {
  if (loading) return <p className="muted">Loading news…</p>;
  if (error) return <p className="error-text">{error}</p>;
  if (!items?.length) return <p className="muted">{emptyText}</p>;

  return (
    <ul className="news">
      {items.map((n, i) => (
        <NewsItem key={n.id || n.url} item={n} featured={i === 0} />
      ))}
    </ul>
  );
}

function NewsItem({ item: n, featured }) {
  const [image, setImage] = useState(n.image || null);
  const [failed, setFailed] = useState(false);
  const ref = useRef(null);

  // No image from the news API: once the item scrolls into view, ask the
  // server for the article's preview image.
  useEffect(() => {
    if (n.image || !n.url) return;
    let alive = true;
    const el = ref.current;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        fetch(`/api/news-image?url=${encodeURIComponent(n.url)}`)
          .then((r) => (r.ok ? r.json() : {}))
          .then((d) => alive && d.image && setImage(d.image))
          .catch(() => {});
      },
      { rootMargin: '200px' }
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [n.image, n.url]);

  const showImage = image && !failed;

  return (
    <li ref={ref} className={featured ? 'featured' : ''}>
      <a href={n.url} target="_blank" rel="noopener noreferrer">
        <div className="news-thumb">
          {showImage ? (
            <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
          ) : (
            <span className="news-thumb-fallback" aria-hidden="true">
              {(n.source || '?').trim().charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="news-text">
          <div className="news-headline">{n.headline}</div>
          {n.summary && <p className="news-summary">{n.summary}</p>}
          <div className="muted small">
            {n.source} · {timeAgo(n.datetime)}
          </div>
        </div>
      </a>
    </li>
  );
}
