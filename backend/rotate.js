#!/usr/bin/env node
// Rotates a shared/breached password out of every account still using it, and
// gives each account its own random password.
//
// Bumping token_version on every rotated row also invalidates every outstanding
// JWT, so nobody stays logged in on the old shared password.
//
//   node rotate.js --shared glorious2026            # rotate only accounts still on it
//   node rotate.js --all                             # rotate every account
//   node rotate.js --shared glorious2026 --dry-run   # show what would change
//   node rotate.js --shared glorious2026 --out new-passwords.csv
//
// Credentials are printed to stdout and written only where you explicitly ask.
// Delete any --out file after handing the passwords over.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('./src/config/db');

const COST = 12;
const LENGTH = 16;

function parseArgs(argv) {
  const args = { dryRun: false, all: false, shared: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--all') args.all = true;
    else if (a === '--shared') args.shared = argv[++i];
    else if (a.startsWith('--shared=')) args.shared = a.slice(9);
    else if (a === '--out') args.out = argv[++i];
    else if (a.startsWith('--out=')) args.out = a.slice(6);
    else if (a === '--help' || a === '-h') args.help = true;
    else { console.error(`Unknown argument: ${a}`); args.help = true; }
  }
  return args;
}

// Unbiased random pick, avoiding the modulo bias of Math.random() % max.
function randomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = crypto.randomBytes(4);
  let n = buf.readUInt32BE(0);
  while (n >= limit) n = crypto.randomBytes(4).readUInt32BE(0);
  return n % max;
}

const SETS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ', // no I/O
  'abcdefghijkmnopqrstuvwxyz', // no l
  '23456789', // no 0/1
  '!@#$%^&*()-_=+[]',
];

function generatePassword(length = LENGTH) {
  const required = SETS.map((set) => set[randomInt(set.length)]);
  const all = SETS.join('');
  const rest = Array.from({ length: length - required.length }, () => all[randomInt(all.length)]);
  const chars = [...required, ...rest];
  // Fisher-Yates with the same unbiased source.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function csvEscape(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HELP = `
Rotate the shared password to a unique random one per account.

  --shared <password>   Only touch accounts that still verify against this password
  --all                 Rotate every account regardless of current password
  --dry-run             Print what would change without writing anything
  --out <file>          Also write a CSV of email,password (delete it afterwards)
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.shared && !args.all)) {
    console.log(HELP.trim());
    process.exit(args.help ? 0 : 1);
  }
  if (args.shared && args.all) {
    console.error('--shared and --all are mutually exclusive');
    process.exit(1);
  }

  const { rows: users } = await pool.query(
    'SELECT id, email, role, status, password_hash, COALESCE(token_version, 0) AS token_version FROM users ORDER BY id'
  );
  if (!users.length) {
    console.log('No users found.');
    await pool.end();
    return;
  }

  const targets = [];
  for (const u of users) {
    if (args.all) {
      targets.push(u);
      continue;
    }
    let matches = false;
    try { matches = bcrypt.compareSync(args.shared, u.password_hash); } catch {}
    if (matches) targets.push(u);
  }

  console.log(`accounts found   : ${users.length}`);
  console.log(`to rotate        : ${targets.length}${args.all ? ' (--all)' : ` (still on the supplied password)`}`);
  if (!targets.length) {
    console.log('\nNothing to do - no account still uses that password. Already rotated?');
    await pool.end();
    return;
  }

  const plan = targets.map((u) => ({ ...u, password: generatePassword() }));

  if (args.dryRun) {
    console.log('\nDRY RUN - no changes written. Would rotate:');
    plan.forEach((p) => console.log(`  ${p.email} (${p.role})`));
    await pool.end();
    return;
  }

  const { connect } = pool;
  const client = await connect();
  let done = 0;
  try {
    await client.query('BEGIN');
    for (const p of plan) {
      const hash = await bcrypt.hash(p.password, COST);
      await client.query(
        'UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2',
        [hash, p.id]
      );
      done++;
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    await client.release();
    await pool.end();
    console.error(`\nFAILED after ${done} account(s): ${err.message}`);
    console.error('Transaction rolled back - no passwords were changed.');
    process.exit(1);
  }
  client.release();

  console.log(`\nrotated ${done} account(s). Every old session is now invalid.\n`);
  console.log('  EMAIL'.padEnd(44) + 'ROLE'.padEnd(12) + 'NEW PASSWORD');
  console.log('  ' + '-'.repeat(76));
  for (const p of plan) console.log('  ' + p.email.padEnd(44) + String(p.role).padEnd(12) + p.password);

  if (args.out) {
    const file = path.resolve(process.cwd(), args.out);
    const csv = ['email,role,password', ...plan.map((p) => [p.email, p.role, p.password].map(csvEscape).join(','))].join('\n');
    fs.writeFileSync(file, csv, { mode: 0o600 });
    console.log(`\nWrote ${file}`);
    console.log('Delete this file once each person has their password.');
  }

  console.log('\nShare each password over a channel that is not this console, and have');
  console.log('users change it on first sign-in. Re-run with --shared <pw> to confirm');
  console.log('nothing is left on the old password.');

  await pool.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
