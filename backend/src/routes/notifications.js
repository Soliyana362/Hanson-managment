const express = require('express');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { parseId } = require('../security');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.patch('/read-all', authenticate, async (req, res) => {
  try {
    await db.query(`UPDATE notifications SET is_read = 1 WHERE user_id = $1`, [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    const notificationId = parseId(req.params.id);
    if (!notificationId) return res.status(400).json({ error: 'Notification id is invalid' });
    const result = await db.query(
      `UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2 RETURNING *`,
      [notificationId, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Notification not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

module.exports = router;
