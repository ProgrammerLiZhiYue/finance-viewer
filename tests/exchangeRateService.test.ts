import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getExchangeRateData, getHKStockFiveDayData } from '../src/exchangeRateService';

const stub = vi.hoisted(() => ({
  status: 200,
  body: '',
  path: '',
  hang: false,
  destroyed: false,
  requestOptions: {} as Record<string, unknown>,
}));

vi.mock('node:https', () => {
  type Handler = (...args: unknown[]) => void;
  interface FakeResponse {
    statusCode: number;
    resume: () => void;
    on: (event: string, handler: Handler) => void;
  }
  return {
    default: {
      request: (options: unknown, callback: (res: FakeResponse) => void) => {
        stub.requestOptions = (options ?? {}) as Record<string, unknown>;
        stub.path = String((options as { path?: string }).path ?? '');
        const handlers = new Map<string, Handler>();
        return {
          on: (event: string, handler: Handler) => { handlers.set(event, handler); },
          destroy: (error: Error) => { stub.destroyed = true; handlers.get('error')?.(error); handlers.get('close')?.(); },
          end: () => {
            if (stub.hang) return;
            callback({
              statusCode: stub.status,
              resume: () => {},
              on: (event, handler) => {
                if (event === 'data') handler(Buffer.from(stub.body));
                else if (event === 'end') handler();
              },
            });
            handlers.get('close')?.();
          },
        };
      },
    },
  };
});

const FIVEDAY_KEYS = [
  'timestamp', 'time', 'price', 'avgPrice', 'range', 'ratio',
  'volume', 'amount', 'totalVolume', 'totalAmount',
];

/** range 是相对五日窗口之前那个交易日收盘的累计涨跌，五日内共用同一基准 */
function point(time: string, price: number, range: number, totalVolume: number, totalAmount: number): string {
  return [
    '1788831000', time, price.toFixed(3), price.toFixed(3), range.toFixed(2),
    '0.00', '0', '0', String(totalVolume), String(totalAmount),
  ].join(',');
}

function fivedayPayload(days: { date: string; points: string[] }[]): string {
  return JSON.stringify({
    ResultCode: 0,
    Result: {
      newMarketData: {
        keys: FIVEDAY_KEYS,
        marketData: days.map((d) => ({ date: d.date, p: d.points.join(';') })),
      },
    },
  });
}

describe('getHKStockFiveDayData', () => {
  beforeEach(() => {
    stub.status = 200;
    stub.body = '';
    stub.path = '';
  });

  it('flattens every trading day into one point list', async () => {
    stub.body = fivedayPayload([
      {
        date: '2026-09-07',
        points: [point('09-07 09:31', 11.64, -0.14, 6518494, 78086833), point('09-07 15:24', 11.42, -0.36, 7000000, 80000000)],
      },
      {
        date: '2026-09-08',
        points: [point('09-08 09:30', 11.42, -0.36, 20400, 232968), point('09-08 15:24', 11.49, -0.29, 5859165, 67148013)],
      },
    ]);

    const d = await getHKStockFiveDayData('00780');

    expect(stub.path).toContain('group=quotation_fiveday_hk');
    expect(stub.path).toContain('code=00780');
    expect(d.kline.map((k) => k.date)).toEqual(['09-07 09:31', '09-07 15:24', '09-08 09:30', '09-08 15:24']);
    expect(d.kline[0]).toMatchObject({ open: 11.64, close: 11.64, high: 11.64, low: 11.64 });
    // 接口不返回名称，由调用方回退到已知股票名
    expect(d.name).toBe('');
    expect(d.code).toBe('00780');
  });

  it('reports the current day quote against the previous trading day close', async () => {
    stub.body = fivedayPayload([
      {
        date: '2026-09-07',
        points: [point('09-07 09:31', 11.64, -0.14, 100, 1000), point('09-07 15:24', 11.42, -0.36, 500, 5000)],
      },
      {
        date: '2026-09-08',
        points: [
          point('09-08 09:30', 11.42, -0.36, 20400, 232968),
          point('09-08 12:00', 11.52, -0.26, 3000000, 34000000),
          point('09-08 15:24', 11.49, -0.29, 5859165, 67148013),
        ],
      },
    ]);

    const d = await getHKStockFiveDayData('00780');

    expect(d.currentPrice).toBe(11.49);
    // 昨收取上一段收盘 11.42，而不是接口 range 的基准 11.78
    expect(d.prevClose).toBe(11.42);
    expect(d.change).toBeCloseTo(0.07, 10);
    expect(d.changePercent).toBeCloseTo(0.613, 3);
    expect(d.open).toBe(11.42);
    expect(d.high).toBe(11.52);
    expect(d.low).toBe(11.42);
    expect(d.volume).toBe(5859165);
    expect(d.turnover).toBe(67148013);
  });

  it('falls back to the API baseline when only one day is returned', async () => {
    stub.body = fivedayPayload([
      { date: '2026-09-08', points: [point('09-08 09:30', 11.42, -0.36, 20400, 232968)] },
    ]);

    const d = await getHKStockFiveDayData('00780');

    expect(d.prevClose).toBeCloseTo(11.78, 10);
    expect(d.change).toBeCloseTo(-0.36, 10);
    expect(d.changePercent).toBeCloseTo(-3.056, 3);
  });

  it('throws when the response has no points', async () => {
    stub.body = fivedayPayload([]);
    await expect(getHKStockFiveDayData('00780')).rejects.toThrow('获取港股 00780 五日数据失败');
  });

  it('wraps the anti-bot 403 into a readable error', async () => {
    stub.status = 403;
    stub.body = JSON.stringify({ ResultCode: 0, Result: { code: 403, isCaptchaEnabled: true, msg: 'hit risk' } });
    await expect(getHKStockFiveDayData('00780')).rejects.toThrow('获取港股 00780 五日数据失败: HTTP 403');
  });
});

describe('百度风控规避', () => {
  beforeEach(() => {
    stub.status = 200;
    stub.hang = false;
    stub.body = JSON.stringify({ ResultCode: 0, Result: { newMarketData: { keys: [], marketData: '1,2026-09-25,7,7,8,6' } } });
  });

  it('sends the browser cookie and a classic-curve TLS fingerprint', async () => {
    await getExchangeRateData('USDCNY', 'dailyK');

    const headers = stub.requestOptions.headers as Record<string, string>;
    expect(headers.Cookie).toContain('BAIDUID=');
    expect(headers.Cookie).toContain('BDUSS=');
    // Node 默认的 TLS 指纹（含后量子密钥共享）会被百度风控 403，必须使用经典曲线；
    // 名称需兼容 Electron 的 BoringSSL（"P-256"），OpenSSL 专属名会抛 "Failed to set ECDH curve"
    expect(stub.requestOptions.ecdhCurve).toBe('X25519:P-256');
  });
});

describe('exchange rate notification data', () => {
  beforeEach(() => { stub.status = 200; stub.hang = false; stub.destroyed = false; });
  afterEach(() => { stub.hang = false; vi.useRealTimers(); vi.restoreAllMocks(); });

  it('preserves actual seconds/milliseconds timestamps without inventing invalid timestamps', async () => {
    stub.body = JSON.stringify({ ResultCode: 0, Result: {
      pankouinfos: { list: [] }, basicinfos: { code: 'USDCNY', name: 'USD/CNY' },
      cur: { price: '7', ratio: '0%', increase: '0' },
      newMarketData: { keys: [], marketData: [{ date: '2026-09-25', p: [
        '1790294400,09-25 08:00,7,0,0', '1790294460000,09-25 08:01,7,0,0',
        'bad,09-25 08:02,7,0,0', ',09-25 08:03,7,0,0',
      ].join(';') }] },
    } });
    const data = await getExchangeRateData('USDCNY', 'fenShi');
    expect(data.kline.map(point => point.timestamp)).toEqual([1790294400000, 1790294460000, undefined, undefined]);
    expect(data.kline[0].date).toBe('09-25 08:00');
  });

  it('bounds a stalled request and allows a subsequent request', async () => {
    vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {});
    stub.hang = true;
    const pending = getExchangeRateData('USDCNY', 'fenShi');
    const rejected = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15000); await rejected;
    expect(stub.destroyed).toBe(true);
    stub.hang = false;
    stub.body = JSON.stringify({ ResultCode: 0, Result: { newMarketData: { keys: [], marketData: '1,2026-09-25,7,7,8,6' } } });
    expect((await getExchangeRateData('USDCNY', 'dailyK')).kline[0].low).toBe(6);
    expect(vi.getTimerCount()).toBe(0);
  });
});
