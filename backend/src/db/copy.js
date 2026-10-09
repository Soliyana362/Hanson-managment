require('dotenv').config();
const { Pool } = require('pg');

// Copies all data from a source database into an already-migrated target
// database (e.g. your local Postgres -> Neon). Run `npm run db:setup` against
// the target first so the schema exists there.
//
//   SOURCE_DATABASE_URL=postgresql://...local... \
//   TARGET_DATABASE_URL=postgresql://...neon...  npm run db:copy
//
// Pass --append to keep existing rows instead of truncating the target first.

const sourceUrl = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL;
const append = process.argv.includes('--append');

if (!sourceUrl) throw new Error('Set SOURCE_DATABASE_URL (or DATABASE_URL) to the source database.');
if (!targetUrl) throw new Error('Set TARGET_DATABASE_URL to the destination database.');
if (sourceUrl === targetUrl) throw new Error('Source and target are the same database.');

const source = new Pool({ connectionString: sourceUrl });
const target = new Pool({ connectionString: targetUrl });

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function tableList(pool) {
  const r = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`);
  return r.rows.map((x) => x.table_name);
}

async function columnsOf(pool, table) {
  const r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
  return r.rows;
}

// Reconcile slight schema drift between the source and the (fresh) target:
// e.g. a column stored as numeric "20.0" in an old database that is an
// integer in the current schema.
function coerce(value, dataType) {
  if (value == null) return null;
  if (dataType === 'integer' || dataType === 'smallint' || dataType === 'bigint') {
    if (typeof value === 'number') return Math.round(value);
    const s = String(value).trim();
    if (/^-?\d+$/.test(s)) return s;
    const n = Number(s);
    return Number.isNaN(n) ? value : Math.round(n);
  }
  return value;
}

async function fkEdges(pool) {
  const r = await pool.query(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
     WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`);
  return r.rows.filter((e) => e.child !== e.parent);
}

// Parents before children. Self-references (e.g. users.manager_id) are excluded
// from the graph and handled with a second pass.
function topoSort(tables, edges) {
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of edges) {
    if (deps.has(child) && deps.has(parent)) deps.get(child).add(parent);
  }
  const ordered = [];
  const done = new Set();
  while (ordered.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...deps.get(t)].every((d) => done.has(d)));
    if (ready.length === 0) throw new Error('Cyclic foreign keys detected; cannot order tables.');
    for (const t of ready) { ordered.push(t); done.add(t); }
  }
  return ordered;
}

async function main() {
  const sourceTables = await tableList(source);
  const targetTables = new Set(await tableList(target));
  const missing = sourceTables.filter((t) => !targetTables.has(t));
  if (missing.length) {
    throw new Error(`Target is missing tables (run db:setup first): ${missing.join(', ')}`);
  }

  const order = topoSort(sourceTables, await fkEdges(source));

  if (!append) {
    await target.query(`TRUNCATE ${order.map(ident).join(', ')} RESTART IDENTITY CASCADE`);
    console.log('Cleared target tables.');
  }

  let total = 0;
  for (const table of order) {
    const targetCols = await columnsOf(target, table);
    const sourceCols = new Set((await columnsOf(source, table)).map((c) => c.column_name));
    const cols = targetCols.filter((c) => sourceCols.has(c.column_name));
    const colNames = cols.map((c) => c.column_name);

    const rows = (await source.query(
      `SELECT ${colNames.map(ident).join(', ')} FROM ${ident(table)}`)).rows;

    // Break the self-referencing users.manager_id FK on insert, fix it after.
    const isUsers = table === 'users';
    const insertRows = isUsers ? rows.map((r) => ({ ...r, manager_id: null })) : rows;

    const colList = cols.map((c) => ident(c.column_name)).join(', ');
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    for (const row of insertRows) {
      await target.query(
        `INSERT INTO ${ident(table)} (${colList}) VALUES (${placeholders})`,
        cols.map((c) => coerce(row[c.column_name], c.data_type)));
    }

    if (isUsers) {
      for (const row of rows) {
        if (row.manager_id != null) {
          await target.query(`UPDATE ${ident('users')} SET manager_id=$1 WHERE id=$2`, [row.manager_id, row.id]);
        }
      }
    }

    // Keep sequences in step with the copied ids.
    const seq = (await target.query(`SELECT pg_get_serial_sequence($1, 'id') AS s`, [table])).rows[0].s;
    if (seq) {
      await target.query(
        `SELECT setval($1, COALESCE((SELECT MAX("id") FROM ${ident(table)}), 0) + 1, false)`, [seq]);
    }

    total += insertRows.length;
    console.log(`  ${table}: ${insertRows.length} rows`);
  }

  console.log(`Done. Copied ${total} rows across ${order.length} tables.`);
}

main()
  .then(() => { source.end(); target.end(); })
  .catch(async (err) => {
    console.error('Migration failed:', err.message);
    await source.end().catch(() => {});
    await target.end().catch(() => {});
    process.exit(1);
  });
