const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { cleanText, parseId } = require('../security');
const { safeOriginalName, uploadReport, uploadSingle, hasSignatureBuffer } = require('../fileStore');

const router = express.Router();
const DB_DRIVER = String(process.env.DB_DRIVER || 'sqlite').toLowerCase();
const IS_POSTGRES = ['postgres', 'postgresql', 'pg'].includes(DB_DRIVER);
const IS_MSSQL = DB_DRIVER === 'mssql';
let plansTableReady = null;

function ensurePlansTable() {
  if (!plansTableReady) {
    const createTable = IS_MSSQL
      ? `IF OBJECT_ID('dbo.company_plans', 'U') IS NULL
         BEGIN
           CREATE TABLE company_plans (
             id INT IDENTITY(1,1) PRIMARY KEY,
             user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             title NVARCHAR(200) NOT NULL,
             plan_year INT NOT NULL CHECK (plan_year BETWEEN 1900 AND 2100),
             original_name NVARCHAR(255) NOT NULL,
             mime_type NVARCHAR(100) NOT NULL,
             size_bytes BIGINT NOT NULL,
             data VARBINARY(MAX) NOT NULL,
             created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
           );
         END`
      : IS_POSTGRES
        ? `CREATE TABLE IF NOT EXISTS company_plans (
             id SERIAL PRIMARY KEY,
             user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             title VARCHAR(200) NOT NULL,
             plan_year INTEGER NOT NULL CHECK (plan_year BETWEEN 1900 AND 2100),
             original_name VARCHAR(255) NOT NULL,
             mime_type VARCHAR(100) NOT NULL,
             size_bytes INTEGER NOT NULL,
             data BYTEA NOT NULL,
             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )`
        : `CREATE TABLE IF NOT EXISTS company_plans (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             title VARCHAR(200) NOT NULL,
             plan_year INTEGER NOT NULL CHECK (plan_year BETWEEN 1900 AND 2100),
             original_name VARCHAR(255) NOT NULL,
             mime_type VARCHAR(100) NOT NULL,
             size_bytes INTEGER NOT NULL,
             data BLOB NOT NULL,
             created_at TEXT DEFAULT CURRENT_TIMESTAMP
           )`;

    plansTableReady = pool.query(createTable).catch((err) => {
      plansTableReady = null;
      throw err;
    });
  }
  return plansTableReady;
}

router.get('/', authenticate, authorize('coo'), async (_req, res) => {
  try {
    await ensurePlansTable();
    const result = await pool.query(
      `SELECT id, title, plan_year, original_name, mime_type, size_bytes, created_at
       FROM company_plans ORDER BY plan_year DESC, created_at DESC, id DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to load company plans' });
  }
});

router.post('/', authenticate, authorize('coo'), uploadSingle(uploadReport, 'plan'), async (req, res) => {
  const title = cleanText(req.body?.title, 200);
  const yearText = String(req.body?.year || '').trim();
  const year = Number(yearText);
  if (!title) return res.status(400).json({ error: 'A plan title is required (maximum 200 characters)' });
  if (!/^\d{4}$/.test(yearText) || !Number.isInteger(year) || year < 1900 || year > 2100) {
    return res.status(400).json({ error: 'Choose a valid plan year' });
  }
  if (!req.file) return res.status(400).json({ error: 'Choose a plan file to upload' });
  if (!hasSignatureBuffer(req.file.buffer, req.file.mimetype)) {
    return res.status(400).json({ error: 'File content does not match its type' });
  }

  try {
    await ensurePlansTable();
    const result = await pool.query(
      `INSERT INTO company_plans
         (user_id, title, plan_year, original_name, mime_type, size_bytes, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, plan_year, original_name, mime_type, size_bytes, created_at`,
      [req.user.id, title, year, safeOriginalName(req.file.originalname), req.file.mimetype, req.file.size, req.file.buffer]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to save company plan' });
  }
});

router.get('/:id/file', authenticate, authorize('coo'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Plan id is invalid' });
    await ensurePlansTable();
    const result = await pool.query('SELECT * FROM company_plans WHERE id = $1', [id]);
    const plan = result.rows[0];
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    res.set({
      'Content-Type': plan.mime_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeOriginalName(plan.original_name)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'private, no-store',
    });
    res.end(plan.data);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to download plan' });
  }
});

module.exports = router;
