require('dotenv').config();
const pool = require('./src/config/db');
(async () => {
  const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position`);
  console.log(r.rows.map(x => x.column_name).join(', '));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
