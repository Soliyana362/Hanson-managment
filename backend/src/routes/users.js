const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { issueEmailVerification, issueAccountSetup } = require('../services/verification');
const { sendEmailChangeNotice } = require('../services/email');
const { leaveSummary } = require('../services/leaveAccrual');
const {
  documentsDir,
  leaveDocumentsDir,
  photosDir,
  removeFile,
  resolveStoredPath,
} = require('../fileStore');
const {
  canAccessEmployee,
  canAssignRole,
  cleanText,
  normalizeAge,
  normalizeDate,
  normalizeEmail,
  normalizeGender,
  parseId,
} = require('../security');

const router = express.Router();
const PASSWORD_MIN_LENGTH = 12;

// Escape a value for CSV: wrap in quotes when it contains a comma, quote,
// newline or carriage return, and double any embedded quotes (RFC 4180).
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

// A filename-safe timestamp for the Content-Disposition header.
function fileStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// Dates arrive as a JS Date (Postgres, at local midnight) or a string
// (SQLite/MSSQL); render both as YYYY-MM-DD. Date objects are formatted from
// their local components so a DATE never shifts a day across time zones.
function isoDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function pagination(limitValue, offsetValue) {
  const limit = Math.min(Math.max(Number.parseInt(limitValue, 10) || 100, 1), 200);
  const offset = Math.max(Number.parseInt(offsetValue, 10) || 0, 0);
  const driver = process.env.DB_DRIVER || 'sqlite';
  return driver === 'mssql'
    ? `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
    : `LIMIT ${limit} OFFSET ${offset}`;
}

function requiredText(value, field, maxLength = 255) {
  const text = cleanText(value, maxLength);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function optionalText(value, field, maxLength = 255) {
  if (value === undefined || value === null || value === '') return null;
  const text = cleanText(value, maxLength);
  if (text === null) throw new Error(`${field} is invalid`);
  return text;
}

function optionalNumber(value, field, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${field} is invalid`);
  return number;
}

function optionalId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const id = parseId(value);
  if (!id) throw new Error(`${field} is invalid`);
  return id;
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const date = normalizeDate(value);
  if (!date) throw new Error(`${field} is invalid`);
  return date;
}

function safeGender(value) {
  if (value === undefined || value === null || value === '') return null;
  const gender = normalizeGender(value);
  if (!gender) throw new Error('gender is invalid');
  return gender;
}

function safeAge(value) {
  if (value === undefined || value === null || value === '') return null;
  const age = normalizeAge(value);
  if (age === null) throw new Error('age is invalid');
  return age;
}

async function ensureManager(managerId, targetId = null) {
  if (!managerId) return;
  if (targetId && managerId === targetId) throw new Error('An employee cannot manage themselves');
  const manager = await pool.query('SELECT id, role, status, manager_id FROM users WHERE id = $1', [managerId]);
  if (!manager.rows[0]) throw new Error('Manager not found');
  if (manager.rows[0].status === 'inactive') throw new Error('Manager is inactive');
  if (!['manager', 'hr', 'admin', 'coo'].includes(manager.rows[0].role)) throw new Error('Selected user cannot be a manager');

  let current = manager.rows[0];
  let depth = 0;
  while (current.manager_id && depth < 20) {
    if (Number(current.manager_id) === Number(targetId)) throw new Error('Manager assignment would create a cycle');
    const next = await pool.query('SELECT id, manager_id FROM users WHERE id = $1', [current.manager_id]);
    if (!next.rows[0]) break;
    current = next.rows[0];
    depth += 1;
  }
}

async function ensureDepartment(departmentId) {
  if (!departmentId) return;
  const result = await pool.query('SELECT id FROM departments WHERE id = $1', [departmentId]);
  if (!result.rows[0]) throw new Error('Department not found');
}

function profileSelect() {
  return `
    SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.position,
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
  `;
}

async function getProfile(id) {
  const result = await pool.query(`${profileSelect()} WHERE u.id = $1`, [id]);
  return result.rows[0];
}

function parseProfileInput(body, current = {}) {
  const firstName = body.first_name === undefined ? current.first_name : requiredText(body.first_name, 'first_name', 100);
  const lastName = body.last_name === undefined ? current.last_name : requiredText(body.last_name, 'last_name', 100);
  const emailValue = body.email === undefined ? current.email : body.email;
  // An email is not required: HR can register employees who have no email
  // address. When one is supplied it must still be valid, and empty/absent
  // values are stored as NULL.
  let email = null;
  if (emailValue !== undefined && emailValue !== null && String(emailValue).trim() !== '') {
    email = normalizeEmail(emailValue);
    if (!email) throw new Error('A valid email is required');
  }
  return {
    first_name: firstName,
    last_name: lastName,
    email,
    phone: body.phone === undefined ? current.phone || null : optionalText(body.phone, 'phone', 30),
    gender: body.gender === undefined ? current.gender || null : safeGender(body.gender),
    age: body.age === undefined ? current.age ?? null : safeAge(body.age),
    emergency_contact: body.emergency_contact === undefined ? current.emergency_contact || null : optionalText(body.emergency_contact, 'emergency_contact', 100),
    education: body.education === undefined ? current.education || null : optionalText(body.education, 'education', 150),
  };
}

function parseEmployeeInput(body, current = {}) {
  const role = body.role === undefined ? current.role || 'employee' : String(body.role);
  const status = body.status === undefined ? current.status || 'active' : String(body.status);
  if (!['employee', 'manager', 'hr', 'admin', 'coo'].includes(role)) throw new Error('role is invalid');
  if (!['active', 'on_leave', 'inactive'].includes(status)) throw new Error('status is invalid');
  const profile = parseProfileInput(body, current);
  return {
    ...profile,
    role,
    status,
    position: body.position === undefined ? current.position || null : optionalText(body.position, 'position', 150),
    department_id: body.department_id === undefined ? current.department_id ?? null : optionalId(body.department_id, 'department_id'),
    hire_date: body.hire_date === undefined ? current.hire_date || null : optionalDate(body.hire_date, 'hire_date'),
    manager_id: body.manager_id === undefined ? current.manager_id ?? null : optionalId(body.manager_id, 'manager_id'),
    tin_number: body.tin_number === undefined ? current.tin_number || null : optionalText(body.tin_number, 'tin_number', 50),
    pension_number: body.pension_number === undefined ? current.pension_number || null : optionalText(body.pension_number, 'pension_number', 50),
    bank_account: body.bank_account === undefined ? current.bank_account || null : optionalText(body.bank_account, 'bank_account', 100),
    gross_salary: body.gross_salary === undefined ? current.gross_salary ?? null : optionalNumber(body.gross_salary, 'gross_salary', 0, 100000000),
    transport_allowance: body.transport_allowance === undefined ? current.transport_allowance ?? null : optionalNumber(body.transport_allowance, 'transport_allowance', 0, 100000000),
  };
}

function publicProfile(user) {
  if (!user) return null;
  const { password_hash, token_version, ...safe } = user;
  return safe;
}

const SENSITIVE_FIELDS = ['tin_number', 'pension_number', 'bank_account', 'gross_salary', 'transport_allowance'];

function redactSensitive(user, role) {
  if (!user || ['hr', 'admin'].includes(role)) return user;
  const copy = { ...user };
  for (const field of SENSITIVE_FIELDS) copy[field] = undefined;
  return copy;
}

router.get('/departments', authenticate, authorize('hr', 'admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM departments ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

router.post('/departments', authenticate, authorize('hr', 'admin'), async (req, res) => {
  try {
    const name = requiredText(req.body?.name, 'Department name', 100);
    const existing = await pool.query('SELECT id, name FROM departments WHERE name = $1', [name]);
    if (existing.rows[0]) return res.status(201).json(existing.rows[0]);
    const result = await pool.query(
      'INSERT INTO departments (name) VALUES ($1) RETURNING id, name',
      [name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (/UNIQUE|already exists/i.test(err.message)) return res.status(400).json({ error: 'Department already exists' });
    console.error(err.message);
    res.status(500).json({ error: 'Failed to save department' });
  }
});

router.post('/', authenticate, authorize('hr', 'admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const role = body.role === undefined ? 'employee' : String(body.role);
    if (!canAssignRole(req.user.role, role)) return res.status(403).json({ error: 'You cannot assign that role' });
    const input = parseEmployeeInput({ ...body, role });
    await ensureDepartment(input.department_id);
    await ensureManager(input.manager_id);
    // HR does not choose the password: when none is supplied we generate a
    // random, unguessable placeholder and email the employee a link to set
    // their own. A password may still be supplied by API clients if desired.
    const providedPassword = String(body.password || '');
    if (providedPassword && (providedPassword.length < PASSWORD_MIN_LENGTH || providedPassword.length > 200)) {
      return res.status(400).json({ error: `Password must be between ${PASSWORD_MIN_LENGTH} and 200 characters` });
    }
    const password = providedPassword || crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, department_id, position, phone, gender, age, hire_date, manager_id,
        tin_number, pension_number, emergency_contact, bank_account, gross_salary, transport_allowance, education)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING id, email, first_name, last_name, role, position`,
      [input.email, passwordHash, input.first_name, input.last_name, input.role, input.department_id, input.position, input.phone,
        input.gender, input.age, input.hire_date, input.manager_id, input.tin_number, input.pension_number, input.emergency_contact,
        input.bank_account, input.gross_salary, input.transport_allowance, input.education]
    );
    const createdUser = result.rows[0];
    // Employees registered without an email address simply have no sign-in
    // account to set up, so skip the setup email instead of failing.
    let emailSent = false;
    if (createdUser.email) {
      try {
        await issueAccountSetup(createdUser);
        emailSent = true;
      } catch (err) {
        emailSent = false;
        console.error(`Failed to send employee account setup email: ${err.message}`);
      }
    }
    res.status(201).json({ ...createdUser, emailSent });
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) return res.status(400).json({ error: 'Email already exists' });
    if (/invalid|required|not found|cannot|cycle/i.test(err.message)) return res.status(400).json({ error: err.message });
    console.error(err.message);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

router.get('/', authenticate, authorize('hr', 'admin', 'manager', 'coo'), async (req, res) => {
  try {
    let query = `
      SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.position,
             u.status, u.phone, u.gender, u.age, u.hire_date,
             u.tin_number, u.pension_number, u.emergency_contact, u.bank_account, u.gross_salary, u.transport_allowance, u.education,
             d.name AS department_name
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
    `;
    const params = [];
    if (req.user.role === 'manager') {
      query += ' WHERE u.manager_id = $1';
      params.push(req.user.id);
    }
    query += ` ORDER BY u.last_name, u.first_name ${pagination(req.query.limit, req.query.offset)}`;
    const result = await pool.query(query, params);
    res.json(result.rows.map((row) => redactSensitive(row, req.user.role)));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await getProfile(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.put('/profile', authenticate, async (req, res) => {
  try {
    const current = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!current.rows[0]) return res.status(404).json({ error: 'User not found' });
    const input = parseProfileInput(req.body || {}, current.rows[0]);
    const emailChanged = current.rows[0].email !== input.email;
    if (emailChanged) {
      // Changing the sign-in email is a sensitive action: require the current
      // password so a stolen session cookie cannot silently retarget the account.
      const password = String(req.body?.password || '');
      if (!password) return res.status(400).json({ error: 'Current password is required to change your sign-in email' });
      if (!(await bcrypt.compare(password, current.rows[0].password_hash))) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      if (input.email) {
        const duplicate = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2', [input.email, req.user.id]);
        if (duplicate.rows[0]) return res.status(400).json({ error: 'Email already exists' });
      }
    }
    await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, email = $3, phone = $4, gender = $5, age = $6,
        emergency_contact = $7, education = $8,
        email_verified_at = CASE WHEN $9 THEN NULL ELSE email_verified_at END,
        token_version = COALESCE(token_version, 0) + CASE WHEN $9 THEN 1 ELSE 0 END
       WHERE id = $10`,
      [input.first_name, input.last_name, input.email, input.phone, input.gender, input.age, input.emergency_contact, input.education, emailChanged, req.user.id]
    );
    const user = await getProfile(req.user.id);
    let emailSent = true;
    if (emailChanged) {
      const previousEmail = current.rows[0].email;
      if (previousEmail) {
        try {
          await sendEmailChangeNotice(previousEmail, `${current.rows[0].first_name} ${current.rows[0].last_name}`.trim());
        } catch (err) {
          console.error(`Failed to notify previous email address: ${err.message}`);
        }
      }
      if (user.email) {
        try {
          await issueEmailVerification(user);
        } catch (err) {
          emailSent = false;
          console.error(`Failed to send email verification: ${err.message}`);
        }
      }
    }
    res.json({ ...user, emailSent });
  } catch (err) {
    if (/invalid|required|valid email/i.test(err.message)) return res.status(400).json({ error: err.message });
    console.error(err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.put('/:id', authenticate, authorize('hr', 'admin'), async (req, res) => {
  try {
    const userId = parseId(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Employee id is invalid' });
    const currentResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const current = currentResult.rows[0];
    if (!current) return res.status(404).json({ error: 'Employee not found' });
    const requestedRole = req.body?.role === undefined ? current.role : String(req.body.role);
    if (!canAssignRole(req.user.role, requestedRole) && requestedRole !== current.role) {
      return res.status(403).json({ error: 'You cannot assign that role' });
    }
    // Peer-privilege guard: HR can manage employees and managers, but cannot
    // modify another privileged account (HR, admin, coo) - only themselves.
    if (req.user.role === 'hr' && Number(current.id) !== Number(req.user.id) && ['hr', 'admin', 'coo'].includes(current.role)) {
      return res.status(403).json({ error: 'You cannot modify a privileged account' });
    }
    if (userId === req.user.id && (requestedRole !== 'admin' || (req.body?.status && req.body.status !== 'active'))) {
      return res.status(400).json({ error: 'You cannot remove your own administrator access' });
    }
    const input = parseEmployeeInput(req.body || {}, current);
    await ensureDepartment(input.department_id);
    await ensureManager(input.manager_id, userId);
    const emailChanged = current.email !== input.email;
    if (emailChanged && req.user.role === 'hr') {
      return res.status(403).json({ error: 'HR cannot change an employee sign-in email after account creation. Contact an administrator.' });
    }
    const privilegeChanged = current.role !== input.role || current.status !== input.status;
    if (emailChanged) {
      if (input.email) {
        const duplicate = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2', [input.email, userId]);
        if (duplicate.rows[0]) return res.status(400).json({ error: 'Email already exists' });
      }
    }
    await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, email = $3, phone = $4, role = $5, position = $6,
        department_id = $7, status = $8, gender = $9, age = $10, hire_date = $11, manager_id = $12,
        tin_number = $13, pension_number = $14, emergency_contact = $15, bank_account = $16,
        gross_salary = $17, transport_allowance = $18, education = $19,
        email_verified_at = CASE WHEN $20 THEN NULL ELSE email_verified_at END,
        token_version = COALESCE(token_version, 0) + CASE WHEN $21 THEN 1 ELSE 0 END
       WHERE id = $22`,
      [input.first_name, input.last_name, input.email, input.phone, input.role, input.position, input.department_id, input.status,
        input.gender, input.age, input.hire_date, input.manager_id, input.tin_number, input.pension_number, input.emergency_contact,
        input.bank_account, input.gross_salary, input.transport_allowance, input.education, emailChanged,
        emailChanged || privilegeChanged, userId]
    );
    const user = await getProfile(userId);
    let emailSent = true;
    if (emailChanged) {
      if (current.email) {
        try {
          await sendEmailChangeNotice(current.email, `${current.first_name} ${current.last_name}`.trim());
        } catch (err) {
          console.error(`Failed to notify previous email address: ${err.message}`);
        }
      }
      if (user.email) {
        try {
          await issueEmailVerification(user);
        } catch (err) {
          emailSent = false;
          console.error(`Failed to send employee email verification: ${err.message}`);
        }
      }
    }
    res.json({ ...publicProfile(user), emailSent, sessionsRevoked: emailChanged || privilegeChanged });
  } catch (err) {
    if (/invalid|required|valid email|not found|cannot|cycle/i.test(err.message)) return res.status(400).json({ error: err.message });
    if (/UNIQUE/i.test(err.message)) return res.status(400).json({ error: 'Email already exists' });
    console.error(err.message);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  const userId = parseId(req.params.id);
  if (!userId) return res.status(400).json({ error: 'Employee id is invalid' });
  if (Number(userId) === Number(req.user.id)) {
    return res.status(400).json({ error: 'You cannot remove your own account' });
  }

  const client = await pool.connect();
  let transactionStarted = false;
  let filesToRemove = [];
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const currentResult = await client.query(
      'SELECT id, role FROM users WHERE id = $1',
      [userId]
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'Employee not found' });
    }
    if (current.role === 'admin') {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ error: 'Administrator accounts cannot be removed here' });
    }

    const documents = await client.query(
      'SELECT category, stored_name FROM documents WHERE user_id = $1',
      [userId]
    );
    const leaveDocuments = await client.query(
      `SELECT ld.stored_name
       FROM leave_documents ld
       JOIN leave_requests lr ON lr.id = ld.leave_request_id
       WHERE lr.user_id = $1`,
      [userId]
    );
    filesToRemove = [
      ...documents.rows.map((doc) => resolveStoredPath(
        doc.category === 'profile_photo' ? photosDir : documentsDir,
        doc.stored_name
      )),
      ...leaveDocuments.rows.map((doc) => resolveStoredPath(leaveDocumentsDir, doc.stored_name)),
    ].filter(Boolean);

    // Keep other employees' records intact while removing references to this account.
    await client.query('UPDATE users SET manager_id = NULL WHERE manager_id = $1', [userId]);
    await client.query('UPDATE leave_requests SET reviewed_by = NULL WHERE reviewed_by = $1', [userId]);
    await client.query('UPDATE leave_requests SET created_by = NULL WHERE created_by = $1', [userId]);
    await client.query('UPDATE leave_documents SET uploaded_by = NULL WHERE uploaded_by = $1', [userId]);
    await client.query('UPDATE kpi_submissions SET reviewer_id = NULL WHERE reviewer_id = $1', [userId]);
    await client.query('UPDATE vacancies SET created_by = NULL WHERE created_by = $1', [userId]);

    // KPI records belong to the removed employee and cannot retain their required employee_id.
    await client.query('DELETE FROM kpi_submissions WHERE employee_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    transactionStarted = false;

    for (const filePath of filesToRemove) removeFile(filePath);
    res.json({ message: 'Employee removed' });
  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }
    console.error(err.message);
    res.status(500).json({ error: 'Failed to remove employee' });
  } finally {
    client.release();
  }
});

router.get('/annual-leave', authenticate, authorize('hr', 'admin'), async (req, res) => {
  try {
    // Approved annual leave is what actually consumes the balance, so only
    // those requests are counted as "taken".
    const result = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.hire_date, u.status,
              d.name AS department_name,
              COALESCE((
                SELECT SUM(lr.days_requested) FROM leave_requests lr
                WHERE lr.user_id = u.id AND lr.status = 'approved' AND lr.leave_type = 'annual'
              ), 0) AS taken_days
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       ORDER BY u.last_name, u.first_name`
    );
    const asOf = new Date();
    const header = [
      'Employee',
      'Email',
      'Department',
      'Hire Date',
      'Years of Service',
      'Days Per Year',
      'Accrued Days',
      'Taken Days',
      'Remaining Days',
    ];
    const rows = [header];
    for (const user of result.rows) {
      const summary = leaveSummary(user, asOf);
      rows.push([
        `${user.first_name} ${user.last_name}`.trim(),
        user.email || '',
        user.department_name || '',
        summary.hire_date ? isoDate(summary.hire_date) : '',
        summary.years_of_service ?? '',
        summary.days_per_year,
        summary.accrued_days ?? '',
        summary.taken_days,
        summary.remaining_days ?? '',
      ]);
    }
    const csv = toCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="annual-leave-${fileStamp()}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    // Prepend a UTF-8 BOM so Excel opens the file with the right encoding.
    res.send(`\uFEFF${csv}`);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to export annual leave report' });
  }
});

router.get('/:id/status', authenticate, async (req, res) => {
  try {
    const userId = parseId(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Employee id is invalid' });
    if (!(await canAccessEmployee(req.user, userId))) return res.status(403).json({ error: 'Access denied' });
    const [userRes, leaveRes, kpiRes] = await Promise.all([
      pool.query(`${profileSelect()} WHERE u.id = $1`, [userId]),
      pool.query(
        'SELECT id, leave_type, start_date, end_date, days_requested, status, created_at FROM leave_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
        [userId]
      ),
      pool.query(
        `SELECT ks.id, ks.period_label, ks.status, ks.total_weighted_score, ks.overall_rating, kt.name AS template_name
         FROM kpi_submissions ks JOIN kpi_templates kt ON kt.id = ks.template_id
         WHERE ks.employee_id = $1 ORDER BY ks.created_at DESC LIMIT 5`,
        [userId]
      ),
    ]);
    if (!userRes.rows[0]) return res.status(404).json({ error: 'Employee not found' });
    res.json({ profile: publicProfile(redactSensitive(userRes.rows[0], req.user.role)), recentLeave: leaveRes.rows, recentKpis: kpiRes.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

module.exports = router;
