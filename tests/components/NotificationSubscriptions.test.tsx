import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import NotificationSubscriptions from '../../src/components/NotificationSubscriptions';
import type { SettingsState } from '../../src/context/SettingsContext';
import i18n from '../../src/i18n';
import type { CurrencyPair, NotificationCondition, NotificationRule, NotificationRuleStatus } from '../../src/types';
import { renderWithProviders } from '../helpers';

const storageKey = 'finance-viewer-settings';
const daily: NotificationCondition = { type: 'low', period: 'day', comparison: 'none', value: null };
const dailySummary = '触及或跌破当天最低时提醒。';
const patchedDialogMethods: Array<{ name: 'showModal' | 'close'; descriptor?: PropertyDescriptor }> = [];

beforeAll(() => {
  // Only supply missing DOM methods, never replace an existing native dialog.
  for (const name of ['showModal', 'close'] as const) {
    if (typeof HTMLDialogElement.prototype[name] === 'function') continue;
    patchedDialogMethods.push({ name, descriptor: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name) });
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value: function (this: HTMLDialogElement) { this.open = name === 'showModal'; },
    });
  }
});

afterAll(() => {
  for (const { name, descriptor } of patchedDialogMethods) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

beforeEach(async () => {
  await i18n.changeLanguage('zh');
});

function stored(): SettingsState {
  return JSON.parse(localStorage.getItem(storageKey) ?? '{}');
}

function rule(id: string, condition: NotificationCondition = daily, pair: CurrencyPair = 'USDCNY', enabled = true): NotificationRule {
  return { ...condition, id, pair, enabled };
}

function seed(rules: NotificationRule[] = [], pairs: CurrencyPair[] = ['USDCNY'], notification = true) {
  localStorage.setItem(storageKey, JSON.stringify({ notificationRules: rules, notificationPairs: pairs, notification }));
}

function card(pair: CurrencyPair = 'USDCNY') {
  return screen.getByRole('article', { name: i18n.t('settings.notifications.cardLabel', { pair: i18n.t(`overview.pair.${pair}`) }) });
}

function row(summary: string, pair: CurrencyPair = 'USDCNY') {
  return within(card(pair)).getByText(summary).closest('.subscription-rule') as HTMLElement;
}

function addButton(pair: CurrencyPair = 'USDCNY') {
  return within(card(pair)).getByRole('button', { name: i18n.t('settings.notifications.addLabel', { pair: i18n.t(`overview.pair.${pair}`) }) });
}

function openAdd(pair: CurrencyPair = 'USDCNY') {
  fireEvent.click(addButton(pair));
  return screen.getByRole('dialog', { name: i18n.t('settings.notifications.addTitle') });
}

function fillCondition(dialog: HTMLElement, condition: NotificationCondition) {
  const editor = within(dialog);
  fireEvent.change(editor.getByRole('combobox', { name: i18n.t('settings.notifications.conditionType') }), { target: { value: condition.type } });
  if (condition.type === 'low') {
    fireEvent.change(editor.getByRole('combobox', { name: i18n.t('settings.notifications.periodLabel') }), { target: { value: condition.period } });
  }
  fireEvent.change(editor.getByRole('combobox', { name: i18n.t(`settings.notifications.${condition.type === 'low' ? 'constraintLabel' : 'directionLabel'}`) }), { target: { value: condition.comparison } });
  if (condition.comparison !== 'none') {
    fireEvent.change(editor.getByRole('spinbutton', { name: i18n.t('settings.notifications.valueLabel') }), { target: { value: String(condition.value) } });
  }
}

function save(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('settings.notifications.save') }));
  expect(screen.queryByRole('dialog')).toBeNull();
}

function add(condition: NotificationCondition, pair: CurrencyPair = 'USDCNY') {
  const dialog = openAdd(pair);
  fillCondition(dialog, condition);
  save(dialog);
  return stored().notificationRules.at(-1)!;
}

describe('NotificationSubscriptions', () => {
  it('starts without selected pairs, rules or sample alerts', () => {
    renderWithProviders(<NotificationSubscriptions />);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('已选择 0 个币种 · 0 条条件 · 0 条已启用 请选择币种，再添加通知条件。');
    expect(stored()).toMatchObject({ notificationPairs: [], notificationRules: [] });
  });

  it.each([true, false])('restores legacy selected pairs without inventing rules (notification=%s)', notification => {
    localStorage.setItem(storageKey, JSON.stringify({ notificationPairs: ['USDCNY', 'JPYCNY'], notification }));
    renderWithProviders(<NotificationSubscriptions />);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    for (const pair of ['USDCNY', 'JPYCNY'] as const) {
      expect(within(card(pair)).getByText('暂未添加通知条件，不会提醒。可添加多条，每条独立生效。')).toBeTruthy();
      expect(within(card(pair)).queryAllByRole('button', { name: /^编辑/ })).toHaveLength(0);
    }
    expect(screen.getByRole('status').textContent).toContain(notification ? '暂无启用条件，不会提醒。' : '桌面通知已暂停');
    expect(stored().notificationRules).toEqual([]);
  });

  it('opens a labelled native dialog, focuses its type field and explains all four periods', () => {
    seed();
    renderWithProviders(<NotificationSubscriptions />);
    const dialog = openAdd();
    const editor = within(dialog);
    expect(dialog.tagName).toBe('DIALOG');
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('美元/人民币 · 新增一条独立条件，不会覆盖已有条件。');
    expect(document.activeElement).toBe(editor.getByRole('combobox', { name: '提醒类型' }));
    const period = editor.getByRole('combobox', { name: '选择统计范围' }) as HTMLSelectElement;
    expect([...period.options].map(option => [option.value, option.text])).toEqual([
      ['day', '当天最低'], ['week', '最近七天最低'], ['month', '最近一个月最低'], ['history', '历史最低'],
    ]);
    expect(period.value).toBe('day');
    expect(editor.queryByRole('spinbutton')).toBeNull();
    expect((editor.getByRole('button', { name: '保存条件' }) as HTMLButtonElement).disabled).toBe(false);
    for (const [value, hint] of [
      ['day', '按本地日期统计今天已有分时数据的最低价。'],
      ['week', '包含今天和前六个自然日，不是上一自然周。'],
      ['month', '指最近30个自然日，包含今天，不是上一自然月。'],
      ['history', '基于数据源实际覆盖的历史，目前接口最多约五年；数据不足时不判断该条件。'],
    ]) {
      fireEvent.change(period, { target: { value } });
      expect(document.getElementById(period.getAttribute('aria-describedby')!)?.textContent).toBe(hint);
    }
    expect(stored().notificationRules).toEqual([]);
  });

  it('adds all four low ranges and price rules to the same pair alongside another currency without overwriting', () => {
    seed([], ['USDCNY', 'JPYCNY']);
    renderWithProviders(<NotificationSubscriptions />);
    const conditions: NotificationCondition[] = [
      daily,
      { type: 'low', period: 'week', comparison: 'below', value: 7.1 },
      { type: 'low', period: 'month', comparison: 'above', value: 6.1 },
      { type: 'low', period: 'history', comparison: 'none', value: null },
      { type: 'price', period: null, comparison: 'above', value: 7.2 },
    ];
    const expected: NotificationRule[] = [];
    for (const condition of conditions) {
      const added = add(condition);
      expect(added).toEqual({ ...condition, pair: 'USDCNY', enabled: true, id: expect.any(String) });
      expect(added.id).not.toBe('');
      expected.push(added);
      expect(stored().notificationRules).toEqual(expected);
      expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^编辑美元\/人民币的条件：/);
    }
    const yen: NotificationCondition = { type: 'price', period: null, comparison: 'below', value: 0.000123456 };
    expected.push(add(yen, 'JPYCNY'));
    expect(stored().notificationRules).toEqual(expected);
    expect(new Set(expected.map(item => item.id)).size).toBe(6);
    expect(within(card()).getByText('5 条条件 · 5 条已启用')).toBeTruthy();
    expect(within(card('JPYCNY')).getByText('1 条条件 · 1 条已启用')).toBeTruthy();
    expect(within(card()).getByText('触及或跌破最近七天最低，且汇率低于 7.1时提醒。')).toBeTruthy();
    expect(within(card()).getByText('触及或跌破最近一个月最低，且汇率高于 6.1时提醒。')).toBeTruthy();
    expect(within(card('JPYCNY')).getByText('汇率低于 0.000123456 时提醒（严格比较，等于阈值不提醒）。')).toBeTruthy();
    expect(screen.getAllByRole('status')[0].textContent).toBe('已选择 2 个币种 · 6 条条件 · 6 条已启用 各条独立判断，任意一条满足即可提醒。');
  });

  it('adds an identical condition with a new id instead of replacing an existing one', () => {
    const original = rule('original');
    seed([original]);
    renderWithProviders(<NotificationSubscriptions />);
    const added = add(daily);
    expect(added.id).not.toBe(original.id);
    expect(stored().notificationRules).toEqual([original, added]);
    expect(within(card()).getAllByText(dailySummary)).toHaveLength(2);
  });

  it('edits only the chosen rule, preserves its id and paused state, and focuses the updated edit button', () => {
    const original = rule('edit-me', { type: 'low', period: 'week', comparison: 'below', value: 0.04987654 }, 'JPYCNY', false);
    const untouched = rule('untouched');
    seed([untouched, original], ['USDCNY', 'JPYCNY']);
    renderWithProviders(<NotificationSubscriptions />);
    fireEvent.click(within(card('JPYCNY')).getByRole('button', { name: /^编辑/ }));
    const dialog = screen.getByRole('dialog', { name: '编辑通知条件' });
    const editor = within(dialog);
    expect((editor.getByRole('combobox', { name: '选择统计范围' }) as HTMLSelectElement).value).toBe('week');
    expect((editor.getByRole('combobox', { name: '附加价格限制' }) as HTMLSelectElement).value).toBe('below');
    expect((editor.getByRole('spinbutton') as HTMLInputElement).value).toBe('0.04987654');
    const changed: NotificationCondition = { type: 'price', period: null, comparison: 'above', value: 0.000000123456 };
    fillCondition(dialog, changed);
    expect(stored().notificationRules).toEqual([untouched, original]);
    save(dialog);
    expect(stored().notificationRules).toEqual([untouched, { ...original, ...changed }]);
    expect(within(card('JPYCNY')).getByRole('status').textContent).toBe('条件已暂停');
    const button = within(card('JPYCNY')).getByRole('button', { name: /^编辑/ });
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    const reopened = within(screen.getByRole('dialog'));
    expect((reopened.getByRole('combobox', { name: '提醒类型' }) as HTMLSelectElement).value).toBe('price');
    expect(reopened.queryByRole('combobox', { name: '选择统计范围' })).toBeNull();
    expect((reopened.getByRole('spinbutton') as HTMLInputElement).valueAsNumber).toBe(changed.value);
  });

  it.each([
    { editing: false, dismissal: 'Cancel' },
    { editing: false, dismissal: 'Escape' },
    { editing: true, dismissal: 'Cancel' },
    { editing: true, dismissal: 'Escape' },
  ])('discards unsaved changes and restores the opener on $dismissal (editing=$editing)', ({ editing, dismissal }) => {
    const original = rule('original');
    seed([original]);
    renderWithProviders(<NotificationSubscriptions />);
    const opener = editing ? within(card()).getByRole('button', { name: /^编辑/ }) : addButton();
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    fillCondition(dialog, { type: 'price', period: null, comparison: 'above', value: 9.12345 });
    expect(stored().notificationRules).toEqual([original]);
    if (dismissal === 'Cancel') fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    else {
      // Browsers translate Escape on a modal dialog into a cancel event;
      // happy-dom does not implement that keyboard default action.
      const event = new Event('cancel', { cancelable: true });
      fireEvent(dialog, event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((dialog as HTMLDialogElement).open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(stored().notificationRules).toEqual([original]);
    fireEvent.click(opener);
    const reopened = within(screen.getByRole('dialog'));
    expect((reopened.getByRole('combobox', { name: '提醒类型' }) as HTMLSelectElement).value).toBe('low');
    expect((reopened.getByRole('combobox', { name: '选择统计范围' }) as HTMLSelectElement).value).toBe('day');
    expect(reopened.queryByRole('spinbutton')).toBeNull();
  });

  it('pauses, resumes and deletes rules independently, keeping other pairs intact and restoring add focus', () => {
    const first = rule('first');
    const second = rule('second', { type: 'low', period: 'history', comparison: 'none', value: null });
    const yen = rule('yen', daily, 'JPYCNY');
    seed([first, second, yen], ['USDCNY', 'JPYCNY']);
    renderWithProviders(<NotificationSubscriptions />);
    fireEvent.click(within(row(dailySummary)).getByRole('button', { name: /^暂停/ }));
    expect(stored().notificationRules).toEqual([{ ...first, enabled: false }, second, yen]);
    expect(within(row(dailySummary)).getByRole('status').textContent).toBe('条件已暂停');
    expect(within(card()).getByText('2 条条件 · 1 条已启用')).toBeTruthy();
    fireEvent.click(within(row(dailySummary)).getByRole('button', { name: /^启用/ }));
    expect(stored().notificationRules).toEqual([first, second, yen]);
    fireEvent.click(within(row(dailySummary)).getByRole('button', { name: /^删除/ }));
    expect(stored().notificationRules).toEqual([second, yen]);
    expect(document.activeElement).toBe(addButton());
    fireEvent.click(within(card()).getByRole('button', { name: /^删除/ }));
    expect(stored().notificationRules).toEqual([yen]);
    expect(stored().notificationPairs).toEqual(['USDCNY', 'JPYCNY']);
    expect(within(card()).getByText('暂未添加通知条件，不会提醒。可添加多条，每条独立生效。')).toBeTruthy();
    expect(document.activeElement).toBe(addButton());
    expect(within(card('JPYCNY')).getByRole('status').textContent).toBe('已启用 · 等待行情');
  });

  it('persists new and edited rules with disabled states across provider remounts', () => {
    seed([], ['USDCNY', 'JPYCNY']);
    const { unmount } = renderWithProviders(<NotificationSubscriptions />);
    const usd = add(daily);
    const yen = add({ type: 'price', period: null, comparison: 'below', value: 0.04987654 }, 'JPYCNY');
    fireEvent.click(within(card()).getByRole('button', { name: /^编辑/ }));
    const dialog = screen.getByRole('dialog');
    const changed: NotificationCondition = { type: 'low', period: 'history', comparison: 'below', value: 6.75 };
    fillCondition(dialog, changed);
    save(dialog);
    fireEvent.click(within(card('JPYCNY')).getByRole('button', { name: /^暂停/ }));
    const expected = [{ ...usd, ...changed }, { ...yen, enabled: false }];
    expect(stored().notificationRules).toEqual(expected);
    unmount();
    renderWithProviders(<NotificationSubscriptions />);
    expect(stored().notificationRules).toEqual(expected);
    expect(within(card()).getByText('触及或跌破历史最低，且汇率低于 6.75时提醒。')).toBeTruthy();
    expect(within(card('JPYCNY')).getByRole('status').textContent).toBe('条件已暂停');
  });

  it('keeps rules editable while desktop notifications are paused', () => {
    const original = rule('paused-by-master');
    seed([original], ['USDCNY'], false);
    renderWithProviders(<NotificationSubscriptions />);
    const added = add({ type: 'price', period: null, comparison: 'below', value: 6.5 });
    expect(stored()).toMatchObject({ notification: false, notificationRules: [original, added] });
    expect(within(card()).getAllByRole('status').map(node => node.textContent)).toEqual([
      '提醒已暂停 · 桌面通知总开关已关闭', '提醒已暂停 · 桌面通知总开关已关闭',
    ]);
  });

  describe.each(['low', 'price'] as const)('%s threshold validation', type => {
    it.each(['', '0', '-0.01', 'NaN', 'Infinity', '-Infinity', '1e309'])('rejects %j without changing saved rules', value => {
      const original = rule('kept');
      seed([original]);
      renderWithProviders(<NotificationSubscriptions />);
      const dialog = openAdd();
      const editor = within(dialog);
      fireEvent.change(editor.getByRole('combobox', { name: '提醒类型' }), { target: { value: type } });
      if (type === 'low') fireEvent.change(editor.getByRole('combobox', { name: '附加价格限制' }), { target: { value: 'below' } });
      const input = editor.getByRole('spinbutton', { name: '汇率阈值' });
      // Number inputs may sanitize NaN/Infinity to empty; either way saving is blocked.
      fireEvent.change(input, { target: { value } });
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(editor.getByRole('alert').textContent).toBe('请输入大于 0 的有限有效汇率。');
      expect((editor.getByRole('button', { name: '保存条件' }) as HTMLButtonElement).disabled).toBe(true);
      expect(editor.getByRole('status').textContent).toContain('条件尚未完成');
      fireEvent.submit(dialog.querySelector('form')!);
      expect(screen.getByRole('dialog')).toBe(dialog);
      expect(document.activeElement).toBe(input);
      expect(stored().notificationRules).toEqual([original]);
    });

    it.each(['below', 'above'] as const)('accepts a small positive decimal with %s without rounding', comparison => {
      seed();
      renderWithProviders(<NotificationSubscriptions />);
      const condition: NotificationCondition = type === 'low'
        ? { type, period: 'month', comparison, value: 0.000000123456 }
        : { type, period: null, comparison, value: 0.000000123456 };
      const dialog = openAdd();
      fillCondition(dialog, condition);
      const editor = within(dialog);
      expect(editor.getByRole('spinbutton').getAttribute('aria-invalid')).toBe('false');
      expect(editor.getByRole('alert').textContent).toBe('');
      expect((editor.getByRole('button', { name: '保存条件' }) as HTMLButtonElement).disabled).toBe(false);
      expect(editor.getByRole('status').textContent).toContain('本条独立生效，不要求其他条件同时满足。');
      save(dialog);
      expect(stored().notificationRules).toEqual([{ ...condition, id: expect.any(String), pair: 'USDCNY', enabled: true }]);
    });
  });

  it('removes an obsolete threshold when returning to an unconstrained low condition', () => {
    seed();
    renderWithProviders(<NotificationSubscriptions />);
    const dialog = openAdd();
    fillCondition(dialog, { type: 'price', period: null, comparison: 'above', value: 7.2 });
    fillCondition(dialog, { type: 'low', period: 'history', comparison: 'none', value: null });
    expect(within(dialog).queryByRole('spinbutton')).toBeNull();
    save(dialog);
    expect(stored().notificationRules[0]).toMatchObject({ type: 'low', period: 'history', comparison: 'none', value: null });
  });
});

const translations = [
  {
    locale: 'zh',
    summaries: [dailySummary, '触及或跌破最近七天最低，且汇率低于 7.1时提醒。', '触及或跌破最近一个月最低，且汇率高于 6.1时提醒。', '触及或跌破历史最低时提醒。', '汇率高于 7.2 时提醒（严格比较，等于阈值不提醒）。', '汇率低于 6.5 时提醒（严格比较，等于阈值不提醒）。'],
    states: ['已启用 · 等待行情', '已满足条件', '尚未满足条件', '数据不足，暂无法判断', '条件已暂停', '已满足条件'],
    allPaused: '提醒已暂停 · 桌面通知总开关已关闭',
    coverage: '实际数据覆盖：2024-06-03 至 2026-09-24 · 范围最低 6.123456',
  },
  {
    locale: 'en',
    summaries: ['Alert at or below the daily low.', 'Alert at or below the 7-day low, and with the rate below 7.1.', 'Alert at or below the 30-day low, and with the rate above 6.1.', 'Alert at or below the historical low.', 'Alert when rate above 7.2 (strict comparison; equality does not trigger an alert).', 'Alert when rate below 6.5 (strict comparison; equality does not trigger an alert).'],
    states: ['Enabled · Waiting for market data', 'Condition matched', 'Condition not matched', 'Insufficient data to evaluate', 'Condition paused', 'Condition matched'],
    allPaused: 'Alerts paused · Desktop notifications are off',
    coverage: 'Actual data coverage: 2024-06-03 to 2026-09-24 · Period low 6.123456',
  },
  {
    locale: 'ja',
    summaries: ['当日安値以下に達したときに通知します。', '直近7日間の安値以下に達し、かつレートが 7.1 を下回る場合に通知します。', '直近1か月の安値以下に達し、かつレートが 6.1 を上回る場合に通知します。', '過去最安値以下に達したときに通知します。', 'レートが 7.2 を上回る場合に通知（厳密な比較。同値では通知しません）。', 'レートが 6.5 を下回る場合に通知（厳密な比較。同値では通知しません）。'],
    states: ['有効 · 相場データを待機中', '条件を満たしています', '条件を満たしていません', 'データ不足のため判定できません', '条件は一時停止中', '条件を満たしています'],
    allPaused: '通知は停止中 · デスクトップ通知がオフ',
    coverage: '実際のデータ期間：2024-06-03 ～ 2026-09-24 · 期間安値 6.123456',
  },
];

describe('localized notification summaries and evaluation statuses', () => {
  it.each(translations)('renders all summaries, states and actual coverage in $locale', async ({ locale, summaries, states, allPaused, coverage }) => {
    await i18n.changeLanguage(locale);
    const rules = [
      rule('day'),
      rule('week', { type: 'low', period: 'week', comparison: 'below', value: 7.1 }),
      rule('month', { type: 'low', period: 'month', comparison: 'above', value: 6.1 }),
      rule('history', { type: 'low', period: 'history', comparison: 'none', value: null }),
      rule('above', { type: 'price', period: null, comparison: 'above', value: 7.2 }, 'USDCNY', false),
      rule('below', { type: 'price', period: null, comparison: 'below', value: 6.5 }),
    ];
    const statuses: Record<string, NotificationRuleStatus> = {
      week: { state: 'matched' },
      month: { state: 'unmatched' },
      history: { state: 'unavailable', from: '2024-06-03', to: '2026-09-24', low: 6.123456 },
      above: { state: 'matched' },
      below: { state: 'matched', from: '2020-01-01', to: '2026-09-24', low: 6.1 },
    };
    seed(rules);
    const { unmount } = renderWithProviders(<NotificationSubscriptions notificationStatuses={statuses} />);
    summaries.forEach((summary, index) => {
      expect(within(row(summary)).getByRole('status').textContent).toBe(states[index]);
    });
    expect(within(row(summaries[3])).getByText(coverage)).toBeTruthy();
    expect(within(row(summaries[5])).queryByText(/2020-01-01/)).toBeNull();
    expect(card().textContent).not.toMatch(/settings\.notifications\.|\{(?:value|period|from|to|price)\}/);
    unmount();

    seed(rules, ['USDCNY'], false);
    renderWithProviders(<NotificationSubscriptions notificationStatuses={statuses} />);
    summaries.forEach((summary, index) => {
      expect(within(row(summary)).getByRole('status').textContent).toBe(index === 4 ? states[4] : allPaused);
    });
    expect(stored().notificationRules).toEqual(rules);
  });

  it.each([undefined, 0, -1, NaN, Infinity])('shows actual date coverage without an invalid observed low (%s)', low => {
    seed([rule('history', { type: 'low', period: 'history', comparison: 'none', value: null })]);
    renderWithProviders(<NotificationSubscriptions notificationStatuses={{
      history: { state: 'unavailable', from: '2025-05-06', to: '2026-09-24', low },
    }} />);
    expect(within(card()).getByText('实际数据覆盖：2025-05-06 至 2026-09-24')).toBeTruthy();
    expect(within(card()).queryByText(/范围最低 /)).toBeNull();
    expect(within(card()).getByRole('status').textContent).toBe('数据不足，暂无法判断');
  });

  it.each([{ from: '2026-09-01' }, { to: '2026-09-25' }])('does not invent missing coverage endpoints: %j', endpoints => {
    seed([rule('day')]);
    renderWithProviders(<NotificationSubscriptions notificationStatuses={{ day: { state: 'unmatched', ...endpoints, low: 6.7 } }} />);
    expect(within(card()).queryByText(/实际数据覆盖/)).toBeNull();
    expect(within(card()).getByRole('status').textContent).toBe('尚未满足条件');
  });
});
