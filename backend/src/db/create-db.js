require('dotenv').config();

async function createDatabase() {
  const driver = process.env.DB_DRIVER || 'sqlite';

  if (driver === 'mssql') {
    const mssql = require('mssql');
    const dbName = process.env.MSSQL_DATABASE || 'glorious_hr';
    if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
      throw new Error(`Invalid database name: ${dbName}`);
    }

    const config = {
      server: process.env.MSSQL_SERVER,
      port: parseInt(process.env.MSSQL_PORT, 10) || 1433,
      user: process.env.MSSQL_USER,
      password: process.env.MSSQL_PASSWORD,
      database: 'master',
      options: {
        encrypt: process.env.MSSQL_ENCRYPT !== 'false',
        trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERT === 'true',
      },
      connectionTimeout: 30000,
      requestTimeout: 30000,
    };

    const pool = await mssql.connect(config);
    await pool.request().query(`IF DB_ID(N'${dbName}') IS NULL CREATE DATABASE [${dbName}]`);
    console.log(`Database '${dbName}' is ready on ${config.server}.`);
    await pool.close();
    return;
  }

  if (driver === 'postgres' || driver === 'postgresql' || driver === 'pg') {
    const { Client } = require('pg');

    const url = new URL(
      process.env.DATABASE_URL ||
        `postgresql://${process.env.PGUSER || 'postgres'}:${process.env.PGPASSWORD || 'postgres'}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'postgres'}`
    );
    const dbName = url.pathname.replace(/^\//, '') || 'glorious_hr';
    if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
      throw new Error(`Invalid database name: ${dbName}`);
    }

    const adminUrl = new URL(url.toString());
    adminUrl.pathname = '/postgres';

    const client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rows.length === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database '${dbName}' created on ${url.host}.`);
    } else {
      console.log(`Database '${dbName}' already exists on ${url.host}.`);
    }
    await client.end();
    return;
  }

  console.log('SQLite driver does not require an explicit database step. Skipping db:create.');
}

createDatabase().catch((err) => {
  console.error('Failed to create database:', err.message);
  process.exit(1);
});