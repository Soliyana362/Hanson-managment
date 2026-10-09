const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { canAccessEmployee, cleanText, normalizeDate, parseId } = require('../security');

const router = express.Router();
const SUBMISSION_STATUSES = new Set(['draft', 'submitted']);

function pagination(limitValue, offsetValue) {
  const limit = Math.min(Math.max(Number.parseInt(limitValue, 10) || 100, 1), 200);
  const offset = Math.max(Number.parseInt(offsetValue, 10) || 0, 0);
  const driver = process.env.DB_DRIVER || 'sqlite';
  return driver === 'mssql'
    ? `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
    : `LIMIT ${limit} OFFSET ${offset}`;
}

function scoreFromAchievement(percentage) {
  if (percentage >= 100) return 5;
  if (percentage >= 96) return 4;
  if (percentage >= 90) return 3;
  if (percentage >= 84) return 2;
  if (percentage >= 79) return 1;
  return 0;
}

function ratingFromTotalScore(total) {
  if (total >= 4.5) return 5;
  if (total >= 3.5) return 4;
  if (total >= 2.5) return 3;
  if (total >= 1.5) return 2;
  return 1;
}

function makePeriodLabel(periodStart, periodEnd) {
  if (periodStart && periodEnd) return `${periodStart} to ${periodEnd}`;
  return periodStart || periodEnd || '';
}

function periodValues(body, existing) {
  const start = normalizeDate(body?.period_start) || normalizeDate(existing?.period_start);
  const end = normalizeDate(body?.period_end) || normalizeDate(existing?.period_end);
  if (!start || !end) throw new Error('A reporting period is required');
  if (end < start) throw new Error('The period end date must be on or after the start date');
  return { start, end };
}

// Turns the submitted rows into scored values. Target and weight always come from
// the template so a client cannot inflate them to raise the final rating.
function itemValues(items, templateItems) {
  if (!Array.isArray(items)) throw new Error('KPI items are required');
  if (items.length > 200) throw new Error('Too many KPI items');
  const byTemplateItem = new Map(templateItems.map((item) => [Number(item.id), item]));
  const used = new Set();
  return items.map((item) => {
    const templateItemId = parseId(item?.template_item_id);
    const templateItem = byTemplateItem.get(templateItemId);
    if (!templateItem) throw new Error('KPI item does not belong to this template');
    if (used.has(templateItemId)) throw new Error('Duplicate KPI item');
    used.add(templateItemId);

    const achievement = Number(item?.achievement);
    if (!Number.isFinite(achievement) || achievement < 0) throw new Error('Achievement must be a number of 0 or more');
    const target = Number(templateItem.target);
    const weight = Number(templateItem.weight);
    const achievementPct = target > 0 ? (achievement / target) * 100 : 0;
    const score = scoreFromAchievement(achievementPct);
    const comments = cleanText(item?.comments, 2000);
    if (item?.comments && comments === null) throw new Error('Comments are too long');
    return {
      id: parseId(item?.id),
      templateItemId,
      achievement,
      achievementPct,
      score,
      weightedScore: (score * weight) / 100,
      comments: comments ?? '',
    };
  });
}

async function getSubmission(submissionId) {
  const result = await pool.query('SELECT * FROM kpi_submissions WHERE id = $1', [submissionId]);
  return result.rows[0] || null;
}

// Managers may only touch submissions for their own reports; admins may touch any.
// (The old check compared the actor's own id to the submission's employee_id,
// which inverted the logic - a manager could never manage any report's KPI.)
async function canManageTarget(actor, target) {
  if (!target) return false;
  if (actor.role === 'admin') return true;
  if (actor.role !== 'manager') return false;
  return canAccessEmployee(actor, target.employee_id);
}

router.get('/templates', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, COUNT(i.id) AS indicator_count
       FROM kpi_templates t
       LEFT JOIN kpi_template_items i ON i.template_id = t.id
       GROUP BY t.id
       ORDER BY t.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

router.post('/templates', authenticate, authorize('hr', 'admin', 'manager'), async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const name = cleanText(req.body?.name, 200);
    if (!name) return res.status(400).json({ error: 'Template name is required' });
    const department = cleanText(req.body?.department, 100) ?? '';
    const roleTitle = cleanText(req.body?.role_title, 150) ?? '';
    const description = cleanText(req.body?.description, 500) ?? '';

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'A template needs at least one KPI' });
    if (items.length > 100) return res.status(400).json({ error: 'Too many KPI items' });

    const values = [];
    for (const item of items) {
      const itemName = cleanText(item?.name, 300);
      if (!itemName) return res.status(400).json({ error: 'KPI name is required' });
      const definition = cleanText(item?.definition, 2000);
      if (item?.definition && definition === null) return res.status(400).json({ error: 'KPI definition is too long' });
      const ratingCriteria = cleanText(item?.rating_criteria, 1000);
      if (item?.rating_criteria && ratingCriteria === null) {
        return res.status(400).json({ error: 'KPI rating criteria is too long' });
      }
      const target = Number(item?.target ?? 100);
      if (!Number.isFinite(target) || target < 0) {
        return res.status(400).json({ error: 'Target must be a number of 0 or more' });
      }
      const weight = Number(item?.weight);
      if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
        return res.status(400).json({ error: 'Weight must be a number between 0 and 100' });
      }
      values.push({
        name: itemName,
        definition: definition ?? '',
        ratingCriteria: ratingCriteria ?? '',
        target: Number(target.toFixed(2)),
        weight: Number(weight.toFixed(2)),
      });
    }

    // Weights are shares of the final score, so they must balance from the start.
    const total = Number(values.reduce((sum, item) => sum + item.weight, 0).toFixed(2));
    if (Math.abs(total - 100) > 0.001) {
      return res.status(400).json({ error: `Weights must add up to 100 (currently ${total})`, total });
    }

    await client.query('BEGIN');
    transactionStarted = true;
    const templateRes = await client.query(
      `INSERT INTO kpi_templates (name, department, role_title, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, department, roleTitle, description]
    );
    const template = templateRes.rows[0];
    for (let index = 0; index < values.length; index += 1) {
      const item = values[index];
      await client.query(
        `INSERT INTO kpi_template_items
           (template_id, sort_order, name, definition, target, weight, rating_criteria)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [template.id, index + 1, item.name, item.definition, item.target, item.weight, item.ratingCriteria]
      );
    }
    await client.query('COMMIT');
    transactionStarted = false;

    const itemsRes = await client.query(
      'SELECT id, sort_order, name, definition, target, weight, rating_criteria, name_am, definition_am, rating_criteria_am FROM kpi_template_items WHERE template_id = $1 ORDER BY sort_order, id',
      [template.id]
    );
    res.status(201).json({ ...template, items: itemsRes.rows, total });
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    if (/required|too long|add up|between 0 and 100|0 or more|at least one|Too many/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err.message);
    res.status(500).json({ error: 'Failed to create the template' });
  } finally {
    client.release();
  }
});

router.get('/templates/:id', authenticate, async (req, res) => {
  try {
    const templateId = parseId(req.params.id);
    if (!templateId) return res.status(400).json({ error: 'Template id is invalid' });
    const templateRes = await pool.query('SELECT * FROM kpi_templates WHERE id = $1', [templateId]);
    const template = templateRes.rows[0];
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const itemsRes = await pool.query(
      `SELECT id, sort_order, name, definition, target, weight, rating_criteria,
              name_am, definition_am, rating_criteria_am
       FROM kpi_template_items WHERE template_id = $1 ORDER BY sort_order, id`,
      [templateId]
    );
    res.json({ ...template, items: itemsRes.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch the template' });
  }
});

// Deleting a template destroys shared structure other managers use, so only
// HR and admins may delete. Managers can still create and edit templates.
router.delete('/templates/:id', authenticate, authorize('hr', 'admin'), async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const templateId = parseId(req.params.id);
    if (!templateId) return res.status(400).json({ error: 'Template id is invalid' });
    const existing = await client.query('SELECT id FROM kpi_templates WHERE id = $1', [templateId]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Template not found' });

    // Reviews already scored against a template are permanent records, so a
    // template that has been used is never deleted out from under them.
    const inUse = await client.query('SELECT COUNT(*) AS total FROM kpi_submissions WHERE template_id = $1', [templateId]);
    if (Number(inUse.rows[0]?.total || 0) > 0) {
      return res.status(409).json({ error: 'This template is already used in a KPI review and cannot be deleted' });
    }

    await client.query('BEGIN');
    transactionStarted = true;
    // kpi_template_items cascades from the template; nothing else can point here.
    await client.query('DELETE FROM kpi_templates WHERE id = $1', [templateId]);
    await client.query('COMMIT');
    transactionStarted = false;
    res.json({ deleted: true, id: templateId });
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    if (/invalid|not found/i.test(err.message)) return res.status(400).json({ error: err.message });
    if (/foreign key|violates/i.test(err.message)) {
      return res.status(409).json({ error: 'This template is already used in a KPI review and cannot be deleted' });
    }
    console.error(err.message);
    res.status(500).json({ error: 'Failed to delete the template' });
  } finally {
    client.release();
  }
});

router.put('/templates/:id/translation', authenticate, authorize('hr', 'admin'), async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const templateId = parseId(req.params.id);
    if (!templateId) return res.status(400).json({ error: 'Template id is invalid' });

    const existing = await client.query('SELECT id FROM kpi_templates WHERE id = $1', [templateId]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Template not found' });

    // Empty input clears the translation so the template falls back to English.
    const nameAm = cleanText(req.body?.name_am, 200);
    const roleTitleAm = cleanText(req.body?.role_title_am, 150);
    if (req.body?.name_am && nameAm === null) return res.status(400).json({ error: 'name_am is too long' });
    if (req.body?.role_title_am && roleTitleAm === null) {
      return res.status(400).json({ error: 'role_title_am is too long' });
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length > 100) return res.status(400).json({ error: 'Too many KPI items' });

    const itemIds = new Set();
    const itemValues = [];
    for (const item of items) {
      const itemId = parseId(item?.id);
      if (!itemId) return res.status(400).json({ error: 'KPI item is invalid' });
      if (itemIds.has(itemId)) return res.status(400).json({ error: 'Duplicate KPI item' });
      itemIds.add(itemId);
      const nameAmValue = cleanText(item.name_am, 300);
      const definitionAm = cleanText(item.definition_am, 2000);
      const ratingCriteriaAm = cleanText(item.rating_criteria_am, 1000);
      if (item.name_am && nameAmValue === null) return res.status(400).json({ error: 'name_am is too long' });
      if (item.definition_am && definitionAm === null) return res.status(400).json({ error: 'definition_am is too long' });
      if (item.rating_criteria_am && ratingCriteriaAm === null) {
        return res.status(400).json({ error: 'rating_criteria_am is too long' });
      }
      itemValues.push({ id: itemId, nameAm: nameAmValue, definitionAm, ratingCriteriaAm });
    }

    await client.query('BEGIN');
    transactionStarted = true;
    await client.query(
      'UPDATE kpi_templates SET name_am = $1, role_title_am = $2 WHERE id = $3',
      [nameAm, roleTitleAm, templateId]
    );
    for (const item of itemValues) {
      // Scoped by template_id so a crafted id cannot retarget another template.
      await client.query(
        `UPDATE kpi_template_items SET name_am = $1, definition_am = $2, rating_criteria_am = $3
         WHERE id = $4 AND template_id = $5`,
        [item.nameAm, item.definitionAm, item.ratingCriteriaAm, item.id, templateId]
      );
    }
    await client.query('COMMIT');
    transactionStarted = false;

    const [template, itemsResult] = await Promise.all([
      client.query('SELECT * FROM kpi_templates WHERE id = $1', [templateId]),
      client.query(
        'SELECT id, sort_order, name, definition, target, weight, rating_criteria, name_am, definition_am, rating_criteria_am FROM kpi_template_items WHERE template_id = $1 ORDER BY sort_order, id',
        [templateId]
      ),
    ]);
    res.json({ ...template.rows[0], items: itemsResult.rows });
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    if (/invalid|too long|Duplicate/i.test(err.message)) return res.status(400).json({ error: err.message });
    console.error(err.message);
    res.status(500).json({ error: 'Failed to save the KPI translation' });
  } finally {
    client.release();
  }
});

// Lets managers, HR and admins edit the template rows themselves (title,
// definition, target, weight, rating criteria) from the KPI screen.
router.put('/templates/:id/items', authenticate, authorize('hr', 'admin', 'manager'), async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const templateId = parseId(req.params.id);
    if (!templateId) return res.status(400).json({ error: 'Template id is invalid' });

    const existing = await client.query('SELECT id FROM kpi_templates WHERE id = $1', [templateId]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Template not found' });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'No KPI items supplied' });
    if (items.length > 100) return res.status(400).json({ error: 'Too many KPI items' });

    const current = await client.query(
      'SELECT id, weight FROM kpi_template_items WHERE template_id = $1 ORDER BY sort_order, id',
      [templateId]
    );
    const currentIds = new Set(current.rows.map((row) => Number(row.id)));

    const seen = new Set();
    const updates = [];
    for (const item of items) {
      const itemId = parseId(item?.id);
      if (!itemId) return res.status(400).json({ error: 'KPI item is invalid' });
      if (seen.has(itemId)) return res.status(400).json({ error: 'Duplicate KPI item' });
      // Scoped to this template so a crafted id cannot retarget another template.
      if (!currentIds.has(itemId)) return res.status(400).json({ error: 'KPI item does not belong to this template' });
      seen.add(itemId);

      const update = { id: itemId, fields: {} };
      if (item.name !== undefined) {
        const name = cleanText(item.name, 300);
        if (name === null) return res.status(400).json({ error: 'KPI name is too long' });
        if (!name) return res.status(400).json({ error: 'KPI name is required' });
        update.fields.name = name;
      }
      if (item.definition !== undefined) {
        const definition = cleanText(item.definition, 2000);
        if (item.definition && definition === null) return res.status(400).json({ error: 'KPI definition is too long' });
        update.fields.definition = definition ?? '';
      }
      if (item.rating_criteria !== undefined) {
        const criteria = cleanText(item.rating_criteria, 1000);
        if (item.rating_criteria && criteria === null) {
          return res.status(400).json({ error: 'KPI rating criteria is too long' });
        }
        update.fields.rating_criteria = criteria ?? '';
      }
      if (item.target !== undefined) {
        const target = Number(item.target);
        if (!Number.isFinite(target) || target < 0) {
          return res.status(400).json({ error: 'Target must be a number of 0 or more' });
        }
        update.fields.target = Number(target.toFixed(2));
      }
      if (item.weight !== undefined) {
        const weight = Number(item.weight);
        if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
          return res.status(400).json({ error: 'Weight must be a number between 0 and 100' });
        }
        update.fields.weight = Number(weight.toFixed(2));
      }
      if (!Object.keys(update.fields).length) {
        return res.status(400).json({ error: `No editable values supplied for KPI item ${itemId}` });
      }
      updates.push(update);
    }

    const merged = new Map(current.rows.map((row) => [Number(row.id), Number(row.weight)]));
    for (const update of updates) {
      if (update.fields.weight !== undefined) merged.set(update.id, update.fields.weight);
    }
    const total = Number([...merged.values()].reduce((sum, weight) => sum + weight, 0).toFixed(2));
    // Weighted scores are shares of 100, so a partial save must still balance.
    if (Math.abs(total - 100) > 0.001) {
      return res.status(400).json({ error: `Weights must add up to 100 (currently ${total})`, total });
    }

    await client.query('BEGIN');
    transactionStarted = true;
    for (const update of updates) {
      const columns = Object.keys(update.fields);
      await client.query(
        `UPDATE kpi_template_items SET ${columns.map((column, index) => `${column} = $${index + 1}`).join(', ')}
         WHERE id = $${columns.length + 1} AND template_id = $${columns.length + 2}`,
        [...columns.map((column) => update.fields[column]), update.id, templateId]
      );
    }
    await client.query('COMMIT');
    transactionStarted = false;

    const itemsResult = await client.query(
      'SELECT id, sort_order, name, definition, target, weight, rating_criteria, name_am, definition_am, rating_criteria_am FROM kpi_template_items WHERE template_id = $1 ORDER BY sort_order, id',
      [templateId]
    );
    res.json({ items: itemsResult.rows, total });
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    if (/invalid|between 0 and 100|add up|belongs|Duplicate|No KPI items|required|too long|0 or more/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err.message);
    res.status(500).json({ error: 'Failed to save the KPI template' });
  } finally {
    client.release();
  }
});

router.get('/submissions', authenticate, async (req, res) => {
  try {
    if (!['employee', 'manager', 'hr', 'admin', 'coo'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
    let query = `
      SELECT ks.*, kt.name AS template_name, kt.name_am AS template_name_am,
             e.first_name AS employee_first_name, e.last_name AS employee_last_name,
             r.first_name AS reviewer_first_name, r.last_name AS reviewer_last_name
      FROM kpi_submissions ks
      JOIN kpi_templates kt ON kt.id = ks.template_id
      JOIN users e ON e.id = ks.employee_id
      LEFT JOIN users r ON r.id = ks.reviewer_id
    `;
    const params = [];
    if (req.user.role === 'employee') {
      query += ' WHERE ks.employee_id = $1';
      params.push(req.user.id);
    } else if (req.user.role === 'manager') {
      query += ' WHERE e.manager_id = $1 OR ks.employee_id = $1';
      params.push(req.user.id);
    }
    query += ` ORDER BY ks.created_at DESC ${pagination(req.query.limit, req.query.offset)}`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

router.get('/department-achievements', authenticate, authorize('hr', 'admin', 'coo'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COALESCE(d.name, 'Unassigned') AS department_name,
             COUNT(DISTINCT ks.id) AS submission_count,
             AVG(si.achievement_pct) AS achievement_pct
      FROM users e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN kpi_submissions ks ON ks.employee_id = e.id AND ks.status IN ('submitted', 'reviewed', 'approved')
      LEFT JOIN kpi_submission_items si ON si.submission_id = ks.id
      WHERE e.role = 'employee'
      GROUP BY COALESCE(d.name, 'Unassigned')
      ORDER BY COALESCE(d.name, 'Unassigned')
    `);
    res.json(result.rows.map((row) => ({
      department_name: row.department_name,
      submission_count: Number(row.submission_count || 0),
      achievement_pct: row.achievement_pct == null ? null : Number(row.achievement_pct),
    })));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch department achievements' });
  }
});

router.get('/submissions/:id', authenticate, async (req, res) => {
  try {
    const submissionId = parseId(req.params.id);
    if (!submissionId) return res.status(400).json({ error: 'Submission id is invalid' });
    const subRes = await pool.query(
      `SELECT ks.*, kt.name AS template_name, kt.name_am AS template_name_am,
              e.first_name AS employee_first_name, e.last_name AS employee_last_name,
              e.position AS employee_position, d.name AS department_name,
              r.first_name AS reviewer_first_name, r.last_name AS reviewer_last_name
       FROM kpi_submissions ks
       JOIN kpi_templates kt ON kt.id = ks.template_id
       JOIN users e ON e.id = ks.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN users r ON r.id = ks.reviewer_id
       WHERE ks.id = $1`,
      [submissionId]
    );
    const submission = subRes.rows[0];
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (!(await canAccessEmployee(req.user, submission.employee_id))) return res.status(403).json({ error: 'Access denied' });
    const itemsRes = await pool.query(
      `SELECT si.*, ti.name, ti.definition, ti.target, ti.weight, ti.rating_criteria,
              ti.name_am, ti.definition_am, ti.rating_criteria_am
       FROM kpi_submission_items si
       JOIN kpi_template_items ti ON ti.id = si.template_item_id
       WHERE si.submission_id = $1 ORDER BY ti.sort_order, ti.id`,
      [submissionId]
    );
    res.json({ ...submission, items: itemsRes.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
});

router.post('/submissions', authenticate, authorize('admin', 'manager'), async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const templateId = parseId(req.body?.template_id);
    const employeeId = parseId(req.body?.employee_id);
    if (!templateId || !employeeId) return res.status(400).json({ error: 'Template and employee are required' });
    const status = String(req.body?.status || 'submitted');
    if (!SUBMISSION_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid submission status' });
    const period = periodValues(req.body || {});
    const label = cleanText(req.body?.period_label, 100) || makePeriodLabel(period.start, period.end);
    const targetResult = await client.query('SELECT id, manager_id, role, status FROM users WHERE id = $1', [employeeId]);
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ error: 'Employee not found' });
    if (target.status === 'inactive' || target.role !== 'employee') return res.status(400).json({ error: 'A KPI can only be created for an active employee' });
    if (req.user.role === 'manager' && Number(target.manager_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'You can only create KPI submissions for direct reports' });
    }
    const templateResult = await client.query('SELECT id FROM kpi_templates WHERE id = $1', [templateId]);
    if (!templateResult.rows[0]) return res.status(400).json({ error: 'Template not found' });
    const templateItemsResult = await client.query('SELECT * FROM kpi_template_items WHERE template_id = $1 ORDER BY sort_order, id', [templateId]);
    const templateItems = templateItemsResult.rows;
    const values = itemValues(req.body?.items, templateItems);
    if (values.length !== templateItems.length) {
      return res.status(400).json({ error: 'A KPI must include every template item exactly once' });
    }
    const valuesToInsert = values;

    await client.query('BEGIN');
    transactionStarted = true;
    const subRes = await client.query(
      `INSERT INTO kpi_submissions (template_id, employee_id, reviewer_id, period_label, period_start, period_end, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [templateId, employeeId, req.user.id, label, period.start, period.end, status]
    );
    const submission = subRes.rows[0];
    let totalWeighted = 0;
    for (const item of valuesToInsert) {
      await client.query(
        `INSERT INTO kpi_submission_items (submission_id, template_item_id, achievement, achievement_pct, score, weighted_score, comments)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [submission.id, item.templateItemId, item.achievement, item.achievementPct, item.score, item.weightedScore, item.comments]
      );
      totalWeighted += item.weightedScore;
    }
    const overallRating = ratingFromTotalScore(totalWeighted);
    const updated = await client.query(
      'UPDATE kpi_submissions SET total_weighted_score = $1, overall_rating = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [totalWeighted, overallRating, submission.id]
    );
    await client.query('COMMIT');
    transactionStarted = false;
    res.status(201).json(updated.rows[0]);
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    if (/invalid|required|not found|Too many|only be created|direct reports/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err.message);
    res.status(500).json({ error: 'Failed to create submission' });
  } finally {
    client.release();
  }
});

router.put('/submissions/:id', authenticate, authorize('admin', 'manager'), async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const submissionId = parseId(req.params.id);
    if (!submissionId) return res.status(400).json({ error: 'Submission id is invalid' });
    const target = await getSubmission(submissionId);
    if (!target) return res.status(404).json({ error: 'Submission not found' });
    if (!(await canManageTarget(req.user, target))) return res.status(403).json({ error: 'You cannot update this submission' });
    if (['approved', 'rejected'].includes(target.status)) return res.status(409).json({ error: 'Reviewed submissions cannot be edited' });
    const requestedStatus = req.body?.status === undefined ? target.status : String(req.body.status);
    if (!SUBMISSION_STATUSES.has(requestedStatus)) return res.status(400).json({ error: 'Invalid submission status' });
    const period = periodValues(req.body || {}, target);
    const label = req.body?.period_label === undefined ? target.period_label : cleanText(req.body.period_label, 100);
    if (req.body?.period_label !== undefined && !label) return res.status(400).json({ error: 'period_label is invalid' });
    const notes = req.body?.notes === undefined ? target.notes : cleanText(req.body.notes, 2000);
    if (req.body?.notes && notes === null) return res.status(400).json({ error: 'notes are too long' });

    const templateItemsResult = await client.query('SELECT * FROM kpi_template_items WHERE template_id = $1', [target.template_id]);
    const templateItems = templateItemsResult.rows;
    const values = itemValues(req.body?.items, templateItems);
    const existingItems = await client.query(
      `SELECT si.id, si.template_item_id, ti.target, ti.weight
       FROM kpi_submission_items si JOIN kpi_template_items ti ON ti.id = si.template_item_id
       WHERE si.submission_id = $1`,
      [submissionId]
    );
    const existingById = new Map(existingItems.rows.map((item) => [Number(item.id), item]));

    await client.query('BEGIN');
    transactionStarted = true;
    for (const item of values) {
      const existing = existingById.get(Number(item.id));
      if (!existing || Number(existing.template_item_id) !== item.templateItemId) {
        throw new Error('KPI item does not belong to this submission');
      }
      await client.query(
        `UPDATE kpi_submission_items
         SET achievement = $1, achievement_pct = $2, score = $3, weighted_score = $4, comments = $5
         WHERE id = $6 AND submission_id = $7`,
        [item.achievement, item.achievementPct, item.score, item.weightedScore, item.comments, item.id, submissionId]
      );
    }
    const totalResult = await client.query(
      'SELECT COALESCE(SUM(weighted_score), 0) AS total FROM kpi_submission_items WHERE submission_id = $1',
      [submissionId]
    );
    const totalWeighted = Number(totalResult.rows[0]?.total || 0);
    const overallRating = ratingFromTotalScore(totalWeighted);
    const updated = await client.query(
      `UPDATE kpi_submissions
       SET total_weighted_score = $1, overall_rating = $2, status = $3, notes = $4, period_label = $5,
           period_start = $6, period_end = $7, reviewer_id = $8, updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [totalWeighted, overallRating, requestedStatus, notes, label || target.period_label, period.start, period.end, req.user.id, submissionId]
    );
    await client.query('COMMIT');
    transactionStarted = false;
    res.json(updated.rows[0]);
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    if (/invalid|required|does not belong|Reviewed/i.test(err.message)) return res.status(400).json({ error: err.message });
    console.error(err.message);
    res.status(500).json({ error: 'Failed to update submission' });
  } finally {
    client.release();
  }
});

router.patch('/submissions/:id/review', authenticate, authorize('hr', 'admin'), async (req, res) => {
  try {
    const submissionId = parseId(req.params.id);
    const status = String(req.body?.status || '').toLowerCase();
    if (!submissionId) return res.status(400).json({ error: 'Submission id is invalid' });
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected' });
    const result = await pool.query(
      `UPDATE kpi_submissions
       SET status = $1, reviewer_id = $2, reviewer_signature_date = CURRENT_DATE, updated_at = NOW()
       WHERE id = $3 AND status IN ('submitted', 'reviewed') RETURNING *`,
      [status, req.user.id, submissionId]
    );
    if (!result.rows[0]) return res.status(409).json({ error: 'Submission is missing or has already been reviewed' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to review submission' });
  }
});

module.exports = router;
