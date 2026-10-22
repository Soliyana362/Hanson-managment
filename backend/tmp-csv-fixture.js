require('dotenv').config();
const pool = require('./src/config/db');
const bcrypt = require('bcryptjs');
(async () => {
  let dept = await pool.query("SELECT id, name FROM departments WHERE name = 'Engineering' LIMIT 1");
  if (!dept.rows.length) {
    dept = await pool.query("INSERT INTO departments (name) VALUES ('Engineering') RETURNING id, name");
    console.log('created department', dept.rows[0].id);
  } else {
    console.log('department exists', dept.rows[0].id);
  }
  const deptId = dept.rows[0].id;
  const email = 'test.leave@hanson.com';
  const hash = await bcrypt.hash('TestEmp!2026x', 12);
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length) {
    await pool.query(
      `UPDATE users SET password_hash=$2, role='employee', department_id=$3, hire_date='2024-01-15',
         status='active', annual_leave_balance=20, sick_leave_balance=10 WHERE email=$1`, [email, hash, deptId]);
    console.log('updated fixture', existing.rows[0].id);
  } else {
    const r = await pool.query(
      `INSERT INTO users (first_name,last_name,email,password_hash,role,department_id,hire_date,status,annual_leave_balance,sick_leave_balance)
       VALUES ('Test','Employee',$1,$2,'employee',$3,'2024-01-15','active',20,10) RETURNING id`, [email, hash, deptId]);
    console.log('created fixture', r.rows[0].id);
  }
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
