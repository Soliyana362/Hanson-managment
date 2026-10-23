const express = require('express');
const fs = require('fs');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { canAccessEmployee, parseId } = require('../security');
const {
  IMAGE_TYPES,
  photosDir,
  documentsDir,
  safeOriginalName,
  uploadPhoto,
  uploadDocument,
  uploadSingle,
  resolveStoredPath,
  removeFile,
  hasSignature,
} = require('../fileStore');

const router = express.Router();

const DB_DRIVER = String(process.env.DB_DRIVER || 'sqlite').toLowerCase();
const IS_POSTGRES = ['postgres', 'postgresql', 'pg'].includes(DB_DRIVER);
const IS_MSSQL = DB_DRIVER === 'mssql';

// The documents table gained a `data` column so profile photos can live in the
// database instead of the host's ephemeral disk. Checking on first use keeps
// uploads working even when the schema migration has not run yet.
let documentDataColumnReady = null;
function ensureDocumentDataColumn() {
  if (!documentDataColumnReady) {
    documentDataColumnReady = (async () => {
      try {
        let exists = false;
        if (IS_POSTGRES) {
          const found = await pool.query(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'data'"
          );
          exists = found.rows.length > 0;
        } else if (IS_MSSQL) {
          const found = await pool.query(
            "SELECT 1 AS present FROM sys.columns WHERE object_id = OBJECT_ID('documents') AND name = 'data'"
          );
          exists = found.rows.length > 0;
        } else {
          const found = await pool.query("PRAGMA table_info('documents')");
          exists = found.rows.some((row) => row.name === 'data');
        }
        if (!exists) {
          const type = IS_MSSQL ? 'VARBINARY(MAX)' : IS_POSTGRES ? 'BYTEA' : 'BLOB';
          await pool.query(`ALTER TABLE documents ADD COLUMN data ${type}`);
          console.log('documents.data column added automatically');
        }
      } catch (err) {
        documentDataColumnReady = null;
        console.error('documents schema check failed:', err && err.message ? err.message : err);
      }
    })();
  }
  return documentDataColumnReady;
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
  return resolveStoredPath(directory, storedName);
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
    await ensureDocumentDataColumn();
    const userId = targetId(req);
    if (!userId || !canEdit(req.user, userId)) {
      removeFile(req.file.path);
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (!hasSignature(req.file.path, req.file.mimetype)) {
      removeFile(req.file.path);
      return res.status(400).json({ error: 'File content does not match its type' });
    }
    // Keep the bytes in the database so the photo survives restarts and
    // redeploys, then drop the temporary file.
    const bytes = fs.readFileSync(req.file.path);
    const old = await pool.query("SELECT id, stored_name, category FROM documents WHERE user_id = $1 AND category = 'profile_photo'", [userId]);
    const result = await pool.query(
      `INSERT INTO documents (user_id, category, original_name, stored_name, mime_type, size_bytes, data)
       VALUES ($1, 'profile_photo', $2, $3, $4, $5, $6)
       RETURNING id, category, original_name, mime_type, size_bytes, created_at`,
      [userId, safeOriginalName(req.file.originalname), req.file.filename, req.file.mimetype, req.file.size, bytes]
    );
    removeFile(req.file.path);
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
    const isPhoto = doc.category === 'profile_photo' && IMAGE_TYPES.has(doc.mime_type);
    const filename = safeOriginalName(doc.original_name);
    const contentType = doc.mime_type === 'text/html' ? 'application/octet-stream' : doc.mime_type;
    const headers = {
      'Content-Type': contentType,
      'Content-Disposition': `${isPhoto ? 'inline' : 'attachment'}; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'private, no-store',
    };
    const stored = Buffer.isBuffer(doc.data) ? doc.data : null;
    if (stored && stored.length) {
      res.set(headers);
      return res.end(stored);
    }
    const filePath = storedPath(doc.category, doc.stored_name);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on storage' });
    res.sendFile(filePath, { dotfiles: 'deny', headers });
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
