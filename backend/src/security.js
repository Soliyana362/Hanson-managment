const crypto = require('crypto');
const pool = require('./config/db');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ROLES = new Set(['employee', 'manager', 'hr', 'admin', 'coo']);
const STATUSES = new Set(['active', 'on_leave', 'inactive']);

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || secret === 'change-this-to-a-secure-random-string') {
    throw new Error('JWT_SECRET must be a unique value of at least 32 characters');
  }
  return secret;
}

function getCsrfSecret() {
  const base = process.env.CSRF_SECRET || process.env.JWT_SECRET;
  if (!base || base.length < 32 || base === 'change-this-to-a-secure-random-string') {
    throw new Error('CSRF_SECRET must be a unique value of at least 32 characters');
  }
  return crypto.createHmac('sha256', base).update('glorious-hr:csrf-only').digest('hex');
}

function createCsrfToken() {
  const nonce = crypto.randomBytes(32).toString('hex');
  const signature = crypto.createHmac('sha256', getCsrfSecret()).update(nonce).digest('hex');
  return `${nonce}.${signature}`;
}

function verifyCsrfToken(token) {
  if (typeof token !== 'string') return false;
  const [nonce, signature] = token.split('.');
  if (!nonce || !signature || !/^[a-f0-9]{64}$/i.test(nonce) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }
  const expected = crypto.createHmac('sha256', getCsrfSecret()).update(nonce).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function verifyCsrfRequest(cookieToken, headerToken) {
  if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') return false;
  if (!verifyCsrfToken(cookieToken) || !verifyCsrfToken(headerToken)) return false;
  const cookieBuffer = Buffer.from(cookieToken, 'utf8');
  const headerBuffer = Buffer.from(headerToken, 'utf8');
  return cookieBuffer.length === headerBuffer.length && crypto.timingSafeEqual(cookieBuffer, headerBuffer);
}

function isSafeMethod(method) {
  return SAFE_METHODS.has(String(method || 'GET').toUpperCase());
}

// CSRF line of defence for cookie-handling endpoints that do not go through the
// authenticated CSRF check: if a browser sends an Origin that is not the app's
// own frontend (or a dev loopback origin), reject the state-changing request.
// Requests without an Origin (non-browser clients) are allowed.
function isAllowedOrigin(origin) {
  if (typeof origin !== 'string' || !origin) return true;
  const normalized = origin.trim().replace(/\/$/, '');
  const allowed = new Set(
    (process.env.FRONTEND_URL || 'http://localhost:3000')
      .split(',')
      .map((value) => value.trim().replace(/\/$/, ''))
      .filter(Boolean)
  );
  if (allowed.has(normalized)) return true;
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(normalized)) return true;
  return false;
}

function parseId(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!/^\d{1,15}$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 255) return null;
  return email;
}

function cleanText(value, maxLength = 255) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function normalizeGender(value) {
  if (value === '' || value === null || value === undefined) return null;
  const gender = String(value).trim().toLowerCase();
  return ['female', 'male', 'other', 'prefer_not_to_say'].includes(gender) ? gender : null;
}

function normalizeAge(value) {
  if (value === '' || value === null || value === undefined) return null;
  const age = Number(value);
  return Number.isInteger(age) && age >= 0 && age <= 130 ? age : null;
}

function normalizeDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

function validDateRange(start, end) {
  const normalizedStart = normalizeDate(start);
  const normalizedEnd = normalizeDate(end);
  if (!normalizedStart || !normalizedEnd || normalizedEnd < normalizedStart) return null;
  return { start: normalizedStart, end: normalizedEnd, days: Math.floor((Date.parse(`${normalizedEnd}T00:00:00.000Z`) - Date.parse(`${normalizedStart}T00:00:00.000Z`)) / 86400000) + 1 };
}

function isRole(value) {
  return ROLES.has(value);
}

function isStatus(value) {
  return STATUSES.has(value);
}

function canAssignRole(actorRole, targetRole) {
  if (!isRole(targetRole)) return false;
  if (actorRole === 'admin') return true;
  if (actorRole === 'hr') return targetRole === 'employee' || targetRole === 'manager';
  return false;
}

async function canAccessEmployee(actor, targetUserId) {
  const targetId = parseId(targetUserId);
  const actorId = parseId(actor?.id);
  if (!targetId || !actorId) return false;
  if (actorId === targetId) return true;
  if (['hr', 'admin', 'coo'].includes(actor.role)) return true;
  if (actor.role !== 'manager') return false;
  const result = await pool.query('SELECT 1 AS allowed FROM users WHERE id = $1 AND manager_id = $2', [targetId, actorId]);
  return Boolean(result.rows[0]);
}

function canEditUser(actor, targetUserId) {
  const targetId = parseId(targetUserId);
  const actorId = parseId(actor?.id);
  if (!targetId || !actorId) return false;
  return actorId === targetId || ['hr', 'admin'].includes(actor.role);
}

function isPrivilegedRole(role) {
  return ['hr', 'admin', 'coo'].includes(role);
}

module.exports = {
  canAccessEmployee,
  canAssignRole,
  canEditUser,
  cleanText,
  createCsrfToken,
  getCsrfSecret,
  getJwtSecret,
  isAllowedOrigin,
  isPrivilegedRole,
  isRole,
  isSafeMethod,
  isStatus,
  normalizeAge,
  normalizeDate,
  normalizeEmail,
  normalizeGender,
  parseId,
  validDateRange,
  verifyCsrfRequest,
  verifyCsrfToken,
};
