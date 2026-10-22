// One-off migration: add leave_requests.created_by so leave filed by HR or a
// manager on behalf of an employee can be traced back to whoever entered it.
require('dotenv').config();
const pool = require('./src/config/db');

async function run() {
  const driver = process.env.DB_DRIVER || 'sqlite';
  const type = driver === 'mssql' ? 'INT' : 'INTEGER';

  const existing = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'leave_requests' AND column_name = 'created_by'"
  );
  if (existing.rows.length) {
    console.log('leave_requests.created_by already present');
    await pool.end();
    return;
  }

  await pool.query(`ALTER TABLE leave_requests ADD COLUMN created_by ${type}`);
  console.log('Added column leave_requests.created_by');

  const check = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'leave_requests' AND column_name = 'created_by'"
  );
  console.log('Verified:', check.rows.length ? 'created_by present' : 'MISSING');
  await pool.end();
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
