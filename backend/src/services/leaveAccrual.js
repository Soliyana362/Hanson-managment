// Annual-leave accrual based on years of service.
//
// HR policy: every employee earns a fixed number of annual-leave days for each
// FULL year they have worked, and a proportional slice of that entitlement for
// the part of the current year they have already worked. Entitlement therefore
// grows automatically as an employee's tenure grows, without HR having to top
// the balance up by hand every year.
//
// The calculation is intentionally done in JavaScript rather than SQL so the
// same numbers come out on SQLite, PostgreSQL and MSSQL, whose date arithmetic
// and rounding all differ.

// Days earned per completed year of service (the standard 20-day entitlement).
const DAYS_PER_YEAR = Number(process.env.ANNUAL_LEAVE_DAYS_PER_YEAR) > 0
  ? Number(process.env.ANNUAL_LEAVE_DAYS_PER_YEAR)
  : 20;

function toDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Postgres hands back a DATE as a Date at *local* midnight. Re-anchor it to
    // a UTC midnight built from the local calendar day so the timezone of the
    // server never shifts a hire date by a day.
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  // SQLite/MSSQL return DATE as a string.
  const text = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Full years elapsed between hire and now, plus the fraction of the current
// (incomplete) year already worked, as a decimal number of years.
function yearsOfService(hireDate, asOf = new Date()) {
  const hire = toDate(hireDate);
  if (!hire) return null;
  const today = startOfUtcDay(asOf);
  const start = startOfUtcDay(hire);
  if (start > today) return { completeYears: 0, partialFraction: 0, total: 0 };

  let years = today.getUTCFullYear() - start.getUTCFullYear();
  let anniversary = new Date(Date.UTC(
    start.getUTCFullYear() + years,
    start.getUTCMonth(),
    start.getUTCDate()
  ));

  // If this year's anniversary has not happened yet, the last full year ended
  // on the previous anniversary.
  if (anniversary > today) {
    years -= 1;
    anniversary = new Date(Date.UTC(
      start.getUTCFullYear() + years,
      start.getUTCMonth(),
      start.getUTCDate()
    ));
  }

  const nextAnniversary = new Date(Date.UTC(
    start.getUTCFullYear() + years + 1,
    start.getUTCMonth(),
    start.getUTCDate()
  ));
  const yearMs = nextAnniversary - anniversary;
  const workedMs = today - anniversary;
  const partial = yearMs > 0 ? Math.min(Math.max(workedMs / yearMs, 0), 1) : 0;

  return {
    completeYears: Math.max(years, 0),
    partialFraction: partial,
    total: Math.max(years, 0) + partial,
  };
}

// Round to a whole/half day, the granularity leave is actually booked in.
function roundDays(value) {
  return Math.round(value * 2) / 2;
}

// Entitlement (accrued days) an employee has earned up to `asOf`.
function accruedDays(hireDate, asOf = new Date()) {
  const service = yearsOfService(hireDate, asOf);
  if (service === null) return null;
  return roundDays(service.total * DAYS_PER_YEAR);
}

// Full breakdown used by both the API and the CSV export.
function leaveSummary({ hire_date, taken_days }, asOf = new Date()) {
  const service = yearsOfService(hire_date, asOf);
  const accrued = accruedDays(hire_date, asOf);
  const taken = Number(taken_days) || 0;
  return {
    hire_date: hire_date || null,
    complete_years: service === null ? null : service.completeYears,
    years_of_service: service === null ? null : roundDays(service.total * 100) / 100,
    days_per_year: DAYS_PER_YEAR,
    accrued_days: accrued,
    taken_days: roundDays(taken),
    remaining_days: accrued === null ? null : roundDays(accrued - taken),
  };
}

module.exports = {
  DAYS_PER_YEAR,
  toDate,
  yearsOfService,
  accruedDays,
  leaveSummary,
  roundDays,
};
