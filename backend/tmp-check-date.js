require('dotenv').config();
const pool = require('./src/config/db');

async function run() {
  console.log('TZ env:', process.env.TZ || '(unset)');
  console.log('local offset (min):', new Date().getTimezoneOffset());
  const r = await pool.query("SELECT DATE '2027-03-01' AS d, DATE '2027-03-01'::text AS d_text");
  const d = r.rows[0].d;
  console.log('raw value:', d, '| instanceof Date:', d instanceof Date);
  console.log('toISOString():', d instanceof Date ? d.toISOString() : 'n/a');
  console.log('local parts  :', d instanceof Date ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : 'n/a');
  console.log('utc parts    :', d instanceof Date ? `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}` : 'n/a');
  console.log('cast to text :', r.rows[0].d_text);
  await pool.end();
}

run().catch((e) => { console.error(e.message); process.exit(1); });
