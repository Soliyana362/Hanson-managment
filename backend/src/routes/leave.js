const express = require('express');
const fs = require('fs');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { canAccessEmployee, cleanText, parseId, validDateRange } = require('../security');
const {
  leaveDocumentsDir,
  LEAVE_DOCUMENT_TYPES,
  safeOriginalName,
  extensionFor,
  uploadLeaveDocument,
  uploadSingle,
  removeFile,
  writeBuffer,
  hasSignatureBuffer,
  resolveStoredPath,
} = require('../fileStore');

const router = express.Router();
const LEAVE_TYPES = new Set(['annual', 'sick', 'unpaid', 'emergency', 'maternity', 'bereavement', 'marriage']);
const LEAVE_MANAGER_ROLES = ['hr', 'admin', 'manager', 'coo'];
const LEAVE_TARGET_ROLES = new Set(['employee', 'manager']);

// Only these leave types draw down a stored balance. The rest are unpaid and
// therefore never touch the balance columns.
function balanceColumnFor(leaveType) {
  if (leaveType === 'annual') return 'annual_leave_balance';
  if (leaveType === 'sick') return 'sick_leave_balance';
  return null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Postgres DATE columns arrive from the driver as Date objects pinned to local
// midnight. Reading the local parts back gives the exact calendar date the row
// stores, without the day shifting the way the ISO string does.
function toDateString(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

// Leave dates go over the wire as plain calendar dates. A timestamp would be
// read in the browser's own time zone and could land on the previous day.
function withDateStrings(row) {
  if (!row) return row;
  const copy = { ...row };
  for (const field of ['start_date', 'end_date']) {
    const value = toDateString(copy[field]);
    if (value) copy[field] = value;
  }
  return copy;
}

function pagination(limitValue, offsetValue) {
  const limit = Math.min(Math.max(Number.parseInt(limitValue, 10) || 100, 1), 200);
  const offset = Math.max(Number.parseInt(offsetValue, 10) || 0, 0);
  const driver = process.env.DB_DRIVER || 'sqlite';
  return driver === 'mssql'
    ? `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
    : `LIMIT ${limit} OFFSET ${offset}`;
}

function reviewDateRange(start, end) {
  const range = validDateRange(start, end);
  return range ? range.days : null;
}

async function userName(client, id) {
  const result = await client.query('SELECT first_name, last_name FROM users WHERE id = $1', [id]);
  const user = result.rows[0];
  return user ? `${user.first_name} ${user.last_name}` : 'Employee';
}

// Applies the side effects of an approved leave: draw down the balance and
// park the employee on leave until the request ends. Throws when the balance
// is not enough so the caller can roll the transaction back.
async function applyLeaveApproval(client, leave) {
  const column = balanceColumnFor(leave.leave_type);
  if (column) {
    const days = Math.round(Number(leave.days_requested));
    const deducted = await client.query(
      `UPDATE users SET ${column} = ${column} - $1, status = 'on_leave'
       WHERE id = $2 AND ${column} >= $1
       RETURNING ${column}`,
      [days, leave.user_id]
    );
    if (!deducted.rows[0]) {
      const error = new Error('Insufficient leave balance');
      error.status = 409;
      throw error;
    }
  } else {
    await client.query("UPDATE users SET status = 'on_leave' WHERE id = $1", [leave.user_id]);
  }
}

// Undoes applyLeaveApproval. Used when an approved request is edited so the
// balance matches the corrected request instead of double counting.
async function reverseLeaveApproval(client, leave) {
  const column = balanceColumnFor(leave.leave_type);
  if (!column) return;
  const days = Math.round(Number(leave.days_requested));
  await client.query(
    `UPDATE users SET ${column} = ${column} + $1 WHERE id = $2`,
    [days, leave.user_id]
  );
}

// Puts an employee back to active unless another approved leave still covers
// today. Only employees currently marked as on leave are touched.
async function syncEmployeeLeaveStatus(client, userId) {
  const current = today();
  const covering = await client.query(
    `SELECT 1 FROM leave_requests
     WHERE user_id = $1 AND status = 'approved' AND start_date <= $2 AND end_date >= $2 LIMIT 1`,
    [userId, current]
  );
  await client.query(
    `UPDATE users SET status = $1 WHERE id = $2 AND status = 'on_leave'`,
    [covering.rows[0] ? 'on_leave' : 'active', userId]
  );
}

async function notifyStaff(client, { type, title, message, link, exclude }) {
  const result = await client.query("SELECT id FROM users WHERE role IN ('hr', 'admin') AND status = 'active'");
  for (const user of result.rows) {
    if (exclude && user.id === exclude) continue;
    await client.query(
      'INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1, $2, $3, $4, $5)',
      [user.id, type, title, message, link]
    );
  }
}

router.get('/', authenticate, async (req, res) => {
  try {
    if (!['employee', 'manager', 'hr', 'admin', 'coo'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    let query = `
      SELECT lr.*, u.first_name, u.last_name, u.email,
             r.first_name AS reviewer_first_name, r.last_name AS reviewer_last_name,
             c.first_name AS creator_first_name, c.last_name AS creator_last_name,
             ld.id AS document_id, ld.original_name AS document_name
      FROM leave_requests lr
      JOIN users u ON u.id = lr.user_id
      LEFT JOIN users r ON r.id = lr.reviewed_by
      LEFT JOIN users c ON c.id = lr.created_by
      LEFT JOIN leave_documents ld ON ld.leave_request_id = lr.id
    `;
    const params = [];
    if (req.user.role === 'employee') {
      query += ' WHERE lr.user_id = $1';
      params.push(req.user.id);
    } else if (req.user.role === 'manager') {
      query += ' WHERE u.manager_id = $1 OR lr.user_id = $1';
      params.push(req.user.id);
    } else if (req.user.role === 'coo') {
      query += ' WHERE lr.user_id = $1';
      params.push(req.user.id);
    }
    query += ` ORDER BY lr.created_at DESC ${pagination(req.query.limit, req.query.offset)}`;
    const result = await pool.query(query, params);
    res.json(result.rows.map(withDateStrings));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch leave requests' });
  }
});

router.post('/', authenticate, uploadSingle(uploadLeaveDocument, 'document'), async (req, res) => {
  const file = req.file;
  let writtenPath = null;
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const leaveType = String(req.body?.leave_type || '').trim().toLowerCase();
    if (!LEAVE_TYPES.has(leaveType)) return res.status(400).json({ error: 'Leave type is invalid' });
    const range = validDateRange(req.body?.start_date, req.body?.end_date);
    if (!range) return res.status(400).json({ error: 'A valid leave date range is required' });
    const reason = cleanText(req.body?.reason, 2000);
    if (req.body?.reason && reason === null) return res.status(400).json({ error: 'Reason is too long' });

    // HR and managers may file a request for an employee who cannot reach the
    // portal themselves. The employee stays the owner of the request.
    const requestedUserId = parseId(req.body?.user_id);
    const onBehalf = requestedUserId && requestedUserId !== Number(req.user.id);
    let targetUserId = Number(req.user.id);
    if (onBehalf) {
      if (!LEAVE_MANAGER_ROLES.includes(req.user.role)) {
        return res.status(403).json({ error: 'You cannot file leave for another employee' });
      }
      if (!(await canAccessEmployee(req.user, requestedUserId))) {
        return res.status(403).json({ error: 'You are not responsible for this employee' });
      }
      const target = await client.query('SELECT id, role FROM users WHERE id = $1', [requestedUserId]);
      if (!target.rows[0]) return res.status(404).json({ error: 'Employee not found' });
      if (!LEAVE_TARGET_ROLES.has(target.rows[0].role)) {
        return res.status(400).json({ error: 'Leave can only be filed for an employee or manager' });
      }
      targetUserId = Number(target.rows[0].id);
    }

    const approveNow = onBehalf
      && ['1', 'true', 'yes', 'on'].includes(String(req.body?.approve_now ?? '').trim().toLowerCase());

    if (file && !LEAVE_DOCUMENT_TYPES.has(file.mimetype)) {
      return res.status(400).json({ error: 'Unsupported document type' });
    }
    if (file && !hasSignatureBuffer(file.buffer, file.mimetype)) {
      return res.status(400).json({ error: 'File content does not match its type' });
    }
    if (leaveType === 'sick' && !file) {
      return res.status(400).json({ error: 'A medical document is required for sick leave' });
    }

    await client.query('BEGIN');
    transactionStarted = true;

    const overlap = await client.query(
      `SELECT id FROM leave_requests
       WHERE user_id = $1 AND status IN ('pending', 'approved')
         AND start_date <= $2 AND end_date >= $3 LIMIT 1`,
      [targetUserId, range.end, range.start]
    );
    if (overlap.rows[0]) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'Leave overlaps an existing request' });
    }

    const result = await client.query(
      `INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, days_requested, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [targetUserId, leaveType, range.start, range.end, range.days, reason, req.user.id]
    );

    if (file) {
      const { storedName, filePath } = writeBuffer(
        leaveDocumentsDir,
        file.buffer,
        extensionFor(file.mimetype, LEAVE_DOCUMENT_TYPES)
      );
      writtenPath = filePath;
      await client.query(
        `INSERT INTO leave_documents (leave_request_id, original_name, stored_name, mime_type, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [result.rows[0].id, safeOriginalName(file.originalname), storedName, file.mimetype, file.size, req.user.id]
      );
    }

    let status = 'pending';
    if (approveNow) {
      try {
        await applyLeaveApproval(client, result.rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(err.status || 409).json({ error: err.message });
      }
      const approved = await client.query(
        `UPDATE leave_requests
         SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
         WHERE id = $2 RETURNING *`,
        [req.user.id, result.rows[0].id]
      );
      result.rows[0] = approved.rows[0];
      status = 'approved';
    }

    await client.query('COMMIT');
    transactionStarted = false;

    const requesterName = await userName(pool, req.user.id);
    const employeeName = onBehalf ? await userName(pool, targetUserId) : requesterName;
    if (onBehalf) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, message, link)
         VALUES ($1, 'leave_submitted', 'Leave Request Recorded For You', $2, '/leave')`,
        [targetUserId, `${requesterName} recorded a ${leaveType} leave for you (${range.start} to ${range.end}).`]
      );
    }
    await notifyStaff(pool, {
      type: 'leave_submitted',
      title: 'New Leave Request',
      message: onBehalf
        ? `${requesterName} recorded a ${leaveType} leave request for ${employeeName} (${range.start} to ${range.end}).`
        : `${requesterName} submitted a ${leaveType} leave request (${range.start} to ${range.end}).`,
      link: '/leave/review',
    });
    res.status(201).json(withDateStrings(result.rows[0]));
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    if (writtenPath) removeFile(writtenPath);
    if (/match its type|document type|too large|unsupported/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err.message);
    res.status(500).json({ error: 'Failed to create leave request' });
  } finally {
    client.release();
  }
});

router.get('/:id/document', authenticate, async (req, res) => {
  try {
    const leaveId = parseId(req.params.id);
    if (!leaveId) return res.status(400).json({ error: 'Leave request id is invalid' });
    const result = await pool.query(
      `SELECT ld.*, lr.user_id FROM leave_documents ld
       JOIN leave_requests lr ON lr.id = ld.leave_request_id
       WHERE ld.leave_request_id = $1`,
      [leaveId]
    );
    const doc = result.rows[0];
    if (!doc) return res.status(404).json({ error: 'No document attached to this request' });
    if (!(await canAccessEmployee(req.user, doc.user_id))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const filePath = resolveStoredPath(leaveDocumentsDir, doc.stored_name);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on storage' });
    res.sendFile(filePath, {
      dotfiles: 'deny',
      headers: {
        'Content-Type': doc.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeOriginalName(doc.original_name)}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to load document' });
  }
});

router.patch('/:id/review', authenticate, authorize('hr', 'admin', 'manager'), async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const leaveId = parseId(req.params.id);
    const status = String(req.body?.status || '').toLowerCase();
    if (!leaveId) return res.status(400).json({ error: 'Leave request id is invalid' });
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected' });
    const reviewNotes = cleanText(req.body?.review_notes, 2000);
    if (req.body?.review_notes && reviewNotes === null) return res.status(400).json({ error: 'Review notes are too long' });

    await client.query('BEGIN');
    transactionStarted = true;
    const leaveRes = await client.query(
      `SELECT lr.*, u.manager_id, u.annual_leave_balance, u.sick_leave_balance
       FROM leave_requests lr JOIN users u ON u.id = lr.user_id WHERE lr.id = $1`,
      [leaveId]
    );
    const leave = leaveRes.rows[0];
    if (!leave) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'Leave request not found' });
    }
    if (Number(leave.user_id) === Number(req.user.id)) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ error: 'You cannot review your own leave request' });
    }
    if (req.user.role === 'manager' && !(await canAccessEmployee(req.user, leave.user_id))) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ error: 'Not authorized to review this request' });
    }
    if (leave.status !== 'pending') {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'Leave request has already been reviewed' });
    }

    const updated = await client.query(
      `UPDATE leave_requests
       SET status = $1, review_notes = $2, reviewed_by = $3, reviewed_at = NOW()
       WHERE id = $4 AND status = 'pending' RETURNING *`,
      [status, reviewNotes, req.user.id, leaveId]
    );
    if (!updated.rows[0]) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'Leave request has already been reviewed' });
    }

    if (status === 'approved') {
      try {
        await applyLeaveApproval(client, leave);
      } catch (err) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(err.status || 409).json({ error: err.message });
      }
    }

    const employeeName = await userName(client, leave.user_id);
    const reviewerName = await userName(client, req.user.id);
    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, link)
       VALUES ($1, $2, $3, $4, '/leave')`,
      [leave.user_id, status === 'approved' ? 'leave_approved' : 'leave_rejected', status === 'approved' ? 'Leave Approved' : 'Leave Declined',
        `${reviewerName} ${status} your ${leave.leave_type} leave request (${toDateString(leave.start_date)} to ${toDateString(leave.end_date)}).`]
    );
    await notifyStaff(client, {
      type: 'leave_reviewed',
      title: 'Leave Request Reviewed',
      message: `${employeeName}'s ${leave.leave_type} leave request (${toDateString(leave.start_date)} to ${toDateString(leave.end_date)}) was ${status} by ${reviewerName}.`,
      link: '/leave/review',
      exclude: req.user.id,
    });

    await client.query('COMMIT');
    transactionStarted = false;
    res.json(withDateStrings(updated.rows[0]));
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    console.error(err.message);
    res.status(500).json({ error: 'Failed to review leave request' });
  } finally {
    client.release();
  }
});

// Lets HR and managers correct a leave request, and lets an employee correct
// their own request while it is still pending. Editing a request that was
// already approved moves the leave balance with it, and a rejected or
// cancelled request goes back into the review queue.
router.patch('/:id', authenticate, uploadSingle(uploadLeaveDocument, 'document'), async (req, res) => {
  const file = req.file;
  let writtenPath = null;
  const replacedPaths = [];
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const leaveId = parseId(req.params.id);
    if (!leaveId) return res.status(400).json({ error: 'Leave request id is invalid' });

    await client.query('BEGIN');
    transactionStarted = true;

    const leaveRes = await client.query(
      `SELECT lr.*, u.manager_id, u.annual_leave_balance, u.sick_leave_balance
       FROM leave_requests lr JOIN users u ON u.id = lr.user_id WHERE lr.id = $1`,
      [leaveId]
    );
    const leave = leaveRes.rows[0];
    if (!leave) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const isOwner = Number(leave.user_id) === Number(req.user.id);
    const isManager = LEAVE_MANAGER_ROLES.includes(req.user.role);
    if (isManager) {
      if (!(await canAccessEmployee(req.user, leave.user_id))) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(403).json({ error: 'You are not responsible for this employee' });
      }
    } else if (!isOwner || leave.status !== 'pending') {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ error: 'You cannot edit this leave request' });
    }

    const leaveType = req.body?.leave_type
      ? String(req.body.leave_type).trim().toLowerCase()
      : leave.leave_type;
    if (!LEAVE_TYPES.has(leaveType)) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'Leave type is invalid' });
    }

    const startDate = req.body?.start_date ? String(req.body.start_date) : toDateString(leave.start_date);
    const endDate = req.body?.end_date ? String(req.body.end_date) : toDateString(leave.end_date);
    const range = validDateRange(startDate, endDate);
    if (!range) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'A valid leave date range is required' });
    }

    let reason = leave.reason;
    if (req.body?.reason !== undefined) {
      reason = cleanText(req.body.reason, 2000);
      if (req.body.reason && reason === null) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(400).json({ error: 'Reason is too long' });
      }
    }

    if (file && !LEAVE_DOCUMENT_TYPES.has(file.mimetype)) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'Unsupported document type' });
    }
    if (file && !hasSignatureBuffer(file.buffer, file.mimetype)) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'File content does not match its type' });
    }

    // Sick leave always needs proof. Keep the existing document when the type
    // does not change, otherwise a replacement has to be attached.
    const docRes = await client.query(
      'SELECT id FROM leave_documents WHERE leave_request_id = $1',
      [leaveId]
    );
    const hasDocument = Boolean(docRes.rows[0]);
    if (leaveType === 'sick' && !hasDocument && !file) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'A medical document is required for sick leave' });
    }

    const overlap = await client.query(
      `SELECT id FROM leave_requests
       WHERE user_id = $1 AND id <> $2 AND status IN ('pending', 'approved')
         AND start_date <= $3 AND end_date >= $4 LIMIT 1`,
      [leave.user_id, leaveId, range.end, range.start]
    );
    if (overlap.rows[0]) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'Leave overlaps an existing request' });
    }

    // A rejected or cancelled request goes back to pending so the corrected
    // details can be reviewed again.
    const nextStatus = leave.status === 'approved' ? 'approved' : 'pending';
    const clearReview = nextStatus === 'pending' && leave.status !== 'pending';

    if (leave.status === 'approved') {
      await reverseLeaveApproval(client, leave);
    }

    const updated = await client.query(
      `UPDATE leave_requests
       SET leave_type = $1, start_date = $2, end_date = $3, days_requested = $4, reason = $5,
           status = $6, reviewed_by = $7, review_notes = $8, reviewed_at = $9
       WHERE id = $10 RETURNING *`,
      [
        leaveType,
        range.start,
        range.end,
        range.days,
        reason,
        nextStatus,
        clearReview ? null : leave.reviewed_by,
        clearReview ? null : leave.review_notes,
        clearReview ? null : leave.reviewed_at,
        leaveId,
      ]
    );

    if (file) {
      // Replace any document already attached to this request. The previous
      // file is only deleted once the transaction has committed, so a failed
      // edit never leaves the request pointing at a missing file.
      const existing = await client.query(
        'SELECT stored_name FROM leave_documents WHERE leave_request_id = $1',
        [leaveId]
      );
      for (const doc of existing.rows) {
        const oldPath = resolveStoredPath(leaveDocumentsDir, doc.stored_name);
        if (oldPath) replacedPaths.push(oldPath);
      }
      await client.query('DELETE FROM leave_documents WHERE leave_request_id = $1', [leaveId]);
      const { storedName, filePath } = writeBuffer(
        leaveDocumentsDir,
        file.buffer,
        extensionFor(file.mimetype, LEAVE_DOCUMENT_TYPES)
      );
      writtenPath = filePath;
      await client.query(
        `INSERT INTO leave_documents (leave_request_id, original_name, stored_name, mime_type, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [leaveId, safeOriginalName(file.originalname), storedName, file.mimetype, file.size, req.user.id]
      );
    }

    if (nextStatus === 'approved') {
      try {
        await applyLeaveApproval(client, updated.rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(err.status || 409).json({ error: err.message });
      }
      if (toDateString(updated.rows[0].end_date) < today()) {
        await syncEmployeeLeaveStatus(client, leave.user_id);
      }
    }

    const editorName = await userName(client, req.user.id);
    const employeeName = await userName(client, leave.user_id);
    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, link)
       VALUES ($1, 'leave_updated', 'Leave Request Updated', $2, '/leave')`,
      [leave.user_id, `${editorName} updated your ${leaveType} leave request (${range.start} to ${range.end}).`]
    );
    await notifyStaff(client, {
      type: 'leave_updated',
      title: 'Leave Request Updated',
      message: `${editorName} updated ${employeeName}'s ${leaveType} leave request (${range.start} to ${range.end}).`,
      link: '/leave/review',
      exclude: req.user.id,
    });

    await client.query('COMMIT');
    transactionStarted = false;
    for (const oldPath of replacedPaths) removeFile(oldPath);
    res.json(withDateStrings(updated.rows[0]));
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    if (writtenPath) removeFile(writtenPath);
    if (/match its type|document type|too large|unsupported/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err.message);
    res.status(500).json({ error: 'Failed to update leave request' });
  } finally {
    client.release();
  }
});

router.patch('/:id/cancel', authenticate, async (req, res) => {
  try {
    const leaveId = parseId(req.params.id);
    if (!leaveId) return res.status(400).json({ error: 'Leave request id is invalid' });
    const result = await pool.query(
      `UPDATE leave_requests SET status = 'cancelled'
       WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING *`,
      [leaveId, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Request not found or cannot be cancelled' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to cancel request' });
  }
});

module.exports = router;
