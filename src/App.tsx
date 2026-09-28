import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import OverviewView from './components/OverviewView';
import ExchangeRateViewer from './components/ExchangeRateViewer';
import StockViewer from './components/StockViewer';
import SettingsView from './components/Settings';
import { useSettings } from './context/SettingsContext';
import { useCountdown } from './hooks/useCountdown';
import { useRateNotifications } from './hooks/useRateNotifications';
import i18n from './i18n';
import type { CurrencyPair, HKStockCode } from './types';

type Page = 'overview' | 'detail' | 'stock' | 'settings';
type Platform = 'macos' | 'windows' | 'linux';

export default function App() {
  const { t } = useTranslation();
  const { state, dispatch } = useSettings();
  const notificationStatuses = useRateNotifications();

  const [currentPage, setCurrentPage] = useState<Page>('overview');
  const [systemDark, setSystemDark] = useState(false);
  const [platform, setPlatform] = useState<Platform>('windows');
  const [overviewReady, setOverviewReady] = useState(false);
  const [detailReady, setDetailReady] = useState(false);
  const [stockReady, setStockReady] = useState(false);
  const [detailInitialPair, setDetailInitialPair] = useState<CurrencyPair | null>(null);
  const [stockInitialStock, setStockInitialStock] = useState<HKStockCode | null>(null);

  const isDark = state.theme === 'system' ? systemDark : state.theme === 'dark';

  // 渲染阶段同步写主题属性，保证子组件重绘图表时读到新 CSS 变量
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';

  const { value: countdownValue } = useCountdown(state.refreshInterval, { autoRestart: true });

  useEffect(() => {
    const cleanupNav = window.electronAPI.onNavigateToSettings(() => setCurrentPage('settings'));

    void window.electronAPI.getPlatform().then(p => {
      const detected = p as Platform;
      setPlatform(detected);
      document.documentElement.dataset.platform = detected;
    });

    let cleanupTheme: (() => void) | undefined;
    void window.electronAPI.getSystemTheme().then(dark => {
      setSystemDark(dark);
      cleanupTheme = window.electronAPI.onSystemThemeChange(setSystemDark);
    });

    setOverviewReady(true);
    void window.electronAPI.setLocale(state.locale);

    return () => {
      cleanupNav();
      cleanupTheme?.();
    };
  }, []);

  useEffect(() => {
    void i18n.changeLanguage(state.locale);
  }, [state.locale]);

  function toggleTheme(): void {
    dispatch({ type: 'setTheme', theme: isDark ? 'light' : 'dark' });
  }

  function switchPage(page: Page): void {
    setCurrentPage(page);
    if (page === 'overview') setOverviewReady(true);
    if (page === 'detail') setDetailReady(true);
    if (page === 'stock') setStockReady(true);
  }

  function onSelectPair(pair: CurrencyPair): void {
    setDetailInitialPair(pair);
    setDetailReady(true);
    setCurrentPage('detail');
  }

  function onSelectStock(stock: HKStockCode): void {
    setStockInitialStock(stock);
    setStockReady(true);
    setCurrentPage('stock');
  }

  const pages: { key: Page; label: string }[] = [
    { key: 'overview', label: t('nav.overview') },
    { key: 'detail', label: t('nav.detail') },
    { key: 'stock', label: t('nav.stock') },
    { key: 'settings', label: t('nav.settings') },
  ];

  const panelClass = (page: Page): string =>
    `view-panel${currentPage === page ? ' active' : ''}`;

  return (
    <div className="window-frame">
      {/* Title Bar */}
      <header className="title-bar">
        {/* macOS traffic lights */}
        {platform === 'macos' && (
          <div className="platform-ctrls" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="traffic-lights">
              <div className="traffic-light tl-close" onClick={() => void window.electronAPI.windowClose()}></div>
              <div className="traffic-light tl-minimize" onClick={() => void window.electronAPI.windowMinimize()}></div>
              <div className="traffic-light tl-maximize" onClick={() => void window.electronAPI.windowMaximize()}></div>
            </div>
          </div>
        )}
        {/* Windows icon + label */}
        {platform === 'windows' && (
          <div className="platform-ctrls">
            <span className="win-title-icon">💱</span>
            <span className="win-title-label">{t('app.title')}</span>
          </div>
        )}
        {/* Linux icon + label */}
        {platform === 'linux' && (
          <div className="platform-ctrls">
            <span className="linux-title-icon">💱</span>
            <span className="linux-title-label">{t('app.title')}</span>
          </div>
        )}

        {platform !== 'windows' && (
          <span className={`title-text${platform === 'macos' ? ' title-text-macos' : ''}`}>{t('app.title')}</span>
        )}

        <div className="title-bar-actions">
          <div className="refresh-indicator">
            <span className="refresh-dot"></span>
            <span className="tabular-nums">{countdownValue}s</span>
          </div>
          <button className="theme-toggle" aria-label={t('settings.appearance.title')} onClick={toggleTheme}>
            <span>{isDark ? '☀️' : '🌙'}</span>
          </button>
          {/* Windows controls */}
          {platform === 'windows' && (
            <div className="win-window-controls">
              <button className="win-ctrl-btn" title={t('nav.overview')} aria-label="minimize" onClick={() => void window.electronAPI.windowMinimize()}>
                <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" /></svg>
              </button>
              <button className="win-ctrl-btn" aria-label="maximize" onClick={() => void window.electronAPI.windowMaximize()}>
                <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
              </button>
              <button className="win-ctrl-btn win-close-btn" aria-label="close" onClick={() => void window.electronAPI.windowClose()}>
                <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.1" /><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.1" /></svg>
              </button>
            </div>
          )}
          {/* Linux controls */}
          {platform === 'linux' && (
            <div className="linux-window-controls">
              <button className="linux-ctrl-btn" aria-label="minimize" onClick={() => void window.electronAPI.windowMinimize()}>
                <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" /></svg>
              </button>
              <button className="linux-ctrl-btn" aria-label="maximize" onClick={() => void window.electronAPI.windowMaximize()}>
                <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
              </button>
              <button className="linux-ctrl-btn linux-close-btn" aria-label="close" onClick={() => void window.electronAPI.windowClose()}>
                <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" /><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.5" /></svg>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Navigation */}
      <nav className="nav-bar">
        <div className="nav-pills" role="tablist">
          {pages.map(page => (
            <button
              key={page.key}
              className={`nav-pill${currentPage === page.key ? ' active' : ''}`}
              role="tab"
              aria-selected={currentPage === page.key}
              onClick={() => switchPage(page.key)}
            >{page.label}</button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="content-area">
        <section className={panelClass('overview')}>
          {overviewReady && <OverviewView onSelectPair={onSelectPair} onSelectStock={onSelectStock} />}
        </section>
        <section className={panelClass('detail')}>
          {detailReady && <ExchangeRateViewer isDark={isDark} initialPair={detailInitialPair} />}
        </section>
        <section className={panelClass('stock')}>
          {stockReady && <StockViewer isDark={isDark} initialStock={stockInitialStock} />}
        </section>
        <section className={panelClass('settings')}>
          {currentPage === 'settings' && <SettingsView notificationStatuses={notificationStatuses} />}
        </section>
      </main>
    </div>
  );
}
