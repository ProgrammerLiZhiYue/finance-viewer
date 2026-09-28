import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import StockViewer from '../../src/components/StockViewer';
import i18n from '../../src/i18n';
import type { HKStockCode, Period } from '../../src/types';
import { installElectronAPI, makeStock, renderWithProviders } from '../helpers';

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

const NAMES: Record<string, string> = {
  '00700': '腾讯控股',
  '09988': '阿里巴巴-W',
};

beforeEach(async () => {
  await i18n.changeLanguage('zh');
});

describe('StockViewer', () => {
  it('renders header, metrics and order book', async () => {
    const api = installElectronAPI();
    api.getHKStockMinute.mockImplementation((code: HKStockCode) =>
      Promise.resolve(makeStock({ code, name: NAMES[code] ?? code })));
    const { container } = renderWithProviders(<StockViewer isDark={false} initialStock="00700" />);

    await waitFor(() =>
      expect(container.querySelector('.stock-header-name')?.textContent).toBe('腾讯控股'));
    expect(container.querySelector('.stock-header-price')?.textContent).toBe('456.80');
    expect(container.querySelectorAll('.ask-row').length).toBe(5);
    expect(container.querySelectorAll('.bid-row').length).toBe(5);
    expect(container.querySelector('.order-book-spread')?.textContent).toContain('价差');
    expect(container.querySelectorAll('.stock-info-item').length).toBe(8);
  });

  it('switches stock from the sidebar', async () => {
    const api = installElectronAPI();
    api.getHKStockMinute.mockImplementation((code: HKStockCode) =>
      Promise.resolve(makeStock({ code, name: NAMES[code] ?? code, currentPrice: 82.35 })));
    const { container } = renderWithProviders(<StockViewer isDark={false} initialStock="00700" />);
    await waitFor(() =>
      expect(container.querySelector('.stock-header-name')?.textContent).toBe('腾讯控股'));

    const target = [...container.querySelectorAll('.sidebar-item-name')]
      .find(el => el.textContent === '阿里巴巴-W')!.closest('.sidebar-item');
    fireEvent.click(target!);

    await waitFor(() => expect(api.getHKStockMinute).toHaveBeenCalledWith('09988'));
    await waitFor(() =>
      expect(container.querySelector('.stock-header-price')?.textContent).toBe('82.35'));
  });

  it('shows the error panel when the API fails', async () => {
    const api = installElectronAPI();
    api.getHKStockMinute.mockRejectedValue(new Error('down'));
    renderWithProviders(<StockViewer isDark={false} initialStock="00700" />);
    expect(await screen.findByText('重试')).toBeTruthy();
  });

  it('reloads data for each K-line period', async () => {
    const api = installElectronAPI();
    api.getHKStockMinute.mockImplementation((code: HKStockCode) =>
      Promise.resolve(makeStock({ code, name: NAMES[code] ?? code })));
    const klinePrices: Record<string, number> = {
      dailyK: 11.46, weeklyK: 11.47, monthlyK: 12.12, quarterlyK: 12.16, yearlyK: 22.35,
    };
    // K 线接口不返回股票名称，组件需回退到已知名称
    api.getHKStockKLine.mockImplementation((_code: HKStockCode, period: Period) =>
      Promise.resolve(makeStock({ name: '', currentPrice: klinePrices[period] })));

    const { container } = renderWithProviders(<StockViewer isDark={false} initialStock="00700" />);
    await waitFor(() =>
      expect(container.querySelector('.stock-header-price')?.textContent).toBe('456.80'));

    for (const [period, price] of Object.entries(klinePrices)) {
      const label = screen.getByText(i18n.t(`viewer.periods.${period}`));
      fireEvent.click(label);
      await waitFor(() => expect(api.getHKStockKLine).toHaveBeenCalledWith('00700', period));
      await waitFor(() =>
        expect(container.querySelector('.stock-header-price')?.textContent).toBe(price.toFixed(2)));
      expect(container.querySelector('.stock-header-name')?.textContent).toBe('腾讯控股');
      expect(label.className).toContain('active');
    }

    fireEvent.click(screen.getByText('分时'));
    await waitFor(() =>
      expect(container.querySelector('.stock-header-price')?.textContent).toBe('456.80'));
  });

  it('puts 五日 between 分时 and 日K and loads its own endpoint', async () => {
    const api = installElectronAPI();
    api.getHKStockMinute.mockImplementation((code: HKStockCode) =>
      Promise.resolve(makeStock({ code, name: NAMES[code] ?? code })));
    // 五日接口同样不返回股票名称，组件需回退到已知名称
    api.getHKStockFiveDay.mockResolvedValue(makeStock({ name: '', currentPrice: 11.35 }));

    const { container } = renderWithProviders(<StockViewer isDark={false} initialStock="00700" />);
    await waitFor(() =>
      expect(container.querySelector('.stock-header-price')?.textContent).toBe('456.80'));

    const buttons = [...container.querySelectorAll('.period-btn')];
    expect(buttons.map(b => b.textContent)).toEqual(['分时', '五日', '日K', '周K', '月K', '季K', '年K']);

    const fiveDay = buttons[1];
    fireEvent.click(fiveDay);
    await waitFor(() => expect(api.getHKStockFiveDay).toHaveBeenCalledWith('00700'));
    await waitFor(() =>
      expect(container.querySelector('.stock-header-price')?.textContent).toBe('11.35'));
    expect(api.getHKStockKLine).not.toHaveBeenCalled();
    expect(container.querySelector('.stock-header-name')?.textContent).toBe('腾讯控股');
    expect(fiveDay.className).toContain('active');
    await waitFor(() =>
      expect(container.querySelector('.sidebar-item.active .sidebar-item-rate')?.textContent).toBe('11.35'));
  });
});
