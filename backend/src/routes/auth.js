const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const {
  createCsrfToken,
  getJwtSecret,
  isAllowedOrigin,
  isSafeMethod,
  normalizeEmail,
  verifyCsrfRequest,
} = require('../security');
const { createToken, hashToken } = require('../services/tokens');
const { sendPasswordResetEmail } = require('../services/email');
const { issueEmailVerification } = require('../services/verification');

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000;
const EMAIL_REQUEST_COOLDOWN_MS = 60 * 1000;
const RESET_TOKEN_EXPIRY_MINUTES = 15;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_HASH_COST = 12;
const DEFAULT_SESSION = '8h';
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('glorious-hr-timing-equalizer', PASSWORD_HASH_COST);
const router = express.Router();

// Every cookie-handling endpoint on this router either goes through
// `authenticate` (which enforces a CSRF token pair) or is public (login,
// logout, forgot/reset/verify). CORS is not a CSRF defence, so for public
// state-changing routes we also reject browser requests from any Origin that is
// not one of ours. Non-browser clients send no Origin and are unaffected.
function assertOrigin(req, res, next) {
  if (isSafeMethod(req.method)) return next();
  if (isAllowedOrigin(req.headers?.origin)) return next();
  return res.status(403).json({ error: 'Origin not allowed' });
}
router.use(assertOrigin);

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

// The cookie lifetime has to match the token lifetime. These were two separate
// hardcoded 15 minute values, so a session could not outlive its own cookie and
// the first request after 15 minutes bounced the user back to the login page.
function sessionMaxAgeMs() {
  const raw = String(process.env.JWT_EXPIRES_IN || DEFAULT_SESSION).trim().toLowerCase();
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/);
  if (!match) return msFor(DEFAULT_SESSION);
  return msFor(`${match[1]}${match[2] || 's'}`);
}

function msFor(value) {
  const match = String(value).match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/);
  if (!match) return 8 * 60 * 60 * 1000;
  const multiplier = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  const ms = Number(match[1]) * multiplier;
  return Number.isFinite(ms) && ms > 0 ? ms : 8 * 60 * 60 * 1000;
}

function cookieOptions(httpOnly) {
  const configured = String(process.env.COOKIE_SAME_SITE || '').toLowerCase();
  const sameSite = ['lax', 'strict', 'none'].includes(configured)
    ? configured
    : isProduction()
      ? 'none'
      : 'lax';
  return {
    httpOnly,
    // The access cookie carries an 8 hour token, so it must never travel in
    // clear text. Production forces Secure unconditionally (SameSite=None is
    // rejected by browsers without it); development opts in with
    // COOKIE_SECURE=true. Loopback origins such as http://localhost are
    // treated as trustworthy, so Secure works there too.
    secure: isProduction() ? true : process.env.COOKIE_SECURE === 'true',
    sameSite,
    path: '/',
    maxAge: sessionMaxAgeMs(),
  };
}

function setAuthCookies(res, token, csrfToken) {
  res.cookie('access_token', token, cookieOptions(true));
  res.cookie('csrf_token', csrfToken, cookieOptions(false));
}

function clearAuthCookies(res) {
  const accessOptions = cookieOptions(true);
  const csrfOptions = cookieOptions(false);
  delete accessOptions.maxAge;
  delete csrfOptions.maxAge;
  res.clearCookie('access_token', accessOptions);
  res.clearCookie('csrf_token', csrfOptions);
}

function passwordResetInsertSql() {
  const driver = process.env.DB_DRIVER || 'sqlite';
  let sql = 'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, ';
  if (driver === 'postgres' || driver === 'postgresql' || driver === 'pg') {
    sql += `NOW() + INTERVAL '${RESET_TOKEN_EXPIRY_MINUTES} minutes')`;
  } else if (driver === 'mssql') {
    sql += `CONVERT(NVARCHAR(19), DATEADD(MINUTE, ${RESET_TOKEN_EXPIRY_MINUTES}, GETDATE()), 120))`;
  } else {
    sql += `datetime('now', '+${RESET_TOKEN_EXPIRY_MINUTES} minutes'))`;
  }
  return sql;
}

// The web app is served from a different origin than the API, and the
// csrf_token cookie is bound to the API's own domain, so document.cookie in
// the browser cannot read it cross-site. Hand the token back in the response
// body as well so the client can echo it in the X-CSRF-Token header. This is
// a safe GET, so it is exempt from the CSRF check itself.
router.get('/csrf', (req, res) => {
  const csrfToken = createCsrfToken();
  res.cookie('csrf_token', csrfToken, cookieOptions(false));
  res.json({ csrfToken });
});

router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    if (password.length > 200) {
      return res.status(400).json({ error: 'Password is too long' });
    }

    const clientIp = String(req.ip || 'unknown');
    // Lockout is keyed on the ACCOUNT, not on (email, ip). Keying it on the IP
    // let an attacker rotate addresses and keep guessing, because the lock row
    // was per (email, ip) pair. We still record the ip for forensics - it just
    // does not gate the lock. The per-IP express-rate-limit limiter remains as
    // the second layer for distributed guessing across many accounts.
    const lockRes = await pool.query(
      'SELECT locked_until FROM login_attempts WHERE email = $1 ORDER BY attempted_at DESC LIMIT 1',
      [email]
    );
    const lockedUntil = lockRes.rows[0]?.locked_until ? new Date(lockRes.rows[0].locked_until) : null;
    if (lockedUntil && !Number.isNaN(lockedUntil.getTime()) && lockedUntil > new Date()) {
      const remaining = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${remaining} minute(s).` });
    }

    const result = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name, u.role, u.department_id, u.position, u.manager_id,
              u.phone, u.gender, u.age, u.hire_date, u.status,
              CAST(u.annual_leave_balance AS INTEGER) AS annual_leave_balance,
              CAST(u.sick_leave_balance AS INTEGER) AS sick_leave_balance,
              u.tin_number, u.pension_number, u.emergency_contact, u.bank_account,
              u.gross_salary, u.transport_allowance, u.education, u.email_verified_at, u.created_at, u.token_version,
              d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.email = $1`,
      [email]
    );

    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
    if (!user || !passwordMatches) {
      await pool.query('INSERT INTO login_attempts (email, ip_address) VALUES ($1, $2)', [email, clientIp]);
      // Count every failure since the last successful sign-in, not just the
      // last 5 minutes. A sliding window let an attacker pace 5 guesses per
      // 5 minutes indefinitely; failures now accumulate until the owner signs
      // in (which clears the rows above), so each lockout escalates off the
      // prior-lock count below instead of quietly expiring.
      const countRes = await pool.query(
        'SELECT COUNT(*) AS count FROM login_attempts WHERE email = $1',
        [email]
      );
      if (Number.parseInt(countRes.rows[0]?.count, 10) >= MAX_LOGIN_ATTEMPTS) {
        const priorLocks = await pool.query(
          'SELECT COUNT(*) AS count FROM login_attempts WHERE email = $1 AND locked_until IS NOT NULL',
          [email]
        );
        const baseMinutes = LOCKOUT_DURATION_MS / 60000;
        const minutes = Math.min(120, baseMinutes * Math.pow(2, Number(priorLocks.rows[0]?.count || 0)));
        const lockedDate = new Date(Date.now() + minutes * 60000).toISOString();
        await pool.query(
          'UPDATE login_attempts SET locked_until = $1 WHERE email = $2 AND locked_until IS NULL',
          [lockedDate, email]
        );
        return res.status(429).json({ error: `Too many failed attempts. Try again in ${minutes} minutes.` });
      }
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await pool.query('DELETE FROM login_attempts WHERE email = $1', [email]);
    if (bcrypt.getRounds(user.password_hash) < PASSWORD_HASH_COST) {
      const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_COST);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user.id]);
    }
    if (!user.email_verified_at) {
      return res.status(403).json({ error: 'Verify your email before signing in', emailVerified: false });
    }
    if (user.status === 'inactive') {
      return res.status(403).json({ error: 'This account is inactive' });
    }

    const tokenVersion = Number(user.token_version || 0);
    const token = jwt.sign(
      { sub: String(user.id), tokenVersion },
      getJwtSecret(),
      {
        algorithm: 'HS256',
        expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_SESSION,
        issuer: process.env.JWT_ISSUER || 'glorious-hr-api',
        audience: process.env.JWT_AUDIENCE || 'glorious-hr-web',
      }
    );
    const csrfToken = createCsrfToken();
    const { password_hash, token_version, ...safeUser } = user;
    setAuthCookies(res, token, csrfToken);
    res.json({ user: safeUser, csrfToken });
  } catch (err) {
    console.error(err.message || 'Login failed');
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout must kill the JWT, not just drop the cookie. Stateless JWTs cannot be
// revoked individually, so we bump token_version: every token already issued for
// that account stops verifying immediately (same mechanism change/reset
// password already used). Trade-off: sign-out invalidates all of that user's
// sessions, not just the current one.
router.post('/logout', async (req, res) => {
  if (!verifyCsrfRequest(req.cookies?.csrf_token, req.headers['x-csrf-token'])) {
    return res.status(403).json({ error: 'CSRF validation failed' });
  }
  try {
    const header = String(req.headers.authorization || '');
    const bearerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = bearerToken || req.cookies?.access_token;
    if (token) {
      const payload = jwt.verify(token, getJwtSecret(), {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER || 'glorious-hr-api',
        audience: process.env.JWT_AUDIENCE || 'glorious-hr-web',
      });
      const userId = Number(payload.sub || payload.id);
      if (Number.isSafeInteger(userId) && userId > 0) {
        await pool.query('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = $1', [userId]);
      }
    }
  } catch (err) {
    // Token already invalid/expired - still clear cookies so a client can log out.
  }
  clearAuthCookies(res);
  res.json({ message: 'Signed out' });
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.position,
              u.phone, u.gender, u.age, u.hire_date, u.status,
              CAST(u.annual_leave_balance AS INTEGER) AS annual_leave_balance,
              CAST(u.sick_leave_balance AS INTEGER) AS sick_leave_balance,
              u.tin_number, u.pension_number, u.emergency_contact, u.bank_account,
              u.gross_salary, u.transport_allowance, u.education, u.email_verified_at,
              u.manager_id, d.name AS department_name,
              m.first_name AS manager_first_name, m.last_name AS manager_last_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN users m ON m.id = u.manager_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message || 'Failed to fetch profile');
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.post('/verify-email', async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const token = String(req.body?.token || '');
    if (!token || token.length > 512) return res.status(400).json({ error: 'Verification token is required' });

    await client.query('BEGIN');
    transactionStarted = true;
    const tokenHash = hashToken(token);
    const tokenRes = await client.query(
      `UPDATE email_verification_tokens
       SET used = 1
       WHERE token = $1 AND used = 0 AND expires_at > NOW()
       RETURNING id, user_id`,
      [tokenHash]
    );
    if (!tokenRes.rows[0]) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    await client.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1', [tokenRes.rows[0].user_id]);
    await client.query('COMMIT');
    transactionStarted = false;
    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    console.error(err.message || 'Email verification failed');
    res.status(500).json({ error: 'Email verification failed' });
  } finally {
    client.release();
  }
});

router.post('/resend-verification', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: 'A valid email is required' });

    const userRes = await pool.query(
      'SELECT id, email, first_name, email_verified_at FROM users WHERE email = $1',
      [email]
    );
    const user = userRes.rows[0];
    if (user && !user.email_verified_at) {
      const recentRes = await pool.query(
        'SELECT created_at FROM email_verification_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [user.id]
      );
      const recent = recentRes.rows[0];
      const canSend = !recent || Date.now() - new Date(recent.created_at).getTime() >= EMAIL_REQUEST_COOLDOWN_MS;
      if (canSend) {
        try {
          await issueEmailVerification(user);
        } catch (err) {
          console.error(`Failed to resend verification email: ${err.message}`);
        }
      }
    }
    res.json({ message: 'If an account requires verification, a new link has been sent.' });
  } catch (err) {
    console.error(err.message || 'Failed to send verification email');
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

router.post('/change-password', authenticate, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > 200) {
      return res.status(400).json({ error: `New password must be between ${PASSWORD_MIN_LENGTH} and 200 characters` });
    }

    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    if (!(await bcrypt.compare(currentPassword, result.rows[0].password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_HASH_COST);
    await pool.query(
      'UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2',
      [passwordHash, req.user.id]
    );
    clearAuthCookies(res);
    res.json({ message: 'Password changed successfully. Please sign in again.' });
  } catch (err) {
    console.error(err.message || 'Failed to change password');
    res.status(500).json({ error: 'Failed to change password' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: 'A valid email is required' });

    const userRes = await pool.query('SELECT id, email, first_name FROM users WHERE email = $1', [email]);
    const user = userRes.rows[0];
    // Equalize timing: burn the same bcrypt cost whether or not the account
    // exists, so the response latency does not reveal account existence. The
    // SMTP call can still add latency when a mail is actually sent, but that is
    // noisy, rate-limited, and gated behind the per-account cooldown below.
    await bcrypt.compare(DUMMY_PASSWORD_HASH + email, DUMMY_PASSWORD_HASH);
    if (user) {
      const recentRes = await pool.query(
        'SELECT created_at FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [user.id]
      );
      const recent = recentRes.rows[0];
      const canSend = !recent || Date.now() - new Date(recent.created_at).getTime() >= EMAIL_REQUEST_COOLDOWN_MS;
      if (canSend) {
        const token = createToken();
        try {
          await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1 AND used = 0', [user.id]);
          await pool.query(passwordResetInsertSql(), [user.id, hashToken(token)]);
          await sendPasswordResetEmail(user.email, user.first_name, token);
        } catch (err) {
          console.error(`Failed to send password reset email: ${err.message}`);
        }
      }
    }
    res.json({ message: 'If an account exists, a password reset link has been sent.' });
  } catch (err) {
    console.error(err.message || 'Failed to process password reset request');
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

router.post('/reset-password', async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const token = String(req.body?.token || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!token || token.length > 512 || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > 200) {
      return res.status(400).json({ error: `Password must be between ${PASSWORD_MIN_LENGTH} and 200 characters` });
    }

    await client.query('BEGIN');
    transactionStarted = true;
    const resetRes = await client.query(
      `UPDATE password_reset_tokens
       SET used = 1
       WHERE token = $1 AND used = 0 AND expires_at > NOW()
       RETURNING id, user_id`,
      [hashToken(token)]
    );
    if (!resetRes.rows[0]) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_HASH_COST);
    await client.query(
      `UPDATE users
       SET password_hash = $1,
           token_version = COALESCE(token_version, 0) + 1,
           email_verified_at = COALESCE(email_verified_at, NOW())
       WHERE id = $2`,
      [passwordHash, resetRes.rows[0].user_id]
    );
    await client.query('COMMIT');
    transactionStarted = false;
    res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    console.error(err.message || 'Failed to reset password');
    res.status(500).json({ error: 'Failed to reset password' });
  } finally {
    client.release();
  }
});

module.exports = router;
