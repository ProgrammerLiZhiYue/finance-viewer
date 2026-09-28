import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh';
import en from './locales/en';
import ja from './locales/ja';
import type { Locale } from './types';

export const locales: { value: Locale; label: string; sub: string }[] = [
  { value: 'zh', label: '中文', sub: '简体中文' },
  { value: 'en', label: 'English', sub: '英文' },
  { value: 'ja', label: '日本語', sub: '日文' },
];

/**
 * 获取系统语言，返回支持的 locale
 * 如果系统语言不在支持列表中，默认返回 'zh'
 */
export function getSystemLocale(): Locale {
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('en')) return 'en';
  return 'zh';
}

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
    ja: { translation: ja },
  },
  lng: getSystemLocale(),
  fallbackLng: 'zh',
  // 语言文件沿用 vue-i18n 的 {key} 单括号插值
  interpolation: {
    prefix: '{',
    suffix: '}',
    escapeValue: false,
  },
});

export default i18n;
