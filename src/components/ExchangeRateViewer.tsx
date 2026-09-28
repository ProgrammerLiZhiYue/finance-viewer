import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as echarts from 'echarts';
import type { ExchangeRateData, Period, CurrencyPair, SummaryItem } from '../types';
import { PAIR_FLAGS } from '../types';
import { useSettings, ALL_PAIRS } from '../context/SettingsContext';
import { useCountdown } from '../hooks/useCountdown';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useEChart } from '../hooks/useEChart';
import { useDebouncedSearch } from '../hooks/useDebouncedSearch';
import { formatNum, formatRate, formatChange, formatChangePercent, nowTimeString } from '../lib/format';
import { getThemeColors, getRateColors } from '../lib/chartTheme';
import i18n from '../i18n';

const mainPeriodValues: Period[] = ['fenShi', 'dailyK', 'weeklyK', 'monthlyK', 'quarterlyK', 'yearlyK'];
const morePeriodValues: Period[] = ['1min', '5min', '15min', '30min', '60min'];

interface SidebarPairItem {
  code: CurrencyPair;
  name: string;
  flag: string;
  rateText: string;
  changePctText: string;
  colorClass: string;
  index: number;
}

export default function ExchangeRateViewer({ isDark, initialPair }: { isDark: boolean; initialPair: CurrencyPair | null }) {
  const { t } = useTranslation();
  const { state, dispatch } = useSettings();

  const [currentPair, setCurrentPair] = useState<CurrencyPair>(() => {
    const candidate = initialPair ?? (state.enabledPairs[0] || 'USDCNY');
    return state.enabledPairs.includes(candidate) ? candidate : (state.enabledPairs[0] || 'USDCNY');
  });
  const [currentPeriod, setCurrentPeriod] = useState<Period>('fenShi');
  const [moreOpen, setMoreOpen] = useState(false);
  const [data, setData] = useState<ExchangeRateData | null>(null);
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [flashActive, setFlashActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [updateTimeText, setUpdateTimeText] = useState('--:--:--');
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [addPanelQuery, setAddPanelQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [sidebarRates, setSidebarRates] = useState<Map<CurrencyPair, { rate: number; changePct: number }>>(new Map());
  const [discoveredPairNames, setDiscoveredPairNames] = useState<Map<string, string>>(new Map());

  const currentPairRef = useRef(currentPair);
  currentPairRef.current = currentPair;
  const currentPeriodRef = useRef(currentPeriod);
  currentPeriodRef.current = currentPeriod;
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;

  const { value: countdown, reset: resetCountdown } = useCountdown(state.refreshInterval);
  const { containerRef, getChart } = useEChart();
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragSrcIndexRef = useRef<number | null>(null);

  const { results: addPanelSearchResults, searching: addPanelSearching } = useDebouncedSearch(addPanelQuery);

  const mainPeriods = mainPeriodValues.map(v => ({ value: v, label: t(`viewer.periods.${v}`) }));
  const morePeriods = morePeriodValues.map(v => ({ value: v, label: t(`viewer.periods.${v}`) }));

  const isMorePeriodActive = morePeriodValues.includes(currentPeriod);
  const moreLabel = isMorePeriodActive ? t(`viewer.periods.${currentPeriod}`) : t('viewer.periods.more');

  const currentPairName = discoveredPairNames.get(currentPair) ?? t(`overview.pair.${currentPair}`);

  const changeBadgeClass = !data ? 'flat' : data.change > 0 ? 'up' : data.change < 0 ? 'down' : 'flat';

  async function loadDataFor(pair: CurrencyPair, period: Period): Promise<ExchangeRateData | null> {
    try {
      setIsRefreshing(true);
      setFlashActive(false);
      const d = await window.electronAPI.getExchangeRate(pair, period);
      setErrorMessage('');
      setData(d);
      setFlashActive(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashActive(false), 600);
      setUpdateTimeText(nowTimeString());
      setSidebarRates(prev => {
        const next = new Map(prev);
        next.set(pair, { rate: d.currentRate, changePct: d.changePercent });
        return next;
      });
      return d;
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      console.error('Failed to load exchange rate data:', e);
      return null;
    } finally {
      setIsRefreshing(false);
    }
  }

  async function loadSummaryFor(pair: CurrencyPair): Promise<SummaryItem[]> {
    try {
      const s = await window.electronAPI.getRateSummary(pair);
      setSummary(s);
      return s;
    } catch (e) {
      console.error('Failed to load rate summary:', e);
      return [];
    }
  }

  async function loadSidebarData(pairs: CurrencyPair[]): Promise<void> {
    const results = await Promise.allSettled(
      pairs.map(code => window.electronAPI.getExchangeRate(code, 'fenShi'))
    );
    const map = new Map<CurrencyPair, { rate: number; changePct: number }>();
    for (let i = 0; i < pairs.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        map.set(pairs[i], { rate: r.value.currentRate, changePct: r.value.changePercent });
      }
    }
    setSidebarRates(map);
  }

  function renderChart(): void {
    const chart = getChart();
    if (!chart || !data) return;

    const kline = data.kline;
    const isIntraday = currentPeriodRef.current === 'fenShi';
    const dates = kline.map(d => isIntraday ? d.date.split(' ')[1] ?? d.date : d.date);
    const ohlc = kline.map(d => [d.open, d.close, d.low, d.high]);

    const { up: upColor, down: downColor } = getRateColors();
    const tc = getThemeColors();

    if (isIntraday) {
      const prices = kline.map(d => d.close);
      const prevClose = data.prevClose;

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
            const item = kline[p.dataIndex];
            const diff = item?.change ?? (price - prevClose);
            const pct = item?.changePercent ?? ((diff / prevClose) * 100);
            const c = diff >= 0 ? upColor : downColor;
            return `
              <div style="font-size:13px">
                <div style="margin-bottom:4px;color:${tc.muted}">${p.axisValue}</div>
                <div>${i18n.t('viewer.chart.price')}: <span style="color:${c}">${formatNum(price)}</span></div>
                <div>${i18n.t('viewer.chart.change')}: <span style="color:${c}">${diff >= 0 ? '+' : ''}${formatNum(diff)}</span></div>
                <div>${i18n.t('viewer.chart.percent')}: <span style="color:${c}">${pct >= 0 ? '+' : ''}${formatNum(pct)}%</span></div>
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
          axisLabel: { color: tc.label, fontSize: 10, formatter: (v: number) => formatNum(v) },
          splitLine: { lineStyle: { color: tc.grid, type: 'dashed' } },
        },
        series: [
          {
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
          },
        ],
      };

      chart.setOption(option, true);
      return;
    }

    const volumes = kline.map((d, i) => {
      const prev = i > 0 ? kline[i - 1].close : d.open;
      return {
        value: Math.abs((d.close - prev) * 10000),
        itemStyle: { color: d.close >= d.open ? upColor : downColor },
      };
    });

    const option: echarts.EChartsOption = {
      animation: true,
      animationDuration: 600,
      backgroundColor: tc.bg,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: tc.tooltipBg,
        borderColor: tc.tooltipBorder,
        textStyle: { color: tc.tooltipText, fontSize: 12 },
        formatter: (params: unknown) => {
          // params 中可能混入柱状系列条目（data 为对象），只取 K 线系列的数组数据；
          // 此处若抛异常会中断 ECharts 更新流程，导致图表实例卡死、后续 setOption 全部失效
          const list = params as { data: unknown; axisValue: string }[];
          const p = Array.isArray(list) ? list.find(item => Array.isArray(item.data)) : undefined;
          if (!p || !Array.isArray(p.data)) return '';
          const [open, close, low, high] = p.data;
          const color = close >= open ? upColor : downColor;
          return `
            <div style="font-size:13px">
              <div style="margin-bottom:4px;color:${tc.muted}">${p.axisValue}</div>
              <div>${i18n.t('viewer.chart.open')}: <span style="color:${color}">${formatNum(open)}</span></div>
              <div>${i18n.t('viewer.chart.close')}: <span style="color:${color}">${formatNum(close)}</span></div>
              <div>${i18n.t('viewer.chart.high')}: <span style="color:${upColor}">${formatNum(high)}</span></div>
              <div>${i18n.t('viewer.chart.low')}: <span style="color:${downColor}">${formatNum(low)}</span></div>
            </div>
          `;
        },
      },
      grid: [
        { top: 20, right: 56, bottom: '32%', left: 56 },
        { height: '15%', right: 56, bottom: 48, left: 56 },
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          gridIndex: 0,
          axisLine: { lineStyle: { color: tc.axis } },
          axisTick: { show: false },
          axisLabel: { color: tc.label, fontSize: 10, interval: Math.floor(dates.length / 5) },
          boundaryGap: true,
          axisPointer: { show: true },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          axisLabel: { show: false },
          axisLine: { lineStyle: { color: tc.axis } },
          axisTick: { show: false },
          splitLine: { show: false },
          boundaryGap: true,
        },
      ],
      yAxis: [
        {
          scale: true,
          gridIndex: 0,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: tc.label, fontSize: 10, formatter: (v: number) => formatNum(v) },
          splitLine: { lineStyle: { color: tc.grid, type: 'dashed' } },
        },
        {
          scale: true,
          gridIndex: 1,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1],
          start: 50,
          end: 100,
        },
        {
          type: 'slider',
          xAxisIndex: [0, 1],
          bottom: 8,
          height: 20,
          borderColor: tc.datazoomBorder,
          backgroundColor: tc.datazoomBg,
          fillerColor: tc.datazoomFiller,
          handleStyle: { color: tc.datazoomHandle },
          textStyle: { color: tc.label, fontSize: 10 },
          start: 50,
          end: 100,
        },
      ],
      series: [
        {
          name: i18n.t('viewer.chart.kline'),
          type: 'candlestick',
          data: ohlc,
          itemStyle: {
            color: upColor,
            color0: downColor,
            borderColor: upColor,
            borderColor0: downColor,
          },
        },
        {
          name: i18n.t('viewer.chart.amplitude'),
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumes.map((v, i) => ({
            value: v.value,
            itemStyle: { color: (kline[i].close >= kline[i].open ? upColor : downColor) + '40' },
          })),
          barMaxWidth: 8,
        },
      ],
    };

    chart.setOption(option, true);
  }

  useEffect(() => {
    if (data) renderChart();
    // 数据更新或主题切换时重绘图表
  }, [data, isDark]);

  function switchPair(pair: CurrencyPair): void {
    if (isEditingRef.current) return;
    if (pair === currentPairRef.current) return;
    setCurrentPair(pair);
    setIsLoading(true);
    getChart()?.clear();
    setData(null);
    setSummary([]);
    void Promise.all([loadDataFor(pair, currentPeriodRef.current), loadSummaryFor(pair)])
      .then(() => resetCountdown())
      .finally(() => setIsLoading(false));
  }

  function switchPeriod(period: Period): void {
    setCurrentPeriod(period);
    setMoreOpen(false);
    // 清掉 dataZoom 等残留状态，避免 K 线缩放窗口影响切换回分时图
    getChart()?.clear();
    const pair = currentPairRef.current;
    const loads = period === 'fenShi'
      ? Promise.all([loadDataFor(pair, period), loadSummaryFor(pair)])
      : Promise.all([loadDataFor(pair, period)] as const);
    void loads.then(() => resetCountdown());
  }

  function retryLoad(): void {
    setErrorMessage('');
    const pair = currentPairRef.current;
    void Promise.all([loadDataFor(pair, currentPeriodRef.current), loadSummaryFor(pair)])
      .then(() => resetCountdown());
  }

  // 初始加载
  useEffect(() => {
    void loadSidebarData(state.enabledPairs);
    void Promise.all([loadDataFor(currentPairRef.current, currentPeriodRef.current), loadSummaryFor(currentPairRef.current)])
      .then(() => resetCountdown());
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  // 外部跳转选中货币对
  useEffect(() => {
    setIsEditing(false);
    if (initialPair && initialPair !== currentPairRef.current) {
      switchPair(initialPair);
    }
  }, [initialPair]);

  // 启用列表变化：当前对被移除则切到首个，并刷新侧栏行情
  const pairsMountedRef = useRef(false);
  useEffect(() => {
    if (!pairsMountedRef.current) {
      pairsMountedRef.current = true;
      return;
    }
    const pairs = state.enabledPairs;
    if (!pairs.includes(currentPairRef.current) && pairs.length > 0) {
      switchPair(pairs[0]);
    }
    void loadSidebarData(pairs);
  }, [state.enabledPairs]);

  useAutoRefresh(state.refreshInterval, () => {
    void loadDataFor(currentPairRef.current, currentPeriodRef.current).then(() => resetCountdown());
  });

  // 点击页面其他区域关闭"更多周期"下拉
  useEffect(() => {
    const onClick = (): void => setMoreOpen(false);
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  function openAddPanel(): void {
    setAddPanelQuery('');
    setAddPanelOpen(true);
  }

  function onAddPair(code: CurrencyPair, name?: string): void {
    if (state.enabledPairs.includes(code)) return;
    if (name) {
      setDiscoveredPairNames(prev => {
        const next = new Map(prev);
        next.set(code, name);
        return next;
      });
    }
    dispatch({ type: 'togglePair', pair: code });
  }

  const isLastEnabled = (code: CurrencyPair): boolean =>
    state.enabledPairs.length === 1 && state.enabledPairs[0] === code;

  function onRemovePair(code: CurrencyPair): void {
    if (isLastEnabled(code)) return;
    dispatch({ type: 'togglePair', pair: code });
    if (currentPairRef.current === code) {
      const remaining = state.enabledPairs.filter(p => p !== code);
      if (remaining.length > 0) switchPair(remaining[0]);
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
    if (event.clientY < midY) {
      el.classList.add('drag-over-top');
    } else {
      el.classList.add('drag-over-bottom');
    }
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

    if (fromIndex !== insertAt) {
      dispatch({ type: 'reorderPair', from: fromIndex, to: insertAt });
    }

    clearDragStates();
  }

  function clearDragStates(): void {
    dragSrcIndexRef.current = null;
    document.querySelectorAll('.sidebar-item').forEach(el => {
      el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
    });
  }

  const availablePairsForAdd = useMemo(() => {
    const q = addPanelQuery.toLowerCase().trim();
    const enabledSet = new Set(state.enabledPairs);

    if (q && addPanelSearchResults.length > 0) {
      return addPanelSearchResults
        .filter(item => item.type === 'foreign' && !enabledSet.has(item.code as CurrencyPair))
        .map(item => ({
          code: item.code as CurrencyPair,
          name: item.name,
          flag: PAIR_FLAGS[item.code as CurrencyPair] ?? '',
          price: item.price,
          ratio: item.ratio,
        }));
    }

    return ALL_PAIRS
      .filter(code => !enabledSet.has(code))
      .map(code => ({
        code,
        name: t(`overview.pair.${code}`),
        flag: PAIR_FLAGS[code],
        price: '',
        ratio: '',
      }))
      .filter(item =>
        !q || item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q)
      );
  }, [addPanelQuery, addPanelSearchResults, state.enabledPairs, t]);

  const sidebarPairs = useMemo<SidebarPairItem[]>(() => {
    return state.enabledPairs.map((code, index) => {
      const cached = sidebarRates.get(code);
      const isUp = cached ? cached.changePct >= 0 : false;
      const sign = isUp ? '+' : '';
      return {
        code,
        name: discoveredPairNames.get(code) ?? t(`overview.pair.${code}`),
        flag: PAIR_FLAGS[code] ?? '',
        rateText: cached ? String(cached.rate) : '--',
        changePctText: cached ? `${sign}${cached.changePct.toFixed(2)}%` : '--',
        colorClass: cached
          ? (cached.changePct > 0 ? 'rate-up' : cached.changePct < 0 ? 'rate-down' : 'rate-flat')
          : 'rate-flat',
        index,
      };
    });
  }, [state.enabledPairs, sidebarRates, discoveredPairNames, t]);

  const filteredPairs = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return sidebarPairs;
    return sidebarPairs.filter(item =>
      item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q)
    );
  }, [searchQuery, sidebarPairs]);

  return (
    <div className="detail-layout">
      {/* Sidebar */}
      <aside className={`detail-sidebar${isEditing ? ' editing' : ''}`}>
        <div className="sidebar-search">
          <input
            className="sidebar-search-input"
            type="text"
            placeholder={t('detail.searchPlaceholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label={t('detail.searchPlaceholder')}
          />
        </div>
        <div className="sidebar-toolbar">
          <span className="sidebar-toolbar-label">{isEditing ? t('detail.editHint') : ''}</span>
          <button className={`sidebar-edit-btn${isEditing ? ' done' : ''}`} onClick={() => setIsEditing(v => !v)}>
            {isEditing ? t('detail.done') : t('detail.edit')}
          </button>
        </div>
        <div className="sidebar-list">
          {filteredPairs.map(item => (
            <div
              key={item.code}
              className={`sidebar-item${item.code === currentPair ? ' active' : ''}`}
              data-index={item.index}
              draggable={isEditing}
              role="button"
              tabIndex={0}
              onClick={() => switchPair(item.code)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  switchPair(item.code);
                }
              }}
              onDragStart={e => onDragStart(e, item.index)}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={e => onDrop(e, item.index)}
              onDragEnd={clearDragStates}
            >
              {isEditing && <span className="sidebar-item-drag" title={t('detail.reorderPair')}>⠿</span>}
              <div className="sidebar-item-flag">{item.flag}</div>
              <div className="sidebar-item-info">
                <div className="sidebar-item-name">{item.name}</div>
                <div className="sidebar-item-rate">{item.rateText}</div>
              </div>
              <div className={`sidebar-item-change ${item.colorClass}`}>{item.changePctText}</div>
              {isEditing && (
                <button
                  className="sidebar-item-remove"
                  title={t('detail.removePair')}
                  aria-label={t('detail.removePair')}
                  onClick={e => { e.stopPropagation(); onRemovePair(item.code); }}
                >✕</button>
              )}
            </div>
          ))}
        </div>
        {!isEditing && (
          <button className="sidebar-add-btn" onClick={openAddPanel}>+ {t('detail.addPair')}</button>
        )}
        <div className="sidebar-footer">
          <span className="refresh-dot" style={{ width: 5, height: 5 }}></span>
          <span>{t('detail.autoRefresh')} <span className="tabular-nums">{isRefreshing ? t('viewer.refreshing') : countdown + 's'}</span></span>
        </div>

        {/* Add currency panel overlay */}
        <div
          className={`add-panel-overlay${addPanelOpen ? ' open' : ''}`}
          onClick={e => { if (e.target === e.currentTarget) setAddPanelOpen(false); }}
        >
          <div className="add-panel">
            <div className="add-panel-header">
              <span className="add-panel-title">{t('detail.addPair')}</span>
              <button className="add-panel-close" onClick={() => setAddPanelOpen(false)}>✕</button>
            </div>
            <div className="add-panel-search">
              <input
                type="text"
                placeholder={t('detail.searchPlaceholder')}
                value={addPanelQuery}
                onChange={e => setAddPanelQuery(e.target.value)}
              />
            </div>
            <div className="add-panel-list">
              {availablePairsForAdd.map(item => (
                <div
                  key={item.code}
                  className="add-panel-item"
                  onClick={() => onAddPair(item.code, item.name)}
                >
                  <div className="add-panel-item-flag">{item.flag}</div>
                  <div className="add-panel-item-info">
                    <div className="add-panel-item-name">{item.name}</div>
                    <div className="add-panel-item-code">{item.code}{item.price ? ` · ${item.price} ${item.ratio}` : ''}</div>
                  </div>
                  <span className="add-panel-item-add">+</span>
                </div>
              ))}
              {addPanelSearching && (
                <div className="add-panel-empty">{t('viewer.loading')}</div>
              )}
              {!addPanelSearching && availablePairsForAdd.length === 0 && (
                <div className="add-panel-empty">{t('detail.noMorePairs')}</div>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main detail area */}
      <div className="detail-main">
        {/* Error */}
        {errorMessage && (
          <div className="error-panel">
            <span style={{ fontSize: 18, color: 'var(--rate-up)' }}>⚠</span>
            <span className="error-panel-text">{errorMessage}</span>
            <button className="error-panel-btn" onClick={retryLoad}>{t('viewer.retry')}</button>
          </div>
        )}

        {/* Rate header */}
        <div className="rate-header">
          <div>
            <div className="rate-pair-title">{currentPairName}</div>
            <div className={`rate-value${flashActive ? ' flash' : ''}`}>{formatRate(data?.currentRate)}</div>
            <div className="rate-change-row">
              <span className={`rate-change-badge ${changeBadgeClass}`}>
                {formatChange(data?.change)} ({formatChangePercent(data?.changePercent)})
              </span>
            </div>
          </div>
          <div className="rate-update-time">{updateTimeText}</div>
        </div>

        {/* Key metrics strip */}
        {data && (
          <div className="key-metrics">
            <div className="key-metric-item">
              <div className="key-metric-label">{t('viewer.open')}</div>
              <div className="key-metric-value">{formatRate(data.open)}</div>
            </div>
            <div className="key-metric-item">
              <div className="key-metric-label">{t('viewer.high')}</div>
              <div className="key-metric-value rate-up">{formatRate(data.high)}</div>
            </div>
            <div className="key-metric-item">
              <div className="key-metric-label">{t('viewer.low')}</div>
              <div className="key-metric-value rate-down">{formatRate(data.low)}</div>
            </div>
            <div className="key-metric-item">
              <div className="key-metric-label">{t('viewer.bid')}</div>
              <div className="key-metric-value">{formatRate(data.bid)}</div>
            </div>
            <div className="key-metric-item">
              <div className="key-metric-label">{t('viewer.ask')}</div>
              <div className="key-metric-value">{formatRate(data.ask)}</div>
            </div>
            <div className="key-metric-item">
              <div className="key-metric-label">{t('viewer.prevClose')}</div>
              <div className="key-metric-value">{formatRate(data.prevClose)}</div>
            </div>
          </div>
        )}

        {/* Period selector */}
        <div className="period-selector">
          {mainPeriods.map(p => (
            <button
              key={p.value}
              className={`period-btn${currentPeriod === p.value ? ' active' : ''}`}
              onClick={() => switchPeriod(p.value)}
            >{p.label}</button>
          ))}
          <div className={`period-more-wrap${moreOpen ? ' open' : ''}`}>
            <button
              className={`period-btn period-more-btn${isMorePeriodActive ? ' active' : ''}`}
              onClick={e => { e.stopPropagation(); setMoreOpen(v => !v); }}
            >
              <span>{moreLabel}</span>
              <span className="chevron">▾</span>
            </button>
            <div className="period-dropdown">
              {morePeriods.map(p => (
                <button
                  key={p.value}
                  className={`period-dropdown-item${currentPeriod === p.value ? ' active' : ''}`}
                  onClick={e => { e.stopPropagation(); setMoreOpen(false); switchPeriod(p.value); }}
                >{p.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="chart-container">
          {isLoading && (
            <div className="loading-overlay">
              <div className="loading-spinner"></div>
              <span className="loading-text">{t('viewer.loading')}</span>
            </div>
          )}
          <div ref={containerRef} className="chart-area"></div>
        </div>

        {/* Period statistics */}
        {summary.length > 0 && (
          <div className="period-stats">
            <div className="period-stats-title">{t('detail.periodStats')}</div>
            <div className="summary-grid-period">
              {summary.map(item => (
                <div key={item.label} className="summary-item-dual">
                  <div className="summary-item-dual-title">{item.label}</div>
                  <div className="summary-item-dual-row">
                    <div className="summary-item-dual-cell">
                      <div className="summary-item-dual-cell-label">{t('viewer.high')}</div>
                      <div className="summary-item-dual-cell-value rate-up">{formatRate(item.high)}</div>
                    </div>
                    <div className="summary-item-dual-divider"></div>
                    <div className="summary-item-dual-cell">
                      <div className="summary-item-dual-cell-label">{t('viewer.low')}</div>
                      <div className="summary-item-dual-cell-value rate-down">{formatRate(item.low)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="scheduling-note">
              <span className="scheduling-note-icon">📅</span>
              <span>{t('detail.schedulingNote')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
