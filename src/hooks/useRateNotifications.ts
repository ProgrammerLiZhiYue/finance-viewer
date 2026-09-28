import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import type { CurrencyPair, NotificationRule, NotificationRuleStatus } from '../types';
import { evaluateNotificationRule, notificationRuleFingerprint, notificationRuleSummary } from '../lib/notificationRules';
import i18n from '../i18n';

interface RuleMemory {
  fingerprint: string;
  notified: boolean;
}

export function useRateNotifications(): Record<string, NotificationRuleStatus> {
  const { state } = useSettings();
  const [statuses, setStatuses] = useState<Record<string, NotificationRuleStatus>>({});
  const memoryRef = useRef(new Map<string, RuleMemory>());
  const inFlightRef = useRef(new Map<CurrencyPair, Promise<void>>());

  useEffect(() => {
    let cancelled = false;
    const queued = new Set<CurrencyPair>();
    const memory = memoryRef.current;
    const ids = new Set(state.notificationRules.map(rule => rule.id));
    for (const id of memory.keys()) if (!ids.has(id)) memory.delete(id);

    function remember(rule: NotificationRule, now: Date): RuleMemory {
      const fingerprint = notificationRuleFingerprint(rule, now);
      if (memory.get(rule.id)?.fingerprint !== fingerprint) {
        memory.set(rule.id, { fingerprint, notified: false });
      }
      return memory.get(rule.id)!;
    }

    const changed = new Set<string>();
    for (const rule of state.notificationRules) {
      const previous = memory.get(rule.id);
      if (remember(rule, new Date()) !== previous) changed.add(rule.id);
    }
    setStatuses(previous => Object.fromEntries(Object.entries(previous)
      .filter(([id]) => ids.has(id) && !changed.has(id))));
    if (!state.notification) return;
    const rules = state.notificationRules.filter(rule => rule.enabled && state.notificationPairs.includes(rule.pair));
    const pairs = [...new Set(rules.map(rule => rule.pair))];

    function checkPair(pair: CurrencyPair): void {
      if (queued.has(pair)) return;
      queued.add(pair);
      const previous = inFlightRef.current.get(pair);
      const check = async (): Promise<void> => {
        // Serialise across effect restarts, including an already submitted notification.
        if (previous) await previous;
        if (cancelled) return;
        const pairRules = rules.filter(rule => rule.pair === pair);
        const needsHistory = pairRules.some(rule => rule.type === 'low' && rule.period !== 'day');
        const [rateResult, historyResult] = await Promise.allSettled([
          window.electronAPI.getExchangeRate(pair, 'fenShi'),
          needsHistory ? window.electronAPI.getExchangeRate(pair, 'dailyK') : Promise.resolve(undefined),
        ]);
        if (cancelled) return;
        const rate = rateResult.status === 'fulfilled' ? rateResult.value : undefined;
        const history = historyResult.status === 'fulfilled' ? historyResult.value?.kline : undefined;
        const now = new Date();
        const results: [string, NotificationRuleStatus][] = [];
        const matched: { rule: NotificationRule; record: RuleMemory }[] = [];
        for (const rule of pairRules) {
          const record = remember(rule, now);
          const result = evaluateNotificationRule(rule, rate, history, now);
          results.push([rule.id, result]);
          if (result.state === 'unmatched') record.notified = false;
          if (result.state === 'matched') matched.push({ rule, record });
        }
        setStatuses(previous => Object.fromEntries([...Object.entries(previous), ...results]));
        if (!rate || !matched.some(item => !item.record.notified)) return;
        const t = i18n.t.bind(i18n);
        const submitted = await window.electronAPI.sendNotification({
          pairCode: pair,
          level: matched.some(item => item.rule.type === 'low' && item.rule.period === 'history') ? 'urgent' : 'normal',
          title: t('settings.notifications.notificationTitle', { pair: t(`overview.pair.${pair}`) }),
          body: [t('settings.notifications.notificationRate', { rate: rate.currentRate }),
            ...matched.map(item => notificationRuleSummary(item.rule, t))].join('\n'),
        });
        // A pause cannot undo a submission; only record success for the same definition.
        if (submitted) for (const { rule, record } of matched) {
          if (memory.get(rule.id) === record) record.notified = true;
        }
      };
      const task = check()
        .catch(error => console.error(`Failed to check rate notifications for ${pair}:`, error))
        .finally(() => {
          queued.delete(pair);
          if (inFlightRef.current.get(pair) === task) inFlightRef.current.delete(pair);
        });
      inFlightRef.current.set(pair, task);
    }

    const checkAll = (): void => pairs.forEach(checkPair);
    checkAll();
    const timer = setInterval(checkAll, state.refreshInterval * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state.notification, state.notificationPairs, state.notificationRules, state.refreshInterval]);

  return statuses;
}
