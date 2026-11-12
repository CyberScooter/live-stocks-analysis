export function money(value, currency) {
  if (value == null || Number.isNaN(value)) return '—';
  // London listings are quoted in pence (Yahoo: "GBp", others: "GBX")
  if (currency === 'GBX' || currency === 'GBp') return `${num(value)}p`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${num(value)} ${currency || ''}`.trim();
  }
}

export function num(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function pct(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  // Decades-long returns get huge: +276,903% reads better than +276903.12%
  if (Math.abs(value) >= 1000) return `${sign}${Math.round(value).toLocaleString()}%`;
  return `${sign}${Number(value).toFixed(digits)}%`;
}

export function signed(value, currency) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${money(value, currency)}`;
}

export const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

export function timeAgo(unixSeconds) {
  const s = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function compact(value) {
  if (value == null) return '—';
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}
