require('dotenv').config();
const pool = require('./src/config/db');
(async () => {
  const r = await pool.query(`SELECT lr.id, lr.user_id, u.email, lr.start_date, lr.end_date, lr.leave_type, lr.reason, lr.status
    FROM leave_requests lr JOIN users u ON u.id = lr.user_id
    WHERE u.email = 'admin@hanson.com' ORDER BY lr.id`);
  console.log('admin leave rows:', r.rows.length);
  console.table(r.rows);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
