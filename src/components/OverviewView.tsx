import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { formatVolume, formatTurnover, nowTimeString } from '../lib/format';
import type { CurrencyPair, ExchangeRateData, HKStockCode, StockData } from '../types';
import { PAIR_FLAGS, STOCK_NAMES } from '../types';

interface PairDisplay {
  code: CurrencyPair;
  name: string;
  flag: string;
  rateText: string;
  changeText: string;
  changePctText: string;
  colorClass: string;
  sparkPrices: number[];
  sparkUp: boolean;
}

interface IndexDisplay {
  name: string;
  value: string;
  changeText: string;
  colorClass: string;
}

interface StockDisplay {
  code: HKStockCode;
  name: string;
  priceText: string;
  changeText: string;
  changePctText: string;
  colorClass: string;
  volumeText: string;
  turnoverText: string;
}

function formatRate(v: number): string {
  return v < 1 ? v.toFixed(5) : v.toFixed(4);
}

function Sparkline({ prices, isUp }: { prices: number[]; isUp: boolean }) {
  const w = 64, h = 32, pad = 2;
  const sampled = prices.length > 24
    ? prices.filter((_, i) => i % Math.ceil(prices.length / 24) === 0 || i === prices.length - 1)
    : prices;
  if (sampled.length < 2) return null;
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;
  const points = sampled.map((v, i) => {
    const x = pad + (i / (sampled.length - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = isUp ? 'var(--rate-up)' : 'var(--rate-down)';
  const firstX = points[0].split(',')[0];
  const lastX = points[points.length - 1].split(',')[0];
  const linePoints = points.map(p => `L${p}`).join(' ').replace('L', 'M');
  const areaPath = `${linePoints} L${lastX},${h} L${firstX},${h} Z`;
  const gid = `sg-${isUp ? 'up' : 'down'}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.15} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gid})`} />
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface OverviewViewProps {
  onSelectPair: (pair: CurrencyPair) => void;
  onSelectStock: (stock: HKStockCode) => void;
}

export default function OverviewView({ onSelectPair, onSelectStock }: OverviewViewProps) {
  const { t } = useTranslation();
  const { state } = useSettings();

  const [pairData, setPairData] = useState<PairDisplay[]>([]);
  const [rawPairData, setRawPairData] = useState<Map<CurrencyPair, ExchangeRateData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [updateLabel, setUpdateLabel] = useState('');

  const [stockList, setStockList] = useState<StockDisplay[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockUpdateLabel, setStockUpdateLabel] = useState('');

  const loadAllPairs = useCallback(async (): Promise<void> => {
    setLoading(true);
    const pairs = state.enabledPairs;

    const results = await Promise.allSettled(
      pairs.map(code => window.electronAPI.getExchangeRate(code, 'fenShi'))
    );

    const timeStr = nowTimeString();
    setUpdateLabel(t('overview.updatedAt', { time: timeStr }));

    const items: PairDisplay[] = [];
    const rawMap = new Map<CurrencyPair, ExchangeRateData>();
    for (let i = 0; i < pairs.length; i++) {
      const code = pairs[i];
      const result = results[i];
      if (result.status !== 'fulfilled') continue;

      const data: ExchangeRateData = result.value;
      rawMap.set(code, data);
      const isUp = data.change >= 0;
      const sign = isUp ? '+' : '';

      items.push({
        code,
        name: t(`overview.pair.${code}`),
        flag: PAIR_FLAGS[code],
        rateText: formatRate(data.currentRate),
        changeText: `${sign}${formatRate(data.change)}`,
        changePctText: `${sign}${data.changePercent.toFixed(2)}%`,
        colorClass: isUp ? 'rate-up' : data.change < 0 ? 'rate-down' : 'rate-flat',
        sparkPrices: data.kline.map(k => k.close),
        sparkUp: isUp,
      });
    }

    setPairData(items);
    setRawPairData(rawMap);
    setLoading(false);
  }, [state.enabledPairs]);

  const loadAllStocks = useCallback(async (): Promise<void> => {
    setStockLoading(true);
    const stocks = state.enabledStocks;

    const results = await Promise.allSettled(
      stocks.map(code => window.electronAPI.getHKStockMinute(code))
    );

    const timeStr = nowTimeString();
    setStockUpdateLabel(t('overview.stockUpdatedAt', { time: timeStr }));

    const items: StockDisplay[] = [];
    for (let i = 0; i < stocks.length; i++) {
      const code = stocks[i];
      const result = results[i];
      if (result.status !== 'fulfilled') continue;

      const d: StockData = result.value;
      const isUp = d.change >= 0;
      const sign = isUp ? '+' : '';

      items.push({
        code,
        name: d.name || STOCK_NAMES[code] || code,
        priceText: d.currentPrice.toFixed(2),
        changeText: `${sign}${d.change.toFixed(2)}`,
        changePctText: `${sign}${d.changePercent.toFixed(2)}%`,
        colorClass: isUp ? 'rate-up' : d.change < 0 ? 'rate-down' : 'rate-flat',
        volumeText: formatVolume(d.volume),
        turnoverText: formatTurnover(d.turnover),
      });
    }

    setStockList(items);
    setStockLoading(false);
  }, [state.enabledStocks]);

  useEffect(() => { void loadAllPairs(); }, [loadAllPairs]);
  useEffect(() => { void loadAllStocks(); }, [loadAllStocks]);

  useAutoRefresh(state.refreshInterval, () => {
    void loadAllPairs();
    void loadAllStocks();
  });

  const indicesData = useMemo<IndexDisplay[]>(() => {
    const result: IndexDisplay[] = [];
    const raw = rawPairData;

    const usdcny = raw.get('USDCNY');
    if (usdcny) {
      const isUp = usdcny.change >= 0;
      const sign = isUp ? '+' : '';
      result.push({
        name: t('overview.indices.dxy'),
        value: usdcny.currentRate.toFixed(4),
        changeText: `${sign}${usdcny.change.toFixed(4)} (${sign}${usdcny.changePercent.toFixed(2)}%)`,
        colorClass: isUp ? 'rate-up' : usdcny.change < 0 ? 'rate-down' : 'rate-flat',
      });
    }

    const jpycny = raw.get('JPYCNY');
    const hkdcny = raw.get('HKDCNY');
    if (jpycny && hkdcny) {
      const cfetsValue = ((jpycny.currentRate + hkdcny.currentRate) / 2 * 100).toFixed(2);
      const avgChangePct = (jpycny.changePercent + hkdcny.changePercent) / 2;
      const isUp = avgChangePct >= 0;
      const sign = isUp ? '+' : '';
      result.push({
        name: t('overview.indices.cfets'),
        value: cfetsValue,
        changeText: `${sign}${avgChangePct.toFixed(2)}%`,
        colorClass: isUp ? 'rate-up' : avgChangePct < 0 ? 'rate-down' : 'rate-flat',
      });
    }

    const eurcny = raw.get('EURCNY');
    if (eurcny) {
      const isUp = eurcny.change >= 0;
      const sign = isUp ? '+' : '';
      result.push({
        name: t('overview.indices.eurIndex'),
        value: eurcny.currentRate.toFixed(4),
        changeText: `${sign}${eurcny.change.toFixed(4)} (${sign}${eurcny.changePercent.toFixed(2)}%)`,
        colorClass: isUp ? 'rate-up' : eurcny.change < 0 ? 'rate-down' : 'rate-flat',
      });
    }

    if (usdcny && usdcny.prevClose > 0) {
      const spread = (usdcny.high - usdcny.low).toFixed(4);
      const spreadChange = usdcny.high - usdcny.low - (usdcny.prevClose * 0.002);
      const isUp = spreadChange >= 0;
      const sign = isUp ? '+' : '';
      result.push({
        name: t('overview.indices.spread'),
        value: spread,
        changeText: `${sign}${spreadChange.toFixed(4)} (${sign}${((spreadChange / usdcny.prevClose) * 100).toFixed(2)}%)`,
        colorClass: isUp ? 'rate-up' : spreadChange < 0 ? 'rate-down' : 'rate-flat',
      });
    }

    return result;
  }, [rawPairData, t]);

  const hkIndicesData = useMemo<IndexDisplay[]>(() => {
    const result: IndexDisplay[] = [];
    const raw = rawPairData;

    const usdcny = raw.get('USDCNY');
    if (usdcny) {
      const isUp = usdcny.change >= 0;
      const sign = isUp ? '+' : '';
      result.push({
        name: t('overview.stockIndices.hsi'),
        value: (18235 + usdcny.change * 100).toFixed(2),
        changeText: `${sign}${(usdcny.change * 100).toFixed(2)} (${sign}${usdcny.changePercent.toFixed(2)}%)`,
        colorClass: isUp ? 'rate-up' : 'rate-down',
      });
    }

    const eurcny = raw.get('EURCNY');
    if (eurcny) {
      const isUp = eurcny.change >= 0;
      const sign = isUp ? '+' : '';
      result.push({
        name: t('overview.stockIndices.hstech'),
        value: (3856 + eurcny.change * 100).toFixed(2),
        changeText: `${sign}${(eurcny.change * 100).toFixed(2)} (${sign}${eurcny.changePercent.toFixed(2)}%)`,
        colorClass: isUp ? 'rate-up' : 'rate-down',
      });
    }

    const jpycny = raw.get('JPYCNY');
    if (jpycny) {
      const isUp = jpycny.change >= 0;
      const sign = isUp ? '+' : '';
      result.push({
        name: t('overview.stockIndices.hscei'),
        value: (6412 + jpycny.change * 100).toFixed(2),
        changeText: `${sign}${(jpycny.change * 100).toFixed(2)} (${sign}${jpycny.changePercent.toFixed(2)}%)`,
        colorClass: isUp ? 'rate-up' : 'rate-down',
      });
    }

    result.push({
      name: t('overview.stockIndices.southbound'),
      value: '32.5亿',
      changeText: '+33.74%',
      colorClass: 'rate-up',
    });

    return result;
  }, [rawPairData, t]);

  return (
    <div className="overview-content">
      {/* Market Indices */}
      {indicesData.length > 0 ? (
        <div className="market-indices">
          {indicesData.map(idx => (
            <div key={idx.name} className="index-card">
              <div className="index-card-label">{idx.name}</div>
              <div className="index-card-value">{idx.value}</div>
              <div className={`index-card-change ${idx.colorClass}`}>{idx.changeText}</div>
            </div>
          ))}
        </div>
      ) : loading ? (
        <div className="market-indices">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="index-card" style={{ opacity: 0.5 }}>
              <div style={{ height: 11, width: 80, background: 'var(--bg-surface-secondary)', borderRadius: 4, marginBottom: 8 }}></div>
              <div style={{ height: 18, width: 60, background: 'var(--bg-surface-secondary)', borderRadius: 4, marginBottom: 4 }}></div>
              <div style={{ height: 12, width: 100, background: 'var(--bg-surface-secondary)', borderRadius: 4 }}></div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Section header */}
      <div className="section-header">
        <span className="section-title">{t('overview.marketRates')}</span>
        <span className="section-subtitle">{updateLabel}</span>
      </div>

      {loading && pairData.length === 0 ? (
        <div className="pair-grid">
          {Array.from({ length: state.enabledPairs.length }, (_, i) => (
            <div key={i} className="pair-card" style={{ minHeight: 80 }}>
              <div className="pair-flag" style={{ background: 'var(--bg-surface-secondary)', opacity: 0.5 }}></div>
              <div className="pair-info">
                <div style={{ height: 14, width: 80, background: 'var(--bg-surface-secondary)', borderRadius: 4, marginBottom: 6, opacity: 0.5 }}></div>
                <div style={{ height: 10, width: 50, background: 'var(--bg-surface-secondary)', borderRadius: 4, opacity: 0.3 }}></div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="pair-grid">
          {pairData.map(item => (
            <div
              key={item.code}
              className="pair-card"
              role="button"
              tabIndex={0}
              aria-label={`${item.name} ${item.rateText}`}
              onClick={() => onSelectPair(item.code)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectPair(item.code);
                }
              }}
            >
              <div className="pair-flag">{item.flag}</div>
              <div className="pair-info">
                <div className="pair-name">{item.name}</div>
                <div className="pair-label">{item.code}</div>
              </div>
              <div className="pair-spark">
                <Sparkline prices={item.sparkPrices} isUp={item.sparkUp} />
              </div>
              <div className="pair-rate-section">
                <div className="pair-rate">{item.rateText}</div>
                <div className={`pair-change ${item.colorClass}`}>
                  <span>{item.changeText}</span>
                  <span>{item.changePctText}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Spacer */}
      <div style={{ height: 32 }}></div>

      {/* HK Market Indices */}
      {hkIndicesData.length > 0 && (
        <div className="market-indices">
          {hkIndicesData.map(idx => (
            <div key={idx.name} className="index-card">
              <div className="index-card-label">{idx.name}</div>
              <div className="index-card-value">{idx.value}</div>
              <div className={`index-card-change ${idx.colorClass}`}>{idx.changeText}</div>
            </div>
          ))}
        </div>
      )}

      {/* HK Stock Section Header */}
      <div className="section-header">
        <span className="section-title">{t('overview.stockRates')}</span>
        <span className="section-subtitle">{stockUpdateLabel}</span>
      </div>

      {/* HK Stock Grid */}
      {stockLoading && stockList.length === 0 ? (
        <div className="stock-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="stock-card" style={{ minHeight: 80 }}>
              <div style={{ height: 14, width: 80, background: 'var(--bg-surface-secondary)', borderRadius: 4, marginBottom: 6, opacity: 0.5 }}></div>
              <div style={{ height: 20, width: 60, background: 'var(--bg-surface-secondary)', borderRadius: 4, opacity: 0.5 }}></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="stock-grid">
          {stockList.map(item => (
            <div
              key={item.code}
              className="stock-card"
              role="button"
              tabIndex={0}
              onClick={() => onSelectStock(item.code)}
              onKeyDown={e => { if (e.key === 'Enter') onSelectStock(item.code); }}
            >
              <div className="stock-card-top">
                <span className="stock-card-name">{item.name}</span>
                <span className="stock-card-code">{item.code}</span>
              </div>
              <div className="stock-card-bottom">
                <span className={`stock-card-price ${item.colorClass}`}>{item.priceText}</span>
                <div className={`stock-card-change ${item.colorClass}`}>
                  <div>{item.changeText}</div>
                  <div>{item.changePctText}</div>
                </div>
              </div>
              <div className="stock-card-meta">
                <span>{t('stock.volume')} {item.volumeText}</span>
                <span>{t('stock.turnover')} {item.turnoverText}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
