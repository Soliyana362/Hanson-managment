// Removes everything the leave-on-behalf test creates so the test can be run
// repeatedly without leftover rows blocking it.
require('dotenv').config();
const pool = require('./src/config/db');

const EMAILS = [
  'test.leave.emp@hanson.com',
  'test.leave.emp2@hanson.com',
  'test.leave.manager@hanson.com',
  'test.leave.hr@hanson.com',
];

async function run() {
  const users = await pool.query('SELECT id, email FROM users WHERE email = ANY($1)', [EMAILS]);
  const ids = users.rows.map((r) => r.id);
  if (!ids.length) {
    console.log('no fixture users to clean');
    await pool.end();
    return;
  }

  const leave = await pool.query('DELETE FROM leave_requests WHERE user_id = ANY($1)', [ids]);
  const notif = await pool.query('DELETE FROM notifications WHERE user_id = ANY($1)', [ids]);
  // The test also files one self-service request on the admin account. Only
  // rows marked as test data are removed so real admin leave is never touched.
  const adminTest = await pool.query(
    "DELETE FROM leave_requests WHERE reason = 'self-service test'"
  );
  await pool.query(
    `UPDATE users SET status = 'active', annual_leave_balance = 20, sick_leave_balance = 10
     WHERE id = ANY($1)`,
    [ids]
  );

  console.log(`cleaned ${leave.rowCount + adminTest.rowCount} leave requests, ${notif.rowCount} notifications for ${ids.length} users`);
  await pool.end();
}

run().catch((err) => {
  console.error('Cleanup failed:', err.message);
  process.exit(1);
});
