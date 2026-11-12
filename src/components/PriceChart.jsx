import { useEffect, useRef, useState } from 'react';
import { money, pct, signed, tone } from '../format.js';

const HEIGHT = 280;
const M = { top: 12, right: 64, bottom: 28, left: 8 };
const DAY = 86_400_000;
const MIN_ZOOM_POINTS = 3;

const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtMonth = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
const fmtYear = (t) => new Date(t).getFullYear();
const fmtFull = (t, intraday) =>
  new Date(t).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: intraday ? undefined : 'numeric',
    ...(intraday ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
const fmtShort = (t, intraday) =>
  new Date(t).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: intraday ? undefined : 'numeric',
    ...(intraday ? { hour: '2-digit', minute: '2-digit' } : {}),
  });

/** Axis labels follow the time span on screen, so they stay sensible when zoomed. */
function axisFormat(spanMs) {
  if (spanMs <= 1.5 * DAY) return fmtTime;
  if (spanMs <= 8 * DAY) return fmtDay;
  if (spanMs <= 120 * DAY) return fmtDate;
  if (spanMs <= 900 * DAY) return fmtMonth;
  return fmtYear;
}

/**
 * Single-series price line. X is by index (so overnight / weekend gaps don't
 * leave holes), dashed baseline = price at the start of the period.
 * Drag across the chart to zoom into a region; double-click or "Reset zoom" to go back.
 */
export default function PriceChart({ points, baseline, currency, rate = 1, periodKey, cost }) {
  const wrap = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null);
  const [drag, setDrag] = useState(null); // { a, b } indices into the visible points
  const [zoom, setZoom] = useState(null); // { key, from, to } timestamps; `to` = Infinity follows live data

  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setHover(null);
    setDrag(null);
  }, [periodKey]);

  const all = points || [];
  // A zoom only applies to the period it was made in.
  let view = all;
  if (zoom && zoom.key === periodKey) {
    const inRange = all.filter((p) => p.t >= zoom.from && p.t <= zoom.to);
    if (inRange.length >= 2) view = inRange;
  }
  const zoomed = view !== all;
  const ok = view.length >= 2;
  const resetZoom = () => {
    setZoom(null);
    setHover(null);
  };

  let chart = null;
  let bar = null;
  if (ok) {
    const n = view.length;
    const intraday = view[1].t - view[0].t < 20 * 60 * 60 * 1000;
    const xLabel = axisFormat(view[n - 1].t - view[0].t);
    // Zoomed in: compare against the start of the visible region instead of the period start.
    const base = zoomed ? view[0].c : baseline;

    const innerW = Math.max(50, width - M.left - M.right);
    const innerH = HEIGHT - M.top - M.bottom;
    const values = view.map((p) => p.c);
    let min = Math.min(...values, base ?? Infinity);
    let max = Math.max(...values, base ?? -Infinity);
    const pad = (max - min) * 0.08 || max * 0.01 || 1;
    min -= pad;
    max += pad;

    const x = (i) => M.left + (i / (n - 1)) * innerW;
    const y = (v) => M.top + (1 - (v - min) / (max - min)) * innerH;

    const line = view.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join('');
    const area = `${line}L${x(n - 1).toFixed(1)},${M.top + innerH}L${x(0).toFixed(1)},${M.top + innerH}Z`;
    const ref = base ?? values[0];
    const up = values[n - 1] >= ref;

    const yTicks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * (i + 0.5)) / 5);
    const xCount = Math.max(2, Math.min(6, Math.floor(innerW / 110), n));
    const xTicks = [...new Set(Array.from({ length: xCount }, (_, i) => Math.round((i * (n - 1)) / (xCount - 1))))];

    const indexAt = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const i = Math.round(((e.clientX - rect.left - M.left) / innerW) * (n - 1));
      return Math.max(0, Math.min(n - 1, i));
    };

    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const i = indexAt(e);
      setDrag({ a: i, b: i });
      e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e) => {
      const i = indexAt(e);
      setHover(i);
      if (drag) setDrag((d) => (d ? { ...d, b: i } : d));
    };
    const onPointerUp = () => {
      if (!drag) return;
      const lo = Math.min(drag.a, drag.b);
      const hi = Math.max(drag.a, drag.b);
      setDrag(null);
      if (hi - lo + 1 < MIN_ZOOM_POINTS) return; // a click or tiny drag: not a zoom
      const toEnd = hi === n - 1 && view[n - 1] === all[all.length - 1];
      setZoom({ key: periodKey, from: view[lo].t, to: toEnd ? Infinity : view[hi].t });
      setHover(null);
    };

    const sel = drag && drag.a !== drag.b ? { lo: Math.min(drag.a, drag.b), hi: Math.max(drag.a, drag.b) } : null;
    const hp = hover != null && hover < n ? view[hover] : null;

    const viewChange = values[n - 1] - values[0];
    bar = zoomed ? (
      <>
        <span className="small">
          <span className="muted">
            {fmtShort(view[0].t, intraday)} – {fmtShort(view[n - 1].t, intraday)} ·{' '}
          </span>
          <strong className={tone(viewChange)}>{pct((values[n - 1] / values[0] - 1) * 100)}</strong>
        </span>
        <button className="ghost-btn" onClick={resetZoom}>Reset zoom</button>
      </>
    ) : (
      <span className="muted small">Drag across the chart to zoom in</span>
    );

    chart = (
      <>
        <svg
          width={width}
          height={HEIGHT}
          className={`price-chart ${up ? 'up' : 'down'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          onPointerLeave={() => !drag && setHover(null)}
          onDoubleClick={resetZoom}
          role="img"
          aria-label={`Price chart, ${up ? 'up' : 'down'} over the ${zoomed ? 'selected range' : 'period'}`}
        >
          <defs>
            <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" className="area-stop-top" />
              <stop offset="100%" className="area-stop-bottom" />
            </linearGradient>
          </defs>

          {yTicks.map((v) => (
            <g key={v}>
              <line className="grid" x1={M.left} x2={M.left + innerW} y1={y(v)} y2={y(v)} />
              <text className="axis" x={M.left + innerW + 8} y={y(v)} dy="0.32em">
                {money(v * rate, currency)}
              </text>
            </g>
          ))}
          {xTicks.map((i, k) => (
            <text
              key={i}
              className="axis"
              x={x(i)}
              y={HEIGHT - 8}
              textAnchor={k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'}
            >
              {xLabel(view[i].t)}
            </text>
          ))}

          {base != null && <line className="baseline" x1={M.left} x2={M.left + innerW} y1={y(base)} y2={y(base)} />}
          <path d={area} fill="url(#area-fill)" />
          <path d={line} className="line" fill="none" />

          {cost != null &&
            (cost >= min && cost <= max ? (
              <g>
                <line className="cost-line" x1={M.left} x2={M.left + innerW} y1={y(cost)} y2={y(cost)} />
                <text className="cost-label" x={M.left + 4} y={y(cost) - 5}>
                  Your buy {money(cost * rate, currency)}
                </text>
              </g>
            ) : (
              <text className="cost-label" x={M.left + 4} y={cost > max ? M.top + 10 : M.top + innerH - 6}>
                {cost > max ? '▲' : '▼'} Your buy {money(cost * rate, currency)}
              </text>
            ))}

          {sel && (
            <g>
              <rect className="selection" x={x(sel.lo)} y={M.top} width={x(sel.hi) - x(sel.lo)} height={innerH} />
              <circle className="hover-dot" cx={x(sel.lo)} cy={y(view[sel.lo].c)} r={4} />
              <circle className="hover-dot" cx={x(sel.hi)} cy={y(view[sel.hi].c)} r={4} />
            </g>
          )}
          {!sel && hp && (
            <g>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + innerH} />
              <circle className="hover-dot" cx={x(hover)} cy={y(hp.c)} r={5} />
            </g>
          )}
          {/* full-size transparent hit area */}
          <rect x={M.left} y={M.top} width={innerW} height={innerH} fill="transparent" />
        </svg>

        {sel ? (
          <div
            className="chart-tooltip"
            style={{ left: Math.min(Math.max((x(sel.lo) + x(sel.hi)) / 2, 110), width - 110), top: 0 }}
          >
            <div className="muted small">
              {fmtShort(view[sel.lo].t, intraday)} → {fmtShort(view[sel.hi].t, intraday)}
            </div>
            <div className="tt-price">
              {pct((view[sel.hi].c / view[sel.lo].c - 1) * 100)}{' '}
              <span className="small">({signed((view[sel.hi].c - view[sel.lo].c) * rate, currency)})</span>
            </div>
            <div className="small muted">Release to zoom</div>
          </div>
        ) : (
          hp && (
            <div
              className="chart-tooltip"
              style={{
                left: Math.min(Math.max(x(hover), 80), width - 80),
                top: Math.max(0, y(hp.c) - 70),
              }}
            >
              <div className="muted small">{fmtFull(hp.t, intraday)}</div>
              <div className="tt-price">{money(hp.c * rate, currency)}</div>
              <div className="small">{pct((hp.c / ref - 1) * 100)} vs start</div>
            </div>
          )
        )}
      </>
    );
  }

  return (
    <div className="chart">
      <div className="chart-bar">{bar}</div>
      <div className="chart-wrap" ref={wrap}>
        {chart ?? <div className="chart-empty muted">Not enough price data for this period.</div>}
      </div>
    </div>
  );
}
