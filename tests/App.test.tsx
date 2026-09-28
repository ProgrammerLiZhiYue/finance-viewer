import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import i18n from '../src/i18n';
import { installElectronAPI, renderWithProviders } from './helpers';

vi.mock('../src/components/OverviewView', () => ({ default: () => <div>Overview content</div> }));
vi.mock('../src/components/ExchangeRateViewer', () => ({ default: () => <div>Exchange detail content</div> }));
vi.mock('../src/components/StockViewer', () => ({ default: () => <div>Stock content</div> }));

beforeEach(async () => {
  await i18n.changeLanguage('zh');
  localStorage.setItem('finance-viewer-settings', JSON.stringify({ locale: 'zh' }));
});

describe('App notification monitoring', () => {
  it('monitors subscriptions outside the display list before visiting details and across navigation', async () => {
    const api = installElectronAPI();
    api.getRateSummary.mockResolvedValue([{ label: '近7天', high: 8, low: 7 }]);
    localStorage.setItem('finance-viewer-settings', JSON.stringify({
      enabledPairs: ['USDCNY'], notificationPairs: ['CADCNY', 'JPYCNY'], locale: 'zh',
      notificationRules: ['CADCNY', 'JPYCNY'].map(pair => ({ id: pair, pair, enabled: true, type: 'price', period: null, comparison: 'below', value: 7 })),
    }));
    renderWithProviders(<App />);
    await waitFor(() => expect(api.sendNotification).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Exchange detail content')).toBeNull();
    expect(api.getExchangeRate.mock.calls).toEqual([['CADCNY', 'fenShi'], ['JPYCNY', 'fenShi']]);
    fireEvent.click(screen.getByRole('tab', { name: '设置' }));
    const group = screen.getByRole('group', { name: '通知订阅' });
    expect(within(group).getByRole('button', { name: '加元/人民币' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: '日元/人民币' }));
    await waitFor(() => expect(api.getExchangeRate).toHaveBeenCalledTimes(3));
    expect(api.sendNotification).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('tab', { name: '汇率' }));
    expect(screen.getByText('Exchange detail content')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '港股' }));
    expect(screen.getByText('Stock content')).toBeTruthy();
    expect(api.getExchangeRate).toHaveBeenCalledTimes(3);
    expect(api.sendNotification.mock.calls.every(([message]) => message.pairCode !== 'USDCNY')).toBe(true);
  });

  it('starts and stops global monitoring through the settings controls', async () => {
    const api = installElectronAPI();
    localStorage.setItem('finance-viewer-settings', JSON.stringify({ locale: 'zh',
      notificationRules: ['JPYCNY', 'CADCNY'].map(pair => ({ id: pair, pair, enabled: true, type: 'price', period: null, comparison: 'below', value: 7 })),
    }));
    renderWithProviders(<App />);
    fireEvent.click(screen.getByRole('tab', { name: '设置' }));
    expect(api.sendNotification).not.toHaveBeenCalled();
    const group = screen.getByRole('group', { name: '通知订阅' });
    fireEvent.click(within(group).getByRole('button', { name: '日元/人民币' }));
    await waitFor(() => expect(api.sendNotification).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('checkbox', { name: '桌面通知' }));
    fireEvent.click(within(group).getByRole('button', { name: '加元/人民币' }));
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox', { name: '桌面通知' }));
    await waitFor(() => expect(api.sendNotification).toHaveBeenCalledTimes(2));
    expect(api.getExchangeRate.mock.calls).toEqual([
      ['JPYCNY', 'fenShi'], ['JPYCNY', 'fenShi'], ['CADCNY', 'fenShi'],
    ]);
  });
});
