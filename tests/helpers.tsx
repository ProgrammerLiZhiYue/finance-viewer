import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import { SettingsProvider } from '../src/context/SettingsContext';
import type { ExchangeRateData, KLineItem, StockData } from '../src/types';

export function renderWithProviders(ui: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <SettingsProvider>{ui}</SettingsProvider>
    </I18nextProvider>,
  );
}

export function makeKline(count = 5, base = 6.7): KLineItem[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-01-0${i + 1}`,
    open: base,
    close: base + i * 0.001,
    high: base + 0.01,
    low: base - 0.01,
  }));
}

export function makeRate(overrides: Partial<ExchangeRateData> = {}): ExchangeRateData {
  return {
    name: '美元/人民币',
    currentRate: 6.7208,
    change: -0.0021,
    changePercent: -0.03,
    open: 6.7214,
    high: 6.7229,
    low: 6.7207,
    prevClose: 6.7229,
    bid: 6.7201,
    ask: 6.7215,
    kline: makeKline(),
    ...overrides,
  };
}

export function makeStock(overrides: Partial<StockData> = {}): StockData {
  return {
    name: '腾讯控股',
    code: '00700',
    currentPrice: 456.8,
    change: 5.6,
    changePercent: 1.24,
    open: 451,
    high: 460,
    low: 450,
    prevClose: 451.2,
    volume: 12345678,
    turnover: 5600000000,
    bid: 456.7,
    ask: 456.9,
    kline: makeKline(5, 456),
    ...overrides,
  };
}

export function installElectronAPI() {
  const api = {
    getExchangeRate: vi.fn().mockResolvedValue(makeRate()),
    getRateSummary: vi.fn().mockResolvedValue([]),
    getHKStockMinute: vi.fn().mockResolvedValue(makeStock()),
    getHKStockFiveDay: vi.fn().mockResolvedValue(makeStock()),
    getHKStockKLine: vi.fn().mockResolvedValue(makeStock()),
    getHKStockSummary: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    sendNotification: vi.fn().mockResolvedValue(true),
    onNavigateToSettings: vi.fn(() => () => {}),
    getAutoLaunch: vi.fn().mockResolvedValue(false),
    setAutoLaunch: vi.fn().mockResolvedValue(true),
    getSystemTheme: vi.fn().mockResolvedValue(false),
    onSystemThemeChange: vi.fn(() => () => {}),
    setLocale: vi.fn().mockResolvedValue(true),
    windowClose: vi.fn().mockResolvedValue(undefined),
    windowMinimize: vi.fn().mockResolvedValue(undefined),
    windowMaximize: vi.fn().mockResolvedValue(undefined),
    getPlatform: vi.fn().mockResolvedValue('win32'),
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return api;
}
