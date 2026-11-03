const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { parseId } = require('../security');
const { safeOriginalName, uploadReport, uploadSingle, hasSignatureBuffer } = require('../fileStore');

const router = express.Router();
const DB_DRIVER = String(process.env.DB_DRIVER || 'sqlite').toLowerCase();
const IS_POSTGRES = ['postgres', 'postgresql', 'pg'].includes(DB_DRIVER);
const IS_MSSQL = DB_DRIVER === 'mssql';
let reportTableReady = null;

function ensureReportTable() {
  if (!reportTableReady) {
    const createTable = IS_MSSQL
      ? `IF OBJECT_ID('dbo.employee_reports', 'U') IS NULL
         BEGIN
           CREATE TABLE employee_reports (
             id INT IDENTITY(1,1) PRIMARY KEY,
             user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             report_type NVARCHAR(20) NOT NULL CHECK (report_type IN ('monthly', 'annual')),
             report_year INT NOT NULL CHECK (report_year BETWEEN 1900 AND 2100),
             report_month INT NOT NULL DEFAULT 0,
             original_name NVARCHAR(255) NOT NULL,
             mime_type NVARCHAR(100) NOT NULL,
             size_bytes BIGINT NOT NULL,
             data VARBINARY(MAX) NOT NULL,
             created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120),
             CONSTRAINT UQ_employee_reports_period UNIQUE (user_id, report_year, report_month),
             CONSTRAINT CK_employee_reports_period CHECK ((report_type = 'monthly' AND report_month BETWEEN 1 AND 12) OR (report_type = 'annual' AND report_month = 0))
           );
         END`
      : IS_POSTGRES
        ? `CREATE TABLE IF NOT EXISTS employee_reports (
             id SERIAL PRIMARY KEY,
             user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             report_type VARCHAR(20) NOT NULL CHECK (report_type IN ('monthly', 'annual')),
             report_year INTEGER NOT NULL CHECK (report_year BETWEEN 1900 AND 2100),
             report_month INTEGER NOT NULL DEFAULT 0,
             original_name VARCHAR(255) NOT NULL,
             mime_type VARCHAR(100) NOT NULL,
             size_bytes INTEGER NOT NULL,
             data BYTEA NOT NULL,
             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
             UNIQUE (user_id, report_year, report_month),
             CHECK ((report_type = 'monthly' AND report_month BETWEEN 1 AND 12) OR (report_type = 'annual' AND report_month = 0))
           )`
        : `CREATE TABLE IF NOT EXISTS employee_reports (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             report_type VARCHAR(20) NOT NULL CHECK (report_type IN ('monthly', 'annual')),
             report_year INTEGER NOT NULL CHECK (report_year BETWEEN 1900 AND 2100),
             report_month INTEGER NOT NULL DEFAULT 0,
             original_name VARCHAR(255) NOT NULL,
             mime_type VARCHAR(100) NOT NULL,
             size_bytes INTEGER NOT NULL,
             data BLOB NOT NULL,
             created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
             UNIQUE (user_id, report_year, report_month),
             CHECK ((report_type = 'monthly' AND report_month BETWEEN 1 AND 12) OR (report_type = 'annual' AND report_month = 0))
           )`;

    reportTableReady = pool.query(createTable).catch((err) => {
      reportTableReady = null;
      throw err;
    });
  }
  return reportTableReady;
}

function parseReportPeriod(body) {
  const reportType = String(body?.reportType || '').trim().toLowerCase();
  const yearText = String(body?.year || '').trim();
  const year = Number(yearText);
  if (!['monthly', 'annual'].includes(reportType)) return null;
  if (!/^\d{4}$/.test(yearText) || !Number.isInteger(year) || year < 1900 || year > 2100) return null;

  if (reportType === 'annual') return { reportType, year, month: 0 };
  const monthText = String(body?.month || '').trim();
  const month = Number(monthText);
  if (!/^(0?[1-9]|1[0-2])$/.test(monthText) || !Number.isInteger(month)) return null;
  return { reportType, year, month };
}

function periodError(err) {
  return err?.code === '23505'
    || err?.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || /duplicate key|unique constraint/i.test(err?.message || '');
}

router.get('/', authenticate, authorize('employee', 'manager', 'coo'), async (req, res) => {
  try {
    await ensureReportTable();
    let where = '';
    const params = [];
    if (req.user.role === 'manager') {
      where = 'WHERE (u.id = $1 OR u.manager_id = $1)';
      params.push(req.user.id);
    } else if (req.user.role !== 'coo') {
      where = 'WHERE u.id = $1';
      params.push(req.user.id);
    }

    const result = await pool.query(
      `SELECT er.id, er.user_id, u.first_name, u.last_name, u.position,
              d.name AS department_name, er.report_type, er.report_year,
              er.report_month, er.original_name, er.mime_type, er.size_bytes, er.created_at
       FROM employee_reports er
       JOIN users u ON u.id = er.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       ${where}
       ORDER BY er.report_year DESC, er.report_month DESC, er.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to load employee reports' });
  }
});

router.post('/', authenticate, authorize('employee', 'manager'), uploadSingle(uploadReport, 'report'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a report file to upload' });
  const period = parseReportPeriod(req.body);
  if (!period) return res.status(400).json({ error: 'Choose a valid report type, year, and month' });
  if (!hasSignatureBuffer(req.file.buffer, req.file.mimetype)) {
    return res.status(400).json({ error: 'File content does not match its type' });
  }

  let client;
  let transactionStarted = false;
  try {
    await ensureReportTable();
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    const existing = await client.query(
      `SELECT id FROM employee_reports
       WHERE user_id = $1 AND report_year = $2 AND report_month = $3`,
      [req.user.id, period.year, period.month]
    );
    const values = [
      period.reportType,
      period.year,
      period.month,
      safeOriginalName(req.file.originalname),
      req.file.mimetype,
      req.file.size,
      req.file.buffer,
    ];

    const saved = existing.rows[0]
      ? await client.query(
        `UPDATE employee_reports
         SET report_type = $1, report_year = $2, report_month = $3,
             original_name = $4, mime_type = $5, size_bytes = $6, data = $7,
             created_at = CURRENT_TIMESTAMP
         WHERE id = $8
         RETURNING id, user_id, report_type, report_year, report_month,
                   original_name, mime_type, size_bytes, created_at`,
        [...values, existing.rows[0].id]
      )
      : await client.query(
        `INSERT INTO employee_reports
          (user_id, report_type, report_year, report_month, original_name, mime_type, size_bytes, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, user_id, report_type, report_year, report_month,
                   original_name, mime_type, size_bytes, created_at`,
        [req.user.id, ...values]
      );

    await client.query('COMMIT');
    transactionStarted = false;
    res.status(existing.rows[0] ? 200 : 201).json(saved.rows[0]);
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    if (periodError(err)) return res.status(409).json({ error: 'A report for this period was uploaded at the same time. Please retry.' });
    console.error(err.message);
    res.status(500).json({ error: 'Failed to save employee report' });
  } finally {
    if (client) client.release();
  }
});

router.get('/:id/file', authenticate, authorize('employee', 'manager', 'coo'), async (req, res) => {
  try {
    await ensureReportTable();
    const reportId = parseId(req.params.id);
    if (!reportId) return res.status(400).json({ error: 'Report id is invalid' });
    const result = await pool.query(
      `SELECT er.*, u.manager_id
       FROM employee_reports er JOIN users u ON u.id = er.user_id
       WHERE er.id = $1`,
      [reportId]
    );
    const report = result.rows[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const canView = Number(req.user.id) === Number(report.user_id)
      || req.user.role === 'coo'
      || (req.user.role === 'manager' && Number(req.user.id) === Number(report.manager_id));
    if (!canView) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    res.set({
      'Content-Type': report.mime_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeOriginalName(report.original_name)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'private, no-store',
    });
    res.end(report.data);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to download report' });
  }
});

module.exports = router;
