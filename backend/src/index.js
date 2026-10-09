require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const leaveRoutes = require('./routes/leave');
const kpiRoutes = require('./routes/kpi');
const dashboardRoutes = require('./routes/dashboard');
const notificationRoutes = require('./routes/notifications');
const vacancyRoutes = require('./routes/vacancies');
const uploadRoutes = require('./routes/uploads');
const letterRoutes = require('./routes/letters');
const { restoreLeaveStatuses } = require('./jobs/leave-status');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = new Set(
  (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
);

// Vite may serve the app on a different loopback port (for example when 3000 is
// busy), so local development accepts any loopback origin instead of a fixed one.
const isLoopbackOrigin = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);

// Trust a reverse proxy only when explicitly enabled - never implicitly from
// NODE_ENV. 'true' means exactly one hop; an integer sets the exact hop count.
// Leaving it unset (the default) makes req.ip the direct peer, which is correct
// behind nginx/cloudfront only once TRUST_PROXY is set to match the hop count.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy && trustProxy !== 'false') {
  const hopCount = Number(trustProxy);
  app.set('trust proxy', trustProxy === 'true' ? true : Number.isInteger(hopCount) && hopCount > 0 ? hopCount : true);
}
app.disable('x-powered-by');

app.use(
  cors({
    origin(origin, callback) {
      const normalized = origin ? origin.replace(/\/$/, '') : origin;
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(normalized)) return callback(null, true);
      if (!isProduction && isLoopbackOrigin(normalized)) return callback(null, true);
      console.warn(`[cors] rejected origin: ${origin}`);
      return callback(new Error('Origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  })
);
app.use(
  helmet({
    strictTransportSecurity: isProduction
      ? { maxAge: 15552000, includeSubDomains: true, preload: true }
      : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", ...allowedOrigins],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
      },
    },
    permissionsPolicy: {
      directives: {
        camera: ["'none'"],
        microphone: ["'none'"],
        geolocation: ["'none'"],
        payment: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '1mb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
// Keyed by IP, so everyone behind one office router shares this budget. The
// per-account lockout in routes/auth.js is the real brute-force defence, which
// lets this stay generous enough that a busy office is not locked out.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication requests. Please try again later.' },
});
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests. Please try again later.' },
});

app.get('/api/health', (_, res) => res.json({ status: 'ok', service: 'Glorious HR API' }));
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
// Only writes are limited. The budget exists to stop someone filling the disk
// with spam POSTs, not to throttle ordinary reads - a single employee page
// issues several GET /uploads list + file requests, so a 20/15min cap on reads
// locked HR out of viewing letters. Reads still sit under the 300/15min
// apiLimiter above, and every route is authenticated and object-authorized.
app.use('/api/uploads', (req, res, next) => {
  if (req.method === 'GET') return next();
  return uploadLimiter(req, res, next);
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/vacancies', vacancyRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/letters', letterRoutes);

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  if (err.message === 'Origin not allowed') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  console.error(err.message || 'Unhandled server error');
  res.status(500).json({ error: 'Internal server error' });
});

const HOST = process.env.HOST || '127.0.0.1';
const LEAVE_RESTORE_INTERVAL_MS = 15 * 60 * 1000;
app.listen(PORT, HOST, () => {
  console.log(`Glorious HR API running on http://${HOST}:${PORT}`);
});

restoreLeaveStatuses().catch(() => {});
setInterval(() => restoreLeaveStatuses().catch(() => {}), LEAVE_RESTORE_INTERVAL_MS);
