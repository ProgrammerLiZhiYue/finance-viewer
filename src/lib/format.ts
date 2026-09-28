export function formatNum(v: number): string {
  return v < 1 ? v.toFixed(5) : v.toFixed(4);
}

export function formatRate(v?: number | null): string {
  return v !== undefined && v !== null ? formatNum(v) : '--';
}

export function formatChange(v?: number | null): string {
  if (v === undefined || v === null) return '--';
  const sign = v >= 0 ? '+' : '';
  return sign + formatNum(v);
}

export function formatChangePercent(v?: number | null): string {
  if (v === undefined || v === null) return '--';
  const sign = v >= 0 ? '+' : '';
  return sign + v.toFixed(2) + '%';
}

export function formatVolume(v: number): string {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '万';
  return v.toString();
}

/** 成交额传入原始金额（元/港元），按万、亿、万亿换算 */
export function formatTurnover(v: number): string {
  if (isNaN(v) || v <= 0) return '--';
  if (v >= 1e12) return (v / 1e12).toFixed(2) + '万亿';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return v.toFixed(0);
}

export function nowTimeString(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}
