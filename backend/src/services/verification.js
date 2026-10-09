const pool = require('../config/db');
const { createToken, hashToken } = require('./tokens');
const { sendVerificationEmail, sendAccountSetupEmail } = require('./email');

async function issueEmailVerification(user, client = pool) {
  const token = createToken();
  const tokenHash = hashToken(token);
  const driver = process.env.DB_DRIVER || 'sqlite';
  let insertSql = `INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, `;

  if (driver === 'postgres' || driver === 'postgresql' || driver === 'pg') {
    insertSql += `NOW() + INTERVAL '24 hours')`;
  } else if (driver === 'mssql') {
    insertSql += `CONVERT(NVARCHAR(19), DATEADD(HOUR, 24, GETDATE()), 120))`;
  } else {
    insertSql += `datetime('now', '+24 hours'))`;
  }

  await client.query(
    'DELETE FROM email_verification_tokens WHERE user_id = $1 AND used = 0',
    [user.id]
  );
  await client.query(insertSql, [user.id, tokenHash]);

  await sendVerificationEmail(user.email, user.first_name, token);
}

// New accounts are created without a usable password. Instead of asking HR to
// invent one, we email the employee a link (valid for 7 days) to choose their
// own password. The token reuses the password-reset mechanism; using it also
// confirms the email address, so the account is ready to sign in afterwards.
async function issueAccountSetup(user, client = pool) {
  const token = createToken();
  const tokenHash = hashToken(token);
  const driver = process.env.DB_DRIVER || 'sqlite';
  let insertSql = `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, `;

  if (driver === 'postgres' || driver === 'postgresql' || driver === 'pg') {
    insertSql += `NOW() + INTERVAL '7 days')`;
  } else if (driver === 'mssql') {
    insertSql += `CONVERT(NVARCHAR(19), DATEADD(DAY, 7, GETDATE()), 120))`;
  } else {
    insertSql += `datetime('now', '+7 days'))`;
  }

  await client.query(
    'DELETE FROM password_reset_tokens WHERE user_id = $1 AND used = 0',
    [user.id]
  );
  await client.query(insertSql, [user.id, tokenHash]);

  await sendAccountSetupEmail(user.email, user.first_name, token);
}

module.exports = { issueEmailVerification, issueAccountSetup };
