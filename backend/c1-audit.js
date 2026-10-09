require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./src/config/db');

(async () => {
  const u = await pool.query('SELECT id, email, role, status, password_hash FROM users ORDER BY id');
  const total = u.rows.length;
  const distinct = new Set(u.rows.map((r) => r.password_hash)).size;

  const shared = 'glorious2026';
  const matches = [];
  for (const r of u.rows) {
    let ok = false;
    try { ok = bcrypt.compareSync(shared, r.password_hash); } catch {}
    if (ok) matches.push(r.email);
  }

  console.log('users              : ' + total);
  console.log('distinct hashes    : ' + distinct + (distinct === 1 ? '  <-- every account identical' : ''));
  console.log('verify glorious2026: ' + matches.length + ' of ' + total);
  if (matches.length) console.log('  accounts: ' + matches.join(', '));
  const roles = {};
  u.rows.forEach((r) => { roles[r.role] = (roles[r.role] || 0) + 1; });
  console.log('by role            : ' + JSON.stringify(roles));
  console.log('non-active         : ' + u.rows.filter((r) => r.status !== 'active').length);

  await pool.end();
  process.exit(0);
})();
