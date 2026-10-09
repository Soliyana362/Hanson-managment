# Glorious HR Management System

A full-stack HR management portal for **Glorious** — employees can view their status, request leave, and managers/HR can fill KPI evaluations based on your company's KPI templates.

## Features

- **Employee Dashboard** — view employment status, leave balances, and recent activity
- **Leave Management** — submit, track, and cancel leave requests; managers/HR approve or reject
- **KPI System** — templates from your KPI.xlsx (Finance, Sales, Showroom roles) with automatic scoring
- **Role-based Access** — Employee, Manager, HR, and Admin roles
- **Glorious Branding** — blue corporate theme with company logo

## Tech Stack

- **Frontend:** React 18 + Vite
- **Backend:** Node.js + Express
- **Database:** Microsoft SQL Server (Azure SQL) via the `mssql` driver, PostgreSQL via the `pg` driver, or a built-in SQLite file — selected with `DB_DRIVER` (`mssql`, `postgres`, or unset → `sqlite`)

## Quick Start (PostgreSQL)

### 1. Install dependencies

```bash
cd "C:\Users\Administrator\Desktop\Glorious managment (3)\Glorious managment"
npm run install:all
```

### 2. Configure the connection

Edit `backend/.env`:

```
DB_DRIVER=postgres
DATABASE_URL=postgresql://postgres:<your-strong-password>@localhost:5432/glorious_hr
```

You need a running PostgreSQL server. Options:

- **Bundled cluster (recommended for this machine):** the project comes with a ready-made Postgres data directory at `postgres-data/` (database `glorious_hr`, default superuser `postgres`). Change the superuser's password and mirror it in the `DATABASE_URL` above — do not leave the shipped default in place. Start it with:

  ```
  start-postgres.bat
  ```

  (or `start-postgres.ps1`). This launches Postgres 18 directly with a clean PATH to avoid the `0xC0000142` Windows DLL-init crash caused by a stale `PostgreSQL\16` entry on the system PATH. It must be re-run after every reboot — Postgres here is not a Windows service.
- **Docker:** `docker compose up -d` starts a Postgres 16 container matching the URL above (port 5432, db `glorious_hr`, user `postgres` — password is taken from `POSTGRES_PASSWORD` in your environment or a local `.env` file).
- **Other local install:** point `DATABASE_URL` at your own instance, or set `DB_DRIVER=sqlite` to run with no server at all.

### 3. Create tables and seed demo data

```bash
npm run db:create
npm run db:setup
npm run db:seed
```

`db:create` creates the `glorious_hr` database if it doesn't exist (for local SQLite this step is a no-op). Skippable if you're already using the bundled `postgres-data` cluster, which ships pre-seeded.

### 4. Run the application

**Terminal 1 — Backend:**
```bash
npm run dev:backend
```

**Terminal 2 — Frontend:**
```bash
npm run dev:frontend
```

Open **http://localhost:3000**

## Quick Start (Microsoft SQL Server / Azure SQL)

### Prerequisites

- [Node.js](https://nodejs.org/) 22.5+
- A Microsoft SQL Server instance (e.g. Azure SQL Database) with a database created and credentials you can connect with

### 1. Install dependencies

```bash
cd "C:\Users\Administrator\Desktop\Glorious managment (3)\Glorious managment"
npm run install:all
```

If npm SSL errors occur, run:
```bash
set NODE_TLS_REJECT_UNAUTHORIZED=0
npm run install:all
```

### 2. Configure the connection

Edit `backend/.env` and set the MSSQL values (for Azure SQL, the login is `username@server`):

```
DB_DRIVER=mssql
MSSQL_SERVER=your-server.database.windows.net
MSSQL_PORT=1433
MSSQL_DATABASE=glorious_hr
MSSQL_USER=your-login@your-server
MSSQL_PASSWORD=your-password
MSSQL_ENCRYPT=true
```

**Note for Azure SQL:** add your machine's public IP to the server firewall (Azure portal → your SQL server → Networking → "Add your client IPv4 address"). You must also create the database (`glorious_hr`) before running `db:setup`, since a connection to the database itself is required.

### 3. Create tables and seed demo data

```bash
npm run db:setup
npm run db:seed
```

### 4. Run the application

**Terminal 1 — Backend:**
```bash
npm run dev:backend
```

**Terminal 2 — Frontend:**
```bash
npm run dev:frontend
```

Open **http://localhost:3000**

### Optional: use SQL Server Express (free, local)

1. Download **SQL Server Express** from https://www.microsoft.com/en-us/sql-server/sql-server-downloads (choose the Express edition) and run the installer.
2. Choose **Custom** installation → keep **Database Engine Services** → on the **Database Engine Configuration** page select **Mixed Mode (SQL Server authentication and Windows authentication)** and set an **sa** password. Click **Add Current User** on the same page.
3. After install, enable TCP/IP so the app can connect:
   - Open **SQL Server Configuration Manager** → **SQL Server Network Configuration** → **Protocols for SQLEXPRESS** (or `MSSQLSERVER` for a default instance) → right-click **TCP/IP** → **Enable**.
   - In **SQL Server Services**, right-click **SQL Server (SQLEXPRESS)** → **Restart**.
4. Set `backend/.env` (for a named instance use `localhost\SQLEXPRESS`; for a default instance use `localhost`):
   ```
   DB_DRIVER=mssql
   MSSQL_SERVER=localhost\SQLEXPRESS
   MSSQL_DATABASE=glorious_hr
   MSSQL_USER=sa
   MSSQL_PASSWORD=TheSaPasswordYouSet
   MSSQL_ENCRYPT=false
   MSSQL_TRUST_SERVER_CERT=true
   ```
5. Create the database, tables, and seed data (the app does it for you):
   ```bash
   npm run db:create
   npm run db:setup
   npm run db:seed
   ```

### Optional: run without SQL Server (SQLite fallback)

Remove `DB_DRIVER=mssql` from `backend/.env` (or set `DB_DRIVER=sqlite`) and the app will use a local SQLite file at `backend/data/glorious_hr.db` instead. No server needed.

## Demo Accounts

Passwords come from `SEED_PASSWORD` (set in `backend/.env`, minimum 12 characters). Set a unique, strong value before running `npm run db:seed`; accounts created before hardening keep their original passwords and can still sign in with them.

| Email | Role |
|-------|------|
| admin@hanson.com | Admin |
| hr@hanson.com | HR |
| manager@hanson.com | Manager |
| finance@hanson.com | Employee (Senior Finance) |
| sales@hanson.com | Employee (Showroom Head) |
| employee@hanson.com | Employee (Sales Associate) |
| coo@hanson.com | COO |

## KPI Templates

Pre-loaded templates based on your `KPI.xlsx`:

1. **Senior Finance Objective KPI** — reconciliation, audit, payroll, taxes, etc.
2. **Junior Finance Objective KPI** — cash reconciliation, invoices, data entry
3. **Showroom Head KPI** — sales targets, customer follow-up, team performance
4. **Hanson Showroom Head KPI** — sales, inventory, conversion rate

HR/Managers create KPI entries by selecting a template and employee, then filling achievement percentages. Scores (1–5) and weighted totals are calculated automatically.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Login |
| GET | /api/auth/me | Current user profile |
| GET | /api/dashboard | Dashboard stats |
| GET/POST | /api/leave | Leave requests |
| PATCH | /api/leave/:id/review | Approve/reject leave |
| GET | /api/kpi/templates | KPI templates |
| GET/POST | /api/kpi/submissions | KPI submissions |
| GET | /api/users | Employee list (HR/Manager) |

## Project Structure

```
Glorious managment/
├── backend/          # Express API + MSSQL (SQLite fallback)
├── frontend/         # React UI
├── docker-compose.yml
├── KPI.xlsx          # Original KPI spreadsheet
└── README.md
```

## Configuration

Copy `backend/.env.example` to `backend/.env` and update:

**PostgreSQL:**
```
DB_DRIVER=postgres                # mssql | postgres | sqlite
DATABASE_URL=postgresql://postgres:<your-strong-password>@localhost:5432/glorious_hr
JWT_SECRET=your-secure-secret
PORT=5000
```

**MSSQL:**
```
DB_DRIVER=mssql                   # mssql | postgres | sqlite
MSSQL_SERVER=your-server.database.windows.net   # local Express: localhost or localhost\SQLEXPRESS
MSSQL_PORT=1433
MSSQL_DATABASE=glorious_hr
MSSQL_USER=your-login@your-server               # local Express: sa
MSSQL_PASSWORD=your-password
MSSQL_ENCRYPT=true             # local Express: false
MSSQL_TRUST_SERVER_CERT=false  # local Express: true
JWT_SECRET=your-secure-secret
PORT=5000
```

The backend automatically translates the app's SQL for T-SQL (placeholders `$1` → `@p1`, `RETURNING` → `OUTPUT INSERTED`, `LIMIT n` → `TOP n`, `NOW()`/`CURRENT_TIMESTAMP` → `GETDATE()`, `GREATEST` → `CASE WHEN`), so no query changes are needed. With `DB_DRIVER=postgres` the SQL runs natively.
