import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import ExchangeRateViewer from '../../src/components/ExchangeRateViewer';
import i18n from '../../src/i18n';
import { installElectronAPI, renderWithProviders } from '../helpers';

vi.mock('echarts', () => {
  const chart = {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    clear: vi.fn(),
    getOption: vi.fn(() => ({})),
  };
  return {
    init: vi.fn(() => chart),
    graphic: { LinearGradient: class LinearGradient { constructor(...args: unknown[]) { void args; } } },
  };
});

beforeEach(async () => {
  await i18n.changeLanguage('zh');
});

describe('ExchangeRateViewer', () => {
  it('loads the initial pair and renders header + sidebar', async () => {
    installElectronAPI();
    const { container } = renderWithProviders(<ExchangeRateViewer isDark={false} initialPair="USDCNY" />);

    await waitFor(() =>
      expect(container.querySelector('.rate-value')?.textContent).toBe('6.7208'));
    expect(container.querySelector('.rate-pair-title')?.textContent).toBe('美元/人民币');
    expect(container.querySelectorAll('.sidebar-item').length).toBe(8);
    expect(container.querySelectorAll('.key-metric-item').length).toBe(6);
  });

  it('switches pair from the sidebar', async () => {
    const api = installElectronAPI();
    const { container } = renderWithProviders(<ExchangeRateViewer isDark={false} initialPair={null} />);
    await waitFor(() =>
      expect(container.querySelector('.rate-value')?.textContent).toBe('6.7208'));

    const target = [...container.querySelectorAll('.sidebar-item-name')]
      .find(el => el.textContent === '日元/人民币')!.closest('.sidebar-item');
    fireEvent.click(target!);

    await waitFor(() => expect(api.getExchangeRate).toHaveBeenCalledWith('JPYCNY', 'fenShi'));
    await waitFor(() =>
      expect(container.querySelector('.rate-pair-title')?.textContent).toBe('日元/人民币'));
  });

  it('switches period and refetches', async () => {
    const api = installElectronAPI();
    const { container } = renderWithProviders(<ExchangeRateViewer isDark={false} initialPair="USDCNY" />);
    await waitFor(() =>
      expect(container.querySelector('.rate-value')?.textContent).toBe('6.7208'));

    const daily = [...container.querySelectorAll('.period-btn')]
      .find(b => b.textContent === '日K');
    fireEvent.click(daily!);

    await waitFor(() => expect(api.getExchangeRate).toHaveBeenCalledWith('USDCNY', 'dailyK'));
    await waitFor(() => expect(daily!.className).toContain('active'));
  });

  it('shows the error panel and retries', async () => {
    const api = installElectronAPI();
    api.getExchangeRate.mockRejectedValue(new Error('down'));
    const { container } = renderWithProviders(<ExchangeRateViewer isDark={false} initialPair="USDCNY" />);

    const retry = await screen.findByText('重试');
    expect(container.querySelector('.error-panel')).toBeTruthy();
    const calls = api.getExchangeRate.mock.calls.length;
    fireEvent.click(retry);
    await waitFor(() => expect(api.getExchangeRate.mock.calls.length).toBeGreaterThan(calls));
  });

  it('does not send duplicate low alerts on load, pair/period changes, retry or refresh', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const api = installElectronAPI();
      api.getRateSummary.mockResolvedValue([{ label: '近7天', high: 8, low: 7 }]);
      localStorage.setItem('finance-viewer-settings', JSON.stringify({ refreshInterval: 5, notificationPairs: ['USDCNY', 'JPYCNY'] }));
      const { container } = renderWithProviders(<ExchangeRateViewer isDark={false} initialPair="USDCNY" />);
      await act(async () => {});
      expect(container.querySelector('.rate-value')?.textContent).toBe('6.7208');
      fireEvent.click([...container.querySelectorAll('.period-btn')].find(button => button.textContent === '日K')!);
      await act(async () => {});
      fireEvent.click([...container.querySelectorAll('.sidebar-item-name')]
        .find(item => item.textContent === '日元/人民币')!.closest('.sidebar-item')!);
      await act(async () => {});
      api.getExchangeRate.mockRejectedValueOnce(new Error('offline'));
      fireEvent.click([...container.querySelectorAll('.period-btn')].find(button => button.textContent === '月K')!);
      await act(async () => {});
      fireEvent.click(screen.getByText('重试'));
      await act(async () => {});
      const calls = api.getExchangeRate.mock.calls.length;
      await act(() => vi.advanceTimersByTimeAsync(5000));
      expect(api.getExchangeRate.mock.calls.length).toBeGreaterThan(calls);
      expect(api.sendNotification).not.toHaveBeenCalled();
    } finally {
      cleanup();
      vi.useRealTimers();
      errors.mockRestore();
    }
  });
});
