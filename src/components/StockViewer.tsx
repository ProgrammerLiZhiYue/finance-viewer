import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as echarts from 'echarts';
import type { StockData, Period, HKStockCode } from '../types';
import { STOCK_NAMES } from '../types';
import { useSettings, ALL_STOCKS } from '../context/SettingsContext';
import { useCountdown } from '../hooks/useCountdown';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useEChart } from '../hooks/useEChart';
import { useDebouncedSearch } from '../hooks/useDebouncedSearch';
import { formatChangePercent, formatVolume, formatTurnover, nowTimeString } from '../lib/format';
import { getThemeColors, getRateColors } from '../lib/chartTheme';
import i18n from '../i18n';

const stockPeriodValues: Period[] = ['fenShi', 'fiveDay', 'dailyK', 'weeklyK', 'monthlyK', 'quarterlyK', 'yearlyK'];

/** 分时与五日的最后一个点就是最新成交，可用来刷新侧栏报价；K 线的最后一根是历史周期柱 */
const LIVE_QUOTE_PERIODS: Period[] = ['fenShi', 'fiveDay'];

function fetchStockData(stock: HKStockCode, period: Period): Promise<StockData> {
  if (period === 'fenShi') return window.electronAPI.getHKStockMinute(stock);
  if (period === 'fiveDay') return window.electronAPI.getHKStockFiveDay(stock);
  return window.electronAPI.getHKStockKLine(stock, period);
}

interface SidebarStockItem {
  code: HKStockCode;
  name: string;
  priceText: string;
  changePctText: string;
  colorClass: string;
  index: number;
}

interface OrderRow { level: string; price: string; volume: string; }

function formatPrice(v?: number | null): string {
  return v !== undefined && v !== null ? v.toFixed(2) : '--';
}

function formatPriceChange(v?: number | null): string {
  if (v === undefined || v === null) return '--';
  const sign = v >= 0 ? '+' : '';
  return sign + v.toFixed(2);
}

export default function StockViewer({ isDark, initialStock }: { isDark: boolean; initialStock: HKStockCode | null }) {
  const { t } = useTranslation();
  const { state, dispatch } = useSettings();

  const [currentStock, setCurrentStock] = useState<HKStockCode>(() => {
    const candidate = initialStock ?? (state.enabledStocks[0] || '00700');
    return state.enabledStocks.includes(candidate) ? candidate : (state.enabledStocks[0] || '00700');
  });
  const [currentPeriod, setCurrentPeriod] = useState<Period>('fenShi');
  const [data, setData] = useState<StockData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [updateTimeText, setUpdateTimeText] = useState('--:--:--');
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [addPanelQuery, setAddPanelQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [sidebarPrices, setSidebarPrices] = useState<Map<HKStockCode, { price: number; changePct: number }>>(new Map());

  const currentStockRef = useRef(currentStock);
  currentStockRef.current = currentStock;
  const currentPeriodRef = useRef(currentPeriod);
  currentPeriodRef.current = currentPeriod;
  const loadSeqRef = useRef(0);
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;

  const { value: countdown, reset: resetCountdown } = useCountdown(state.refreshInterval);
  const { containerRef, getChart } = useEChart();
  const dragSrcIndexRef = useRef<number | null>(null);

  const { results: addPanelSearchResults, searching: addPanelSearching } = useDebouncedSearch(
    addPanelQuery,
    items => items.filter(r => r.type === 'stock' && r.market === 'hk'),
  );

  const stockPeriods = stockPeriodValues.map(v => ({ value: v, label: t(`viewer.periods.${v}`) }));

  const stockName = data?.name || (STOCK_NAMES[currentStock] || currentStock);

  const hour = new Date().getHours();
  const isTrading = hour >= 9 && hour < 16;

  const priceColorClass = !data ? '' : data.change > 0 ? 'rate-up' : data.change < 0 ? 'rate-down' : '';
  const changeBadgeClass = !data ? 'flat' : data.change > 0 ? 'up' : data.change < 0 ? 'down' : 'flat';

  const askRows = useMemo<OrderRow[]>(() => {
    if (!data) return [];
    const rows: OrderRow[] = [];
    let askP = data.currentPrice + 0.05;
    for (let i = 5; i >= 1; i--) {
      rows.push({
        level: t('stock.ask') + i,
        price: askP.toFixed(2),
        volume: formatVolume(Math.floor(1000 + Math.abs(Math.sin(i * 7)) * 50000)),
      });
      askP += parseFloat((0.05 + Math.abs(Math.sin(i * 3)) * 0.15).toFixed(2));
    }
    return rows;
  }, [data, t]);

  const bidRows = useMemo<OrderRow[]>(() => {
    if (!data) return [];
    const rows: OrderRow[] = [];
    let bidP = data.currentPrice - 0.05;
    for (let i = 1; i <= 5; i++) {
      rows.push({
        level: t('stock.bid') + i,
        price: bidP.toFixed(2),
        volume: formatVolume(Math.floor(1000 + Math.abs(Math.cos(i * 5)) * 50000)),
      });
      bidP -= parseFloat((0.05 + Math.abs(Math.cos(i * 3)) * 0.15).toFixed(2));
    }
    return rows;
  }, [data, t]);

  const spreadValue = useMemo(() => {
    if (!data || askRows.length === 0 || bidRows.length === 0) return '--';
    const askPrice = parseFloat(askRows[askRows.length - 1].price);
    const bidPrice = parseFloat(bidRows[0].price);
    return (askPrice - bidPrice).toFixed(2);
  }, [data, askRows, bidRows]);

  const spreadPct = useMemo(() => {
    if (!data || data.currentPrice === 0) return '--';
    const sv = parseFloat(spreadValue);
    if (isNaN(sv)) return '--';
    return ((sv / data.currentPrice) * 100).toFixed(3);
  }, [data, spreadValue]);

  const extraInfo = useMemo(() => {
    if (!data) {
      return { pe: '--', pb: '--', marketCap: '--', turnoverRate: '--', high52w: '--', low52w: '--', amplitude: '--', volumeRatio: '--' };
    }
    const amp = data.prevClose > 0 ? ((data.high - data.low) / data.prevClose * 100).toFixed(2) + '%' : '--';
    return {
      pe: '--',
      pb: '--',
      marketCap: '--',
      turnoverRate: '--',
      high52w: '--',
      low52w: '--',
      amplitude: amp,
      volumeRatio: '--',
    };
  }, [data]);

  async function loadDataFor(stock: HKStockCode, period: Period): Promise<StockData | null> {
    const seq = ++loadSeqRef.current;
    try {
      setIsLoading(true);
      const d = await fetchStockData(stock, period);
      if (seq !== loadSeqRef.current) return null;
      setErrorMessage('');
      setData(d);
      setUpdateTimeText(nowTimeString());
      if (LIVE_QUOTE_PERIODS.includes(period)) {
        setSidebarPrices(prev => {
          const next = new Map(prev);
          next.set(stock, { price: d.currentPrice, changePct: d.changePercent });
          return next;
        });
      }
      return d;
    } catch (e) {
      if (seq !== loadSeqRef.current) return null;
      setErrorMessage(e instanceof Error ? e.message : String(e));
      console.error('Failed to load stock data:', e);
      return null;
    } finally {
      if (seq === loadSeqRef.current) {
        setIsLoading(false);
        resetCountdown();
      }
    }
  }

  async function loadSidebarData(stocks: HKStockCode[]): Promise<void> {
    const results = await Promise.allSettled(
      stocks.map(code => window.electronAPI.getHKStockMinute(code))
    );
    const map = new Map<HKStockCode, { price: number; changePct: number }>();
    for (let i = 0; i < stocks.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        map.set(stocks[i], { price: r.value.currentPrice, changePct: r.value.changePercent });
      }
    }
    setSidebarPrices(map);
  }

  function renderChart(): void {
    const chart = getChart();
    if (!chart || !data) return;

    const kline = data.kline;
    const dates = kline.map(d => d.date.split(' ')[1] ?? d.date);
    const prices = kline.map(d => d.close);
    const prevClose = data.prevClose;
    const tc = getThemeColors();
    const { up: upColor, down: downColor } = getRateColors();

    const option: echarts.EChartsOption = {
      animation: true,
      animationDuration: 800,
      animationEasing: 'cubicOut',
      backgroundColor: tc.bg,
      tooltip: {
        trigger: 'axis',
        backgroundColor: tc.tooltipBg,
        borderColor: tc.tooltipBorder,
        textStyle: { color: tc.tooltipText, fontSize: 12 },
        formatter: (params: unknown) => {
          const p = (params as { data: number; axisValue: string; dataIndex: number }[])[0];
          if (!p) return '';
          const price = p.data as number;
          const diff = price - prevClose;
          const pct = prevClose !== 0 ? (diff / prevClose) * 100 : 0;
          const c = diff >= 0 ? upColor : downColor;
          return `
            <div style="font-size:13px">
              <div style="margin-bottom:4px;color:${tc.muted}">${p.axisValue}</div>
              <div>${i18n.t('viewer.chart.price')}: <span style="color:${c}">${price.toFixed(2)}</span></div>
              <div>${i18n.t('viewer.chart.change')}: <span style="color:${c}">${diff >= 0 ? '+' : ''}${diff.toFixed(2)}</span></div>
              <div>${i18n.t('viewer.chart.percent')}: <span style="color:${c}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span></div>
            </div>
          `;
        },
      },
      grid: { top: 20, right: 16, bottom: 32, left: 56 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: tc.axis } },
        axisTick: { show: false },
        axisLabel: { color: tc.label, fontSize: 10, interval: Math.floor(dates.length / 6) },
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: tc.label, fontSize: 10, formatter: (v: number) => v.toFixed(2) },
        splitLine: { lineStyle: { color: tc.grid, type: 'dashed' } },
      },
      series: [{
        name: i18n.t('viewer.chart.price'),
        type: 'line',
        data: prices,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: tc.accent, width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: tc.accent + '26' },
            { offset: 1, color: tc.accent + '03' },
          ]),
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: tc.markline, type: 'dashed', width: 1 },
          data: [{ yAxis: prevClose, label: { formatter: i18n.t('viewer.chart.prevClose') + ' ' + prevClose.toFixed(2), color: tc.muted, fontSize: 10 } }],
        },
      }],
    };

    chart.setOption(option, true);
  }

  useEffect(() => {
    if (data) renderChart();
  }, [data, isDark]);

  function switchStock(stock: HKStockCode): void {
    if (isEditingRef.current) return;
    if (stock === currentStockRef.current) return;
    setCurrentStock(stock);
    setIsLoading(true);
    getChart()?.clear();
    setData(null);
    void loadDataFor(stock, currentPeriodRef.current);
  }

  function switchPeriod(period: Period): void {
    setCurrentPeriod(period);
    setIsLoading(true);
    getChart()?.clear();
    setData(null);
    void loadDataFor(currentStockRef.current, period);
  }

  function retryLoad(): void {
    setErrorMessage('');
    void loadDataFor(currentStockRef.current, currentPeriodRef.current);
  }

  // 初始加载
  useEffect(() => {
    void loadSidebarData(state.enabledStocks);
    void loadDataFor(currentStockRef.current, currentPeriodRef.current);
  }, []);

  // 外部跳转选中股票
  useEffect(() => {
    setIsEditing(false);
    if (initialStock && initialStock !== currentStockRef.current) {
      switchStock(initialStock);
    }
  }, [initialStock]);

  // 启用列表变化：当前股被移除则切到首个，并刷新侧栏行情
  const stocksMountedRef = useRef(false);
  useEffect(() => {
    if (!stocksMountedRef.current) {
      stocksMountedRef.current = true;
      return;
    }
    const stocks = state.enabledStocks;
    if (!stocks.includes(currentStockRef.current) && stocks.length > 0) {
      switchStock(stocks[0]);
    }
    void loadSidebarData(stocks);
  }, [state.enabledStocks]);

  useAutoRefresh(state.refreshInterval, () => {
    void loadDataFor(currentStockRef.current, currentPeriodRef.current);
  });

  function openAddPanel(): void {
    setAddPanelQuery('');
    setAddPanelOpen(true);
  }

  function onAddStock(code: HKStockCode, name?: string): void {
    if (state.enabledStocks.includes(code)) return;
    if (name && !STOCK_NAMES[code]) {
      STOCK_NAMES[code] = name;
    }
    dispatch({ type: 'toggleStock', stock: code });
  }

  const isLastEnabledStock = (code: HKStockCode): boolean =>
    state.enabledStocks.length === 1 && state.enabledStocks[0] === code;

  function onRemoveStock(code: HKStockCode): void {
    if (isLastEnabledStock(code)) return;
    dispatch({ type: 'toggleStock', stock: code });
    if (currentStockRef.current === code) {
      const remaining = state.enabledStocks.filter(s => s !== code);
      if (remaining.length > 0) switchStock(remaining[0]);
    }
  }

  function onDragStart(event: React.DragEvent<HTMLDivElement>, index: number): void {
    dragSrcIndexRef.current = index;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    event.currentTarget.classList.add('dragging');
  }

  function onDragOver(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    el.classList.remove('drag-over-top', 'drag-over-bottom');
    if (event.clientY < midY) el.classList.add('drag-over-top');
    else el.classList.add('drag-over-bottom');
  }

  function onDragLeave(event: React.DragEvent<HTMLDivElement>): void {
    event.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>, toIndex: number): void {
    event.preventDefault();
    const fromIndex = dragSrcIndexRef.current;
    if (fromIndex === null || fromIndex === toIndex) return;
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const insertBefore = event.clientY < midY;
    let insertAt = insertBefore ? toIndex : toIndex + 1;
    if (fromIndex < insertAt) insertAt--;
    if (fromIndex !== insertAt) dispatch({ type: 'reorderStock', from: fromIndex, to: insertAt });
    clearDragStates();
  }

  function clearDragStates(): void {
    dragSrcIndexRef.current = null;
    document.querySelectorAll('.sidebar-item').forEach(el => {
      el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
    });
  }

  const availableStocksForAdd = useMemo(() => {
    const q = addPanelQuery.toLowerCase().trim();
    const enabledSet = new Set(state.enabledStocks);

    if (q && addPanelSearchResults.length > 0) {
      return addPanelSearchResults
        .filter(item => !enabledSet.has(item.code))
        .map(item => ({
          code: item.code,
          name: item.name,
          price: item.price,
          ratio: item.ratio,
        }));
    }

    return ALL_STOCKS
      .filter(code => !enabledSet.has(code))
      .map(code => ({
        code,
        name: STOCK_NAMES[code] || code,
        price: '',
        ratio: '',
      }))
      .filter(item =>
        !q || item.name.toLowerCase().includes(q) || item.code.includes(q)
      );
  }, [addPanelQuery, addPanelSearchResults, state.enabledStocks]);

  const sidebarStockItems = useMemo<SidebarStockItem[]>(() => {
    return state.enabledStocks.map((code, index) => {
      const cached = sidebarPrices.get(code);
      const isUp = cached ? cached.changePct >= 0 : false;
      const sign = isUp ? '+' : '';
      return {
        code,
        name: STOCK_NAMES[code] || code,
        priceText: cached ? cached.price.toFixed(2) : '--',
        changePctText: cached ? `${sign}${cached.changePct.toFixed(2)}%` : '--',
        colorClass: cached
          ? (cached.changePct > 0 ? 'rate-up' : cached.changePct < 0 ? 'rate-down' : 'rate-flat')
          : 'rate-flat',
        index,
      };
    });
  }, [state.enabledStocks, sidebarPrices]);

  const filteredStocks = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return sidebarStockItems;
    return sidebarStockItems.filter(item =>
      item.name.toLowerCase().includes(q) || item.code.includes(q)
    );
  }, [searchQuery, sidebarStockItems]);

  return (
    <div className="detail-layout">
      <aside className={`detail-sidebar stock-sidebar${isEditing ? ' editing' : ''}`}>
        <div className="sidebar-search">
          <input
            className="sidebar-search-input"
            type="text"
            placeholder={t('stock.searchPlaceholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label={t('stock.searchPlaceholder')}
          />
        </div>
        <div className="sidebar-toolbar">
          <span className="sidebar-toolbar-label">{isEditing ? t('stock.editHint') : ''}</span>
          <button className={`sidebar-edit-btn${isEditing ? ' done' : ''}`} onClick={() => setIsEditing(v => !v)}>
            {isEditing ? t('stock.done') : t('stock.edit')}
          </button>
        </div>
        <div className="sidebar-list">
          {filteredStocks.map(item => (
            <div
              key={item.code}
              className={`sidebar-item${item.code === currentStock ? ' active' : ''}`}
              data-index={item.index}
              draggable={isEditing}
              role="button"
              tabIndex={0}
              onClick={() => switchStock(item.code)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  switchStock(item.code);
                }
              }}
              onDragStart={e => onDragStart(e, item.index)}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={e => onDrop(e, item.index)}
              onDragEnd={clearDragStates}
            >
              {isEditing && <span className="sidebar-item-drag">⠿</span>}
              <div className="sidebar-item-flag stock-flag">{item.code.slice(-2)}</div>
              <div className="sidebar-item-info">
                <div className="sidebar-item-name">{item.name}</div>
                <div className="sidebar-item-rate">{item.priceText}</div>
              </div>
              <div className={`sidebar-item-change ${item.colorClass}`}>{item.changePctText}</div>
              {isEditing && (
                <button
                  className="sidebar-item-remove"
                  onClick={e => { e.stopPropagation(); onRemoveStock(item.code); }}
                >✕</button>
              )}
            </div>
          ))}
        </div>
        {!isEditing && (
          <button className="sidebar-add-btn" onClick={openAddPanel}>+ {t('stock.addStock')}</button>
        )}
        <div className="sidebar-footer">
          <span className="refresh-dot" style={{ width: 5, height: 5 }}></span>
          <span>{t('stock.autoRefresh')} <span className="tabular-nums">{countdown}s</span></span>
        </div>

        <div
          className={`add-panel-overlay${addPanelOpen ? ' open' : ''}`}
          onClick={e => { if (e.target === e.currentTarget) setAddPanelOpen(false); }}
        >
          <div className="add-panel">
            <div className="add-panel-header">
              <span className="add-panel-title">{t('stock.addStock')}</span>
              <button className="add-panel-close" onClick={() => setAddPanelOpen(false)}>✕</button>
            </div>
            <div className="add-panel-search">
              <input type="text" placeholder={t('stock.searchPlaceholder')} value={addPanelQuery} onChange={e => setAddPanelQuery(e.target.value)} />
            </div>
            <div className="add-panel-list">
              {availableStocksForAdd.map(item => (
                <div
                  key={item.code}
                  className="add-panel-item"
                  onClick={() => onAddStock(item.code, item.name)}
                >
                  <div className="add-panel-item-flag stock-flag">{item.code.slice(-2)}</div>
                  <div className="add-panel-item-info">
                    <div className="add-panel-item-name">{item.name}</div>
                    <div className="add-panel-item-code">{item.code}{item.price ? ` · ${item.price} ${item.ratio}` : t('stock.codeSuffix')}</div>
                  </div>
                  <span className="add-panel-item-add">+</span>
                </div>
              ))}
              {addPanelSearching && (
                <div className="add-panel-empty">{t('viewer.loading')}</div>
              )}
              {!addPanelSearching && availableStocksForAdd.length === 0 && (
                <div className="add-panel-empty">{t('stock.noMoreStocks')}</div>
              )}
            </div>
          </div>
        </div>
      </aside>

      <div className="detail-main">
        {errorMessage && (
          <div className="error-panel">
            <span style={{ fontSize: 18, color: 'var(--rate-up)' }}>⚠</span>
            <span className="error-panel-text">{errorMessage}</span>
            <button className="error-panel-btn" onClick={retryLoad}>{t('viewer.retry')}</button>
          </div>
        )}

        <div className="stock-header">
          <div className="stock-header-left">
            <div className="stock-header-name">{stockName}</div>
            <div className="stock-header-code">{currentStock}{t('stock.codeSuffix')}</div>
            <div className={`stock-header-price ${priceColorClass}`}>{formatPrice(data?.currentPrice)}</div>
            <div className="stock-header-change-row">
              <span className={`stock-header-badge ${changeBadgeClass}`}>
                {formatPriceChange(data?.change)} ({formatChangePercent(data?.changePercent)})
              </span>
            </div>
          </div>
          <div className="stock-header-right">
            <div className="stock-header-time">{updateTimeText}</div>
            <div className={`stock-header-status ${isTrading ? 'trading' : 'closed'}`}>
              <span className="refresh-dot" style={{ width: 5, height: 5 }}></span>
              {isTrading ? t('stock.trading') : t('stock.closed')}
            </div>
          </div>
        </div>

        {data && (
          <div className="key-metrics">
            <div className="key-metric-item">
              <div className="key-metric-label">{t('viewer.open')}</div>
              <div className="key-metric-value">{formatPrice(data.open)}</div>
            </div>
            <div className="key-metric-item">
              <div className="key-metric-label">{t('viewer.high')}</div>
              <div className="key-metric-value rate-up">{formatPrice(data.high)}</div>
            </div>
            <div className="key-metric-item">
              <div className="key-metric-label">{t('viewer.low')}</div>
              <div className="key-metric-value rate-down">{formatPrice(data.low)}</div>
            </div>
            <div className="key-metric-item">
              <div className="key-metric-label">{t('viewer.prevClose')}</div>
              <div className="key-metric-value">{formatPrice(data.prevClose)}</div>
            </div>
            <div className="key-metric-item">
              <div className="key-metric-label">{t('stock.volume')}</div>
              <div className="key-metric-value">{formatVolume(data.volume)}</div>
            </div>
            <div className="key-metric-item">
              <div className="key-metric-label">{t('stock.turnover')}</div>
              <div className="key-metric-value">{formatTurnover(data.turnover)}</div>
            </div>
          </div>
        )}

        <div className="period-selector">
          {stockPeriods.map(p => (
            <button
              key={p.value}
              className={`period-btn${currentPeriod === p.value ? ' active' : ''}`}
              onClick={() => switchPeriod(p.value)}
            >{p.label}</button>
          ))}
        </div>

        <div className="chart-container">
          {isLoading && (
            <div className="loading-overlay">
              <div className="loading-spinner"></div>
              <span className="loading-text">{t('viewer.loading')}</span>
            </div>
          )}
          <div ref={containerRef} className="chart-area"></div>
        </div>

        <div className="stock-bottom-section">
          <div className="order-book">
            <div className="order-book-title">{t('stock.orderBook')}</div>
            <table className="order-book-table">
              <thead><tr><th>{t('stock.level')}</th><th>{t('stock.price')}</th><th>{t('stock.quantity')}</th></tr></thead>
              <tbody>
                {askRows.map(ask => (
                  <tr key={ask.level} className="ask-row">
                    <td>{ask.level}</td>
                    <td>{ask.price}</td>
                    <td>{ask.volume}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="order-book-spread">
              {t('stock.spread')} {spreadValue} · {spreadPct}%
            </div>
            <table className="order-book-table">
              <tbody>
                {bidRows.map(bid => (
                  <tr key={bid.level} className="bid-row">
                    <td>{bid.level}</td>
                    <td>{bid.price}</td>
                    <td>{bid.volume}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="stock-info-panel">
            <div className="stock-info-title">{t('stock.stockInfo')}</div>
            <div className="stock-info-grid">
              <div className="stock-info-item">
                <span className="stock-info-label">{t('stock.pe')}</span>
                <span className="stock-info-value">{extraInfo.pe}</span>
              </div>
              <div className="stock-info-item">
                <span className="stock-info-label">{t('stock.pb')}</span>
                <span className="stock-info-value">{extraInfo.pb}</span>
              </div>
              <div className="stock-info-item">
                <span className="stock-info-label">{t('stock.marketCap')}</span>
                <span className="stock-info-value">{extraInfo.marketCap}</span>
              </div>
              <div className="stock-info-item">
                <span className="stock-info-label">{t('stock.turnoverRate')}</span>
                <span className="stock-info-value">{extraInfo.turnoverRate}</span>
              </div>
              <div className="stock-info-item">
                <span className="stock-info-label">{t('stock.high52w')}</span>
                <span className="stock-info-value rate-up">{extraInfo.high52w}</span>
              </div>
              <div className="stock-info-item">
                <span className="stock-info-label">{t('stock.low52w')}</span>
                <span className="stock-info-value rate-down">{extraInfo.low52w}</span>
              </div>
              <div className="stock-info-item">
                <span className="stock-info-label">{t('stock.amplitude')}</span>
                <span className="stock-info-value">{extraInfo.amplitude}</span>
              </div>
              <div className="stock-info-item">
                <span className="stock-info-label">{t('stock.volumeRatio')}</span>
                <span className="stock-info-value">{extraInfo.volumeRatio}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
