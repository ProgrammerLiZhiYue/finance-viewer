import { describe, expect, it } from 'vitest';
import { evaluateNotificationRule, isNotificationCondition, localDate, notificationRuleFingerprint } from '../../src/lib/notificationRules';
import type { KLineItem, NotificationCondition, NotificationPeriod, NotificationRule } from '../../src/types';
import { makeRate } from '../helpers';

const now = new Date(2026, 2, 1, 12);
const lowRule = (period: NotificationPeriod): NotificationCondition => ({ type: 'low', period, comparison: 'none', value: null });
const point = (date: string, low: number, timestamp?: number): KLineItem => ({ date, low, timestamp, open: low, close: low, high: low });

describe('notification conditions', () => {
  it.each([0, -1, NaN, Infinity, -Infinity, '7', null, undefined])('rejects invalid price %s', value => {
    expect(isNotificationCondition({ type: 'price', period: null, comparison: 'below', value })).toBe(false);
  });

  it.each(['day', 'week', 'month', 'history'] as const)('accepts range %s with optional valid price', period => {
    expect(isNotificationCondition(lowRule(period))).toBe(true);
    expect(isNotificationCondition({ ...lowRule(period), comparison: 'above', value: 0.000001 })).toBe(true);
  });

  it.each([null, {}, { type: 'low', period: 'year', comparison: 'none', value: null },
    { type: 'price', period: null, comparison: 'none', value: null },
    { type: 'price', period: 'day', comparison: 'below', value: 7 }])('rejects invalid shape %j', value => {
    expect(isNotificationCondition(value)).toBe(false);
  });

  it.each(['below', 'above'] as const)('uses strict %s comparison', comparison => {
    const rule: NotificationCondition = { type: 'price', period: null, comparison, value: 7 };
    expect(evaluateNotificationRule(rule, makeRate({ currentRate: 7 }), undefined, now).state).toBe('unmatched');
    expect(evaluateNotificationRule(rule, makeRate({ currentRate: comparison === 'below' ? 6.99 : 7.01 }), undefined, now).state).toBe('matched');
  });

  it('uses inclusive lows and AND for an additional price constraint', () => {
    const history = [point('2026-03-01', 7)];
    expect(evaluateNotificationRule(lowRule('week'), makeRate({ currentRate: 7 }), history, now).state).toBe('matched');
    expect(evaluateNotificationRule({ ...lowRule('week'), comparison: 'below', value: 7 }, makeRate({ currentRate: 7 }), history, now).state).toBe('unmatched');
    expect(evaluateNotificationRule({ ...lowRule('week'), comparison: 'above', value: 6 }, makeRate({ currentRate: 7 }), history, now).state).toBe('matched');
    expect(evaluateNotificationRule({ ...lowRule('week'), comparison: 'below', value: 10 }, makeRate({ currentRate: 8 }), history, now).state).toBe('unmatched');
  });

  it.each([['week', 7], ['month', 30], ['history', 1825]] as const)('uses inclusive %s window without future/older points', (period, days) => {
    const start = new Date(now); start.setDate(start.getDate() - days + 1);
    const before = new Date(start); before.setDate(before.getDate() - 1);
    const result = evaluateNotificationRule(lowRule(period), makeRate({ currentRate: 7 }), [
      point(localDate(before), 1), point(localDate(start), 7), point('2026-03-01', 8), point('2026-03-02', 1),
    ], now);
    expect(result).toEqual({ state: 'matched', low: 7, from: localDate(start), to: '2026-03-01' });
  });

  it('uses only valid timestamps from the local current day, not stale quote lows', () => {
    const rate = makeRate({ currentRate: 7, low: 1, kline: [
      point('02-28 23:59', 1, new Date(2026, 1, 28, 23, 59).getTime()),
      point('03-01 00:00', 7, new Date(2026, 2, 1).getTime()),
      point('03-01 13:00', 1, new Date(2026, 2, 1, 13).getTime()),
      point('03-01 01:00', 1), point('bad', 1, NaN),
    ] });
    expect(evaluateNotificationRule(lowRule('day'), rate, undefined, now)).toEqual({ state: 'matched', low: 7, from: '2026-03-01', to: '2026-03-01' });
    rate.kline = rate.kline.slice(0, 1);
    expect(evaluateNotificationRule(lowRule('day'), rate, undefined, now).state).toBe('unavailable');
  });

  it('excludes impossible dates and nonpositive or nonfinite lows', () => {
    const history = [point('2026-02-31', 1), ...[0, -1, NaN, Infinity].map(low => point('2026-02-28', low)), point('2026-02-27', 7)];
    expect(evaluateNotificationRule(lowRule('month'), makeRate({ currentRate: 7 }), history, now)).toEqual({ state: 'matched', low: 7, from: '2026-02-27', to: '2026-02-27' });
  });

  it.each([undefined, [], [point('bad', 1)]])('does not invent coverage for missing data %j', history => {
    expect(evaluateNotificationRule(lowRule('history'), makeRate(), history, now)).toEqual({ state: 'unavailable' });
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid current rate %s', currentRate => {
    expect(evaluateNotificationRule(lowRule('week'), makeRate({ currentRate }), [point('2026-03-01', 7)], now).state).toBe('unavailable');
  });

  it('changes a fingerprint only for definition changes or a new day window', () => {
    const day: NotificationRule = { ...lowRule('day'), id: 'a', pair: 'USDCNY', enabled: true };
    const tomorrow = new Date(2026, 2, 2);
    expect(notificationRuleFingerprint(day, now)).not.toBe(notificationRuleFingerprint(day, tomorrow));
    expect(notificationRuleFingerprint(day, now)).toBe(notificationRuleFingerprint({ ...day, enabled: false }, now));
    const week: NotificationRule = { ...day, type: 'low', period: 'week' };
    expect(notificationRuleFingerprint(week, now)).toBe(notificationRuleFingerprint(week, tomorrow));
  });
});
