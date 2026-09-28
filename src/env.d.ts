/// <reference types="vite/client" />

import type { ExchangeRateData, Period, KLinePeriod, CurrencyPair, SummaryItem, Locale, HKStockCode, StockData, SearchResultItem, NotifyArgs } from './types';

interface ElectronAPI {
  getExchangeRate: (pairCode: CurrencyPair, period: Period) => Promise<ExchangeRateData>;
  getRateSummary: (pairCode: CurrencyPair) => Promise<SummaryItem[]>;
  getHKStockMinute: (stockCode: HKStockCode) => Promise<StockData>;
  getHKStockFiveDay: (stockCode: HKStockCode) => Promise<StockData>;
  getHKStockKLine: (stockCode: HKStockCode, period: KLinePeriod) => Promise<StockData>;
  getHKStockSummary: (stockCode: HKStockCode) => Promise<SummaryItem[]>;
  search: (query: string) => Promise<SearchResultItem[]>;
  sendNotification: (args: NotifyArgs) => Promise<boolean>;
  onNavigateToSettings: (callback: () => void) => () => void;
  getAutoLaunch: () => Promise<boolean>;
  setAutoLaunch: (enable: boolean) => Promise<boolean>;
  getSystemTheme: () => Promise<boolean>;
  onSystemThemeChange: (callback: (isDark: boolean) => void) => () => void;
  setLocale: (locale: Locale) => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  getPlatform: () => Promise<string>;
}

declare global {
  const __APP_VERSION__: string;
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
  const MAIN_WINDOW_VITE_NAME: string;
  interface Window {
    electronAPI: ElectronAPI;
  }
}
