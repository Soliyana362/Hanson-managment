const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { canAccessEmployee, cleanText, parseId, validDateRange } = require('../security');

const router = express.Router();
const LEAVE_TYPES = new Set(['annual', 'sick', 'unpaid', 'emergency', 'other']);

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
             r.first_name AS reviewer_first_name, r.last_name AS reviewer_last_name
      FROM leave_requests lr
      JOIN users u ON u.id = lr.user_id
      LEFT JOIN users r ON r.id = lr.reviewed_by
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
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch leave requests' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const leaveType = String(req.body?.leave_type || '').trim().toLowerCase();
    if (!LEAVE_TYPES.has(leaveType)) return res.status(400).json({ error: 'Leave type is invalid' });
    const range = validDateRange(req.body?.start_date, req.body?.end_date);
    if (!range) return res.status(400).json({ error: 'A valid leave date range is required' });
    const reason = cleanText(req.body?.reason, 2000);
    if (req.body?.reason && reason === null) return res.status(400).json({ error: 'Reason is too long' });

    const overlap = await pool.query(
      `SELECT id FROM leave_requests
       WHERE user_id = $1 AND status IN ('pending', 'approved')
         AND start_date <= $2 AND end_date >= $3 LIMIT 1`,
      [req.user.id, range.end, range.start]
    );
    if (overlap.rows[0]) return res.status(409).json({ error: 'Leave overlaps an existing request' });

    const result = await pool.query(
      `INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, days_requested, reason)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, leaveType, range.start, range.end, range.days, reason]
    );
    const requesterName = await userName(pool, req.user.id);
    await notifyStaff(pool, {
      type: 'leave_submitted',
      title: 'New Leave Request',
      message: `${requesterName} submitted a ${leaveType} leave request (${range.start} to ${range.end}).`,
      link: '/leave/review',
    });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to create leave request' });
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
      if (['annual', 'sick'].includes(leave.leave_type)) {
        const column = leave.leave_type === 'sick' ? 'sick_leave_balance' : 'annual_leave_balance';
        const deducted = await client.query(
          `UPDATE users SET ${column} = ${column} - $1, status = 'on_leave'
           WHERE id = $2 AND ${column} >= $1
           RETURNING ${column}`,
          [leave.days_requested, leave.user_id]
        );
        if (!deducted.rows[0]) {
          await client.query('ROLLBACK');
          transactionStarted = false;
          return res.status(409).json({ error: 'Insufficient leave balance' });
        }
      } else {
        await client.query("UPDATE users SET status = 'on_leave' WHERE id = $1", [leave.user_id]);
      }
    }

    const employeeName = await userName(client, leave.user_id);
    const reviewerName = await userName(client, req.user.id);
    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, link)
       VALUES ($1, $2, $3, $4, '/leave')`,
      [leave.user_id, status === 'approved' ? 'leave_approved' : 'leave_rejected', status === 'approved' ? 'Leave Approved' : 'Leave Declined',
        `${reviewerName} ${status} your ${leave.leave_type} leave request (${leave.start_date} to ${leave.end_date}).`]
    );
    await notifyStaff(client, {
      type: 'leave_reviewed',
      title: 'Leave Request Reviewed',
      message: `${employeeName}'s ${leave.leave_type} leave request (${leave.start_date} to ${leave.end_date}) was ${status} by ${reviewerName}.`,
      link: '/leave/review',
      exclude: req.user.id,
    });

    await client.query('COMMIT');
    transactionStarted = false;
    res.json(updated.rows[0]);
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    console.error(err.message);
    res.status(500).json({ error: 'Failed to review leave request' });
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
