// Test fixture: creates the users the leave-on-behalf E2E test needs.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./src/config/db');

const PW = 'TestLeave!2026pw';

async function run() {
  const hash = await bcrypt.hash(PW, 12);
  const now = new Date().toISOString();

  const people = [
    { email: 'test.leave.emp@hanson.com', first: 'Test', last: 'Employee', role: 'employee' },
    { email: 'test.leave.emp2@hanson.com', first: 'Test', last: 'EmployeeTwo', role: 'employee' },
    { email: 'test.leave.manager@hanson.com', first: 'Test', last: 'Manager', role: 'manager' },
    { email: 'test.leave.hr@hanson.com', first: 'Test', last: 'Hr', role: 'hr' },
  ];

  const ids = {};
  for (const p of people) {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [p.email]);
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE users SET password_hash = $1, email_verified_at = $2, status = 'active',
           annual_leave_balance = 20, sick_leave_balance = 10, role = $3, manager_id = NULL
         WHERE id = $4`,
        [hash, now, p.role, existing.rows[0].id]
      );
      ids[p.email] = existing.rows[0].id;
      continue;
    }
    const created = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, status,
         annual_leave_balance, sick_leave_balance, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, 'active', 20, 10, $6) RETURNING id`,
      [p.email, hash, p.first, p.last, p.role, now]
    );
    ids[p.email] = created.rows[0].id;
  }

  // Put one employee under the test manager.
  await pool.query('UPDATE users SET manager_id = $1 WHERE id = $2', [
    ids['test.leave.manager@hanson.com'],
    ids['test.leave.emp@hanson.com'],
  ]);

  console.log(JSON.stringify({ ids, pw: PW }, null, 2));
  await pool.end();
}

run().catch((err) => {
  console.error('Fixture failed:', err.message);
  process.exit(1);
});
