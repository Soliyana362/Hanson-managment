#!/usr/bin/env node
// Removes every account except one keeper, along with all data that belongs to
// the removed accounts (leave requests, notifications, KPI submissions,
// documents, tokens, login attempts, vacancies). Shared configuration
// (departments, KPI templates) is preserved.
//
//   node purge-users.js --keep admin@hanson.com --dry-run   # preview
//   node purge-users.js --keep admin@hanson.com             # apply
//
// The whole purge runs in a single transaction: it either fully completes or
// changes nothing.

require('dotenv').config();
const pool = require('./src/config/db');

function parseArgs(argv) {
  const args = { keep: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--keep') args.keep = argv[++i];
    else if (a.startsWith('--keep=')) args.keep = a.slice(7);
    else if (a === '--help' || a === '-h') args.help = true;
    else { console.error(`Unknown argument: ${a}`); args.help = true; }
  }
  return args;
}

const HELP = `
Remove every account except one keeper, plus the data those accounts own.

  --keep <email>   The account to keep (required)
  --dry-run        Show what would be removed without changing anything
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.keep) {
    console.log(HELP.trim());
    process.exit(args.help ? 0 : 1);
  }

  const keeper = (await pool.query('SELECT id, email, role FROM users WHERE email = $1', [args.keep])).rows[0];
  if (!keeper) {
    console.error(`No account found with email ${args.keep}`);
    await pool.end();
    process.exit(1);
  }

  const gone = (await pool.query(
    'SELECT id, email, role FROM users WHERE id <> $1 ORDER BY id', [keeper.id])).rows;
  const ids = gone.map((u) => u.id);
  const emails = gone.map((u) => u.email);

  console.log(`keeping  : ${keeper.email} (id ${keeper.id}, ${keeper.role})`);
  console.log(`removing : ${gone.length} account(s)`);
  gone.forEach((u) => console.log(`   - ${u.email} (${u.role})`));

  if (!gone.length) {
    console.log('\nNothing to remove.');
    await pool.end();
    return;
  }

  if (args.dryRun) {
    console.log('\nDRY RUN - no changes written.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  const removed = {};
  const q = async (label, sql, params) => {
    const res = await client.query(sql, params);
    removed[label] = (removed[label] || 0) + res.rowCount;
  };

  try {
    await client.query('BEGIN');
    await q('kpi_submission_items',
      `DELETE FROM kpi_submission_items
       WHERE submission_id IN (SELECT id FROM kpi_submissions WHERE employee_id = ANY($1::int[]) OR reviewer_id = ANY($1::int[]))`, [ids]);
    await q('kpi_submissions',
      `DELETE FROM kpi_submissions WHERE employee_id = ANY($1::int[]) OR reviewer_id = ANY($1::int[])`, [ids]);
    await q('leave_requests',
      `DELETE FROM leave_requests WHERE user_id = ANY($1::int[]) OR reviewed_by = ANY($1::int[])`, [ids]);
    await q('documents', `DELETE FROM documents WHERE user_id = ANY($1::int[])`, [ids]);
    await q('notifications', `DELETE FROM notifications WHERE user_id = ANY($1::int[])`, [ids]);
    await q('password_reset_tokens', `DELETE FROM password_reset_tokens WHERE user_id = ANY($1::int[])`, [ids]);
    await q('email_verification_tokens', `DELETE FROM email_verification_tokens WHERE user_id = ANY($1::int[])`, [ids]);
    await q('vacancy_candidates',
      `DELETE FROM vacancy_candidates WHERE vacancy_id IN (SELECT id FROM vacancies WHERE created_by = ANY($1::int[]))`, [ids]);
    await q('vacancies', `DELETE FROM vacancies WHERE created_by = ANY($1::int[])`, [ids]);
    await q('users (managers cleared)', `UPDATE users SET manager_id = NULL WHERE manager_id = ANY($1::int[])`, [ids]);
    await q('users', `DELETE FROM users WHERE id = ANY($1::int[])`, [ids]);
    await q('login_attempts', `DELETE FROM login_attempts WHERE email = ANY($1::text[])`, [emails]);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    client.release();
    await pool.end();
    console.error(`\nFAILED: ${err.message}`);
    console.error('Transaction rolled back - nothing was changed.');
    process.exit(1);
  }
  client.release();

  console.log('\nRemoved:');
  for (const [label, n] of Object.entries(removed)) console.log(`  ${label}: ${n}`);
  const remaining = (await pool.query('SELECT COUNT(*)::int n FROM users')).rows[0].n;
  console.log(`\nDone. ${remaining} account(s) remain.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
