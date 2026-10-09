const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { canAccessEmployee, parseId } = require('../security');

const router = express.Router();
const uploadRoot = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : process.env.VERCEL
    ? path.join(os.tmpdir(), 'glorious-hr-uploads')
    : path.join(__dirname, '..', '..', 'uploads');
const photosDir = path.join(uploadRoot, 'photos');
const documentsDir = path.join(uploadRoot, 'documents');
fs.mkdirSync(photosDir, { recursive: true });
fs.mkdirSync(documentsDir, { recursive: true });

const IMAGE_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const DOCUMENT_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.ms-powerpoint', '.ppt'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  ['application/zip', '.zip'],
]);

function safeOriginalName(value) {
  const base = path.basename(String(value || 'file')).replace(/[\u0000-\u001f\u007f]/g, '');
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 180);
  return safe || 'file';
}

function extensionFor(type, allowed) {
  return allowed.get(type) || '';
}

function imageFilter(req, file, cb) {
  if (IMAGE_TYPES.has(file.mimetype)) return cb(null, true);
  cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
}

function documentFilter(req, file, cb) {
  if (DOCUMENT_TYPES.has(file.mimetype)) return cb(null, true);
  cb(new Error('Unsupported document type'));
}

function makeStorage(dir, allowedTypes) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const extension = extensionFor(file.mimetype, allowedTypes);
      cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
    },
  });
}

const uploadPhoto = multer({
  storage: makeStorage(photosDir, IMAGE_TYPES),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
const uploadDocument = multer({
  storage: makeStorage(documentsDir, DOCUMENT_TYPES),
  fileFilter: documentFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

function uploadSingle(uploader, field) {
  return (req, res, next) => {
    uploader.single(field)(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Uploaded file is too large' });
      return res.status(400).json({ error: err.message || 'Invalid file upload' });
    });
  };
}

function targetId(req) {
  const raw = req.body?.userId ?? req.query?.userId;
  if (raw === undefined || raw === null || raw === '') return req.user.id;
  return parseId(raw);
}

function canEdit(user, targetUserId) {
  return ['hr', 'admin'].includes(user.role) || Number(user.id) === Number(targetUserId);
}

// Self-service deletion is limited to a user's own profile photo; official
// documents and HR letters belong to the employee record and must only be
// removed by HR/admin so warning letters and certificates cannot be deleted
// to tamper with the record.
function canDeleteFile(user, doc) {
  if (['hr', 'admin'].includes(user.role)) return true;
  return Number(user.id) === Number(doc.user_id) && doc.category === 'profile_photo';
}

function storedPath(category, storedName) {
  const directory = category === 'profile_photo' ? photosDir : documentsDir;
  const resolvedDirectory = path.resolve(directory);
  const resolvedPath = path.resolve(directory, String(storedName || ''));
  if (!resolvedPath.startsWith(`${resolvedDirectory}${path.sep}`)) return null;
  return resolvedPath;
}

function removeFile(filePath) {
  if (!filePath) return;
  fs.rm(filePath, { force: true }, () => {});
}

function readHead(filePath, maxBytes) {
  const size = Math.min(maxBytes, fs.statSync(filePath).size);
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(size);
  try {
    fs.readSync(fd, buffer, 0, size, 0);
  } finally {
    fs.closeSync(fd);
  }
  return buffer;
}

function isTextual(buffer) {
  if (!buffer || !buffer.length) return true;
  let printable = 0;
  for (const byte of buffer) {
    if (byte === 0) return false;
    if (byte >= 32 && byte <= 126) printable += 1;
    else if (byte >= 128) printable += 1;
  }
  return printable / buffer.length >= 0.9;
}

function hasSignature(filePath, mimeType) {
  const buffer = readHead(filePath, 12);
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (mimeType === 'application/pdf') return buffer.subarray(0, 4).toString() === '%PDF';
  if (mimeType === 'application/zip' || mimeType.includes('openxmlformats')) return buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
  if (mimeType === 'application/msword' || mimeType === 'application/vnd.ms-excel' || mimeType === 'application/vnd.ms-powerpoint') {
    return buffer.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]));
  }
  if (mimeType === 'text/plain' || mimeType === 'text/csv') {
    return isTextual(readHead(filePath, 65536));
  }
  return false;
}

async function ensureTarget(userId) {
  const result = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
  return Boolean(result.rows[0]);
}

async function removeDocumentFile(doc) {
  removeFile(storedPath(doc.category, doc.stored_name));
}

router.get('/', authenticate, async (req, res) => {
  try {
    const userId = targetId(req);
    if (!userId) return res.status(400).json({ error: 'userId is invalid' });
    if (!(await canAccessEmployee(req.user, userId))) return res.status(403).json({ error: 'Insufficient permissions' });
    const result = await pool.query(
      'SELECT id, category, original_name, mime_type, size_bytes, created_at FROM documents WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

router.post('/photo', authenticate, uploadSingle(uploadPhoto, 'photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
    const userId = targetId(req);
    if (!userId || !canEdit(req.user, userId)) {
      removeFile(req.file.path);
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (!hasSignature(req.file.path, req.file.mimetype)) {
      removeFile(req.file.path);
      return res.status(400).json({ error: 'File content does not match its type' });
    }
    const old = await pool.query("SELECT id, stored_name, category FROM documents WHERE user_id = $1 AND category = 'profile_photo'", [userId]);
    const result = await pool.query(
      `INSERT INTO documents (user_id, category, original_name, stored_name, mime_type, size_bytes)
       VALUES ($1, 'profile_photo', $2, $3, $4, $5)
       RETURNING id, category, original_name, mime_type, size_bytes, created_at`,
      [userId, safeOriginalName(req.file.originalname), req.file.filename, req.file.mimetype, req.file.size]
    );
    for (const doc of old.rows) {
      await pool.query('DELETE FROM documents WHERE id = $1', [doc.id]);
      await removeDocumentFile(doc);
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (req.file) removeFile(req.file.path);
    console.error(err.message);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

router.post('/document', authenticate, uploadSingle(uploadDocument, 'document'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No document uploaded' });
    if (!['hr', 'admin'].includes(req.user.role)) {
      removeFile(req.file.path);
      return res.status(403).json({ error: 'Only HR can upload documents' });
    }
    const userId = targetId(req);
    if (!userId || !(await ensureTarget(userId))) {
      removeFile(req.file.path);
      return res.status(400).json({ error: 'Employee not found' });
    }
    if (!hasSignature(req.file.path, req.file.mimetype)) {
      removeFile(req.file.path);
      return res.status(400).json({ error: 'File content does not match its type' });
    }
    const result = await pool.query(
      `INSERT INTO documents (user_id, category, original_name, stored_name, mime_type, size_bytes)
       VALUES ($1, 'document', $2, $3, $4, $5)
       RETURNING id, category, original_name, mime_type, size_bytes, created_at`,
      [userId, safeOriginalName(req.file.originalname), req.file.filename, req.file.mimetype, req.file.size]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (req.file) removeFile(req.file.path);
    if (/match its type|document type|too large/i.test(err.message)) return res.status(400).json({ error: err.message });
    console.error(err.message);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

router.get('/file/:id', authenticate, async (req, res) => {
  try {
    const docId = parseId(req.params.id);
    if (!docId) return res.status(400).json({ error: 'File id is invalid' });
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [docId]);
    const doc = result.rows[0];
    if (!doc) return res.status(404).json({ error: 'File not found' });
    if (!(await canAccessEmployee(req.user, doc.user_id))) return res.status(403).json({ error: 'Insufficient permissions' });
    const filePath = storedPath(doc.category, doc.stored_name);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on storage' });
    const isPhoto = doc.category === 'profile_photo' && IMAGE_TYPES.has(doc.mime_type);
    const filename = safeOriginalName(doc.original_name);
    const contentType = doc.mime_type === 'text/html' ? 'application/octet-stream' : doc.mime_type;
    res.sendFile(filePath, {
      dotfiles: 'deny',
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `${isPhoto ? 'inline' : 'attachment'}; filename="${filename}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to load file' });
  }
});

router.get('/letter/:id', authenticate, async (req, res) => {
  try {
    const docId = parseId(req.params.id);
    if (!docId) return res.status(400).json({ error: 'File id is invalid' });
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [docId]);
    const doc = result.rows[0];
    if (!doc) return res.status(404).json({ error: 'File not found' });
    // DOCUMENT_TYPES has no HTML entry, so a text/html document can only be a
    // letter our own letters.js wrote. Anything else must not be rendered.
    if (doc.mime_type !== 'text/html') return res.status(415).json({ error: 'Not a viewable letter' });
    if (!(await canAccessEmployee(req.user, doc.user_id))) return res.status(403).json({ error: 'Insufficient permissions' });
    const filePath = storedPath(doc.category, doc.stored_name);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on storage' });
    res.sendFile(filePath, {
      dotfiles: 'deny',
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        // sandbox = no scripts, unique origin; the letter only needs inline CSS.
        'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to load letter' });
  }
});

router.put('/document/:id', authenticate, uploadSingle(uploadDocument, 'document'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No document uploaded' });
    if (!['hr', 'admin'].includes(req.user.role)) {
      removeFile(req.file.path);
      return res.status(403).json({ error: 'Only HR can edit documents' });
    }
    const docId = parseId(req.params.id);
    const find = await pool.query("SELECT * FROM documents WHERE id = $1 AND category = 'document'", [docId]);
    const doc = find.rows[0];
    if (!doc) {
      removeFile(req.file.path);
      return res.status(404).json({ error: 'Document not found' });
    }
    if (!hasSignature(req.file.path, req.file.mimetype)) {
      removeFile(req.file.path);
      return res.status(400).json({ error: 'File content does not match its type' });
    }
    const result = await pool.query(
      `UPDATE documents
       SET original_name = $1, stored_name = $2, mime_type = $3, size_bytes = $4, created_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING id, category, original_name, mime_type, size_bytes, created_at`,
      [safeOriginalName(req.file.originalname), req.file.filename, req.file.mimetype, req.file.size, docId]
    );
    removeFile(storedPath(doc.category, doc.stored_name));
    res.json(result.rows[0]);
  } catch (err) {
    if (req.file) removeFile(req.file.path);
    console.error(err.message);
    res.status(500).json({ error: 'Failed to edit document' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const docId = parseId(req.params.id);
    if (!docId) return res.status(400).json({ error: 'File id is invalid' });
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [docId]);
    const doc = result.rows[0];
    if (!doc) return res.status(404).json({ error: 'File not found' });
    if (!canDeleteFile(req.user, doc)) return res.status(403).json({ error: 'Insufficient permissions' });
    await pool.query('DELETE FROM documents WHERE id = $1', [docId]);
    await removeDocumentFile(doc);
    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

module.exports = router;
