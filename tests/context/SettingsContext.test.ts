import { beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, settingsReducer } from '../../src/context/SettingsContext';
import type { SettingsState } from '../../src/context/SettingsContext';
import { getSystemLocale } from '../../src/i18n';
import type { NotificationRule } from '../../src/types';

function rule(id: string, overrides: Partial<NotificationRule> = {}): NotificationRule {
  return { id, pair: 'USDCNY', enabled: true, type: 'low', period: 'day', comparison: 'none', value: null, ...overrides } as NotificationRule;
}

function baseState(overrides: Partial<SettingsState> = {}): SettingsState {
  return {
    refreshInterval: 30,
    enabledPairs: ['USDCNY', 'JPYCNY', 'EURCNY'],
    notificationPairs: [],
    notificationRules: [],
    enabledStocks: ['00700', '09988'],
    theme: 'system',
    locale: 'zh',
    notification: true,
    minimizeToTray: true,
    ...overrides,
  };
}

describe('settingsReducer', () => {
  it('applies simple setters', () => {
    let s = settingsReducer(baseState(), { type: 'setTheme', theme: 'dark' });
    expect(s.theme).toBe('dark');
    s = settingsReducer(s, { type: 'setRefreshInterval', value: 60 });
    expect(s.refreshInterval).toBe(60);
    s = settingsReducer(s, { type: 'setNotification', value: false });
    expect(s.notification).toBe(false);
    s = settingsReducer(s, { type: 'setMinimizeToTray', value: false });
    expect(s.minimizeToTray).toBe(false);
    s = settingsReducer(s, { type: 'setLocale', locale: 'ja' });
    expect(s.locale).toBe('ja');
  });

  it('togglePair adds a disabled pair', () => {
    const s = settingsReducer(baseState(), { type: 'togglePair', pair: 'HKDCNY' });
    expect(s.enabledPairs).toContain('HKDCNY');
  });

  it('togglePair removes an enabled pair', () => {
    const s = settingsReducer(baseState(), { type: 'togglePair', pair: 'JPYCNY' });
    expect(s.enabledPairs).not.toContain('JPYCNY');
  });

  it('togglePair keeps the last remaining pair', () => {
    const state = baseState({ enabledPairs: ['USDCNY'] });
    expect(settingsReducer(state, { type: 'togglePair', pair: 'USDCNY' })).toBe(state);
  });

  it('toggleNotificationPair adds multiple subscriptions without changing displayed pairs', () => {
    const state = baseState();
    const first = settingsReducer(state, { type: 'toggleNotificationPair', pair: 'USDCNY' });
    expect(first.notificationPairs).toEqual(['USDCNY']);
    expect(first.enabledPairs).toBe(state.enabledPairs);

    const second = settingsReducer(first, { type: 'toggleNotificationPair', pair: 'CADCNY' });
    expect(second.notificationPairs).toEqual(['USDCNY', 'CADCNY']);
    expect(second.enabledPairs).toBe(state.enabledPairs);
    expect(second.enabledPairs).not.toContain('CADCNY');
    expect(state.notificationPairs).toEqual([]);
    expect(first.notificationPairs).toEqual(['USDCNY']);
  });

  it('toggleNotificationPair removes subscriptions including the final one', () => {
    const state = baseState({ notificationPairs: ['USDCNY', 'CADCNY'] });
    const first = settingsReducer(state, { type: 'toggleNotificationPair', pair: 'USDCNY' });
    expect(first.notificationPairs).toEqual(['CADCNY']);
    expect(first.enabledPairs).toBe(state.enabledPairs);

    const empty = settingsReducer(first, { type: 'toggleNotificationPair', pair: 'CADCNY' });
    expect(empty.notificationPairs).toEqual([]);
    expect(empty.enabledPairs).toBe(state.enabledPairs);
    expect(state.notificationPairs).toEqual(['USDCNY', 'CADCNY']);
    expect(first.notificationPairs).toEqual(['CADCNY']);
  });

  it('togglePair adds and removes displayed pairs without changing subscriptions', () => {
    const state = baseState({ enabledPairs: ['USDCNY', 'JPYCNY'], notificationPairs: ['USDCNY', 'CADCNY'] });
    const added = settingsReducer(state, { type: 'togglePair', pair: 'HKDCNY' });
    expect(added.enabledPairs).toEqual(['USDCNY', 'JPYCNY', 'HKDCNY']);
    expect(added.notificationPairs).toBe(state.notificationPairs);

    const removed = settingsReducer(added, { type: 'togglePair', pair: 'USDCNY' });
    expect(removed.enabledPairs).toEqual(['JPYCNY', 'HKDCNY']);
    expect(removed.notificationPairs).toBe(state.notificationPairs);
  });

  it('pausing notifications preserves subscriptions and permits editing before resuming', () => {
    const state = baseState({ notificationPairs: ['USDCNY', 'JPYCNY'] });
    const paused = settingsReducer(state, { type: 'setNotification', value: false });
    expect(paused.notification).toBe(false);
    expect(paused.notificationPairs).toBe(state.notificationPairs);

    const added = settingsReducer(paused, { type: 'toggleNotificationPair', pair: 'CADCNY' });
    expect(added.notificationPairs).toEqual(['USDCNY', 'JPYCNY', 'CADCNY']);
    expect(added.notification).toBe(false);
    const removed = settingsReducer(added, { type: 'toggleNotificationPair', pair: 'USDCNY' });
    expect(removed.notificationPairs).toEqual(['JPYCNY', 'CADCNY']);
    expect(removed.notification).toBe(false);
    expect(removed.enabledPairs).toBe(state.enabledPairs);

    const resumed = settingsReducer(removed, { type: 'setNotification', value: true });
    expect(resumed.notification).toBe(true);
    expect(resumed.notificationPairs).toBe(removed.notificationPairs);
  });

  it('appends independent rules for multiple pairs and all four ranges without overwriting', () => {
    const rules = [
      rule('day'),
      rule('week', { period: 'week', comparison: 'below', value: 7.1 }),
      rule('month', { period: 'month', comparison: 'above', value: 6.2 }),
      rule('history', { period: 'history' }),
      rule('price', { type: 'price', period: null, comparison: 'below', value: 6.8 }),
      rule('jpy', { pair: 'JPYCNY', type: 'price', period: null, comparison: 'above', value: 0.00012345 }),
      rule('another-day'),
    ];
    const initial = baseState({ notificationPairs: ['USDCNY', 'JPYCNY'] });
    const result = rules.reduce((state, item) => settingsReducer(state, { type: 'saveNotificationRule', rule: item }), initial);
    expect(result.notificationRules).toEqual(rules);
    expect(result.notificationPairs).toBe(initial.notificationPairs);
    expect(result.enabledPairs).toBe(initial.enabledPairs);
    expect(initial.notificationRules).toEqual([]);
  });

  it('edits only the matching rule by id, preserving position and disabled state', () => {
    const first = rule('first');
    const disabled = rule('disabled', { enabled: false });
    const otherPair = rule('jpy', { pair: 'JPYCNY' });
    const initial = baseState({ notificationRules: [first, disabled, otherPair] });
    const edited = rule('disabled', { enabled: false, type: 'price', period: null, comparison: 'above', value: 6.12345678 });
    const result = settingsReducer(initial, { type: 'saveNotificationRule', rule: edited });
    expect(result.notificationRules).toEqual([first, edited, otherPair]);
    expect(result.notificationRules[0]).toBe(first);
    expect(result.notificationRules[2]).toBe(otherPair);
    expect(initial.notificationRules).toEqual([first, disabled, otherPair]);
  });

  it('independently pauses, resumes and deletes one rule without affecting its siblings', () => {
    const first = rule('first');
    const second = rule('second', { period: 'history' });
    const otherPair = rule('jpy', { pair: 'JPYCNY' });
    const initial = baseState({ notificationPairs: ['USDCNY', 'JPYCNY'], notificationRules: [first, second, otherPair] });
    const paused = settingsReducer(initial, { type: 'toggleNotificationRule', id: 'first' });
    expect(paused.notificationRules).toEqual([{ ...first, enabled: false }, second, otherPair]);
    expect(paused.notificationRules[1]).toBe(second);
    expect(paused.notificationRules[2]).toBe(otherPair);
    expect(first.enabled).toBe(true);
    const resumed = settingsReducer(paused, { type: 'toggleNotificationRule', id: 'first' });
    expect(resumed.notificationRules).toEqual(initial.notificationRules);
    const deleted = settingsReducer(resumed, { type: 'deleteNotificationRule', id: 'second' });
    expect(deleted.notificationRules).toEqual([first, otherPair]);
    expect(deleted.notificationPairs).toBe(initial.notificationPairs);
  });

  it.each(['toggleNotificationRule', 'deleteNotificationRule'] as const)('ignores unknown ids for %s', type => {
    const initial = baseState({ notificationRules: [rule('kept')] });
    expect(settingsReducer(initial, { type, id: 'missing' }).notificationRules).toEqual(initial.notificationRules);
  });

  it('preserves rules through the master switch, removing every pair and selecting again', () => {
    const rules = [rule('usd'), rule('jpy', { pair: 'JPYCNY', enabled: false })];
    const initial = baseState({ notificationPairs: ['USDCNY', 'JPYCNY'], notificationRules: rules });
    let state = settingsReducer(initial, { type: 'setNotification', value: false });
    state = settingsReducer(state, { type: 'toggleNotificationPair', pair: 'USDCNY' });
    state = settingsReducer(state, { type: 'toggleNotificationPair', pair: 'JPYCNY' });
    expect(state.notificationPairs).toEqual([]);
    expect(state.notificationRules).toBe(rules);
    state = settingsReducer(state, { type: 'toggleNotificationPair', pair: 'USDCNY' });
    state = settingsReducer(state, { type: 'toggleNotificationPair', pair: 'JPYCNY' });
    state = settingsReducer(state, { type: 'setNotification', value: true });
    expect(state.notificationPairs).toEqual(initial.notificationPairs);
    expect(state.notificationRules).toBe(rules);
    expect(state.enabledPairs).toBe(initial.enabledPairs);
  });

  it('reorderPair moves an item', () => {
    const s = settingsReducer(baseState(), { type: 'reorderPair', from: 0, to: 2 });
    expect(s.enabledPairs).toEqual(['JPYCNY', 'EURCNY', 'USDCNY']);
  });

  it('reorderPair ignores out-of-bounds indices', () => {
    const state = baseState();
    expect(settingsReducer(state, { type: 'reorderPair', from: -1, to: 2 }).enabledPairs).toBe(state.enabledPairs);
    expect(settingsReducer(state, { type: 'reorderPair', from: 0, to: 9 }).enabledPairs).toBe(state.enabledPairs);
    expect(settingsReducer(state, { type: 'reorderPair', from: 1, to: 1 }).enabledPairs).toBe(state.enabledPairs);
  });

  it('toggleStock adds/removes with last-one guard', () => {
    const added = settingsReducer(baseState(), { type: 'toggleStock', stock: '03690' });
    expect(added.enabledStocks).toContain('03690');
    const removed = settingsReducer(added, { type: 'toggleStock', stock: '03690' });
    expect(removed.enabledStocks).not.toContain('03690');
    const last = baseState({ enabledStocks: ['00700'] });
    expect(settingsReducer(last, { type: 'toggleStock', stock: '00700' })).toBe(last);
  });

  it('reorderStock moves an item', () => {
    const s = settingsReducer(baseState(), { type: 'reorderStock', from: 1, to: 0 });
    expect(s.enabledStocks).toEqual(['09988', '00700']);
  });

  it('reset restores defaults with locale zh', () => {
    const dirty = baseState({
      refreshInterval: 5,
      enabledPairs: ['EURCNY'],
      notificationPairs: ['USDCNY', 'CADCNY'],
      notificationRules: [rule('saved'), rule('paused', { pair: 'CADCNY', enabled: false })],
      enabledStocks: ['03690'],
      theme: 'dark',
      locale: 'en',
      notification: false,
      minimizeToTray: false,
    });
    const s = settingsReducer(dirty, { type: 'reset' });
    expect(s.refreshInterval).toBe(30);
    expect(s.theme).toBe('system');
    expect(s.locale).toBe('zh');
    expect(s.notification).toBe(true);
    expect(s.minimizeToTray).toBe(true);
    expect(s.enabledPairs[0]).toBe('USDCNY');
    expect(s.enabledPairs.length).toBeGreaterThan(1);
    expect(s.notificationPairs).toEqual([]);
    expect(s.notificationRules).toEqual([]);
    expect(dirty.notificationRules).toEqual([rule('saved'), rule('paused', { pair: 'CADCNY', enabled: false })]);
    expect(dirty.notificationPairs).toEqual(['USDCNY', 'CADCNY']);
    expect(s.enabledStocks[0]).toBe('00700');
  });
});

describe('loadSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns defaults when nothing is stored', () => {
    const s = loadSettings();
    expect(s.refreshInterval).toBe(30);
    expect(s.theme).toBe('system');
    expect(s.notification).toBe(true);
    expect(s.minimizeToTray).toBe(true);
    expect(s.enabledPairs).toContain('USDCNY');
    expect(s.notificationPairs).toEqual([]);
    expect(s.notificationRules).toEqual([]);
  });

  it('fills missing fields from defaults', () => {
    localStorage.setItem('finance-viewer-settings', JSON.stringify({ refreshInterval: 60 }));
    const s = loadSettings();
    expect(s.refreshInterval).toBe(60);
    expect(s.theme).toBe('system');
    expect(s.enabledPairs).toContain('USDCNY');
    expect(s.notificationPairs).toEqual([]);
    expect(s.notificationRules).toEqual([]);
  });

  it.each([true, false])('does not subscribe displayed pairs from legacy settings with notification=%s', notification => {
    localStorage.setItem('finance-viewer-settings', JSON.stringify({
      enabledPairs: ['EURCNY', 'CADCNY'],
      notification,
    }));
    const s = loadSettings();
    expect(s.notificationPairs).toEqual([]);
    expect(s.enabledPairs).toEqual(['EURCNY', 'CADCNY']);
    expect(s.notification).toBe(notification);
  });

  it('keeps an explicitly empty subscription list', () => {
    localStorage.setItem('finance-viewer-settings', JSON.stringify({
      enabledPairs: ['USDCNY'],
      notificationPairs: [],
    }));
    const s = loadSettings();
    expect(s.notificationPairs).toEqual([]);
    expect(s.enabledPairs).toEqual(['USDCNY']);
    expect(s.notification).toBe(true);
  });

  it.each([
    { name: 'null', value: null },
    { name: 'string', value: 'USDCNY' },
    { name: 'number', value: 1 },
    { name: 'boolean', value: true },
    { name: 'object', value: { USDCNY: true } },
  ])('ignores a non-array $name subscription value', ({ value }) => {
    localStorage.setItem('finance-viewer-settings', JSON.stringify({
      enabledPairs: ['EURCNY'],
      notificationPairs: value,
    }));
    const s = loadSettings();
    expect(s.notificationPairs).toEqual([]);
    expect(s.enabledPairs).toEqual(['EURCNY']);
  });

  it('filters invalid subscription entries without dropping valid ones', () => {
    localStorage.setItem('finance-viewer-settings', JSON.stringify({
      enabledPairs: ['EURCNY'],
      notificationPairs: ['CADCNY', 'INVALID', null, 42, true, {}, ['USDCNY'], 'usdcny', '', 'USDCNY'],
    }));
    const s = loadSettings();
    expect(s.notificationPairs).toEqual(['CADCNY', 'USDCNY']);
    expect(s.enabledPairs).toEqual(['EURCNY']);
  });

  it('keeps subscriptions empty when every saved entry is invalid', () => {
    localStorage.setItem('finance-viewer-settings', JSON.stringify({
      notificationPairs: ['INVALID', null, 42, false, {}, ['USDCNY']],
    }));
    expect(loadSettings().notificationPairs).toEqual([]);
  });

  it('deduplicates subscriptions while preserving first-seen order', () => {
    localStorage.setItem('finance-viewer-settings', JSON.stringify({
      notificationPairs: ['CADCNY', 'USDCNY', 'CADCNY', 'JPYCNY', 'USDCNY'],
    }));
    expect(loadSettings().notificationPairs).toEqual(['CADCNY', 'USDCNY', 'JPYCNY']);
  });

  it('keeps valid stored values', () => {
    localStorage.setItem('finance-viewer-settings', JSON.stringify({
      theme: 'dark',
      locale: 'ja',
      enabledPairs: ['EURCNY'],
      notificationPairs: ['CADCNY', 'USDCNY', 'JPYCNY'],
      notification: false,
    }));
    const s = loadSettings();
    expect(s.theme).toBe('dark');
    expect(s.locale).toBe('ja');
    expect(s.enabledPairs).toEqual(['EURCNY']);
    expect(s.notificationPairs).toEqual(['CADCNY', 'USDCNY', 'JPYCNY']);
    expect(s.notification).toBe(false);
  });

  it.each([true, false])('keeps legacy selected pairs without inventing rules when notification=%s', notification => {
    localStorage.setItem('finance-viewer-settings', JSON.stringify({ notificationPairs: ['USDCNY', 'JPYCNY'], notification }));
    expect(loadSettings()).toMatchObject({ notificationPairs: ['USDCNY', 'JPYCNY'], notificationRules: [], notification });
  });

  it.each([null, 'rule', 1, false, {}])('ignores non-array notificationRules: %j', notificationRules => {
    localStorage.setItem('finance-viewer-settings', JSON.stringify({ notificationRules }));
    expect(loadSettings().notificationRules).toEqual([]);
  });

  it('restores all valid rule types, small decimals and paused rules even for deselected pairs', () => {
    const rules = [
      rule('day'),
      rule('week', { period: 'week', comparison: 'below', value: 0.000000123456 }),
      rule('month', { period: 'month', comparison: 'above', value: 7.12345678 }),
      rule('history', { period: 'history', enabled: false }),
      rule('price-below', { type: 'price', period: null, comparison: 'below', value: 0.005 }),
      rule('jpy-above', { pair: 'JPYCNY', type: 'price', period: null, comparison: 'above', value: 0.04987654 }),
    ];
    localStorage.setItem('finance-viewer-settings', JSON.stringify({
      notification: false,
      notificationPairs: ['USDCNY'],
      notificationRules: rules,
    }));
    expect(loadSettings()).toMatchObject({ notification: false, notificationPairs: ['USDCNY'], notificationRules: rules });
  });

  it.each([
    { name: 'null entry', entry: null },
    { name: 'string entry', entry: 'rule' },
    { name: 'number entry', entry: 7 },
    { name: 'array entry', entry: [] },
    { name: 'missing id', entry: { ...rule('bad'), id: undefined } },
    { name: 'non-string id', entry: { ...rule('bad'), id: 1 } },
    { name: 'empty id', entry: rule('') },
    { name: 'blank id', entry: rule('   ') },
    { name: 'too long id', entry: rule('x'.repeat(129)) },
    { name: 'invalid pair', entry: { ...rule('bad'), pair: 'INVALID' } },
    { name: 'missing enabled', entry: { ...rule('bad'), enabled: undefined } },
    { name: 'non-boolean enabled', entry: { ...rule('bad'), enabled: 'true' } },
    { name: 'invalid type', entry: { ...rule('bad'), type: 'high' } },
    { name: 'invalid period', entry: { ...rule('bad'), period: 'year' } },
    { name: 'missing period', entry: { ...rule('bad'), period: undefined } },
    { name: 'invalid comparison', entry: { ...rule('bad'), comparison: 'equal' } },
    { name: 'unconstrained low with a value', entry: { ...rule('bad'), value: 7 } },
    { name: 'price with a period', entry: { ...rule('bad'), type: 'price', comparison: 'below', value: 7 } },
    { name: 'price without comparison', entry: { ...rule('bad'), type: 'price', period: null } },
    { name: 'string threshold', entry: { ...rule('bad'), comparison: 'below', value: '6.8' } },
    { name: 'missing threshold', entry: { ...rule('bad'), comparison: 'above', value: undefined } },
  ])('filters $name without discarding adjacent valid rules', ({ entry }) => {
    const first = rule('first');
    const last = rule('last', { pair: 'JPYCNY' });
    localStorage.setItem('finance-viewer-settings', JSON.stringify({ notificationRules: [first, entry, last] }));
    expect(loadSettings().notificationRules).toEqual([first, last]);
  });

  it.each(['low', 'price'] as const)('filters zero, negative and non-finite persisted %s thresholds', type => {
    // JSON turns NaN and infinities into null. Overflow JSON numbers exercise
    // the parsed Infinity path as well as those ordinary persisted nulls.
    const invalid = [0, -0.01, NaN, Infinity, -Infinity].map((value, index) => ({
      ...rule(`invalid-${index}`), type, period: type === 'low' ? 'day' : null, comparison: 'below', value,
    }));
    const overflow = JSON.stringify({ ...invalid[0], id: 'overflow', value: 'overflow' }).replace('"overflow"}', '1e400}');
    const valid = rule('valid');
    localStorage.setItem('finance-viewer-settings', `{"notificationRules":[${invalid.map(item => JSON.stringify(item)).join(',')},${overflow},${JSON.stringify(valid)}]}`);
    expect(loadSettings().notificationRules).toEqual([valid]);
  });

  it('keeps the first valid unique id, permits 128-character ids and does not reserve invalid ids', () => {
    const first = rule('same');
    const duplicate = rule('same', { pair: 'JPYCNY', enabled: false });
    const rescued = rule('rescued');
    const longest = rule('x'.repeat(128));
    localStorage.setItem('finance-viewer-settings', JSON.stringify({ notificationRules: [
      { ...rescued, enabled: 'invalid' }, first, duplicate, rescued, longest,
    ] }));
    expect(loadSettings().notificationRules).toEqual([first, rescued, longest]);
  });

  it('falls back to system locale for invalid locale', () => {
    localStorage.setItem('finance-viewer-settings', JSON.stringify({ locale: 'xx' }));
    expect(loadSettings().locale).toBe(getSystemLocale());
  });

  it('falls back to default pairs/stocks for empty arrays', () => {
    localStorage.setItem('finance-viewer-settings', JSON.stringify({ enabledPairs: [], enabledStocks: [] }));
    const s = loadSettings();
    expect(s.enabledPairs).toContain('USDCNY');
    expect(s.enabledStocks).toContain('00700');
  });

  it('returns defaults on corrupted JSON', () => {
    localStorage.setItem('finance-viewer-settings', '{not json');
    const s = loadSettings();
    expect(s.refreshInterval).toBe(30);
    expect(s.theme).toBe('system');
    expect(s.notificationPairs).toEqual([]);
  });
});
