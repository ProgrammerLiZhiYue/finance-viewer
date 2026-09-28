import { createContext, useContext, useEffect, useReducer } from 'react';
import type { Dispatch, ReactNode } from 'react';
import type { CurrencyPair, HKStockCode, ThemeMode, Locale, NotificationRule } from '../types';
import { getSystemLocale } from '../i18n';
import { isNotificationCondition } from '../lib/notificationRules';

const STORAGE_KEY = 'finance-viewer-settings';

export const ALL_PAIRS: CurrencyPair[] = [
  'USDCNY', 'JPYCNY', 'EURCNY', 'GBPCNY', 'USDJPY', 'AUDCNY', 'NZDCNY', 'HKDCNY',
  'CADCNY', 'CHFCNY', 'SGDCNY', 'THBCNY', 'KRWCNY', 'MYRCNY', 'RUBCNY', 'ZARCNY',
];

const DEFAULT_ENABLED_PAIRS: CurrencyPair[] = [
  'USDCNY', 'JPYCNY', 'EURCNY', 'GBPCNY', 'USDJPY', 'AUDCNY', 'NZDCNY', 'HKDCNY',
];

export const ALL_STOCKS: HKStockCode[] = [
  '00700', '09988', '03690', '01810', '09618', '09888', '02318', '00941',
  '00780', '00981', '09999', '01024',
];

const DEFAULT_ENABLED_STOCKS: HKStockCode[] = [
  '00700', '09988', '03690', '01810', '09618', '09888', '02318', '00941',
];

export interface SettingsState {
  refreshInterval: number;
  enabledPairs: CurrencyPair[];
  notificationPairs: CurrencyPair[];
  notificationRules: NotificationRule[];
  enabledStocks: HKStockCode[];
  theme: ThemeMode;
  locale: Locale;
  notification: boolean;
  minimizeToTray: boolean;
}

const DEFAULTS: SettingsState = {
  refreshInterval: 30,
  enabledPairs: [...DEFAULT_ENABLED_PAIRS],
  notificationPairs: [],
  notificationRules: [],
  enabledStocks: [...DEFAULT_ENABLED_STOCKS],
  theme: 'system',
  locale: getSystemLocale(),
  notification: true,
  minimizeToTray: true,
};

export type SettingsAction =
  | { type: 'setTheme'; theme: ThemeMode }
  | { type: 'setLocale'; locale: Locale }
  | { type: 'setRefreshInterval'; value: number }
  | { type: 'setNotification'; value: boolean }
  | { type: 'setMinimizeToTray'; value: boolean }
  | { type: 'togglePair'; pair: CurrencyPair }
  | { type: 'toggleNotificationPair'; pair: CurrencyPair }
  | { type: 'saveNotificationRule'; rule: NotificationRule }
  | { type: 'deleteNotificationRule'; id: string }
  | { type: 'toggleNotificationRule'; id: string }
  | { type: 'reorderPair'; from: number; to: number }
  | { type: 'toggleStock'; stock: HKStockCode }
  | { type: 'reorderStock'; from: number; to: number }
  | { type: 'reset' };

function reorder<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return list;
  if (fromIndex < 0 || fromIndex >= list.length) return list;
  if (toIndex < 0 || toIndex >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'setTheme':
      return { ...state, theme: action.theme };
    case 'setLocale':
      return { ...state, locale: action.locale };
    case 'setRefreshInterval':
      return { ...state, refreshInterval: action.value };
    case 'setNotification':
      return { ...state, notification: action.value };
    case 'setMinimizeToTray':
      return { ...state, minimizeToTray: action.value };
    case 'togglePair': {
      const idx = state.enabledPairs.indexOf(action.pair);
      if (idx === -1) {
        return { ...state, enabledPairs: [...state.enabledPairs, action.pair] };
      }
      if (state.enabledPairs.length <= 1) return state;
      return { ...state, enabledPairs: state.enabledPairs.filter(p => p !== action.pair) };
    }
    case 'toggleNotificationPair':
      return {
        ...state,
        notificationPairs: state.notificationPairs.includes(action.pair)
          ? state.notificationPairs.filter(pair => pair !== action.pair)
          : [...state.notificationPairs, action.pair],
      };
    case 'saveNotificationRule':
      return {
        ...state,
        notificationRules: state.notificationRules.some(rule => rule.id === action.rule.id)
          ? state.notificationRules.map(rule => rule.id === action.rule.id ? action.rule : rule)
          : [...state.notificationRules, action.rule],
      };
    case 'deleteNotificationRule':
      return { ...state, notificationRules: state.notificationRules.filter(rule => rule.id !== action.id) };
    case 'toggleNotificationRule':
      return { ...state, notificationRules: state.notificationRules.map(rule => rule.id === action.id ? { ...rule, enabled: !rule.enabled } : rule) };
    case 'reorderPair':
      return { ...state, enabledPairs: reorder(state.enabledPairs, action.from, action.to) };
    case 'toggleStock': {
      const idx = state.enabledStocks.indexOf(action.stock);
      if (idx === -1) {
        return { ...state, enabledStocks: [...state.enabledStocks, action.stock] };
      }
      if (state.enabledStocks.length <= 1) return state;
      return { ...state, enabledStocks: state.enabledStocks.filter(s => s !== action.stock) };
    }
    case 'reorderStock':
      return { ...state, enabledStocks: reorder(state.enabledStocks, action.from, action.to) };
    case 'reset':
      return {
        ...DEFAULTS,
        enabledPairs: [...DEFAULTS.enabledPairs],
        notificationPairs: [],
        notificationRules: [],
        enabledStocks: [...DEFAULTS.enabledStocks],
        locale: 'zh',
      };
  }
}

function loadNotificationRules(value: unknown): NotificationRule[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.filter((item): item is NotificationRule => {
    if (!item || typeof item !== 'object') return false;
    const { id } = item;
    if (typeof id !== 'string' || !id.trim() || id.length > 128 || ids.has(id)
      || !ALL_PAIRS.includes(item.pair) || typeof item.enabled !== 'boolean' || !isNotificationCondition(item)) return false;
    ids.add(id);
    return true;
  });
}

export function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<SettingsState>;
    return {
      refreshInterval: parsed.refreshInterval ?? DEFAULTS.refreshInterval,
      enabledPairs: Array.isArray(parsed.enabledPairs) && parsed.enabledPairs.length > 0
        ? parsed.enabledPairs
        : [...DEFAULTS.enabledPairs],
      notificationPairs: Array.isArray(parsed.notificationPairs)
        ? [...new Set(parsed.notificationPairs.filter(pair => ALL_PAIRS.includes(pair)))]
        : [],
      notificationRules: loadNotificationRules(parsed.notificationRules),
      enabledStocks: Array.isArray(parsed.enabledStocks) && parsed.enabledStocks.length > 0
        ? parsed.enabledStocks
        : [...DEFAULTS.enabledStocks],
      theme: parsed.theme ?? DEFAULTS.theme,
      locale: (['zh', 'en', 'ja'].includes(parsed.locale ?? '') ? parsed.locale : DEFAULTS.locale) as Locale,
      notification: parsed.notification ?? DEFAULTS.notification,
      minimizeToTray: parsed.minimizeToTray ?? DEFAULTS.minimizeToTray,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

interface SettingsContextValue {
  state: SettingsState;
  dispatch: Dispatch<SettingsAction>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(settingsReducer, undefined, loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  return (
    <SettingsContext.Provider value={{ state, dispatch }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
