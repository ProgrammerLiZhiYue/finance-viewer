import { describe, expect, it } from 'vitest';
import { formatChange, formatChangePercent, formatNum, formatRate, formatTurnover, formatVolume, nowTimeString } from '../../src/lib/format';

describe('formatNum', () => {
  it('uses 5 decimals for values below 1', () => {
    expect(formatNum(0.042177)).toBe('0.04218');
  });

  it('uses 4 decimals for values >= 1', () => {
    expect(formatNum(6.72081)).toBe('6.7208');
  });
});

describe('formatRate', () => {
  it('returns -- for null/undefined', () => {
    expect(formatRate(null)).toBe('--');
    expect(formatRate(undefined)).toBe('--');
  });

  it('formats numbers like formatNum', () => {
    expect(formatRate(0.8765)).toBe('0.87650');
  });
});

describe('formatChange', () => {
  it('returns -- for null/undefined', () => {
    expect(formatChange(null)).toBe('--');
  });

  it('prefixes + for non-negative values', () => {
    expect(formatChange(0.00003)).toBe('+0.00003');
  });

  it('keeps - sign for negative values', () => {
    expect(formatChange(-0.0021)).toBe('-0.00210');
  });
});

describe('formatChangePercent', () => {
  it('returns -- for null/undefined', () => {
    expect(formatChangePercent(undefined)).toBe('--');
  });

  it('formats with 2 decimals and % suffix', () => {
    expect(formatChangePercent(1.234)).toBe('+1.23%');
    expect(formatChangePercent(-0.567)).toBe('-0.57%');
  });
});

describe('formatVolume', () => {
  it('uses 亿 for >= 1e8', () => {
    expect(formatVolume(320000000)).toBe('3.20亿');
  });

  it('uses 万 for >= 1e4', () => {
    expect(formatVolume(123456)).toBe('12万');
  });

  it('returns raw value below 1e4', () => {
    expect(formatVolume(999)).toBe('999');
  });
});

describe('formatTurnover', () => {
  it('scales raw amounts to 万/亿/万亿', () => {
    expect(formatTurnover(56970000)).toBe('5697.00万');
    expect(formatTurnover(2687000000)).toBe('26.87亿');
    expect(formatTurnover(2394000000000)).toBe('2.39万亿');
  });

  it('returns -- when the amount is missing', () => {
    expect(formatTurnover(0)).toBe('--');
    expect(formatTurnover(NaN)).toBe('--');
  });
});

describe('nowTimeString', () => {
  it('returns HH:MM:SS', () => {
    expect(nowTimeString()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
