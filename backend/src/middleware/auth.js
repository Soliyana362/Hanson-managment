const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { getJwtSecret, isSafeMethod, verifyCsrfRequest } = require('../security');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const cookieToken = req.cookies?.access_token;
  const token = bearerToken || cookieToken;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || 'glorious-hr-api',
      audience: process.env.JWT_AUDIENCE || 'glorious-hr-web',
    });
    const userId = Number(payload.sub || payload.id);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const result = await pool.query(
      'SELECT id, email, role, status, token_version FROM users WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];
    const tokenVersion = Number(payload.tokenVersion ?? 0);
    const currentVersion = Number(user?.token_version ?? 0);

    if (!user || user.status === 'inactive' || tokenVersion !== currentVersion) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (!bearerToken && !isSafeMethod(req.method) && !verifyCsrfRequest(req.cookies?.csrf_token, req.headers['x-csrf-token'])) {
      return res.status(403).json({ error: 'CSRF validation failed' });
    }

    req.user = {
      id: Number(user.id),
      email: user.email,
      role: user.role,
      status: user.status,
    };
    next();
  } catch (err) {
    if (err.message?.includes('JWT_SECRET')) {
      console.error(err.message);
      return res.status(500).json({ error: 'Authentication is not configured' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
