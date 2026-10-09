import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../src/i18n/locales/en.js';
import am from '../src/i18n/locales/am.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');

function flatten(object, prefix = '') {
  const result = new Map();
  if (typeof object !== 'object' || object === null) {
    // Strings and numbers are leaves; iterating them would split into characters.
    return result.set(prefix, object);
  }
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      // Long-form documents store paragraphs/lists as arrays; expand them so
      // every translatable string is validated individually.
      for (const [index, item] of value.entries()) {
        for (const [childPath, childValue] of flatten(item, `${path}[${index}]`)) {
          result.set(childPath, childValue);
        }
      }
      continue;
    }
    if (value && typeof value === 'object') {
      // Plural forms are leaves, not nested translation groups.
      if ('one' in value && 'other' in value) {
        result.set(path, value);
        continue;
      }
      for (const [childPath, childValue] of flatten(value, path)) result.set(childPath, childValue);
    } else {
      result.set(path, value);
    }
  }
  return result;
}

const english = flatten(en);
const amharic = flatten(am);

const missingInAmharic = [...english.keys()].filter((key) => !amharic.has(key));
const missingInEnglish = [...amharic.keys()].filter((key) => !english.has(key));
// Acronyms and format examples are intentionally identical across locales.
const ALLOWED_IDENTICAL = new Set([
  'nav.kpi',
  'kpi.indicator',
  'login.emailPlaceholder',
  'education.phd',
  'kpi.saveAs',
  'coo.age30to44',
  'coo.age45plus',
  'files.sizeBytes',
  'files.sizeKb',
  'files.sizeMb',
]);

const identical = [...english.keys()].filter(
  (key) =>
    !ALLOWED_IDENTICAL.has(key) &&
    amharic.has(key) &&
    typeof english.get(key) === 'string' &&
    english.get(key) === amharic.get(key),
);

let failed = false;

// Amharic text is easily corrupted by bad encoding; U+FFFD would render as a box.
for (const [key, value] of english) {
  for (const form of value && typeof value === 'object' ? Object.values(value) : [value]) {
    if (typeof form === 'string' && form.includes('\uFFFD')) {
      failed = true;
      console.error(`Encoding corruption in English key ${key}`);
    }
  }
}
for (const [key, value] of amharic) {
  for (const form of value && typeof value === 'object' ? Object.values(value) : [value]) {
    if (typeof form === 'string' && form.includes('\uFFFD')) {
      failed = true;
      console.error(`Encoding corruption in Amharic key ${key}`);
    }
  }
}

if (missingInAmharic.length) {
  failed = true;
  console.error(`Missing ${missingInAmharic.length} Amharic key(s):`);
  missingInAmharic.forEach((key) => console.error(`  - ${key}`));
}
if (missingInEnglish.length) {
  failed = true;
  console.error(`Missing ${missingInEnglish.length} English key(s):`);
  missingInEnglish.forEach((key) => console.error(`  - ${key}`));
}
if (identical.length) {
  failed = true;
  console.error(`Untranslated (identical to English) ${identical.length} key(s):`);
  identical.forEach((key) => console.error(`  - ${key} = ${JSON.stringify(english.get(key))}`));
}

// Placeholders must match between locales or interpolation silently breaks.
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
for (const [key, value] of english) {
  const englishForms = value && typeof value === 'object' ? Object.entries(value) : [[null, value]];
  const amharicValue = amharic.get(key);
  for (const [form, text] of englishForms) {
    if (typeof text !== 'string') continue;
    const amharicText = amharicValue && typeof amharicValue === 'object' ? amharicValue[form] : amharicValue;
    if (typeof amharicText !== 'string') continue;
    const expected = placeholders(text);
    const actual = placeholders(amharicText);
    if (expected.join(',') !== actual.join(',')) {
      failed = true;
      console.error(`Placeholder mismatch at ${key}${form ? `.${form}` : ''}: en=[${expected}] am=[${actual}]`);
    }
  }
}

// Detect user-visible English left in components instead of a t() lookup.
function sourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === path.join(srcDir, 'i18n', 'locales')) continue;
      sourceFiles(full, found);
    } else if (/\.jsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const HARDCODED = [
  ['text', />([A-Za-z][A-Za-z0-9 ,'&()./%+:-]{2,60})</g],
  ['message', /\bset(?:Error|Success|Message)\(\s*'([A-Z][^']{4,80})'/g],
  ['fallback', /\.data\?\.error\s*\|\|\s*'([A-Z][^']{4,80})'/g],
  ['placeholder', /\b(?:placeholder|title|aria-label|alt)="([A-Z][^"]{2,70})"/g],
];
// Values that must stay English because they are identifiers or brand names,
// not prose: the KPI import matches these column headers exactly.
const HARDCODED_ALLOWED = new Set([
  'Hanson',
  'name',
  'target',
  'weight',
  'definition',
  'rating criteria',
  'template name',
  'role title',
  'department',
  '.xls',
  '.xlsx',
]);

for (const file of sourceFiles(srcDir).sort()) {
  const relative = path.relative(path.join(here, '..'), file);
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (/^\s*(import|const|export|\/\/|\*)/.test(line)) return;
    for (const [kind, re] of HARDCODED) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(line))) {
        const value = match[1].trim();
        if (!value || /^[#\d\s]*$/.test(value) || HARDCODED_ALLOWED.has(value)) continue;
        failed = true;
        console.error(`Hardcoded ${kind} in ${relative}:${index + 1}: ${JSON.stringify(value)}`);
      }
    }
  });
}

// Amharic values must not contain letters from other scripts; a stray Georgian
// or Cyrillic character usually means a copy/paste encoding mistake. ASCII
// letters are skipped because products, units and file extensions stay English.
// Newlines and tabs are allowed because Amharic is written without spaces, so
// multi-line blocks are the only readable way to present longer copy.
const ALLOWED_NON_AMHARIC = /^[\x09\x0A\x20-\x7E\u00AB\u00BB\u2013\u2014\u2018\u2019\u201C\u201D]+$/;
for (const [key, value] of amharic) {
  for (const form of value && typeof value === 'object' ? Object.values(value) : [value]) {
    if (typeof form !== 'string') continue;
    if (/[\u0370-\u04FF]/.test(form)) {
      failed = true;
      console.error(`Unexpected Cyrillic/Greek script in Amharic key ${key}: ${JSON.stringify(form)}`);
    }
    // Strip ASCII, Ethiopic, and the punctuation we intentionally mix in; any
    // remaining character belongs to a script that should not appear here.
    const stray = [...form].find((char) => {
      if (char >= '\u1200' && char <= '\u137F') return false;
      if (ALLOWED_NON_AMHARIC.test(char)) return false;
      return true;
    });
    if (stray) {
      failed = true;
      console.error(`Unexpected script in Amharic key ${key}: U+${stray.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
    }
  }
}

console.log(`Checked ${english.size} English / ${amharic.size} Amharic keys.`);
if (!failed) console.log('PASS: locales are in parity.');
process.exit(failed ? 1 : 0);
