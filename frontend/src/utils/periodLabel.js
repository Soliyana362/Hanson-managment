const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function formatDateText(value, locale) {
  const match = String(value || '').trim().match(datePattern);
  if (!match) return value;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(locale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// `t` is optional so the utility stays usable outside a LanguageProvider; it
// only localises the English range words the backend stores in period labels.
export function displayPeriodLabel(label, keepRaw = false, options = {}) {
  const { locale, t } = typeof options === 'string' ? { locale: options, t: undefined } : options;
  const translate = (key, fallback) => (t ? t(key) : fallback);
  if (keepRaw || !label) return label || '-';

  const format = (value) => formatDateText(value, locale);
  const text = String(label);
  const range = text.match(/^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/);
  if (range) return `${format(range[1])} – ${format(range[2])}`;

  const from = text.match(/^From (\d{4}-\d{2}-\d{2})$/);
  if (from) return `${translate('period.from', 'From')} ${format(from[1])}`;

  const until = text.match(/^Until (\d{4}-\d{2}-\d{2})$/);
  if (until) return `${translate('period.until', 'Until')} ${format(until[1])}`;

  const generated = text.match(/^KPI (\d{4}-\d{2}-\d{2})$/);
  if (generated) return `KPI ${format(generated[1])}`;

  return text.replace(/\d{4}-\d{2}-\d{2}/g, format);
}
