const pool = require('../config/db');
const { createToken, hashToken } = require('./tokens');
const { sendVerificationEmail } = require('./email');

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

module.exports = { issueEmailVerification };
