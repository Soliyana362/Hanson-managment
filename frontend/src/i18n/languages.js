export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'am', label: 'አማርኛ', short: 'አማ' },
];

export const DEFAULT_LANGUAGE = 'en';
export const STORAGE_KEY = 'glorious.language';

// BCP 47 tags drive date/number/currency formatting. Amharic uses Latin digits
// and an "en-ET" calendar so the Ethiopic locale does not switch to Ethiopic numerals.
export const LOCALE_TAGS = {
  en: 'en-ET',
  am: 'am-ET',
};

export function isSupported(code) {
  return LANGUAGES.some((language) => language.code === code);
}
