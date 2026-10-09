import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './locales/en';
import am from './locales/am';
import { DEFAULT_LANGUAGE, LANGUAGES, LOCALE_TAGS, STORAGE_KEY, isSupported } from './languages';

const TRANSLATIONS = { en, am };
const LanguageContext = createContext(null);

function readStoredLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isSupported(stored)) return stored;
  } catch {
    // localStorage can be unavailable in private mode; fall through to detection.
  }
  const preferred = (typeof navigator !== 'undefined' && navigator.language) || '';
  if (isSupported(preferred)) return preferred;
  if (preferred.toLowerCase().startsWith('am')) return 'am';
  return DEFAULT_LANGUAGE;
}

function lookup(dictionary, key) {
  return key.split('.').reduce((value, part) => (value == null ? undefined : value[part]), dictionary);
}

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(readStoredLanguage);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Persisting is best-effort; the app still works without it.
    }
    document.documentElement.lang = language;
    document.documentElement.dir = 'ltr';
  }, [language]);

  const t = useCallback(
    (key, fallbackOrVars, maybeVars) => {
      const dictionary = TRANSLATIONS[language] || TRANSLATIONS[DEFAULT_LANGUAGE];
      let value = lookup(dictionary, key);
      if (value === undefined) value = lookup(TRANSLATIONS[DEFAULT_LANGUAGE], key);
      if (value === undefined) return key;

      let vars = typeof fallbackOrVars === 'object' && fallbackOrVars !== null ? fallbackOrVars : maybeVars;

      // `t(key, count)` selects a one/other plural form.
      if (typeof fallbackOrVars === 'number') {
        vars = { ...vars, count: fallbackOrVars };
      }

      // Resolve `{ one, other }` plural values for both `t(key, 1)` and
      // `t(key, { count: 1 })`. Without this the raw object reaches React,
      // which throws "Objects are not valid as a React child".
      if (value && typeof value === 'object'
        && typeof value.one === 'string' && typeof value.other === 'string') {
        value = Number(vars?.count) === 1 ? value.one : value.other;
      }

      if (typeof value !== 'string') return value;
      return value.replace(/\{(\w+)\}/g, (match, name) => (vars?.[name] !== undefined ? vars[name] : match));
    },
    [language],
  );

  // Long-form documents (legal pages) are structured objects rather than flat strings.
  const getDocument = useCallback(
    (key) => {
      const dictionary = TRANSLATIONS[language] || TRANSLATIONS[DEFAULT_LANGUAGE];
      return lookup(dictionary, key) ?? lookup(TRANSLATIONS[DEFAULT_LANGUAGE], key);
    },
    [language],
  );

  const locale = LOCALE_TAGS[language] || LOCALE_TAGS[DEFAULT_LANGUAGE];
  const EMPTY = '—';

  const formatDate = useCallback(
    (value, options) => {
      if (!value) return EMPTY;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString(locale, options);
    },
    [locale],
  );

  const formatCurrency = useCallback(
    (value, currency = 'ETB') =>
      value == null ? EMPTY : new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value),
    [locale],
  );

  const formatNumber = useCallback(
    (value, options) => (value == null ? EMPTY : new Intl.NumberFormat(locale, options).format(value)),
    [locale],
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      getDocument,
      locale,
      formatDate,
      formatCurrency,
      formatNumber,
      languages: LANGUAGES,
      isAmharic: language === 'am',
    }),
    [language, t, getDocument, locale, formatDate, formatCurrency, formatNumber],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside a LanguageProvider');
  return context;
}

export default LanguageContext;
