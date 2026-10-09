require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function setup() {
  const driver = process.env.DB_DRIVER || 'sqlite';
  const schemaFile =
    driver === 'mssql' ? 'schema.mssql.sql' : driver === 'postgres' || driver === 'postgresql' || driver === 'pg' ? 'schema.postgres.sql' : 'schema.sql';
  const schema = fs.readFileSync(path.join(__dirname, schemaFile), 'utf8');

  if (driver === 'mssql') {
    const batches = schema.split(/^\s*GO\s*$/im).filter((b) => b.trim().length > 0);
    for (const batch of batches) {
      await pool.query(batch);
    }
  } else {
    await pool.query(schema);
  }

  await migrate(driver);

  console.log(`Database schema created successfully (${driver}).`);
  await pool.end();
}

async function migrate(driver) {
  const isMssql = driver === 'mssql';
  const newColumns = {
    gender: isMssql ? 'NVARCHAR(30)' : 'VARCHAR(30)',
    age: 'INTEGER',
    tin_number: 'VARCHAR(50)',
    pension_number: 'VARCHAR(50)',
    emergency_contact: 'VARCHAR(100)',
    bank_account: 'VARCHAR(100)',
    gross_salary: 'DECIMAL(12,2)',
    transport_allowance: 'DECIMAL(12,2)',
    education: 'VARCHAR(150)',
    email_verified_at: isMssql ? 'DATETIME2' : 'TIMESTAMP',
    token_version: isMssql ? 'INT NOT NULL DEFAULT 0' : 'INTEGER NOT NULL DEFAULT 0',
  };

  let existing = [];
  if (driver === 'sqlite') {
    const info = await pool.query('PRAGMA table_info(users)');
    existing = info.rows.map((r) => r.name);
  } else if (driver === 'postgres' || driver === 'postgresql' || driver === 'pg') {
    const info = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"
    );
    existing = info.rows.map((r) => r.column_name);
  } else if (driver === 'mssql') {
    const info = await pool.query(
      "SELECT COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'users'"
    );
    existing = info.rows.map((r) => r.column_name);
  } else {
    return;
  }

  let emailVerificationColumnAdded = false;
  for (const [name, type] of Object.entries(newColumns)) {
    if (!existing.includes(name)) {
      try {
        await pool.query(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
        console.log(`  Added column: ${name}`);
        if (name === 'email_verified_at') emailVerificationColumnAdded = true;
      } catch (err) {
        console.log(`  Column ${name} already present or skipped (${err.message})`);
      }
    }
  }

  if (emailVerificationColumnAdded) {
    const verifiedAt = isMssql ? 'GETDATE()' : 'created_at';
    await pool.query(`UPDATE users SET email_verified_at = ${verifiedAt} WHERE email_verified_at IS NULL`);
    console.log('  Marked existing users as verified.');
  }

  await migrateRoles(driver);
  await migrateKpiTranslations(driver);
}

// KPI templates and indicators are stored in English so that existing
// submissions and CSV imports keep matching. The optional `_am` columns hold the
// Amharic display copy for user-imported templates; the built-in templates are
// translated in the frontend locale files instead.
const KPI_TRANSLATION_COLUMNS = {
  kpi_templates: {
    name_am: 'VARCHAR(200)',
    role_title_am: 'VARCHAR(150)',
    description_am: 'TEXT',
  },
  kpi_template_items: {
    name_am: 'VARCHAR(300)',
    definition_am: 'TEXT',
    rating_criteria_am: 'TEXT',
  },
};

async function migrateKpiTranslations(driver) {
  if (!['sqlite', 'postgres', 'postgresql', 'pg', 'mssql'].includes(driver)) return;
  for (const [table, columns] of Object.entries(KPI_TRANSLATION_COLUMNS)) {
    const existing = await tableColumns(driver, table);
    for (const [name, type] of Object.entries(columns)) {
      if (existing.includes(name)) continue;
      const columnType = driver === 'mssql' && type === 'TEXT' ? 'NVARCHAR(MAX)' : type;
      try {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${columnType}`);
        console.log(`  Added column: ${table}.${name}`);
      } catch (err) {
        console.log(`  Column ${table}.${name} already present or skipped (${err.message})`);
      }
    }
  }
}

async function tableColumns(driver, table) {
  if (driver === 'sqlite') {
    const info = await pool.query(`PRAGMA table_info(${table})`);
    return info.rows.map((row) => row.name);
  }
  if (driver === 'mssql') {
    const info = await pool.query(
      'SELECT COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = $1',
      [table]
    );
    return info.rows.map((row) => row.column_name);
  }
  const info = await pool.query(
    'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
    [table]
  );
  return info.rows.map((row) => row.column_name);
}

async function migrateRoles(driver) {
  if (driver === 'sqlite') {
    const t = await pool.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
    const createSql = t.rows[0]?.sql || '';
    if (createSql.includes("'coo'")) return;

    console.log('  Rebuilding users table to allow coo role...');
    await pool.query('PRAGMA foreign_keys=OFF');
    await pool.query(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('employee', 'manager', 'hr', 'admin', 'coo')),
        department_id INTEGER REFERENCES departments(id),
        position VARCHAR(150),
        manager_id INTEGER REFERENCES users(id),
        phone VARCHAR(30),
        gender VARCHAR(30),
        age INTEGER,
        hire_date TEXT,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'inactive')),
        annual_leave_balance INTEGER DEFAULT 20,
        sick_leave_balance INTEGER DEFAULT 10,
        tin_number VARCHAR(50),
        pension_number VARCHAR(50),
        emergency_contact VARCHAR(100),
        bank_account VARCHAR(100),
        gross_salary DECIMAL(12,2),
        transport_allowance DECIMAL(12,2),
         education VARCHAR(150),
         email_verified_at TEXT,
         token_version INTEGER NOT NULL DEFAULT 0,
         created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
       )
     `);
     await pool.query(`
       INSERT INTO users_new (
         id, email, password_hash, first_name, last_name, role, department_id, position,
         manager_id, phone, gender, age, hire_date, status, annual_leave_balance, sick_leave_balance,
         tin_number, pension_number, emergency_contact, bank_account, gross_salary,
         transport_allowance, education, email_verified_at, token_version, created_at
       )
       SELECT
         id, email, password_hash, first_name, last_name, role, department_id, position,
         manager_id, phone, gender, age, hire_date, status, annual_leave_balance, sick_leave_balance,
         tin_number, pension_number, emergency_contact, bank_account, gross_salary,
         transport_allowance, education, email_verified_at, COALESCE(token_version, 0), created_at
      FROM users
    `);
    await pool.query('DROP TABLE users');
    await pool.query('ALTER TABLE users_new RENAME TO users');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id)');
    await pool.query('PRAGMA foreign_keys=ON');
    console.log('  users table rebuilt with coo role allowed.');
  } else if (driver === 'postgres' || driver === 'postgresql' || driver === 'pg') {
    try {
      await pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
      await pool.query(
        `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('employee', 'manager', 'hr', 'admin', 'coo'))`
      );
      console.log('  Updated users role check constraint to allow coo.');
    } catch (err) {
      console.log(`  Role check migration skipped (${err.message})`);
    }
  }
}

setup().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
