const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const uploadRoot = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : process.env.VERCEL
    ? path.join(os.tmpdir(), 'glorious-hr-uploads')
    : path.join(__dirname, '..', '..', 'uploads');
const photosDir = path.join(uploadRoot, 'photos');
const documentsDir = path.join(uploadRoot, 'documents');
const leaveDocumentsDir = path.join(uploadRoot, 'leave-documents');
fs.mkdirSync(photosDir, { recursive: true });
fs.mkdirSync(documentsDir, { recursive: true });
fs.mkdirSync(leaveDocumentsDir, { recursive: true });

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
// Proof for a leave request (medical certificate, death certificate, marriage
// certificate) is a scan, a photo or an office document.
const LEAVE_DOCUMENT_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
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

function leaveDocumentFilter(req, file, cb) {
  if (LEAVE_DOCUMENT_TYPES.has(file.mimetype)) return cb(null, true);
  cb(new Error('Only images, PDF, and Word documents are allowed'));
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
// Leave proof is buffered so the file is only written to disk after the
// request itself has been validated.
const uploadLeaveDocument = multer({
  storage: multer.memoryStorage(),
  fileFilter: leaveDocumentFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
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

function resolveStoredPath(directory, storedName) {
  const resolvedDirectory = path.resolve(directory);
  const resolvedPath = path.resolve(directory, String(storedName || ''));
  if (!resolvedPath.startsWith(`${resolvedDirectory}${path.sep}`)) return null;
  return resolvedPath;
}

function removeFile(filePath) {
  if (!filePath) return;
  fs.rm(filePath, { force: true }, () => {});
}

function writeBuffer(directory, buffer, extension) {
  const storedName = `${Date.now()}-${crypto.randomUUID()}${extension || ''}`;
  const filePath = path.join(directory, storedName);
  fs.writeFileSync(filePath, buffer);
  return { storedName, filePath };
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

function hasSignatureBuffer(buffer, mimeType) {
  if (!buffer || !buffer.length) return false;
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (mimeType === 'application/pdf') return buffer.subarray(0, 4).toString() === '%PDF';
  if (mimeType === 'application/zip' || mimeType.includes('openxmlformats')) return buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
  if (mimeType === 'application/msword' || mimeType === 'application/vnd.ms-excel' || mimeType === 'application/vnd.ms-powerpoint') {
    return buffer.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]));
  }
  if (mimeType === 'text/plain' || mimeType === 'text/csv') return isTextual(buffer);
  return false;
}

function hasSignature(filePath, mimeType) {
  if (mimeType === 'text/plain' || mimeType === 'text/csv') {
    return isTextual(readHead(filePath, 65536));
  }
  return hasSignatureBuffer(readHead(filePath, 12), mimeType);
}

module.exports = {
  uploadRoot,
  photosDir,
  documentsDir,
  leaveDocumentsDir,
  IMAGE_TYPES,
  DOCUMENT_TYPES,
  LEAVE_DOCUMENT_TYPES,
  safeOriginalName,
  extensionFor,
  imageFilter,
  documentFilter,
  leaveDocumentFilter,
  makeStorage,
  uploadPhoto,
  uploadDocument,
  uploadLeaveDocument,
  uploadSingle,
  resolveStoredPath,
  removeFile,
  writeBuffer,
  hasSignature,
  hasSignatureBuffer,
};
