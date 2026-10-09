const fs = require('fs');
const path = require('path');

const DRIVER = process.env.DB_DRIVER || 'sqlite';

const DEFAULT_POSTGRES_PASSWORDS = new Set(['postgres', 'password', 'pass', 'admin', 'root', 'test', '123456', '']);

// The default-password check used to live only inside the PGPASSWORD fallback,
// so a DATABASE_URL in .env silently bypassed it and the app happily ran on the
// stock `postgres:postgres` superuser. The check now runs on whichever
// connection string wins.
// Paste artifacts (surrounding quotes, stray newlines/spaces) otherwise break
// both the password check and pg itself, so normalize once up front.
function normalizeConnectionString(raw) {
  let value = String(raw).trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    value = value.slice(1, -1).trim();
  }
  return value.replace(/\s+/g, '');
}

function redactConnectionString(connectionString) {
  return connectionString.replace(/(:\/\/[^:@/]*:)[^@]*@/, '$1***@');
}

function parsePassword(connectionString) {
  try {
    // Handles percent-encoding and unusual characters a regex can miss.
    const parsed = new URL(connectionString);
    if (parsed.password) return parsed.password;
  } catch {
    // Fall through to the regex for non-URL-parseable connection strings.
  }
  const match = connectionString.match(/^postgres(?:ql)?:\/\/[^:/@]+:([^@]*)@/i);
  return match ? match[1] : null;
}

function assertNonDefaultPassword(connectionString, source) {
  const password = parsePassword(connectionString);
  if (password === null) {
    throw new Error(
      `Could not parse a database password out of ${source} (got ${redactConnectionString(connectionString)}). ` +
      'Expected a URL like postgresql://user:password@host/database.'
    );
  }
  const decoded = (() => { try { return decodeURIComponent(password); } catch { return password; } })();
  if (DEFAULT_POSTGRES_PASSWORDS.has(String(decoded).trim().toLowerCase())) {
    throw new Error(
      `Refusing to start: ${source} uses a default database password. ` +
      'Set a unique password on the database role and update the connection string.'
    );
  }
}

function buildPostgres() {
  const { Pool } = require('pg');

  const connectionString = normalizeConnectionString(
    process.env.DATABASE_URL
      || `postgresql://${process.env.PGUSER || 'postgres'}:${process.env.PGPASSWORD || ''}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'glorious_hr'}`
  );

  assertNonDefaultPassword(connectionString, process.env.DATABASE_URL ? 'DATABASE_URL' : 'PGPASSWORD');

  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000 });

  function query(text, params) {
    return pool.query(text, params || []);
  }

  return {
    query,
    connect: async () => {
      const client = await pool.connect();
      return {
        query: (text, params) => client.query(text, params || []),
        release: () => client.release(),
      };
    },
    end: async () => {
      try {
        await pool.end();
      } catch {}
    },
    on: (event, handler) => pool.on(event, handler),
    pool,
  };
}

function buildSqlite() {
  const { DatabaseSync } = require('node:sqlite');

  const backendRoot = path.join(__dirname, '..', '..');
  const DB_FILE = process.env.DB_FILE
    ? path.resolve(backendRoot, process.env.DB_FILE)
    : path.join(backendRoot, 'data', 'glorious_hr.db');

  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

  const sqlite = new DatabaseSync(DB_FILE);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  function toSqlite(sql, params = []) {
    const order = [];
    const converted = sql
      .replace(/\$(\d+)/g, (_, num) => {
        order.push(parseInt(num, 10) - 1);
        return '?';
      })
      .replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP')
      .replace(/\bGREATEST\(0,\s*/gi, 'MAX(0, ')
      .replace(/COUNT\(\*\)\s+FILTER\s*\(WHERE\s+([^)]*)\)/gi, 'SUM(CASE WHEN $1 THEN 1 ELSE 0 END)');

    const reordered = order.length ? order.map((i) => params[i]) : params;
    return { sql: converted, params: reordered };
  }

  function query(text, params = []) {
    const { sql, params: bound } = toSqlite(text, params);
    const statements = sql.trim().split(';').filter((s) => s.trim().length > 0);

    if (statements.length > 1) {
      if (bound.length > 0) {
        throw new Error('Multi-statement SQL with bound parameters is not supported on SQLite');
      }
      sqlite.exec(sql);
      return { rows: [] };
    }

    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statements[0].trim().toUpperCase())) {
      sqlite.exec(sql);
      return { rows: [] };
    }

    const stmt = sqlite.prepare(sql);
    return { rows: stmt.all(...bound) };
  }

  return {
    query,
    connect: async () => ({
      query,
      release: () => {},
    }),
    end: () => {
      try {
        sqlite.close();
      } catch {}
    },
    on: () => {},
  };
}

function buildMssql() {
  const mssql = require('mssql');

  const config = {
    server: process.env.MSSQL_SERVER,
    port: parseInt(process.env.MSSQL_PORT, 10) || 1433,
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    database: process.env.MSSQL_DATABASE,
    options: {
      encrypt: process.env.MSSQL_ENCRYPT !== 'false',
      trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERT === 'true',
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 30000,
    requestTimeout: 30000,
  };

  let poolPromise = null;
  function getPool() {
    if (!poolPromise) {
      poolPromise = mssql.connect(config);
      poolPromise.catch(() => {
        poolPromise = null;
      });
    }
    return poolPromise;
  }

  function toMssql(sql) {
    let s = sql.trim();

    const limitMatch = s.match(/\bLIMIT\s+(\d+)\b/i);
    if (limitMatch) {
      s = s.replace(/\bLIMIT\s+(\d+)\b/i, '');
      s = s.replace(/^\s*SELECT\b/i, `SELECT TOP ${limitMatch[1]}`);
    }

    const returning = s.match(/\s+RETURNING\s+([\w\s,*]+?)\s*$/i);
    if (returning) {
      const cols = returning[1];
      const output =
        cols.trim() === '*'
          ? 'OUTPUT INSERTED.*'
          : 'OUTPUT ' + cols.split(',').map((c) => `INSERTED.${c.trim()}`).join(', ');
      s = s.replace(/\s+RETURNING\s+[\w\s,*]+?\s*$/i, '');
      if (/\bVALUES\b/i.test(s)) {
        s = s.replace(/\bVALUES\b/i, (m) => `${output} ${m}`);
      } else {
        s = s.replace(/\bWHERE\b/i, (m) => `${output} ${m}`);
      }
    }

    s = s.replace(/\bNOW\(\)/gi, 'CONVERT(NVARCHAR(19), GETDATE(), 120)');
    s = s.replace(/\bCURRENT_DATE\b/gi, 'CONVERT(NVARCHAR(10), GETDATE(), 23)');
    s = s.replace(/\bCURRENT_TIMESTAMP\b/gi, 'CONVERT(NVARCHAR(19), GETDATE(), 120)');
    s = s.replace(/GREATEST\(\s*0\s*,\s*([^)]*)\)/gi, (m, expr) => `CASE WHEN (${expr}) > 0 THEN (${expr}) ELSE 0 END`);
    s = s.replace(/COUNT\(\*\)\s+FILTER\s*\(WHERE\s+([^)]*)\)/gi, 'COALESCE(SUM(CASE WHEN $1 THEN 1 ELSE 0 END), 0)');

    s = s.replace(/\$(\d+)/g, '@p$1');
    return s;
  }

  function bindInput(request, name, value) {
    if (value === undefined) value = null;
    if (value === null) {
      request.input(name, mssql.NVarChar(mssql.MAX), null);
      return;
    }
    if (typeof value === 'boolean') {
      request.input(name, mssql.Bit, value);
      return;
    }
    if (typeof value === 'number') {
      request.input(name, Number.isInteger(value) ? mssql.Int : mssql.Float, value);
      return;
    }
    if (value instanceof Date) {
      request.input(name, mssql.DateTime2, value);
      return;
    }
    request.input(name, mssql.NVarChar(mssql.MAX), String(value));
  }

  async function exec(target, text, params) {
    const conn = target || (await getPool());
    const sql = toMssql(text);

    if (params && params.length) {
      const request = new mssql.Request(conn);
      params.forEach((p, i) => bindInput(request, `p${i + 1}`, p));
      const res = await request.query(sql);
      return { rows: res.recordset || [] };
    }

    const request = new mssql.Request(conn);
    const res = await request.batch(sql);
    return { rows: res.recordset || [] };
  }

  return {
    query: (text, params) => exec(null, text, params),
    connect: async () => {
      const conn = await getPool();
      let tx = null;
      return {
        query: async (text, params = []) => {
          const stmt = text.trim().toUpperCase();
          if (stmt === 'BEGIN' || stmt === 'BEGIN TRANSACTION') {
            if (tx) return { rows: [] };
            tx = new mssql.Transaction(conn);
            await tx.begin();
            return { rows: [] };
          }
          if (stmt === 'COMMIT' || stmt === 'COMMIT TRANSACTION') {
            if (tx) {
              await tx.commit();
              tx = null;
            }
            return { rows: [] };
          }
          if (stmt === 'ROLLBACK' || stmt === 'ROLLBACK TRANSACTION') {
            if (tx) {
              await tx.rollback();
              tx = null;
            }
            return { rows: [] };
          }
          if (!tx) {
            tx = new mssql.Transaction(conn);
            await tx.begin();
          }
          return exec(tx, text, params);
        },
        release: () => {
          tx = null;
        },
      };
    },
    end: async () => {
      if (poolPromise) {
        try {
          const pool = await poolPromise;
          await pool.close();
        } catch {}
      }
    },
    on: () => {},
  };
}

module.exports = DRIVER === 'mssql' ? buildMssql() : DRIVER === 'postgres' || DRIVER === 'postgresql' || DRIVER === 'pg' ? buildPostgres() : buildSqlite();
