const pool = require('../config/db');

async function restoreLeaveStatuses() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await pool.query(
      `SELECT DISTINCT user_id FROM leave_requests WHERE status = 'approved' AND end_date < $1`,
      [today]
    );
    const ids = result.rows.map((r) => r.user_id);
    if (!ids.length) return 0;
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    await pool.query(
      `UPDATE users SET status = 'active' WHERE status = 'on_leave' AND id IN (${placeholders})`,
      ids
    );
    return ids.length;
  } catch (err) {
    console.error(`Leave status restore failed: ${err.message}`);
    return 0;
  }
}

module.exports = { restoreLeaveStatuses };