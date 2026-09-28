import { describe, expect, it } from 'vitest';
import i18n, { getSystemLocale, locales } from '../src/i18n';

describe('i18n interpolation', () => {
  it('uses single-brace placeholders (zh)', async () => {
    await i18n.changeLanguage('zh');
    expect(i18n.t('overview.updatedAt', { time: '12:00:00' })).toBe('更新于 12:00:00');
  });

  it('uses single-brace placeholders (en)', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('overview.updatedAt', { time: '12:00:00' })).toBe('Updated at 12:00:00');
  });

  it('uses single-brace placeholders (ja)', async () => {
    await i18n.changeLanguage('ja');
    expect(i18n.t('overview.updatedAt', { time: '12:00:00' })).toBe('12:00:00 更新');
  });
});

describe('getSystemLocale', () => {
  it('returns a supported locale', () => {
    expect(['zh', 'en', 'ja']).toContain(getSystemLocale());
  });
});

describe('locales', () => {
  it('lists the three supported locales', () => {
    expect(locales.map(l => l.value)).toEqual(['zh', 'en', 'ja']);
  });
});
