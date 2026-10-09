const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { cleanText, normalizeEmail, parseId } = require('../security');

const router = express.Router();

function requiredText(value, field, maxLength) {
  const text = cleanText(value, maxLength);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  const text = cleanText(value, maxLength);
  if (text === null) throw new Error(`${field} is invalid`);
  return text;
}

function optionalEmail(value) {
  if (value === undefined || value === null || value === '') return null;
  const email = normalizeEmail(value);
  if (!email) throw new Error('email is invalid');
  return email;
}

function idOrThrow(value, field) {
  const id = parseId(value);
  if (!id) throw new Error(`${field} is invalid`);
  return id;
}

function pagination(limitValue, offsetValue) {
  const limit = Math.min(Math.max(Number.parseInt(limitValue, 10) || 100, 1), 200);
  const offset = Math.max(Number.parseInt(offsetValue, 10) || 0, 0);
  const driver = process.env.DB_DRIVER || 'sqlite';
  return driver === 'mssql'
    ? `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
    : `LIMIT ${limit} OFFSET ${offset}`;
}

router.use(authenticate, authorize('hr', 'admin'));

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.*, u.first_name AS creator_first_name, u.last_name AS creator_last_name,
             (SELECT COUNT(*) FROM vacancy_candidates c WHERE c.vacancy_id = v.id) AS candidate_count,
             (SELECT COUNT(*) FROM vacancy_candidates c WHERE c.vacancy_id = v.id AND c.status = 'hired') AS hired_count
      FROM vacancies v
      LEFT JOIN users u ON u.id = v.created_by
      ORDER BY v.created_at DESC ${pagination(req.query.limit, req.query.offset)}
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch vacancies' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const vacancyId = idOrThrow(req.params.id, 'Vacancy id');
    const v = await pool.query('SELECT * FROM vacancies WHERE id = $1', [vacancyId]);
    if (!v.rows[0]) return res.status(404).json({ error: 'Vacancy not found' });
    const candidates = await pool.query(
      'SELECT * FROM vacancy_candidates WHERE vacancy_id = $1 ORDER BY created_at DESC',
      [vacancyId]
    );
    res.json({ ...v.rows[0], candidates: candidates.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch vacancy' });
  }
});

router.post('/', async (req, res) => {
  try {
    const title = requiredText(req.body?.title, 'Vacancy title', 200);
    const department = optionalText(req.body?.department, 'department', 100);
    const position = optionalText(req.body?.position, 'position', 150);
    const description = optionalText(req.body?.description, 'description', 10000);
    const requirements = optionalText(req.body?.requirements, 'requirements', 10000);
    const result = await pool.query(
      `INSERT INTO vacancies (title, department, position, description, requirements, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, department, position, description, requirements, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (/required|invalid/i.test(err.message)) return res.status(400).json({ error: err.message });
    console.error(err.message);
    res.status(500).json({ error: 'Failed to create vacancy' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const vacancyId = idOrThrow(req.params.id, 'Vacancy id');
    const title = requiredText(req.body?.title, 'Vacancy title', 200);
    const department = optionalText(req.body?.department, 'department', 100);
    const position = optionalText(req.body?.position, 'position', 150);
    const description = optionalText(req.body?.description, 'description', 10000);
    const requirements = optionalText(req.body?.requirements, 'requirements', 10000);
    const result = await pool.query(
      `UPDATE vacancies
       SET title = $1, department = $2, position = $3, description = $4, requirements = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 RETURNING *`,
      [title, department, position, description, requirements, vacancyId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Vacancy not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (/required|invalid/i.test(err.message)) return res.status(400).json({ error: err.message });
    console.error(err.message);
    res.status(500).json({ error: 'Failed to update vacancy' });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const vacancyId = idOrThrow(req.params.id, 'Vacancy id');
    const { status } = req.body;
    if (!['pending', 'hired', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Status must be pending, hired or cancelled' });
    }
    const result = await pool.query(
      'UPDATE vacancies SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, vacancyId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Vacancy not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to update vacancy status' });
  }
});

router.post('/:id/candidates', async (req, res) => {
  try {
    const vacancyId = idOrThrow(req.params.id, 'Vacancy id');
    const name = requiredText(req.body?.name, 'Candidate name', 200);
    const email = optionalEmail(req.body?.email);
    const phone = optionalText(req.body?.phone, 'phone', 30);
    const notes = optionalText(req.body?.notes, 'notes', 5000);
    const vacancy = await pool.query('SELECT id FROM vacancies WHERE id = $1', [vacancyId]);
    if (!vacancy.rows[0]) return res.status(404).json({ error: 'Vacancy not found' });
    const result = await pool.query(
      `INSERT INTO vacancy_candidates (vacancy_id, name, email, phone, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [vacancyId, name, email, phone, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (/required|invalid/i.test(err.message)) return res.status(400).json({ error: err.message });
    console.error(err.message);
    res.status(500).json({ error: 'Failed to add candidate' });
  }
});

router.patch('/:id/candidates/:cid/status', async (req, res) => {
  try {
    const vacancyId = idOrThrow(req.params.id, 'Vacancy id');
    const candidateId = idOrThrow(req.params.cid, 'Candidate id');
    const { status } = req.body;
    if (!['applied', 'shortlisted', 'interview', 'hired', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid candidate status' });
    }
    const result = await pool.query(
      `UPDATE vacancy_candidates SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND vacancy_id = $3 RETURNING *`,
      [status, candidateId, vacancyId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Candidate not found' });

    if (status === 'hired') {
      await pool.query(
        "UPDATE vacancies SET status = 'hired', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [vacancyId]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to update candidate status' });
  }
});

router.delete('/:id/candidates/:cid', async (req, res) => {
  try {
    const vacancyId = idOrThrow(req.params.id, 'Vacancy id');
    const candidateId = idOrThrow(req.params.cid, 'Candidate id');
    const exists = await pool.query(
      'SELECT id FROM vacancy_candidates WHERE id = $1 AND vacancy_id = $2',
      [candidateId, vacancyId]
    );
    if (!exists.rows[0]) return res.status(404).json({ error: 'Candidate not found' });
    await pool.query(
      'DELETE FROM vacancy_candidates WHERE id = $1 AND vacancy_id = $2',
      [candidateId, vacancyId]
    );
    res.status(204).send();
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to delete candidate' });
  }
});

module.exports = router;
