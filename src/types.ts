export interface KLineItem {
  date: string;
  timestamp?: number;
  open: number;
  close: number;
  high: number;
  low: number;
  /** 涨跌额（仅分时数据） */
  change?: number;
  /** 涨跌幅 %（仅分时数据） */
  changePercent?: number;
}

export interface ExchangeRateData {
  name: string;
  currentRate: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  bid: number;
  ask: number;
  kline: KLineItem[];
}

export interface SummaryItem {
  label: string;
  high: number;
  low: number;
}

export const SUMMARY_PERIODS = [
  { key: '7d',  label: '最近7天',  days: 7 },
  { key: '1y',  label: '最近1年',  days: 365 },
  { key: 'all', label: '历史',     days: 1825 },
] as const;

export type Period =
  | 'fenShi' | 'fiveDay' | 'dailyK' | 'weeklyK' | 'monthlyK' | 'quarterlyK' | 'yearlyK'
  | '1min' | '5min' | '15min' | '30min' | '60min';

/** 走 K 线接口的周期；分时与五日各有独立接口 */
export type KLinePeriod = Exclude<Period, 'fenShi' | 'fiveDay'>;

export type CurrencyPair =
  | 'USDCNY' | 'JPYCNY' | 'EURCNY' | 'GBPCNY' | 'USDJPY' | 'AUDCNY' | 'NZDCNY' | 'HKDCNY'
  | 'CADCNY' | 'CHFCNY' | 'SGDCNY' | 'THBCNY' | 'KRWCNY' | 'MYRCNY' | 'RUBCNY' | 'ZARCNY';

export const PAIR_FLAGS: Record<CurrencyPair, string> = {
  USDCNY: '\u{1F1FA}\u{1F1F8}',
  JPYCNY: '\u{1F1EF}\u{1F1F5}',
  EURCNY: '\u{1F1EA}\u{1F1FA}',
  GBPCNY: '\u{1F1EC}\u{1F1E7}',
  USDJPY: '\u{1F4B1}',
  AUDCNY: '\u{1F1E6}\u{1F1FA}',
  NZDCNY: '\u{1F1F3}\u{1F1FF}',
  HKDCNY: '\u{1F1ED}\u{1F1F0}',
  CADCNY: '\u{1F1E8}\u{1F1E6}',
  CHFCNY: '\u{1F1E8}\u{1F1ED}',
  SGDCNY: '\u{1F1F8}\u{1F1EC}',
  THBCNY: '\u{1F1F9}\u{1F1ED}',
  KRWCNY: '\u{1F1F0}\u{1F1F7}',
  MYRCNY: '\u{1F1F2}\u{1F1FE}',
  RUBCNY: '\u{1F1F7}\u{1F1FA}',
  ZARCNY: '\u{1F1FF}\u{1F1E6}',
};

export type HKStockCode = string;

export const STOCK_NAMES: Record<string, string> = {
  '00700': '腾讯控股',
  '09988': '阿里巴巴-W',
  '03690': '美团-W',
  '01810': '小米集团-W',
  '09618': '京东集团-SW',
  '09888': '百度集团-SW',
  '02318': '中国平安',
  '00941': '中国移动',
  '00780': '同程旅行',
  '00981': '中芯国际',
  '09999': '网易-S',
  '01024': '快手-W',
};

export const POPULAR_HK_STOCKS: { code: HKStockCode; name: string }[] = [
  { code: '00700', name: '腾讯控股' },
  { code: '09988', name: '阿里巴巴-W' },
  { code: '03690', name: '美团-W' },
  { code: '09999', name: '网易-S' },
  { code: '01810', name: '小米集团-W' },
  { code: '09618', name: '京东集团-SW' },
  { code: '00780', name: '同程旅行' },
  { code: '09888', name: '百度集团-SW' },
];

export interface StockData {
  name: string;
  code: string;
  currentPrice: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  turnover: number;
  bid: number;
  ask: number;
  kline: KLineItem[];
}

export interface SearchResultItem {
  code: string;
  name: string;
  market: string;
  type: string;
  price: string;
  ratio: string;
  exchange: string;
}

export type NotificationPeriod = 'day' | 'week' | 'month' | 'history';
export type PriceConstraint = { comparison: 'below' | 'above'; value: number };
export type NotificationCondition =
  | ({ type: 'low'; period: NotificationPeriod } & (PriceConstraint | { comparison: 'none'; value: null }))
  | ({ type: 'price'; period: null } & PriceConstraint);
export type NotificationRule = NotificationCondition & { id: string; pair: CurrencyPair; enabled: boolean };

export interface NotificationRuleStatus {
  state: 'matched' | 'unmatched' | 'unavailable';
  from?: string;
  to?: string;
  low?: number;
}

export interface NotifyArgs {
  pairCode: CurrencyPair;
  level: 'normal' | 'important' | 'urgent';
  title: string;
  body: string;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export type Locale = 'zh' | 'en' | 'ja';

