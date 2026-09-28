import https from 'node:https';
import type { KLineItem, ExchangeRateData, Period, KLinePeriod, CurrencyPair, SummaryItem, HKStockCode, StockData, SearchResultItem } from './types';
import { SUMMARY_PERIODS } from './types';

/**
 * 浏览器登录态 Cookie，供百度风控识别为正常用户（过期后仍有 TLS_OPTIONS 兜底）。
 */
const BROWSER_COOKIE =
  'BAIDUID=2CD8B83CCE0FEAA3F0C47494C3983AFD:FG=1; BIDUPSID=2CD8B83CCE0FEAA3F0C47494C3983AFD; PSTM=1774253334; BAIDUID_BFESS=2CD8B83CCE0FEAA3F0C47494C3983AFD:FG=1; ZFY=BafUbu47ZbyojWU30oaUNw4Hmyzdd9GxvCCeLzjXjcw:C; __bid_n=19d76cf476a641690759f2; BDUSS=3JmdHZVS3MzVE1UR1hGWDhhRkhVeWNGc0VYTWRQZjdVbjBLSTZwQ0VBVjdjTkJxSVFBQUFBJCQAAAAAAQAAAAEAAACMBIgoaWFtbGl6aGl5dWUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHvjqGp746hqV; BDUSS_BFESS=3JmdHZVS3MzVE1UR1hGWDhhRkhVeWNGc0VYTWRQZjdVbjBLSTZwQ0VBVjdjTkJxSVFBQUFBJCQAAAAAAQAAAAEAAACMBIgoaWFtbGl6aGl5dWUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHvjqGp746hqV; newlogin=1; BA_HECTOR=252la42l84052h2l2k0g05a025a1ag1lbjmic29; H_PS_PSSID=63147_73893_73903_73951_73976_74241_74319_74245_74336_74193_74206_74302_74553_74484_74602_74638_74669_74700_74755_74746_74787_74790_74833_74905_74926_74966_74999_75006_75094_75066_75116_75106_75122_75130_75132_75165_75149_75265_75155_75136_75310; H_WISE_SIDS=63147_73893_73903_73951_73976_74241_74319_74245_74336_74193_74206_74302_74553_74484_74602_74638_74669_74700_74755_74746_74787_74790_74833_74905_74926_74966_74999_75006_75094_75066_75116_75106_75122_75130_75132_75165_75149_75265_75155_75136_75310; ppfuid=d61763c70f82602f9262eae3f1deb2c4; ab_sr=1.0.1_YTYzMzhkNGZjMjBiMGFhM2ZjOGUzNDk4ZjRiMDcyODIxYTE4MTgwNzk0MmE3ZDhiMjJlN2YzNDNjNTdlOGYxMWVjZThkZDUzY2YxMjNmNGM1NmEwODU3NjYyODg4NjgyNWRhYTY4YzgyNDMxNmU0NzdmMjI5MDFlZTZjNWI4OGViMTk3NDdlZTVmOWQ0YjdiOWMxZTE4NDdkNDgxOTBjNg==';

/**
 * 百度风控会按 TLS ClientHello 指纹返回 HTTP 403 "hit risk"：Node/Electron 默认指纹（含 1.2KB
 * x25519mlkem768 后量子密钥共享）会被判为机器人。限定经典曲线后指纹可被接口接受。
 * 注意 Electron 主进程用的是 BoringSSL，曲线名必须同时兼容 BoringSSL（如 "P-256"），
 * 不要改成 OpenSSL 专属写法（如 "secp256r1"），否则报 "Failed to set ECDH curve"。
 */
const TLS_OPTIONS = { ecdhCurve: 'X25519:P-256' };

const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://gushitong.baidu.com/',
  Origin: 'https://gushitong.baidu.com',
  Accept: 'application/json, text/plain, */*',
  'Accept-Encoding': 'identity',
  Connection: 'keep-alive',
  Cookie: BROWSER_COOKIE,
};

const BASE_URL = 'https://finance.pae.baidu.com/vapi/v1/getquotation';

// ---------- helpers ----------

function buildUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${BASE_URL}?${qs}`;
}

/** Use Node.js https module to avoid Electron's Chromium-based fetch (which triggers 403) */
function fetchJSON(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: REQUEST_HEADERS,
      ...TLS_OPTIONS,
    };
    const req = https.request(options, (res) => {
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(text));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });
    const timeout = setTimeout(() => {
      const error = new Error('Market data request timed out');
      req.destroy(error);
      reject(error);
    }, 15_000);
    req.on('close', () => clearTimeout(timeout));
    req.on('error', reject);
    req.end();
  });
}

function findPankouValue(
  list: { ename: string; value: string }[],
  ename: string,
): number {
  const item = list.find((i) => i.ename === ename);
  return item ? parseFloat(item.value) : NaN;
}

/**
 * 盘口的成交量/成交额是带单位的字符串（"497.04万股"、"5697万"、"26.87亿"），
 * 而 K 线接口返回原始数值，这里统一换算成原始单位（股 / 元）。
 */
function findPankouScaled(
  list: { ename: string; value: string }[],
  ...enames: string[]
): number {
  for (const ename of enames) {
    const item = list.find((i) => i.ename === ename);
    if (!item) continue;
    const value = parseFloat(item.value);
    if (isNaN(value)) continue;
    if (item.value.includes('万亿')) return value * 1e12;
    if (item.value.includes('亿')) return value * 1e8;
    if (item.value.includes('万')) return value * 1e4;
    return value;
  }
  return NaN;
}

function computeBidAsk(
  currentRate: number,
  pankou?: { ename: string; value: string }[],
): { bid: number; ask: number } {
  if (pankou) {
    for (const bidName of ['bid', 'buy', 'bidPrice', 'buyPrice']) {
      const v = findPankouValue(pankou, bidName);
      if (!isNaN(v)) {
        for (const askName of ['ask', 'sell', 'askPrice', 'sellPrice']) {
          const a = findPankouValue(pankou, askName);
          if (!isNaN(a)) return { bid: v, ask: a };
        }
      }
    }
  }
  const offset = currentRate * 0.0001;
  return {
    bid: parseFloat((currentRate - offset).toFixed(currentRate < 1 ? 5 : 4)),
    ask: parseFloat((currentRate + offset).toFixed(currentRate < 1 ? 5 : 4)),
  };
}

// ---------- minute (intraday) ----------

interface MinuteAPIResult {
  pankouinfos: { list: { ename: string; name: string; value: string; status: string }[] };
  basicinfos: { code: string; name: string };
  cur: { price: string; ratio: string; increase: string };
  newMarketData: {
    keys: string[];
    marketData: { date: string; p: string }[];
  };
}

function parseMinuteData(raw: MinuteAPIResult): ExchangeRateData {
  const pankou = raw.pankouinfos.list;
  const open = findPankouValue(pankou, 'open');
  const high = findPankouValue(pankou, 'high');
  const low = findPankouValue(pankou, 'low');
  const prevClose = findPankouValue(pankou, 'preClose');

  const currentRate = parseFloat(raw.cur.price);
  const change = parseFloat(raw.cur.increase);
  const changePercent = parseFloat(raw.cur.ratio.replace('%', '').replace('+', ''));

  // parse minute-by-minute data → KLineItem[]
  // Each p string: "timestamp,time,price,ratio,range;..."
  const kline: KLineItem[] = [];
  const md = raw.newMarketData.marketData;
  for (const segment of md) {
    const rows = segment.p.split(';');
    for (const row of rows) {
      if (!row) continue;
      const parts = row.split(',');
      // parts: [timestamp, time, price, ratio, range]
      if (parts.length < 3) continue;
      const time = parts[1]; // "06-08 05:00"
      const price = parseFloat(parts[2]);
      if (isNaN(price)) continue;
      // parts[3] = ratio (涨跌幅 %)，parts[4] = range (涨跌额)
      const pct = parts[3] !== undefined ? parseFloat(parts[3].replace('%', '').replace('+', '')) : NaN;
      const chg = parts[4] !== undefined ? parseFloat(parts[4]) : NaN;
      const rawTimestamp = Number(parts[0]);
      const timestamp = rawTimestamp < 1e12 ? rawTimestamp * 1000 : rawTimestamp;
      // treat each minute point as a tick: open=close=high=low=price
      kline.push({
        date: time,
        timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined,
        open: price,
        close: price,
        high: price,
        low: price,
        change: isNaN(chg) ? undefined : chg,
        changePercent: isNaN(pct) ? undefined : pct,
      });
    }
  }

  const { bid, ask } = computeBidAsk(currentRate, pankou);

  return {
    name: raw.basicinfos.name,
    currentRate,
    change,
    changePercent,
    open,
    high,
    low,
    prevClose,
    bid,
    ask,
    kline,
  };
}

// ---------- K-line (day/week/month) ----------

interface KLineNewMarketData {
  keys: string[];
  marketData: string;
}

interface KLineAPIResult {
  basicinfos?: { code: string; name: string };
  newMarketData: KLineNewMarketData;
}

/** Parse kline marketData string: semicolon-separated rows of "timestamp,date,open,close,high,low,..." */
function parseKLineMarketData(marketDataStr: string): KLineItem[] {
  const kline: KLineItem[] = [];
  const rows = marketDataStr.split(';');
  for (const row of rows) {
    if (!row) continue;
    const parts = row.split(',');
    // parts: [timestamp, date, open, close, high, low, range, ratio, ma5, ma10, ma20]
    if (parts.length < 6) continue;
    const date = parts[1];
    const o = parseFloat(parts[2]);
    const c = parseFloat(parts[3]);
    const h = parseFloat(parts[4]);
    const l = parseFloat(parts[5]);
    if (isNaN(o) || isNaN(c)) continue;
    kline.push({ date, open: o, close: c, high: h, low: l });
  }
  return kline;
}

function buildKLineResult(raw: KLineAPIResult): ExchangeRateData {
  const kline = parseKLineMarketData(raw.newMarketData.marketData);

  if (kline.length === 0) throw new Error('No kline data');

  const latest = kline[kline.length - 1];
  const prev = kline.length > 1 ? kline[kline.length - 2] : latest;
  const currentRate = latest.close;
  const prevClose = prev.close;
  const change = currentRate - prevClose;
  const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

  let high = -Infinity;
  let low = Infinity;
  for (const item of kline) {
    if (item.high > high) high = item.high;
    if (item.low < low) low = item.low;
  }

  const { bid, ask } = computeBidAsk(currentRate);

  return {
    name: raw.basicinfos?.name ?? '',
    currentRate,
    change,
    changePercent,
    open: latest.open,
    high,
    low,
    prevClose,
    bid,
    ask,
    kline,
  };
}

// ---------- Period → API mapping ----------

/** Map Period to the kline API ktype value */
const PERIOD_KTYPE: Record<KLinePeriod, string> = {
  'dailyK': 'day',
  'weeklyK': 'week',
  'monthlyK': 'month',
  'quarterlyK': 'quarter',
  'yearlyK': 'year',
  '1min': 'min1',
  '5min': 'min5',
  '15min': 'min15',
  '30min': 'min30',
  '60min': 'min60',
};

// ---------- public API ----------

export async function getExchangeRateData(
  pairCode: CurrencyPair,
  period: Period,
): Promise<ExchangeRateData> {
  try {
    if (period === 'fenShi') {
      const url = buildUrl({
        code: pairCode,
        group: 'huilv_minute',
        need_reverse_real: '1',
      });
      const json = (await fetchJSON(url)) as { ResultCode: number; Result: MinuteAPIResult };
      if (json.ResultCode !== 0) throw new Error('API error');
      return parseMinuteData(json.Result);
    }

    const ktype = period === 'fiveDay' ? undefined : PERIOD_KTYPE[period];
    if (!ktype) throw new Error(`Unsupported period: ${period}`);
    const url = buildUrl({
      code: pairCode,
      group: 'huilv_kline',
      ktype,
    });
    const json = (await fetchJSON(url)) as { ResultCode: number; Result: KLineAPIResult };
    if (json.ResultCode !== 0) throw new Error('API error');
    return buildKLineResult(json.Result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[exchangeRateService] Failed to fetch ${pairCode} ${period}:`, err);
    throw new Error(`获取 ${pairCode} 汇率数据失败: ${message}`);
  }
}

export async function getRateSummary(
  pairCode: CurrencyPair,
): Promise<SummaryItem[]> {
  try {
    const url = buildUrl({
      code: pairCode,
      group: 'huilv_kline',
      ktype: 'day',
    });
    const json = (await fetchJSON(url)) as { ResultCode: number; Result: KLineAPIResult };
    if (json.ResultCode !== 0 || !json.Result?.newMarketData) throw new Error('API error');

    // Parse newMarketData.marketData string format: "timestamp,date,open,close,high,low,...;..."
    const kline = parseKLineMarketData(json.Result.newMarketData.marketData);
    const items = kline.map((d) => ({
      date: d.date,
      high: d.high,
      low: d.low,
    }));

    // 按日期升序排序
    items.sort((a, b) => a.date.localeCompare(b.date));

    // 按日历天数过滤各周期数据
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    return SUMMARY_PERIODS.map(({ label, days }) => {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;

      const slice = items.filter((item) => item.date >= cutoffStr && item.date <= todayStr);
      if (slice.length === 0) return { label, high: NaN, low: NaN };

      let high = -Infinity;
      let low = Infinity;
      for (const item of slice) {
        if (item.high > high) high = item.high;
        if (item.low < low) low = item.low;
      }
      return { label, high, low };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[exchangeRateService] Failed to fetch summary for ${pairCode}:`, err);
    throw new Error(`获取汇率汇总数据失败: ${message}`);
  }
}

// ---------- HK Stock (港股) ----------

interface HKStockPankouItem {
  ename: string;
  name: string;
  value: string;
  status?: string;
}

interface HKStockMinuteResult {
  pankouinfos?: { list: HKStockPankouItem[] };
  basicinfos?: { code: string; name: string };
  cur?: { price: string; ratio: string; increase: string };
  chartlist?: { time: string; price: string; avgprice?: string; volume?: string }[];
  newMarketData?: {
    keys: string[];
    marketData: { date: string; p: string }[];
  };
}

function parseHKStockMinute(raw: HKStockMinuteResult, stockCode: string): StockData {
  const pankou = raw.pankouinfos?.list ?? [];
  const open = findPankouValue(pankou, 'open');
  const high = findPankouValue(pankou, 'high');
  const low = findPankouValue(pankou, 'low');
  const prevClose = findPankouValue(pankou, 'preClose');
  const volume = findPankouScaled(pankou, 'volume');
  const turnover = findPankouScaled(pankou, 'amount', 'turnover');

  const currentPrice = parseFloat(raw.cur?.price ?? '0');
  const change = parseFloat(raw.cur?.increase ?? '0');
  const changePercent = parseFloat((raw.cur?.ratio ?? '0').replace('%', '').replace('+', ''));

  const kline: KLineItem[] = [];

  if (raw.chartlist && raw.chartlist.length > 0) {
    for (const item of raw.chartlist) {
      const price = parseFloat(item.price);
      if (isNaN(price)) continue;
      kline.push({
        date: item.time,
        open: price,
        close: price,
        high: price,
        low: price,
      });
    }
  } else if (raw.newMarketData) {
    for (const segment of raw.newMarketData.marketData) {
      const rows = segment.p.split(';');
      for (const row of rows) {
        if (!row) continue;
        const parts = row.split(',');
        if (parts.length < 3) continue;
        const time = parts[1];
        const price = parseFloat(parts[2]);
        if (isNaN(price)) continue;
        kline.push({
          date: time,
          open: price,
          close: price,
          high: price,
          low: price,
        });
      }
    }
  }

  const { bid, ask } = computeBidAsk(currentPrice, pankou);

  return {
    name: raw.basicinfos?.name ?? stockCode,
    code: raw.basicinfos?.code ?? stockCode,
    currentPrice,
    change,
    changePercent,
    open,
    high,
    low,
    prevClose,
    volume,
    turnover,
    bid,
    ask,
    kline,
  };
}

export async function getHKStockMinuteData(stockCode: HKStockCode): Promise<StockData> {
  try {
    const url = buildUrl({
      all: '1',
      code: stockCode,
      query: stockCode,
      eprop: 'min',
      financeType: 'stock',
      group: 'quotation_minute_hk',
      stock_type: 'hk',
      chartType: 'minute',
    });
    const json = (await fetchJSON(url)) as { ResultCode: number; Result: HKStockMinuteResult };
    if (json.ResultCode !== 0) throw new Error(`API error: ResultCode=${json.ResultCode}`);
    console.log('[exchangeRateService] HK stock response keys:', Object.keys(json.Result));
    return parseHKStockMinute(json.Result, stockCode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[exchangeRateService] Failed to fetch HK stock ${stockCode}:`, err);
    throw new Error(`获取港股 ${stockCode} 数据失败: ${message}`);
  }
}

interface HKStockFiveDayResult {
  newMarketData?: { keys: string[]; marketData: { date: string; p: string }[] };
}

interface HKFiveDayQuote {
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
}

/**
 * 五日接口按交易日分段返回分时点，keys 为
 * timestamp,time,price,avgPrice,range,ratio,volume,amount,totalVolume,totalAmount。
 * 注意 range/ratio 是相对整个五日窗口之前那个交易日收盘的累计涨跌（五日内同一基准），
 * 不是当日涨跌，所以昨收优先取上一段的收盘价。
 */
function parseHKStockFiveDay(newMarketData: {
  keys: string[];
  marketData: { date: string; p: string }[];
}): { kline: KLineItem[]; today: HKFiveDayQuote } {
  const col = new Map(newMarketData.keys.map((key, index) => [key, index]));
  const timeIndex = col.get('time') ?? 1;
  const priceIndex = col.get('price') ?? 2;

  const days = newMarketData.marketData.map((segment) => {
    const points: { date: string; price: number; range: number; volume: number; turnover: number }[] = [];
    for (const row of segment.p.split(';')) {
      if (!row) continue;
      const parts = row.split(',');
      const price = parseFloat(parts[priceIndex]);
      if (isNaN(price)) continue;
      const numOr = (key: string, fallback: number): number => {
        const index = col.get(key);
        const value = index === undefined ? NaN : parseFloat(parts[index]);
        return isNaN(value) ? fallback : value;
      };
      points.push({
        date: parts[timeIndex],
        price,
        range: numOr('range', 0),
        volume: numOr('totalVolume', 0),
        turnover: numOr('totalAmount', 0),
      });
    }
    return points;
  });

  const kline: KLineItem[] = days.flatMap((points) =>
    points.map((p) => ({ date: p.date, open: p.price, close: p.price, high: p.price, low: p.price })),
  );

  const lastDay = days[days.length - 1] ?? [];
  const prevDay = days[days.length - 2] ?? [];
  const last = lastDay[lastDay.length - 1];
  const prevDayClose = prevDay.length > 0 ? prevDay[prevDay.length - 1].price : NaN;
  const today: HKFiveDayQuote = last
    ? {
        price: last.price,
        // 只返回一天时，接口 range 的基准就是该日的昨收
        prevClose: isNaN(prevDayClose) ? last.price - last.range : prevDayClose,
        open: lastDay[0].price,
        high: Math.max(...lastDay.map((p) => p.price)),
        low: Math.min(...lastDay.map((p) => p.price)),
        volume: last.volume,
        turnover: last.turnover,
      }
    : { price: NaN, prevClose: NaN, open: NaN, high: NaN, low: NaN, volume: 0, turnover: 0 };

  return { kline, today };
}

export async function getHKStockFiveDayData(stockCode: HKStockCode): Promise<StockData> {
  try {
    const url = buildUrl({
      all: '1',
      srcid: '5353',
      pointType: 'string',
      group: 'quotation_fiveday_hk',
      market_type: 'hk',
      new_Format: '1',
      finClientType: 'pc',
      query: stockCode,
      code: stockCode,
      financeType: 'stock',
    });
    const json = (await fetchJSON(url)) as { ResultCode: number; Result: HKStockFiveDayResult };
    if (json.ResultCode !== 0 || !json.Result?.newMarketData) {
      throw new Error(`API error: ResultCode=${json.ResultCode}`);
    }
    const { kline, today } = parseHKStockFiveDay(json.Result.newMarketData);
    if (kline.length === 0 || isNaN(today.price)) throw new Error('No fiveday data');

    const change = today.price - today.prevClose;
    const changePercent = today.prevClose !== 0 ? (change / today.prevClose) * 100 : 0;
    const { bid, ask } = computeBidAsk(today.price);
    return {
      name: '',
      code: stockCode,
      currentPrice: today.price,
      change,
      changePercent,
      open: today.open,
      high: today.high,
      low: today.low,
      prevClose: today.prevClose,
      volume: today.volume,
      turnover: today.turnover,
      bid,
      ask,
      kline,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[exchangeRateService] Failed to fetch HK stock ${stockCode} fiveDay:`, err);
    throw new Error(`获取港股 ${stockCode} 五日数据失败: ${message}`);
  }
}

interface HKStockKLineResult {
  basicinfos?: { code: string; name: string };
  newMarketData: { keys: string[]; marketData: string };
}

interface HKStockBar extends KLineItem {
  volume: number;
  turnover: number;
  prevClose: number;
}

/**
 * 港股 K 线的列顺序是 timestamp,time,open,close,volume,high,low,amount,range,ratio,
 * turnoverratio,preClose,...，与外汇 K 线不同，所以按响应里的 keys 定位列而不是用固定下标。
 */
function parseHKStockKLine(newMarketData: { keys: string[]; marketData: string }): HKStockBar[] {
  const col = new Map(newMarketData.keys.map((key, index) => [key, index]));
  const num = (parts: string[], key: string): number => {
    const index = col.get(key);
    return index === undefined ? NaN : parseFloat(parts[index]);
  };
  const numOr = (parts: string[], key: string, fallback: number): number => {
    const value = num(parts, key);
    return isNaN(value) ? fallback : value;
  };
  const timeIndex = col.get('time') ?? 1;

  const bars: HKStockBar[] = [];
  for (const row of newMarketData.marketData.split(';')) {
    if (!row) continue;
    const parts = row.split(',');
    const date = parts[timeIndex];
    const open = num(parts, 'open');
    const close = num(parts, 'close');
    if (!date || isNaN(open) || isNaN(close)) continue;
    const change = num(parts, 'range');
    const changePercent = num(parts, 'ratio');
    bars.push({
      date,
      open,
      close,
      high: num(parts, 'high'),
      low: num(parts, 'low'),
      change: isNaN(change) ? undefined : change,
      changePercent: isNaN(changePercent) ? undefined : changePercent,
      volume: numOr(parts, 'volume', 0),
      turnover: numOr(parts, 'amount', 0),
      prevClose: num(parts, 'preClose'),
    });
  }
  return bars;
}

async function fetchHKStockKLine(
  stockCode: HKStockCode,
  ktype: string,
): Promise<{ name: string; bars: HKStockBar[] }> {
  const url = buildUrl({
    all: '1',
    code: stockCode,
    query: stockCode,
    eprop: ktype,
    financeType: 'stock',
    group: 'quotation_kline_hk',
    stock_type: 'hk',
    ktype,
  });
  const json = (await fetchJSON(url)) as { ResultCode: number; Result: HKStockKLineResult };
  if (json.ResultCode !== 0 || !json.Result?.newMarketData) {
    throw new Error(`API error: ResultCode=${json.ResultCode}`);
  }
  return {
    name: json.Result.basicinfos?.name ?? '',
    bars: parseHKStockKLine(json.Result.newMarketData),
  };
}

export async function getHKStockKLineData(
  stockCode: HKStockCode,
  period: KLinePeriod,
): Promise<StockData> {
  const ktype = PERIOD_KTYPE[period];
  if (!ktype) throw new Error(`Unsupported period: ${period}`);
  try {
    const { name, bars } = await fetchHKStockKLine(stockCode, ktype);
    if (bars.length === 0) throw new Error('No kline data');

    const latest = bars[bars.length - 1];
    const prev = bars.length > 1 ? bars[bars.length - 2] : latest;
    const currentPrice = latest.close;
    const prevClose = isNaN(latest.prevClose) ? prev.close : latest.prevClose;
    const change = latest.change ?? currentPrice - prevClose;
    const changePercent = latest.changePercent ?? (prevClose !== 0 ? (change / prevClose) * 100 : 0);
    const { bid, ask } = computeBidAsk(currentPrice);

    return {
      name,
      code: stockCode,
      currentPrice,
      change,
      changePercent,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      prevClose,
      volume: latest.volume,
      turnover: latest.turnover,
      bid,
      ask,
      kline: bars,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[exchangeRateService] Failed to fetch HK stock ${stockCode} ${period}:`, err);
    throw new Error(`获取港股 ${stockCode} ${period} K线数据失败: ${message}`);
  }
}

export async function getHKStockSummary(stockCode: HKStockCode): Promise<SummaryItem[]> {
  try {
    const { bars } = await fetchHKStockKLine(stockCode, 'day');
    const items = bars.map((d) => ({ date: d.date, high: d.high, low: d.low }));
    items.sort((a, b) => a.date.localeCompare(b.date));

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    return SUMMARY_PERIODS.map(({ label, days }) => {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;

      const slice = items.filter((item) => item.date >= cutoffStr && item.date <= todayStr);
      if (slice.length === 0) return { label, high: NaN, low: NaN };

      let high = -Infinity;
      let low = Infinity;
      for (const item of slice) {
        if (item.high > high) high = item.high;
        if (item.low < low) low = item.low;
      }
      return { label, high, low };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[exchangeRateService] Failed to fetch HK stock summary for ${stockCode}:`, err);
    throw new Error(`获取港股 ${stockCode} 汇总数据失败: ${message}`);
  }
}

// ---------- 搜索 (Suggest API) ----------

const SUG_URL = 'https://finance.pae.baidu.com/vapi/v1/sug';

interface SugAPIResult {
  list: {
    code: string;
    name: string;
    market: string;
    type: string;
    price: string;
    ratio: string;
    exchange: string;
  }[];
}

export async function search(query: string): Promise<SearchResultItem[]> {
  if (!query.trim()) return [];
  try {
    const url = `${SUG_URL}?${new URLSearchParams({ wd: query }).toString()}`;
    const json = (await fetchJSON(url)) as { ResultCode: number; Result: SugAPIResult };
    if (json.ResultCode !== 0 || !json.Result?.list) throw new Error('API error');
    return json.Result.list.map((item) => ({
      code: item.code,
      name: item.name,
      market: item.market,
      type: item.type,
      price: item.price,
      ratio: item.ratio,
      exchange: item.exchange,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[exchangeRateService] Failed to search "${query}":`, err);
    throw new Error(`搜索 "${query}" 失败: ${message}`);
  }
}


