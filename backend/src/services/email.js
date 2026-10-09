const fs = require('fs');
const path = require('path');
const tls = require('tls');
const nodemailer = require('nodemailer');

// Delivery is chosen at runtime:
//   - If EMAIL_API_KEY is set, mail is sent over an HTTPS email API (works where
//     outbound SMTP ports are blocked, e.g. free-tier hosts).
//   - Otherwise it falls back to SMTP (used for local development).
const HTTP_PROVIDERS = {
  resend: {
    url: 'https://api.resend.com/emails',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    body: ({ to, subject, text, from }) => ({ from, to, subject, text }),
  },
  brevo: {
    url: 'https://api.brevo.com/v3/smtp/email',
    headers: (key) => ({ 'api-key': key, accept: 'application/json' }),
    body: ({ to, subject, text }, sender) => ({
      sender,
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
  },
  sendgrid: {
    url: 'https://api.sendgrid.com/v3/mail/send',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    body: ({ to, subject, text }, sender) => ({
      personalizations: [{ to: [{ email: to }] }],
      from: sender,
      subject,
      content: [{ type: 'text/plain', value: text }],
    }),
  },
};

const configuredProvider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
const apiKey = (process.env.EMAIL_API_KEY || '').trim();
const gmailClientId = (process.env.GMAIL_CLIENT_ID || '').trim();
const gmailClientSecret = (process.env.GMAIL_CLIENT_SECRET || '').trim();
const gmailRefreshToken = (process.env.GMAIL_REFRESH_TOKEN || '').trim();
const activeProvider = configuredProvider || 'resend';
// Gmail is sent through the Gmail REST API over HTTPS (443), which works even
// where outbound SMTP ports are blocked. It needs OAuth2 credentials rather
// than a static API key.
const useGmailApi = configuredProvider === 'gmail' || configuredProvider === 'gmail_api';
const useHttpApi = !useGmailApi && Boolean(apiKey);
if (!useGmailApi && useHttpApi && !HTTP_PROVIDERS[activeProvider]) {
  console.warn(`[email] EMAIL_PROVIDER "${activeProvider}" is not supported (use resend, brevo, sendgrid, or gmail).`);
}

if (useGmailApi) {
  console.log('[email] Sending email via the Gmail API (OAuth2).');
} else if (useHttpApi) {
  console.log(`[email] Sending email via the ${activeProvider} HTTP API.`);
} else {
  console.log('[email] Sending email via SMTP.');
}

// --- SMTP transport (fallback / local development) ---
const smtpPort = Number(process.env.SMTP_PORT || 587);
const rejectUnauthorized = process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false';
if (!useHttpApi && !rejectUnauthorized) {
  console.warn('[email] SMTP certificate verification is DISABLED (SMTP_TLS_REJECT_UNAUTHORIZED=false).');
  console.warn('[email] Set it to true unless your mail server intentionally uses a self-signed certificate.');
}
const tlsOptions = { rejectUnauthorized };
const smtpCaFile = (process.env.SMTP_CA_CERT || '').trim();
if (!useHttpApi && smtpCaFile) {
  const extraCa = fs.readFileSync(path.resolve(smtpCaFile), 'utf8');
  tlsOptions.ca = [...tls.rootCertificates, extraCa];
  console.log(`[email] Extra SMTP CA trusted from ${smtpCaFile} (verification ${rejectUnauthorized ? 'ENABLED' : 'DISABLED'}).`);
}
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: process.env.SMTP_SECURE === 'true' || smtpPort === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: tlsOptions,
});

function parseSender(from) {
  const match = String(from).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1] || undefined, email: match[2] };
  return { email: String(from).trim() };
}

async function sendViaHttp({ to, subject, text }) {
  const provider = HTTP_PROVIDERS[activeProvider];
  if (!provider) {
    throw new Error(`Unsupported EMAIL_PROVIDER "${activeProvider}". Use resend, brevo, or sendgrid.`);
  }
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || '';
  const response = await fetch(provider.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...provider.headers(apiKey) },
    body: JSON.stringify(provider.body({ to, subject, text, from }, parseSender(from))),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Email provider (${activeProvider}) returned ${response.status}: ${detail.slice(0, 300)}`);
  }
}

function frontendUrl(path) {
  const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)[0] || 'http://localhost:3000';
  return `${baseUrl}${path}`;
}

// --- Gmail API (OAuth2) ---
let gmailToken = { value: '', expiresAt: 0 };

async function getGmailAccessToken() {
  if (!gmailClientId || !gmailClientSecret || !gmailRefreshToken) {
    throw new Error('Gmail API is not configured (set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN).');
  }
  if (gmailToken.value && Date.now() < gmailToken.expiresAt - 60000) {
    return gmailToken.value;
  }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: gmailClientId,
      client_secret: gmailClientSecret,
      refresh_token: gmailRefreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`Gmail token refresh failed (${response.status}): ${data.error_description || data.error || 'unknown error'}`);
  }
  gmailToken = {
    value: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return gmailToken.value;
}

function encodeHeader(value) {
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildGmailRaw({ to, from, subject, text }) {
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64'),
  ].join('\r\n');
  return Buffer.from(message, 'utf8').toString('base64url');
}

async function sendViaGmail({ to, subject, text }) {
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || '';
  if (!from) throw new Error('EMAIL_FROM is required to send via the Gmail API.');
  const accessToken = await getGmailAccessToken();
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: buildGmailRaw({ to, from, subject, text }) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Gmail API returned ${response.status}: ${detail.slice(0, 300)}`);
  }
}

async function sendMail({ to, subject, text }) {
  if (useGmailApi) {
    return sendViaGmail({ to, subject, text });
  }
  if (useHttpApi) {
    return sendViaHttp({ to, subject, text });
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('Email service is not configured');
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
}

async function sendVerificationEmail(to, firstName, token) {
  const link = frontendUrl(`/verify-email#token=${encodeURIComponent(token)}`);
  await sendMail({
    to,
    subject: 'Verify your account',
    text: `Hello ${firstName},\n\nVerify your account using this link:\n${link}\n\nThis link expires in 24 hours. If you did not request this account, you can ignore this email.`,
  });
}

async function sendPasswordResetEmail(to, firstName, token) {
  const link = frontendUrl(`/reset-password#token=${encodeURIComponent(token)}`);
  await sendMail({
    to,
    subject: 'Reset your Hanson HR password',
    text: `Hello ${firstName},\n\nReset your Hanson HR password using this link:\n${link}\n\nThis link expires in 15 minutes. If you did not request this, you can ignore this email.`,
  });
}

async function sendAccountSetupEmail(to, firstName, token) {
  const link = frontendUrl(`/reset-password#token=${encodeURIComponent(token)}`);
  await sendMail({
    to,
    subject: 'Set up your Hanson HR account',
    text: `Hello ${firstName},\n\nAn account has been created for you on Hanson HR. Choose your password using this link:\n${link}\n\nThis link expires in 7 days. If you were not expecting this account, you can ignore this email.`,
  });
}

async function sendEmailChangeNotice(to, firstName) {
  await sendMail({
    to,
    subject: 'Your HR account email was changed',
    text: `Hello ${firstName},\n\nThe sign-in email on your Hanson HR account was changed. If you did not make this change, contact your administrator immediately.`,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendAccountSetupEmail, sendEmailChangeNotice };
