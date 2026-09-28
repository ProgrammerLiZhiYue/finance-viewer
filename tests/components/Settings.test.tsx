import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import Settings from '../../src/components/Settings';
import { ALL_PAIRS } from '../../src/context/SettingsContext';
import i18n from '../../src/i18n';
import type { NotificationRule } from '../../src/types';
import { installElectronAPI, renderWithProviders } from '../helpers';

const savedRules: NotificationRule[] = [
  { id: 'usd-day', pair: 'USDCNY', enabled: true, type: 'low', period: 'day', comparison: 'none', value: null },
  { id: 'usd-price', pair: 'USDCNY', enabled: false, type: 'price', period: null, comparison: 'below', value: 6.12345678 },
  { id: 'cad-history', pair: 'CADCNY', enabled: true, type: 'low', period: 'history', comparison: 'above', value: 5.1 },
];

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem('finance-viewer-settings') ?? '{}');
}

beforeEach(async () => {
  await i18n.changeLanguage('zh');
});

describe('Settings', () => {
  it('shows the app version', () => {
    installElectronAPI();
    renderWithProviders(<Settings />);
    expect(screen.getByText('0.0.0-test')).toBeTruthy();
  });

  it('switches theme and persists it', async () => {
    installElectronAPI();
    const { container } = renderWithProviders(<Settings />);
    const dark = container.querySelectorAll('.theme-option')[2];
    fireEvent.click(dark);
    await waitFor(() => expect(stored().theme).toBe('dark'));
    expect(dark.className).toContain('active');
  });

  it('sets refresh interval via preset', async () => {
    installElectronAPI();
    const { container } = renderWithProviders(<Settings />);
    const preset = [...container.querySelectorAll('.slider-preset')].find(b => b.textContent === '1分钟');
    fireEvent.click(preset!);
    await waitFor(() => expect(stored().refreshInterval).toBe(60));
    expect((container.querySelector('input[type="range"]') as HTMLInputElement).value).toBe('60');
  });

  it('toggles notification and persists it', async () => {
    installElectronAPI();
    renderWithProviders(<Settings />);
    fireEvent.click(screen.getByRole('checkbox', { name: '桌面通知' }));
    await waitFor(() => expect(stored().notification).toBe(false));
  });

  it('shows all 16 localized subscription buttons with an empty count by default', async () => {
    installElectronAPI();
    renderWithProviders(<Settings />);
    const subscriptions = within(screen.getByRole('group', { name: '通知订阅' }));
    expect(subscriptions.getAllByRole('button')).toHaveLength(16);
    for (const pair of ALL_PAIRS) {
      const button = subscriptions.getByRole('button', { name: i18n.t(`overview.pair.${pair}`) });
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
    expect(screen.getByRole('status').textContent).toContain('已选择 0 个币种 ·');
    expect(screen.getByRole('status').textContent).toContain('请选择币种，再添加通知条件。');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(stored()).toMatchObject({ notificationPairs: [], notificationRules: [] }));
  });

  it('selects multiple subscriptions independently of displayed pairs and persists the count', async () => {
    installElectronAPI();
    renderWithProviders(<Settings />);
    const enabledPairs = stored().enabledPairs;
    expect(enabledPairs).not.toContain('CADCNY');
    const subscriptions = within(screen.getByRole('group', { name: '通知订阅' }));
    const usd = subscriptions.getByRole('button', { name: '美元/人民币' });
    const cad = subscriptions.getByRole('button', { name: '加元/人民币' });

    fireEvent.click(usd);
    expect(usd.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('已选择 1 个币种 ·');
    fireEvent.click(cad);
    expect(usd.getAttribute('aria-pressed')).toBe('true');
    expect(cad.getAttribute('aria-pressed')).toBe('true');
    expect(subscriptions.getAllByRole('button', { pressed: true })).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toContain('已选择 2 个币种 ·');
    expect(screen.getByRole('status').textContent).not.toContain('尚未订阅币种');
    await waitFor(() => expect(stored().notificationPairs).toEqual(['USDCNY', 'CADCNY']));
    expect(stored().enabledPairs).toEqual(enabledPairs);
  });

  it('deselects multiple subscriptions including the last one to restore the empty state', async () => {
    installElectronAPI();
    localStorage.setItem('finance-viewer-settings', JSON.stringify({
      enabledPairs: ['USDCNY'],
      notificationPairs: ['USDCNY', 'CADCNY'],
    }));
    renderWithProviders(<Settings />);
    const subscriptions = within(screen.getByRole('group', { name: '通知订阅' }));
    const usd = subscriptions.getByRole('button', { name: '美元/人民币' });
    const cad = subscriptions.getByRole('button', { name: '加元/人民币' });

    fireEvent.click(cad);
    expect(cad.getAttribute('aria-pressed')).toBe('false');
    expect(usd.getAttribute('aria-pressed')).toBe('true');
    expect((usd as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toContain('已选择 1 个币种 ·');
    await waitFor(() => expect(stored().notificationPairs).toEqual(['USDCNY']));

    fireEvent.click(usd);
    expect(usd.getAttribute('aria-pressed')).toBe('false');
    expect(subscriptions.queryAllByRole('button', { pressed: true })).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toContain('已选择 0 个币种 ·');
    expect(screen.getByRole('status').textContent).toContain('请选择币种，再添加通知条件。');
    await waitFor(() => expect(stored().notificationPairs).toEqual([]));
    expect(stored().enabledPairs).toEqual(['USDCNY']);
  });

  it('retains subscriptions when paused and allows adding and removing them before resuming', async () => {
    installElectronAPI();
    renderWithProviders(<Settings />);
    const enabledPairs = stored().enabledPairs;
    const subscriptions = within(screen.getByRole('group', { name: '通知订阅' }));
    const usd = subscriptions.getByRole('button', { name: '美元/人民币' });
    const jpy = subscriptions.getByRole('button', { name: '日元/人民币' });
    const cad = subscriptions.getByRole('button', { name: '加元/人民币' });
    const toggle = screen.getByRole('checkbox', { name: '桌面通知' }) as HTMLInputElement;
    fireEvent.click(usd);
    fireEvent.click(jpy);
    fireEvent.click(toggle);

    expect(toggle.checked).toBe(false);
    expect(usd.getAttribute('aria-pressed')).toBe('true');
    expect(jpy.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('已选择 2 个币种 ·');
    expect(screen.getByRole('status').textContent).toContain('桌面通知已暂停，所有订阅和条件已保留。');
    await waitFor(() => expect(stored()).toMatchObject({
      notification: false,
      notificationPairs: ['USDCNY', 'JPYCNY'],
    }));

    expect((cad as HTMLButtonElement).disabled).toBe(false);
    expect((usd as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cad);
    expect(screen.getByRole('status').textContent).toContain('已选择 3 个币种 ·');
    fireEvent.click(usd);
    expect(usd.getAttribute('aria-pressed')).toBe('false');
    expect(jpy.getAttribute('aria-pressed')).toBe('true');
    expect(cad.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('已选择 2 个币种 ·');
    expect(screen.getByRole('status').textContent).toContain('桌面通知已暂停，所有订阅和条件已保留。');
    await waitFor(() => expect(stored()).toMatchObject({
      notification: false,
      notificationPairs: ['JPYCNY', 'CADCNY'],
    }));

    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(screen.getByRole('status').textContent).not.toContain('通知已暂停');
    expect(subscriptions.getAllByRole('button', { pressed: true })).toHaveLength(2);
    await waitFor(() => expect(stored()).toMatchObject({
      notification: true,
      notificationPairs: ['JPYCNY', 'CADCNY'],
      enabledPairs,
    }));
  });

  it('restores persisted subscriptions and paused state after unmounting and remounting', async () => {
    installElectronAPI();
    const { unmount } = renderWithProviders(<Settings />);
    const enabledPairs = stored().enabledPairs;
    const subscriptions = within(screen.getByRole('group', { name: '通知订阅' }));
    fireEvent.click(subscriptions.getByRole('button', { name: '美元/人民币' }));
    fireEvent.click(subscriptions.getByRole('button', { name: '加元/人民币' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '桌面通知' }));
    await waitFor(() => expect(stored()).toMatchObject({
      notificationPairs: ['USDCNY', 'CADCNY'],
      notification: false,
      enabledPairs,
    }));
    unmount();

    renderWithProviders(<Settings />);
    const restored = within(screen.getByRole('group', { name: '通知订阅' }));
    expect(restored.getByRole('button', { name: '美元/人民币' }).getAttribute('aria-pressed')).toBe('true');
    expect(restored.getByRole('button', { name: '加元/人民币' }).getAttribute('aria-pressed')).toBe('true');
    expect(restored.getAllByRole('button', { pressed: true })).toHaveLength(2);
    expect((screen.getByRole('checkbox', { name: '桌面通知' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole('status').textContent).toContain('已选择 2 个币种 ·');
    expect(screen.getByRole('status').textContent).toContain('桌面通知已暂停，所有订阅和条件已保留。');
    await waitFor(() => expect(stored()).toMatchObject({
      notificationPairs: ['USDCNY', 'CADCNY'],
      notification: false,
      enabledPairs,
    }));
  });

  it('retains complete rules and individual pause states across the master switch, deselection and remount', async () => {
    installElectronAPI();
    localStorage.setItem('finance-viewer-settings', JSON.stringify({
      enabledPairs: ['JPYCNY'], notificationPairs: ['USDCNY', 'CADCNY'], notificationRules: savedRules,
    }));
    const { unmount } = renderWithProviders(<Settings />);
    const master = screen.getByRole('checkbox', { name: '桌面通知' });
    fireEvent.click(master);
    const usd = screen.getByRole('article', { name: '美元/人民币通知条件' });
    const cad = screen.getByRole('article', { name: '加元/人民币通知条件' });
    expect(within(usd).getAllByRole('status').map(node => node.textContent)).toEqual([
      '提醒已暂停 · 桌面通知总开关已关闭', '条件已暂停',
    ]);
    expect(within(cad).getByRole('status').textContent).toBe('提醒已暂停 · 桌面通知总开关已关闭');
    const subscriptions = within(screen.getByRole('group', { name: '通知订阅' }));
    fireEvent.click(subscriptions.getByRole('button', { name: '美元/人民币' }));
    expect(screen.queryByRole('article', { name: '美元/人民币通知条件' })).toBeNull();
    await waitFor(() => expect(stored()).toMatchObject({
      notification: false, notificationPairs: ['CADCNY'], notificationRules: savedRules, enabledPairs: ['JPYCNY'],
    }));
    unmount();

    renderWithProviders(<Settings />);
    expect((screen.getByRole('checkbox', { name: '桌面通知' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('article', { name: '美元/人民币通知条件' })).toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: '通知订阅' })).getByRole('button', { name: '美元/人民币' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '桌面通知' }));
    const restored = within(screen.getByRole('article', { name: '美元/人民币通知条件' }));
    expect(restored.getByText('汇率低于 6.12345678 时提醒（严格比较，等于阈值不提醒）。')).toBeTruthy();
    expect(restored.getAllByRole('status').map(node => node.textContent)).toEqual(['已启用 · 等待行情', '条件已暂停']);
    await waitFor(() => expect(stored()).toMatchObject({
      notification: true, notificationPairs: ['CADCNY', 'USDCNY'], notificationRules: savedRules, enabledPairs: ['JPYCNY'],
    }));
  });

  it('forwards rule statuses and actual coverage dates to the subscription cards', () => {
    installElectronAPI();
    localStorage.setItem('finance-viewer-settings', JSON.stringify({
      notificationPairs: ['USDCNY', 'CADCNY'], notificationRules: savedRules,
    }));
    renderWithProviders(<Settings notificationStatuses={{
      'usd-day': { state: 'matched', from: '2026-09-25', to: '2026-09-25', low: 6.7 },
      'cad-history': { state: 'unavailable', from: '2024-01-02', to: '2026-09-24' },
    }} />);
    const usd = within(screen.getByRole('article', { name: '美元/人民币通知条件' }));
    const cad = within(screen.getByRole('article', { name: '加元/人民币通知条件' }));
    expect(usd.getByText('已满足条件')).toBeTruthy();
    expect(usd.getByText('实际数据覆盖：2026-09-25 至 2026-09-25 · 范围最低 6.7')).toBeTruthy();
    expect(cad.getByRole('status').textContent).toBe('数据不足，暂无法判断');
    expect(cad.getByText('实际数据覆盖：2024-01-02 至 2026-09-24')).toBeTruthy();
  });

  it('switches locale and notifies the main process', async () => {
    const api = installElectronAPI();
    const { container } = renderWithProviders(<Settings />);
    const en = [...container.querySelectorAll('.lang-option')].find(b => b.textContent?.includes('English'));
    fireEvent.click(en!);
    await waitFor(() => expect(api.setLocale).toHaveBeenCalledWith('en'));
    await waitFor(() => expect(stored().locale).toBe('en'));
    await waitFor(() => expect(en!.className).toContain('active'));
  });

  it('reads auto-launch state on mount and rolls back on failure', async () => {
    const api = installElectronAPI();
    api.getAutoLaunch.mockResolvedValue(true);
    api.setAutoLaunch.mockRejectedValue(new Error('denied'));
    const { container } = renderWithProviders(<Settings />);
    const autoLaunch = (container.querySelectorAll('.toggle-switch input') as NodeListOf<HTMLInputElement>)[0];
    await waitFor(() => expect(autoLaunch.checked).toBe(true));
    fireEvent.click(autoLaunch);
    await waitFor(() => expect(api.setAutoLaunch).toHaveBeenCalledWith(false));
    await waitFor(() => expect(autoLaunch.checked).toBe(true));
  });

  it('reset clears subscriptions and rules, restores defaults and switches back to zh', async () => {
    const api = installElectronAPI();
    localStorage.setItem('finance-viewer-settings', JSON.stringify({ notificationRules: savedRules }));
    const { container } = renderWithProviders(<Settings />);
    const subscriptions = within(screen.getByRole('group', { name: '通知订阅' }));
    fireEvent.click(subscriptions.getByRole('button', { name: '美元/人民币' }));
    fireEvent.click(subscriptions.getByRole('button', { name: '加元/人民币' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '桌面通知' }));
    await waitFor(() => expect(stored()).toMatchObject({
      notificationPairs: ['USDCNY', 'CADCNY'],
      notification: false,
    }));
    fireEvent.click([...container.querySelectorAll('.lang-option')].find(b => b.textContent?.includes('English'))!);
    await waitFor(() => expect(stored().locale).toBe('en'));
    fireEvent.click(container.querySelector('.btn-reset')!);
    await waitFor(() => expect(stored()).toMatchObject({
      locale: 'zh',
      theme: 'system',
      refreshInterval: 30,
      notification: true,
      notificationPairs: [],
      notificationRules: [],
    }));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    const resetSubscriptions = within(screen.getByRole('group', { name: '通知订阅' }));
    expect(resetSubscriptions.getAllByRole('button', { pressed: false })).toHaveLength(16);
    expect((screen.getByRole('checkbox', { name: '桌面通知' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('已选择 0 个币种 ·');
    expect(screen.getByRole('status').textContent).toContain('请选择币种，再添加通知条件。');
    expect(api.setLocale).toHaveBeenLastCalledWith('zh');
  });
});
