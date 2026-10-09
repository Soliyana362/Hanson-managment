const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { parseId } = require('../security');

const router = express.Router();

const uploadRoot = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : process.env.VERCEL
    ? path.join(os.tmpdir(), 'glorious-hr-uploads')
    : path.join(__dirname, '..', '..', 'uploads');
const documentsDir = path.join(uploadRoot, 'documents');
fs.mkdirSync(documentsDir, { recursive: true });

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return new Date().toLocaleDateString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString();
}

function fileSafe(value) {
  return String(value || 'employee')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .toLowerCase() || 'employee';
}

async function getUser(id) {
  const result = await pool.query(
    `SELECT id, first_name, last_name, email, role, position
     FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}

async function saveDocument({ userId, originalName, html }) {
  const storedName = `${Date.now()}-${crypto.randomUUID()}.html`;
  const filePath = path.join(documentsDir, storedName);
  fs.writeFileSync(filePath, html, 'utf8');
  const stats = fs.statSync(filePath);

  const result = await pool.query(
    `INSERT INTO documents (user_id, category, original_name, stored_name, mime_type, size_bytes)
     VALUES ($1, 'document', $2, $3, 'text/html', $4)
     RETURNING id, category, original_name, mime_type, size_bytes, created_at`,
    [userId, originalName, storedName, stats.size]
  );
  return result.rows[0];
}

async function notifyEmployee({ userId, type, title, message }) {
  await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, link)
     VALUES ($1, $2, $3, $4, '/my-status')`,
    [userId, type, title, message]
  );
}

function documentShell({ title, body, tone = 'certificate' }) {
  const accent = tone === 'warning' ? '#B71C1C' : '#2E7D32';
  const pale = tone === 'warning' ? '#FFF3F3' : '#F4FBF4';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 40px; font-family: Georgia, "Times New Roman", serif; color: #1f2a1f; background: #f7f7f3; }
    .page { max-width: 820px; margin: 0 auto; background: white; border: 10px solid ${accent}; padding: 56px; box-shadow: 0 10px 30px rgba(0,0,0,.12); }
    .brand { text-align: center; text-transform: uppercase; letter-spacing: 4px; color: ${accent}; font: 700 14px Arial, sans-serif; }
    h1 { text-align: center; color: ${accent}; font-size: 38px; margin: 24px 0 12px; }
    .date { text-align: right; font: 14px Arial, sans-serif; color: #526252; margin-bottom: 32px; }
    .content { font-size: 18px; line-height: 1.75; }
    .highlight { background: ${pale}; border-left: 5px solid ${accent}; padding: 18px 22px; margin: 26px 0; }
    .signature { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 56px; font: 15px Arial, sans-serif; }
    .line { border-top: 1px solid #637063; padding-top: 10px; }
    @media print { body { background: white; padding: 0; } .page { box-shadow: none; min-height: 900px; } }
  </style>
</head>
<body>
  <main class="page">
    <div class="brand">Hanson HR Management</div>
    ${body}
  </main>
</body>
</html>`;
}

function certificateHtml({ employee, issuer, achievement, details, issuedDate }) {
  const employeeName = `${employee.first_name} ${employee.last_name}`;
  const issuerName = `${issuer.first_name} ${issuer.last_name}`;
  return documentShell({
    title: 'Acknowledgment Certificate',
    body: `
      <h1>Acknowledgment Certificate</h1>
      <div class="date">Issued on ${formatDate(issuedDate)}</div>
      <section class="content">
        <p>This certificate is proudly presented to <strong>${escapeHtml(employeeName)}</strong>${employee.position ? `, ${escapeHtml(employee.position)}` : ''}.</p>
        <div class="highlight">
          <strong>Achievement:</strong><br>
          ${escapeHtml(achievement)}
        </div>
        ${details ? `<p>${escapeHtml(details).replace(/\n/g, '<br>')}</p>` : ''}
        <p>We acknowledge this contribution with appreciation and encourage continued excellence.</p>
      </section>
      <section class="signature">
        <div class="line">${escapeHtml(issuerName)}<br>${escapeHtml(issuer.role?.toUpperCase() || 'Issuer')}</div>
        <div class="line">Employee Signature<br>${escapeHtml(employeeName)}</div>
      </section>
    `,
  });
}

function warningHtml({ employee, issuer, subject, incidentDate, details, requiredAction }) {
  const employeeName = `${employee.first_name} ${employee.last_name}`;
  const issuerName = `${issuer.first_name} ${issuer.last_name}`;
  return documentShell({
    title: 'Employee Warning Letter',
    tone: 'warning',
    body: `
      <h1>Warning Letter</h1>
      <div class="date">Issued on ${new Date().toLocaleDateString()}</div>
      <section class="content">
        <p>To: <strong>${escapeHtml(employeeName)}</strong>${employee.position ? `, ${escapeHtml(employee.position)}` : ''}</p>
        <div class="highlight">
          <strong>Subject:</strong> ${escapeHtml(subject)}<br>
          <strong>Incident Date:</strong> ${formatDate(incidentDate)}
        </div>
        <p>${escapeHtml(details).replace(/\n/g, '<br>')}</p>
        ${requiredAction ? `<p><strong>Required corrective action:</strong><br>${escapeHtml(requiredAction).replace(/\n/g, '<br>')}</p>` : ''}
        <p>This letter is issued as a formal warning and will remain part of the employee record.</p>
      </section>
      <section class="signature">
        <div class="line">${escapeHtml(issuerName)}<br>HR</div>
        <div class="line">Employee Signature<br>${escapeHtml(employeeName)}</div>
      </section>
    `,
  });
}

router.post('/:userId/certificate', authenticate, authorize('hr', 'admin', 'coo'), async (req, res) => {
  try {
    const userId = parseId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'Employee id is invalid' });
    const achievement = String(req.body?.achievement || '').trim();
    const details = String(req.body?.details || '').trim();
    if (!achievement) return res.status(400).json({ error: 'Achievement is required' });
    if (achievement.length > 500) return res.status(400).json({ error: 'Achievement must be 500 characters or fewer' });
    if (details.length > 5000) return res.status(400).json({ error: 'Details must be 5000 characters or fewer' });

    const employee = await getUser(userId);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const issuer = await getUser(req.user.id);
    const html = certificateHtml({
      employee,
      issuer,
      achievement,
      details,
      issuedDate: req.body.issued_date,
    });
    const employeeSlug = fileSafe(`${employee.first_name}-${employee.last_name}`);
    const doc = await saveDocument({
      userId,
      originalName: `acknowledgment-certificate-${employeeSlug}.html`,
      html,
    });

    await notifyEmployee({
      userId,
      type: 'certificate',
      title: 'Acknowledgment Certificate',
      message: `${issuer.first_name} ${issuer.last_name} issued you an acknowledgment certificate for: ${achievement}.`,
    });

    res.status(201).json(doc);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to issue certificate' });
  }
});

router.post('/:userId/warning', authenticate, authorize('hr', 'admin'), async (req, res) => {
  try {
    const userId = parseId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'Employee id is invalid' });
    const subject = String(req.body?.subject || '').trim();
    const details = String(req.body?.details || '').trim();
    const requiredAction = String(req.body?.required_action || '').trim();
    if (!subject || !details) {
      return res.status(400).json({ error: 'Subject and details are required' });
    }
    if (subject.length > 200) return res.status(400).json({ error: 'Subject must be 200 characters or fewer' });
    if (details.length > 5000) return res.status(400).json({ error: 'Details must be 5000 characters or fewer' });
    if (requiredAction.length > 2000) return res.status(400).json({ error: 'Required action must be 2000 characters or fewer' });

    const employee = await getUser(userId);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const issuer = await getUser(req.user.id);
    issuer.role = 'HR';
    const html = warningHtml({
      employee,
      issuer,
      subject,
      incidentDate: req.body.incident_date,
      details,
      requiredAction,
    });
    const employeeSlug = fileSafe(`${employee.first_name}-${employee.last_name}`);
    const doc = await saveDocument({
      userId,
      originalName: `warning-letter-${employeeSlug}.html`,
      html,
    });

    await notifyEmployee({
      userId,
      type: 'warning',
      title: 'Warning Letter',
      message: `HR issued you a warning letter: ${subject}.`,
    });

    res.status(201).json(doc);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to issue warning letter' });
  }
});

module.exports = router;
