import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings, ALL_PAIRS } from '../context/SettingsContext';
import { PAIR_FLAGS } from '../types';
import type { ThemeMode, Locale, NotificationRuleStatus } from '../types';
import i18n, { locales } from '../i18n';
import NotificationSubscriptions from './NotificationSubscriptions';

const themeOptions: { value: ThemeMode; icon: string }[] = [
  { value: 'system', icon: '💻' },
  { value: 'light', icon: '☀️' },
  { value: 'dark', icon: '🌙' },
];

const presets = [5, 15, 30, 60, 120, 300];

export default function Settings({ notificationStatuses = {} }: { notificationStatuses?: Record<string, NotificationRuleStatus> }) {
  const { t } = useTranslation();
  const { state, dispatch } = useSettings();
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);

  const appVersion = __APP_VERSION__;

  useEffect(() => {
    window.electronAPI.getAutoLaunch()
      .then(setAutoStartEnabled)
      .catch(e => console.error('Failed to read auto-launch state:', e));
  }, []);

  async function changeLocale(locale: Locale): Promise<void> {
    dispatch({ type: 'setLocale', locale });
    await i18n.changeLanguage(locale);
    await window.electronAPI.setLocale(locale);
  }

  async function onAutoStartChange(next: boolean): Promise<void> {
    try {
      await window.electronAPI.setAutoLaunch(next);
    } catch (e) {
      console.error('Failed to set auto-launch:', e);
      setAutoStartEnabled(!next);
    }
  }

  function getPresetLabel(value: number): string {
    if (value >= 60) {
      return t('settings.refreshInterval.minutes', { n: Math.floor(value / 60) });
    }
    return t('settings.refreshInterval.seconds', { n: value });
  }

  function handleReset(): void {
    dispatch({ type: 'reset' });
    void changeLocale('zh');
  }

  const isLastEnabled = (pair: string): boolean =>
    state.enabledPairs.length === 1 && state.enabledPairs[0] === pair;

  return (
    <div className="settings-content">

      {/* Appearance */}
      <div className="settings-group">
        <div className="settings-group-title">{t('settings.appearance.title')}</div>
        <div className="settings-group-desc">{t('settings.appearance.desc')}</div>
        <div className="theme-options">
          {themeOptions.map(opt => (
            <button
              key={opt.value}
              className={`theme-option${state.theme === opt.value ? ' active' : ''}`}
              onClick={() => dispatch({ type: 'setTheme', theme: opt.value })}
            >
              <div className="theme-option-icon">{opt.icon}</div>
              <div className="theme-option-label">{t(`settings.appearance.${opt.value}`)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Refresh interval */}
      <div className="settings-group">
        <div className="settings-group-title">{t('settings.refreshInterval.title')}</div>
        <div className="settings-group-desc">{t('settings.refreshInterval.desc')}</div>
        <div className="slider-row">
          <div className="slider-value">{state.refreshInterval}<span className="slider-unit">{t('settings.refreshInterval.unit')}</span></div>
          <div className="slider-track">
            <input
              type="range"
              min={5}
              max={300}
              step={5}
              value={state.refreshInterval}
              onChange={e => dispatch({ type: 'setRefreshInterval', value: Number(e.target.value) })}
              aria-label={t('settings.refreshInterval.title')}
            />
          </div>
        </div>
        <div className="slider-presets">
          {presets.map(p => (
            <button
              key={p}
              className={`slider-preset${state.refreshInterval === p ? ' active' : ''}`}
              onClick={() => dispatch({ type: 'setRefreshInterval', value: p })}
            >{getPresetLabel(p)}</button>
          ))}
        </div>
      </div>

      {/* Currency pairs */}
      <div className="settings-group">
        <div className="settings-group-title">{t('settings.pairs.title')}</div>
        <div className="settings-group-desc">{t('settings.pairs.desc')}</div>
        <div className="pair-chips">
          {ALL_PAIRS.map(pair => {
            const checked = state.enabledPairs.includes(pair);
            const disabled = checked && isLastEnabled(pair);
            return (
              <div
                key={pair}
                className={`pair-chip${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}
                onClick={() => { if (!disabled || !checked) dispatch({ type: 'togglePair', pair }); }}
              >
                <span className="pair-chip-check">{checked ? '✓' : ''}</span>
                <span>{PAIR_FLAGS[pair]} {t(`overview.pair.${pair}`)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <NotificationSubscriptions notificationStatuses={notificationStatuses} />

      {/* Language */}
      <div className="settings-group">
        <div className="settings-group-title">{t('settings.language.title')}</div>
        <div className="settings-group-desc">{t('settings.language.desc')}</div>
        <div className="lang-options">
          {locales.map(loc => (
            <button
              key={loc.value}
              className={`lang-option${state.locale === loc.value ? ' active' : ''}`}
              onClick={() => void changeLocale(loc.value)}
            >
              <div className="lang-option-label">{loc.label}</div>
              <div className="lang-option-sub">{loc.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* General */}
      <div className="settings-group">
        <div className="settings-group-title">{t('settings.general.title')}</div>
        <div className="settings-group-desc">{t('settings.general.desc')}</div>
        <div className="setting-row">
          <div>
            <div className="setting-row-label">{t('settings.general.autoStart')}</div>
            <div className="setting-row-desc">{t('settings.general.autoStartDesc')}</div>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={autoStartEnabled} onChange={e => void onAutoStartChange(e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-row-label">{t('settings.general.notification')}</div>
            <div className="setting-row-desc">{t('settings.general.notificationDesc')}</div>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" aria-label={t('settings.general.notification')} checked={state.notification} onChange={e => dispatch({ type: 'setNotification', value: e.target.checked })} />
            <span className="toggle-slider"></span>
          </label>
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-row-label">{t('settings.general.minimizeToTray')}</div>
            <div className="setting-row-desc">{t('settings.general.minimizeToTrayDesc')}</div>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={state.minimizeToTray} onChange={e => dispatch({ type: 'setMinimizeToTray', value: e.target.checked })} />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>

      {/* About */}
      <div className="settings-group">
        <div className="settings-group-title">{t('settings.about.title')}</div>
        <div className="about-row">
          <span className="about-label">{t('settings.about.version')}</span>
          <span className="about-value">{appVersion}</span>
        </div>
        <div className="about-row">
          <span className="about-label">{t('settings.about.dataSource')}</span>
          <span className="about-value">{t('settings.about.dataSourceValue')}</span>
        </div>
        <div className="about-row">
          <span className="about-label">{t('settings.about.actions')}</span>
          <button className="btn-reset" onClick={handleReset}>{t('settings.reset.button')}</button>
        </div>
      </div>

    </div>
  );
}
