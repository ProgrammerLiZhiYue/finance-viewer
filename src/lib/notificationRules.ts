import type { TFunction } from 'i18next';
import type { ExchangeRateData, KLineItem, NotificationCondition, NotificationPeriod, NotificationRule, NotificationRuleStatus } from '../types';

export const NOTIFICATION_PERIODS: NotificationPeriod[] = ['day', 'week', 'month', 'history'];

export function isNotificationCondition(value: unknown): value is NotificationCondition {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Record<string, unknown>;
  const price = (rule.comparison === 'below' || rule.comparison === 'above')
    && typeof rule.value === 'number' && Number.isFinite(rule.value) && rule.value > 0;
  if (rule.type === 'price') return rule.period === null && price;
  return rule.type === 'low' && NOTIFICATION_PERIODS.includes(rule.period as NotificationPeriod)
    && (price || (rule.comparison === 'none' && rule.value === null));
}

export function notificationRuleSummary(rule: NotificationCondition, t: TFunction): string {
  const price = rule.comparison === 'none' ? '' : t(`settings.notifications.${rule.comparison}`, { value: rule.value });
  if (rule.type === 'price') return t('settings.notifications.priceSummary', { price });
  const period = t(`settings.notifications.periods.${rule.period}`);
  return t(price ? 'settings.notifications.combinedSummary' : 'settings.notifications.lowSummary', { period, price });
}

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function notificationRuleFingerprint(rule: NotificationRule, now: Date): string {
  return JSON.stringify([rule.pair, rule.type, rule.period, rule.comparison, rule.value,
    rule.type === 'low' && rule.period === 'day' ? localDate(now) : null]);
}

export function evaluateNotificationRule(
  rule: NotificationCondition,
  rate: ExchangeRateData | undefined,
  history: KLineItem[] | undefined,
  now = new Date(),
): NotificationRuleStatus {
  if (!rate || !Number.isFinite(rate.currentRate) || rate.currentRate <= 0) return { state: 'unavailable' };
  const priceMatches = rule.comparison === 'none' || (rule.comparison === 'below'
    ? rate.currentRate < rule.value : rate.currentRate > rule.value);
  if (rule.type === 'price') return { state: priceMatches ? 'matched' : 'unmatched' };
  const today = localDate(now);
  const cutoff = new Date(now);
  const days = { day: 1, week: 7, month: 30, history: 1825 }[rule.period];
  cutoff.setDate(cutoff.getDate() - days + 1);
  const start = localDate(cutoff);
  const points = rule.period === 'day'
    ? rate.kline.flatMap(point => typeof point.timestamp === 'number' && Number.isFinite(point.timestamp)
      && point.timestamp <= now.getTime() ? [{ date: localDate(new Date(point.timestamp)), low: point.low }] : [])
    : (history || []);
  const valid = points.filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date)
    && localDate(new Date(`${point.date}T12:00:00`)) === point.date
    && point.date >= start && point.date <= today && Number.isFinite(point.low) && point.low > 0);
  if (!valid.length) return { state: 'unavailable' };
  const dates = valid.map(point => point.date).sort();
  const low = valid.reduce((minimum, point) => Math.min(minimum, point.low), Infinity);
  return {
    state: priceMatches && rate.currentRate <= low ? 'matched' : 'unmatched',
    low, from: dates[0], to: dates[dates.length - 1],
  };
}
