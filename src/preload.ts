import { contextBridge, ipcRenderer } from 'electron';
import type { ExchangeRateData, Period, KLinePeriod, CurrencyPair, SummaryItem, Locale, HKStockCode, StockData, SearchResultItem, NotifyArgs } from './types';

contextBridge.exposeInMainWorld('electronAPI', {
  getExchangeRate: (pairCode: CurrencyPair, period: Period): Promise<ExchangeRateData> =>
    ipcRenderer.invoke('get-exchange-rate', pairCode, period),
  getRateSummary: (pairCode: CurrencyPair): Promise<SummaryItem[]> =>
    ipcRenderer.invoke('get-rate-summary', pairCode),
  getHKStockMinute: (stockCode: HKStockCode): Promise<StockData> =>
    ipcRenderer.invoke('get-hk-stock-minute', stockCode),
  getHKStockFiveDay: (stockCode: HKStockCode): Promise<StockData> =>
    ipcRenderer.invoke('get-hk-stock-fiveday', stockCode),
  getHKStockKLine: (stockCode: HKStockCode, period: KLinePeriod): Promise<StockData> =>
    ipcRenderer.invoke('get-hk-stock-kline', stockCode, period),
  getHKStockSummary: (stockCode: HKStockCode): Promise<SummaryItem[]> =>
    ipcRenderer.invoke('get-hk-stock-summary', stockCode),
  search: (query: string): Promise<SearchResultItem[]> =>
    ipcRenderer.invoke('search', query),
  sendNotification: (args: NotifyArgs): Promise<boolean> =>
    ipcRenderer.invoke('send-notification', args),
  onNavigateToSettings: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('navigate-to-settings', handler);
    return () => ipcRenderer.removeListener('navigate-to-settings', handler);
  },
  getAutoLaunch: (): Promise<boolean> => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enable: boolean): Promise<boolean> =>
    ipcRenderer.invoke('set-auto-launch', enable),
  getSystemTheme: (): Promise<boolean> =>
    ipcRenderer.invoke('get-system-theme'),
  onSystemThemeChange: (callback: (isDark: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isDark: boolean): void => callback(isDark);
    ipcRenderer.on('system-theme-changed', handler);
    return () => ipcRenderer.removeListener('system-theme-changed', handler);
  },
  setLocale: (locale: Locale): Promise<boolean> =>
    ipcRenderer.invoke('set-locale', locale),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window-close'),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window-minimize'),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke('window-maximize'),
  getPlatform: (): Promise<string> => ipcRenderer.invoke('get-platform'),
});
