const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { normalizeDate, parseId } = require('../security');
const { safeOriginalName, uploadReport, uploadSingle, hasSignatureBuffer } = require('../fileStore');

const router = express.Router();
const DB_DRIVER = String(process.env.DB_DRIVER || 'sqlite').toLowerCase();
const IS_POSTGRES = ['postgres', 'postgresql', 'pg'].includes(DB_DRIVER);
const IS_MSSQL = DB_DRIVER === 'mssql';
let reportTablesReady = null;

function ensureReportTables() {
  if (!reportTablesReady) {
    const createAnnualTable = IS_MSSQL
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
    const createQuarterlyTable = IS_MSSQL
      ? `IF OBJECT_ID('dbo.employee_quarterly_reports', 'U') IS NULL
         BEGIN
           CREATE TABLE employee_quarterly_reports (
             id INT IDENTITY(1,1) PRIMARY KEY,
             user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             report_year INT NOT NULL CHECK (report_year BETWEEN 1900 AND 2100),
             report_quarter INT NOT NULL CHECK (report_quarter BETWEEN 1 AND 4),
             report_months NVARCHAR(20) NOT NULL,
             report_start_date NVARCHAR(10) NOT NULL,
             report_end_date NVARCHAR(10) NOT NULL,
             original_name NVARCHAR(255) NOT NULL,
             mime_type NVARCHAR(100) NOT NULL,
             size_bytes BIGINT NOT NULL,
             data VARBINARY(MAX) NOT NULL,
             created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120),
             CONSTRAINT UQ_employee_quarterly_reports_period UNIQUE (user_id, report_year, report_quarter)
           );
         END`
      : IS_POSTGRES
        ? `CREATE TABLE IF NOT EXISTS employee_quarterly_reports (
             id SERIAL PRIMARY KEY,
             user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             report_year INTEGER NOT NULL CHECK (report_year BETWEEN 1900 AND 2100),
             report_quarter INTEGER NOT NULL CHECK (report_quarter BETWEEN 1 AND 4),
             report_months VARCHAR(20) NOT NULL,
             report_start_date VARCHAR(10) NOT NULL,
             report_end_date VARCHAR(10) NOT NULL,
             original_name VARCHAR(255) NOT NULL,
             mime_type VARCHAR(100) NOT NULL,
             size_bytes INTEGER NOT NULL,
             data BYTEA NOT NULL,
             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
             UNIQUE (user_id, report_year, report_quarter)
           )`
        : `CREATE TABLE IF NOT EXISTS employee_quarterly_reports (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             report_year INTEGER NOT NULL CHECK (report_year BETWEEN 1900 AND 2100),
             report_quarter INTEGER NOT NULL CHECK (report_quarter BETWEEN 1 AND 4),
             report_months VARCHAR(20) NOT NULL,
             report_start_date VARCHAR(10) NOT NULL,
             report_end_date VARCHAR(10) NOT NULL,
             original_name VARCHAR(255) NOT NULL,
             mime_type VARCHAR(100) NOT NULL,
             size_bytes INTEGER NOT NULL,
             data BLOB NOT NULL,
             created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
             UNIQUE (user_id, report_year, report_quarter)
           )`;

    reportTablesReady = (async () => {
      await Promise.all([
        pool.query(createAnnualTable),
        pool.query(createQuarterlyTable),
      ]);

      if (IS_MSSQL) {
        await pool.query(`
          IF COL_LENGTH('dbo.employee_quarterly_reports', 'report_months') IS NULL
            ALTER TABLE employee_quarterly_reports ADD report_months NVARCHAR(20) NULL
          IF COL_LENGTH('dbo.employee_quarterly_reports', 'report_start_date') IS NULL
            ALTER TABLE employee_quarterly_reports ADD report_start_date NVARCHAR(10) NULL
          IF COL_LENGTH('dbo.employee_quarterly_reports', 'report_end_date') IS NULL
            ALTER TABLE employee_quarterly_reports ADD report_end_date NVARCHAR(10) NULL
        `);
      } else if (IS_POSTGRES) {
        await pool.query('ALTER TABLE employee_quarterly_reports ADD COLUMN IF NOT EXISTS report_months VARCHAR(20)');
        await pool.query('ALTER TABLE employee_quarterly_reports ADD COLUMN IF NOT EXISTS report_start_date VARCHAR(10)');
        await pool.query('ALTER TABLE employee_quarterly_reports ADD COLUMN IF NOT EXISTS report_end_date VARCHAR(10)');
      } else {
        const columns = await pool.query("PRAGMA table_info('employee_quarterly_reports')");
        if (!columns.rows.some((row) => row.name === 'report_months')) {
          await pool.query('ALTER TABLE employee_quarterly_reports ADD COLUMN report_months VARCHAR(20)');
        }
        if (!columns.rows.some((row) => row.name === 'report_start_date')) {
          await pool.query('ALTER TABLE employee_quarterly_reports ADD COLUMN report_start_date VARCHAR(10)');
        }
        if (!columns.rows.some((row) => row.name === 'report_end_date')) {
          await pool.query('ALTER TABLE employee_quarterly_reports ADD COLUMN report_end_date VARCHAR(10)');
        }
      }

      await pool.query(`
        UPDATE employee_quarterly_reports
        SET report_months = CASE report_quarter
          WHEN 1 THEN '1,2,3'
          WHEN 2 THEN '4,5,6'
          WHEN 3 THEN '7,8,9'
          WHEN 4 THEN '10,11,12'
        END
        WHERE report_months IS NULL OR report_months = ''
      `);
    })().catch((err) => {
      reportTablesReady = null;
      throw err;
    });
  }
  return reportTablesReady;
}

function parseReportPeriod(body) {
  const reportType = String(body?.reportType || '').trim().toLowerCase();
  if (!['quarterly', 'annual'].includes(reportType)) return null;
  if (reportType === 'annual') {
    const yearText = String(body?.year || '').trim();
    const year = Number(yearText);
    if (!/^\d{4}$/.test(yearText) || !Number.isInteger(year) || year < 1900 || year > 2100) return null;
    return { reportType, year, quarter: 0, months: [] };
  }

  const quarterText = String(body?.quarter || '').trim();
  const quarter = Number(quarterText);
  if (!/^[1-4]$/.test(quarterText) || !Number.isInteger(quarter)) return null;
  const startDate = normalizeDate(body?.startDate);
  const endDate = normalizeDate(body?.endDate);
  if (!startDate || !endDate || endDate < startDate) return null;
  const year = Number(startDate.slice(0, 4));
  if (year < 1900 || year > 2100 || endDate.slice(0, 4) !== String(year)) return null;
  const firstMonth = Number(startDate.slice(5, 7));
  const lastMonth = Number(endDate.slice(5, 7));
  const months = Array.from({ length: lastMonth - firstMonth + 1 }, (_, index) => firstMonth + index);
  return { reportType, year, quarter, startDate, endDate, months };
}

function parseReportKey(value) {
  const match = /^(quarterly|annual)-(\d{1,15})$/.exec(String(value || ''));
  if (!match) return null;
  const id = parseId(match[2]);
  return id ? { reportType: match[1], id } : null;
}

function periodError(err) {
  return err?.code === '23505'
    || err?.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || /duplicate key|unique constraint/i.test(err?.message || '');
}

function reportScope(user) {
  if (user.role === 'coo') return { sql: '', params: [] };
  if (user.role === 'manager') {
    return { sql: 'AND (u.id = $1 OR u.manager_id = $1)', params: [user.id] };
  }
  return { sql: 'AND u.id = $1', params: [user.id] };
}

router.get('/', authenticate, authorize('employee', 'manager', 'hr', 'coo'), async (req, res) => {
  try {
    await ensureReportTables();
    const scope = reportScope(req.user);
    const [annualResult, quarterlyResult] = await Promise.all([
      pool.query(
        `SELECT er.id, er.user_id, u.first_name, u.last_name, u.position,
                d.name AS department_name, 'annual' AS report_type,
                er.report_year, 0 AS report_quarter, er.original_name,
                er.mime_type, er.size_bytes, er.created_at
         FROM employee_reports er
         JOIN users u ON u.id = er.user_id
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE er.report_type = 'annual' ${scope.sql}
         ORDER BY er.report_year DESC, er.created_at DESC`,
        scope.params
      ),
      pool.query(
        `SELECT er.id, er.user_id, u.first_name, u.last_name, u.position,
                d.name AS department_name, 'quarterly' AS report_type,
                er.report_year, er.report_quarter, er.report_months,
                er.report_start_date, er.report_end_date, er.original_name,
                er.mime_type, er.size_bytes, er.created_at
         FROM employee_quarterly_reports er
         JOIN users u ON u.id = er.user_id
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE 1 = 1 ${scope.sql}
         ORDER BY er.report_year DESC, er.report_quarter DESC, er.created_at DESC`,
        scope.params
      ),
    ]);
    const reports = [
      ...annualResult.rows.map((report) => ({ ...report, id: `annual-${report.id}` })),
      ...quarterlyResult.rows.map((report) => {
        if (!report.report_start_date || !report.report_end_date) {
          const months = String(report.report_months || '').split(',').map(Number).filter(Boolean);
          if (months.length) {
            const firstMonth = months[0];
            const lastMonth = months[months.length - 1];
            const lastDay = new Date(Number(report.report_year), lastMonth, 0).getDate();
            report.report_start_date = `${report.report_year}-${String(firstMonth).padStart(2, '0')}-01`;
            report.report_end_date = `${report.report_year}-${String(lastMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
          }
        }
        return { ...report, id: `quarterly-${report.id}` };
      }),
    ].sort((a, b) => (
      Number(b.report_year) - Number(a.report_year)
      || Number(b.report_quarter) - Number(a.report_quarter)
      || new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ));
    res.json(reports);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to load employee reports' });
  }
});

router.post('/', authenticate, authorize('employee', 'manager', 'hr'), uploadSingle(uploadReport, 'report'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a report file to upload' });
  const period = parseReportPeriod(req.body);
  if (!period) return res.status(400).json({ error: 'Choose a valid report type, quarter, and date range' });
  if (!hasSignatureBuffer(req.file.buffer, req.file.mimetype)) {
    return res.status(400).json({ error: 'File content does not match its type' });
  }

  let client;
  let transactionStarted = false;
  try {
    await ensureReportTables();
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    let existing;
    let saved;
    if (period.reportType === 'annual') {
      existing = await client.query(
        `SELECT id FROM employee_reports
         WHERE user_id = $1 AND report_type = 'annual' AND report_year = $2 AND report_month = 0`,
        [req.user.id, period.year]
      );
      const values = [safeOriginalName(req.file.originalname), req.file.mimetype, req.file.size, req.file.buffer];
      saved = existing.rows[0]
        ? await client.query(
          `UPDATE employee_reports
           SET original_name = $1, mime_type = $2, size_bytes = $3, data = $4,
               created_at = CURRENT_TIMESTAMP
           WHERE id = $5
           RETURNING id, user_id, report_year, original_name, mime_type, size_bytes, created_at`,
          [...values, existing.rows[0].id]
        )
        : await client.query(
          `INSERT INTO employee_reports
            (user_id, report_type, report_year, report_month, original_name, mime_type, size_bytes, data)
           VALUES ($1, 'annual', $2, 0, $3, $4, $5, $6)
           RETURNING id, user_id, report_year, original_name, mime_type, size_bytes, created_at`,
          [req.user.id, period.year, ...values]
        );
    } else {
      existing = await client.query(
        `SELECT id FROM employee_quarterly_reports
         WHERE user_id = $1 AND report_year = $2 AND report_quarter = $3`,
        [req.user.id, period.year, period.quarter]
      );
      const values = [
        period.year,
        period.quarter,
        period.months.join(','),
        period.startDate,
        period.endDate,
        safeOriginalName(req.file.originalname),
        req.file.mimetype,
        req.file.size,
        req.file.buffer,
      ];
      saved = existing.rows[0]
        ? await client.query(
          `UPDATE employee_quarterly_reports
           SET report_year = $1, report_quarter = $2, report_months = $3,
               report_start_date = $4, report_end_date = $5,
               original_name = $6, mime_type = $7, size_bytes = $8,
               data = $9, created_at = CURRENT_TIMESTAMP
           WHERE id = $10
           RETURNING id, user_id, report_year, report_quarter, report_months,
                     report_start_date, report_end_date,
                     original_name, mime_type, size_bytes, created_at`,
          [...values, existing.rows[0].id]
        )
        : await client.query(
          `INSERT INTO employee_quarterly_reports
            (user_id, report_year, report_quarter, report_months, report_start_date, report_end_date, original_name, mime_type, size_bytes, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, user_id, report_year, report_quarter, report_months,
                     report_start_date, report_end_date,
                     original_name, mime_type, size_bytes, created_at`,
          [req.user.id, ...values]
        );
    }

    await client.query('COMMIT');
    transactionStarted = false;
    res.status(existing.rows[0] ? 200 : 201).json({
      ...saved.rows[0],
      id: `${period.reportType}-${saved.rows[0].id}`,
      report_type: period.reportType,
      report_quarter: period.quarter,
      report_months: period.months.join(','),
      report_start_date: period.startDate,
      report_end_date: period.endDate,
    });
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

router.get('/:id/file', authenticate, authorize('employee', 'manager', 'hr', 'coo'), async (req, res) => {
  try {
    await ensureReportTables();
    const reportKey = parseReportKey(req.params.id);
    if (!reportKey) return res.status(400).json({ error: 'Report id is invalid' });
    const result = reportKey.reportType === 'annual'
      ? await pool.query(
        `SELECT er.*, u.manager_id
         FROM employee_reports er JOIN users u ON u.id = er.user_id
         WHERE er.id = $1 AND er.report_type = 'annual'`,
        [reportKey.id]
      )
      : await pool.query(
        `SELECT er.*, u.manager_id
         FROM employee_quarterly_reports er JOIN users u ON u.id = er.user_id
         WHERE er.id = $1`,
        [reportKey.id]
      );
    const report = result.rows[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const canView = Number(req.user.id) === Number(report.user_id)
      || req.user.role === 'coo'
      || (req.user.role === 'manager' && Number(req.user.id) === Number(report.manager_id));
    if (!canView) return res.status(403).json({ error: 'Insufficient permissions' });

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
