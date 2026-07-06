import { hu, type I18nKey } from './hu';
import { en } from './en';

/**
 * Tiny i18n helper. Hungarian is primary, English is the fallback. The active
 * language is a module-level flag (not in the pinned store shape) toggled from
 * the start screen; t() reads it at call time, so both React components and the
 * non-React audio module resolve strings against the current language.
 */
export type Lang = 'hu' | 'en';

const TABLES: Record<Lang, Record<I18nKey, string>> = { hu, en };

let current: Lang = 'hu';

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

/** Resolve a key for the active language, filling {placeholder} tokens. */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  let s: string = TABLES[current][key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}
