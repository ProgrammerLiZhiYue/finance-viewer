import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { SettingsProvider, useSettings } from '../../src/context/SettingsContext';
import type { SettingsState } from '../../src/context/SettingsContext';
import { useRateNotifications } from '../../src/hooks/useRateNotifications';
import type { ExchangeRateData, NotificationRule } from '../../src/types';
import i18n from '../../src/i18n';
import { installElectronAPI, makeRate } from '../helpers';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const price: NotificationRule = { id: 'price', pair: 'USDCNY', enabled: true, type: 'price', period: null, comparison: 'below', value: 7 };
const day: NotificationRule = { id: 'day', pair: 'USDCNY', enabled: true, type: 'low', period: 'day', comparison: 'none', value: null };
const history: NotificationRule = { ...day, id: 'history', period: 'history' };
const rate = (currentRate = 6): ExchangeRateData => makeRate({ currentRate, kline: [{
  date: '2026-09-25', timestamp: Date.now(), open: 6, close: 6, high: 8, low: 6,
}] });

function monitor(settings: Partial<SettingsState> = {}) {
  localStorage.setItem('finance-viewer-settings', JSON.stringify({
    notificationPairs: ['USDCNY'], notificationRules: [price], refreshInterval: 5, locale: 'zh', ...settings,
  }));
  return renderHook(() => ({ statuses: useRateNotifications(), ...useSettings() }), { wrapper: SettingsProvider });
}

async function flush(): Promise<void> { await act(async () => {}); }
async function tick(): Promise<void> { await act(() => vi.advanceTimersByTimeAsync(5000)); }
let api: ReturnType<typeof installElectronAPI>;

beforeEach(async () => {
  await i18n.changeLanguage('zh');
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 25, 12));
  api = installElectronAPI();
  api.getExchangeRate.mockImplementation(() => Promise.resolve(rate()));
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useRateNotifications', () => {
  it('checks selected rules across currencies, independently of displayed pairs', async () => {
    monitor({ notificationPairs: ['USDCNY', 'JPYCNY'], enabledPairs: ['EURCNY'], notificationRules: [price, { ...price, id: 'jpy', pair: 'JPYCNY' }] });
    await flush();
    expect(api.getExchangeRate.mock.calls).toEqual([['USDCNY', 'fenShi'], ['JPYCNY', 'fenShi']]);
    expect(api.getRateSummary).not.toHaveBeenCalled();
    expect(api.sendNotification.mock.calls.map(([message]) => message.pairCode).sort()).toEqual(['JPYCNY', 'USDCNY']);
  });

  it.each([{ notificationPairs: [] }, { notification: false }, { notificationRules: [] },
    { notificationRules: [{ ...price, enabled: false }] }] satisfies Partial<SettingsState>[])('does not request inactive subscriptions %j', async settings => {
    monitor(settings); await tick();
    expect(api.getExchangeRate).not.toHaveBeenCalled();
    expect(api.sendNotification).not.toHaveBeenCalled();
  });

  it('merges all current reasons, uses history only when needed and never suppresses a newly added rule', async () => {
    const { result } = monitor({ notificationRules: [price, day, history] }); await flush();
    expect(api.getExchangeRate.mock.calls).toEqual([['USDCNY', 'fenShi'], ['USDCNY', 'dailyK']]);
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
    expect(api.sendNotification.mock.calls[0][0]).toMatchObject({ level: 'urgent', pairCode: 'USDCNY' });
    expect(api.sendNotification.mock.calls[0][0].body).toContain('当天最低');
    expect(api.sendNotification.mock.calls[0][0].body).toContain('历史最低');
    expect(api.sendNotification.mock.calls[0][0].body).toContain('低于 7');
    await tick(); expect(api.sendNotification).toHaveBeenCalledTimes(1);
    act(() => result.current.dispatch({ type: 'saveNotificationRule', rule: { ...price, id: 'new' } }));
    await flush(); expect(api.sendNotification).toHaveBeenCalledTimes(2);
    await tick(); expect(api.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('stores prototype-like persisted IDs as ordinary rule keys', async () => {
    const { result } = monitor({ notificationRules: [{ ...price, id: '__proto__' }, { ...price, id: 'constructor' }] });
    await flush();
    expect(Object.hasOwn(result.current.statuses, '__proto__')).toBe(true);
    expect(result.current.statuses.__proto__).toEqual({ state: 'matched' });
    await tick(); expect(api.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('day-only rules trigger without requesting history', async () => {
    monitor({ notificationRules: [day] }); await flush();
    expect(api.getExchangeRate.mock.calls).toEqual([['USDCNY', 'fenShi']]);
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('a history failure leaves price and day rules independent and reports unavailable coverage', async () => {
    api.getExchangeRate.mockImplementation((_pair, period) => period === 'dailyK' ? Promise.reject(new Error('offline')) : Promise.resolve(rate()));
    const { result } = monitor({ notificationRules: [price, day, history] }); await flush();
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
    expect(result.current.statuses.history).toEqual({ state: 'unavailable' });
    expect(result.current.statuses.day.state).toBe('matched');
    expect(api.sendNotification.mock.calls[0][0].body).not.toContain('历史最低');
  });

  it('does not rearm on missing data, but rearms after confirmed recovery', async () => {
    const { result } = monitor(); await flush();
    api.getExchangeRate.mockRejectedValueOnce(new Error('offline')); await tick();
    expect(result.current.statuses.price.state).toBe('unavailable');
    await tick(); expect(api.sendNotification).toHaveBeenCalledTimes(1);
    api.getExchangeRate.mockResolvedValueOnce(rate(7)); await tick();
    expect(result.current.statuses.price.state).toBe('unmatched');
    await tick(); expect(api.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('keeps latches across pause, unselect, theme, locale and interval changes', async () => {
    const { result } = monitor(); await flush();
    act(() => result.current.dispatch({ type: 'setTheme', theme: 'dark' }));
    act(() => result.current.dispatch({ type: 'setLocale', locale: 'en' }));
    await act(async () => { await i18n.changeLanguage('en'); });
    expect(api.getExchangeRate).toHaveBeenCalledTimes(1);
    for (const action of [
      { type: 'setNotification', value: false }, { type: 'setNotification', value: true },
      { type: 'toggleNotificationPair', pair: 'USDCNY' }, { type: 'toggleNotificationPair', pair: 'USDCNY' },
      { type: 'toggleNotificationRule', id: 'price' }, { type: 'toggleNotificationRule', id: 'price' },
      { type: 'setRefreshInterval', value: 15 },
    ] as const) { act(() => result.current.dispatch(action)); await flush(); }
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
    api.getExchangeRate.mockResolvedValueOnce(rate(8));
    await act(() => vi.advanceTimersByTimeAsync(15000));
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(api.sendNotification.mock.calls[1][0].title).toContain('Subscription matched');
  });

  it('editing resets only that rule, including edits while paused', async () => {
    const { result } = monitor({ notificationRules: [price, day] }); await flush();
    act(() => result.current.dispatch({ type: 'saveNotificationRule', rule: { ...price, value: 5 } })); await flush();
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
    act(() => result.current.dispatch({ type: 'setNotification', value: false }));
    act(() => result.current.dispatch({ type: 'saveNotificationRule', rule: { ...price, value: 8 } }));
    act(() => result.current.dispatch({ type: 'setNotification', value: true })); await flush();
    expect(api.sendNotification).toHaveBeenCalledTimes(2);
    expect(api.sendNotification.mock.calls[1][0].body).toContain('当天最低');
    act(() => result.current.dispatch({ type: 'deleteNotificationRule', id: 'price' })); await flush();
    expect(result.current.statuses.price).toBeUndefined();
    expect(api.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('new local day resets only day rules and restart reevaluates saved rules', async () => {
    const first = monitor({ notificationRules: [price, day] }); await flush();
    vi.setSystemTime(new Date(2026, 8, 26, 0, 1)); await tick();
    expect(api.sendNotification).toHaveBeenCalledTimes(2);
    first.unmount(); monitor({ notificationRules: [price, day] }); await flush();
    expect(api.sendNotification).toHaveBeenCalledTimes(3);
  });

  it.each(['false', 'rejection'] as const)('retries a failed notification (%s)', async failure => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    if (failure === 'false') api.sendNotification.mockResolvedValueOnce(false);
    else api.sendNotification.mockRejectedValueOnce(new Error('unsupported'));
    monitor(); await flush(); await tick(); await tick();
    expect(api.sendNotification).toHaveBeenCalledTimes(2);
  });

  it.each(['unsubscribe', 'disable', 'unmount', 'delete'] as const)('ignores late results after %s', async action => {
    const pending = deferred<ExchangeRateData>(); api.getExchangeRate.mockReturnValue(pending.promise);
    const { result, unmount } = monitor();
    if (action === 'unsubscribe') act(() => result.current.dispatch({ type: 'toggleNotificationPair', pair: 'USDCNY' }));
    if (action === 'disable') act(() => result.current.dispatch({ type: 'setNotification', value: false }));
    if (action === 'delete') act(() => result.current.dispatch({ type: 'deleteNotificationRule', id: 'price' }));
    if (action === 'unmount') unmount();
    await act(async () => pending.resolve(rate())); await tick();
    expect(api.getExchangeRate).toHaveBeenCalledTimes(1);
    expect(api.sendNotification).not.toHaveBeenCalled();
  });

  it('serialises requests over rapid changes and discards old-definition results', async () => {
    const pending = deferred<ExchangeRateData>(); api.getExchangeRate.mockReturnValueOnce(pending.promise);
    const { result } = monitor();
    act(() => result.current.dispatch({ type: 'saveNotificationRule', rule: { ...price, value: 5 } }));
    await tick(); expect(api.getExchangeRate).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(rate()));
    expect(api.getExchangeRate).toHaveBeenCalledTimes(2);
    expect(api.sendNotification).not.toHaveBeenCalled();
  });

  it('keeps same-currency requests serial until all history settles after quote failure', async () => {
    const pending = deferred<ExchangeRateData>();
    api.getExchangeRate.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(pending.promise);
    monitor({ notificationRules: [history] }); await tick(); await tick();
    expect(api.getExchangeRate).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(rate()));
    expect(api.sendNotification).not.toHaveBeenCalled();
    await tick(); expect(api.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('a stalled currency does not block other currencies', async () => {
    const pending = deferred<ExchangeRateData>();
    api.getExchangeRate.mockImplementation(pair => pair === 'USDCNY' ? pending.promise : Promise.resolve(rate()));
    monitor({ notificationPairs: ['USDCNY', 'JPYCNY'], notificationRules: [price, { ...price, id: 'jpy', pair: 'JPYCNY' }] });
    await flush();
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
    expect(api.sendNotification.mock.calls[0][0].pairCode).toBe('JPYCNY');
    await act(async () => pending.resolve(rate()));
  });

  it('does not latch an edited definition from an older in-flight submission', async () => {
    const pending = deferred<boolean>(); api.sendNotification.mockReturnValueOnce(pending.promise);
    const { result } = monitor(); await flush();
    act(() => result.current.dispatch({ type: 'saveNotificationRule', rule: { ...price, value: 8 } }));
    await tick(); expect(api.sendNotification).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(true));
    expect(api.sendNotification).toHaveBeenCalledTimes(2);
    expect(api.sendNotification.mock.calls[1][0].body).toContain('低于 8');
    await tick(); expect(api.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('records a successful in-flight submission across pause without resending', async () => {
    const pending = deferred<boolean>(); api.sendNotification.mockReturnValueOnce(pending.promise);
    const { result } = monitor(); await flush();
    act(() => result.current.dispatch({ type: 'setNotification', value: false }));
    act(() => result.current.dispatch({ type: 'setNotification', value: true }));
    await act(async () => pending.resolve(true)); await tick();
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
  });
});
