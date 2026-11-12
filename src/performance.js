export const PERIODS = [
  { key: '1D', label: '1 day' },
  { key: '1W', label: '1 week', days: 7 },
  { key: '1M', label: '1 month', months: 1 },
  { key: '3M', label: '3 months', months: 3 },
  { key: '6M', label: '6 months', months: 6 },
  { key: '1Y', label: '1 year', months: 12 },
  { key: 'MAX', label: 'Max' },
];

function periodStart(period, now = new Date()) {
  const d = new Date(now);
  if (period.days) d.setDate(d.getDate() - period.days);
  if (period.months) d.setMonth(d.getMonth() - period.months);
  return d.getTime();
}

/** Last daily close on or before `time`. Points are sorted oldest first. */
function closeAtOrBefore(points, time) {
  let ref = null;
  for (const p of points) {
    if (p.t <= time) ref = p;
    else break;
  }
  return ref;
}

/**
 * For each period: the starting price, change vs. the current price, and the
 * high/low seen during the period, plus the points to chart.
 */
export function computePerformance(history, price) {
  if (!history || price == null) return {};
  const out = {};

  for (const period of PERIODS) {
    let start, series;
    if (period.key === '1D') {
      start = history.previousClose != null ? { t: null, c: history.previousClose } : history.intraday[0];
      series = history.intraday;
    } else if (period.key === 'MAX') {
      // Everything available (weekly closes), from the first recorded price
      series = history.max;
      start = series?.[0];
    } else {
      const from = periodStart(period);
      start = closeAtOrBefore(history.daily, from);
      series =
        period.key === '1W'
          ? history.week
          : history.daily.filter((p) => p.t >= (start?.t ?? from));
    }
    if (!start || !series?.length) {
      out[period.key] = null;
      continue;
    }
    const closes = series.map((p) => p.c);
    out[period.key] = {
      startPrice: start.c,
      startTime: start.t,
      change: price - start.c,
      changePct: (price / start.c - 1) * 100,
      high: Math.max(...closes, price),
      low: Math.min(...closes, price),
      series,
    };
  }
  return out;
}
