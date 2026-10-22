require('dotenv').config();
const pool = require('./src/config/db');
(async () => {
  const r = await pool.query("DELETE FROM leave_requests WHERE user_id = (SELECT id FROM users WHERE email='admin@hanson.com') AND reason IS NULL AND start_date >= '2026-11-01'");
  console.log('removed leftover admin rows:', r.rowCount);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
