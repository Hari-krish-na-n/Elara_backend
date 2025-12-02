// server.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const multer = require('multer');
const mm = require('music-metadata');
const mime = require('mime-types');
const crypto = require('crypto');
let connect;
try {
  ({ connect } = require('./db'));
} catch (e) {
  console.warn('better-sqlite3 not available, using JSON store fallback. Details:', e.message);
}

const app = express();

// =====================
// Config
// =====================
const PORT = process.env.PORT || 3000;
const FRONTEND_URLS = [
  'http://localhost:5173/library', // deployed frontend
  'http://localhost:5173',             // local development
];

const DB_PATH = path.join(__dirname, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
let DB = null;
if (connect) {
  try {
    DB = connect();
  } catch (e) {
    console.error('Database initialization failed, falling back to JSON store:', e);
    DB = null;
  }
}

// =====================
// Middleware
// =====================
app.use(cors({
  origin: FRONTEND_URLS,
  credentials: true
}));

app.use(express.json());
app.use(compression());

// Ensure uploads folder exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Serve uploaded images with aggressive caching
app.use('/uploads', express.static(UPLOADS_DIR, {
  maxAge: '365d',
  etag: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

// =====================
// Simple JSON file DB
// =====================
function readDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { plays: {} };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// =====================
// Health Check
// =====================
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// =====================
// Helpers: concurrency limiter, cover hashing, file scan
// =====================
function pLimit(concurrency = 3) {
  let active = 0;
  const queue = [];
  const next = () => {
    active--;
    if (queue.length) queue.shift()();
  };
  return (fn) => new Promise((resolve, reject) => {
    const run = () => {
      active++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(next);
    };
    if (active < concurrency) run(); else queue.push(run);
  });
}

function hashBuffer(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function ensureCover(pic, db) {
  if (!pic || !pic.data) return null;
  const hash = hashBuffer(pic.data);
  const ext = mime.extension(pic.format || 'image/jpeg') || 'jpg';
  const fileName = `cover-${hash}.${ext}`;
  const outPath = path.join(UPLOADS_DIR, fileName);
  if (!fs.existsSync(outPath)) {
    fs.writeFileSync(outPath, pic.data);
  }
  return `/uploads/${fileName}`;
}

async function scanSinglePath(p, db) {
  try {
    const stat = fs.statSync(p);
    db.metadata = db.metadata || {};
    const cached = db.metadata[p];
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return { path: p, ...cached.meta };
    }
    const meta = await mm.parseFile(p);
    const common = meta.common || {};
    const format = meta.format || {};
    const coverUrl = ensureCover((common.picture && common.picture[0]) || null, db);
    const metaLite = {
      title: common.title || path.parse(p).name,
      artist: common.artist || 'Unknown',
      album: common.album || 'Unknown',
      duration: typeof format.duration === 'number' ? format.duration : null,
      coverUrl
    };
    db.metadata[p] = { mtimeMs: stat.mtimeMs, size: stat.size, meta: metaLite };
    return { path: p, ...metaLite };
  } catch (e) {
    return { path: p, error: 'unreadable' };
  }
}

function walkDir(dir, files = []) {
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of ents) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkDir(full, files);
    else files.push(full);
  }
  return files;
}

// =====================
// Metadata API (single-file parse; prefer pre-scan for performance)
// =====================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 } // 200 MB
});

// In-memory metadata cache by SHA1 of file bytes
const META_CACHE = new Map(); // key: sha1(buffer), value: { data, ts }
const META_TTL_MS = 1000 * 60 * 60 * 24; // 24h
function sha1(buf){ return crypto.createHash('sha1').update(buf).digest('hex'); }

app.post('/api/metadata', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const { buffer, mimetype, size, originalname } = req.file;
    const key = sha1(buffer);
    const now = Date.now();
    const cached = META_CACHE.get(key);
    if (cached && (now - cached.ts) < META_TTL_MS) {
      return res.json({ sourceName: originalname, ...cached.data });
    }
    const meta = await mm.parseBuffer(buffer, { mimeType: mimetype, size });
    const common = meta.common || {};
    const format = meta.format || {};

    // Handle cover image (deduplicated by hash)
    const pic = (common.picture && common.picture[0]) || null;
    const coverUrl = ensureCover(pic, null);

    const data = {
      title: common.title || path.parse(originalname).name,
      artist: common.artist || 'Unknown',
      album: common.album || 'Unknown',
      duration: typeof format.duration === 'number' ? format.duration : null,
      coverUrl
    };
    META_CACHE.set(key, { data, ts: now });
    res.json({ sourceName: originalname, ...data });
  } catch (e) {
    console.error('metadata error', e);
    res.status(500).json({ error: 'metadata_parse_failed' });
  }
});

// =====================
// Path-based scan with caching (desktop/local backend)
// =====================
app.post('/api/scan-paths', async (req, res) => {
  try {
    const { paths } = req.body || {};
    if (!Array.isArray(paths) || paths.length === 0) return res.status(400).json({ error: 'paths[] required' });

    const db = readDb();
    db.metadata = db.metadata || {};
    const results = [];

    const limit = pLimit(3);
    const tasks = paths.map(p => limit(() => scanSinglePath(p, db)));
    const out = await Promise.all(tasks);
    out.forEach(item => results.push(item));
    writeDb(db);
    res.json({ items: results });
  } catch (e) {
    console.error('scan-paths error', e);
    res.status(500).json({ error: 'scan_failed' });
  }
});

// =====================
// Scan a directory recursively (desktop/local backend)
// =====================
app.post('/api/scan-dir', async (req, res) => {
  try {
    const { dir } = req.body || {};
    if (!dir) return res.status(400).json({ error: 'dir required' });
    const all = walkDir(dir).filter(f => /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(f));
    const db = readDb();
    const limit = pLimit(3);
    const results = await Promise.all(all.map(p => limit(() => scanSinglePath(p, db))));
    writeDb(db);
    res.json({ items: results });
  } catch (e) {
    console.error('scan-dir error', e);
    res.status(500).json({ error: 'scan_dir_failed' });
  }
});

// =====================
// Tracks cache + list/search
// =====================
app.get('/api/tracks', (req, res) => {
  const { q } = req.query;
  const db = readDb();
  const meta = db.metadata || {};
  let items = Object.keys(meta).map(p => ({ path: p, ...meta[p].meta }));
  if (q && String(q).trim()) {
    const s = String(q).toLowerCase();
    items = items.filter(t => (
      (t.title||'').toLowerCase().includes(s) ||
      (t.artist||'').toLowerCase().includes(s) ||
      (t.album||'').toLowerCase().includes(s)
    ));
  }
  res.json({ items });
});

// =====================
// Mount new routers (tracks, playlists, likes, plays, streaming)
// =====================
if (DB) {
  let tracksRouter, streamRouter;
  try {
    tracksRouter = require('./routes/tracks')({ db: DB, uploadsDir: UPLOADS_DIR });
    streamRouter = require('./routes/stream')({ db: DB });
  } catch (e) {
    console.error('Router initialization failed with DB:', e);
    process.exit(1);
  }
  app.use('/api', tracksRouter);
  app.use('/api', streamRouter);
} else {
  console.warn('Mounting JSON-backed API routes. Some features may be less efficient.');
  const jsonApi = require('./routes/json-api')({ dbPath: DB_PATH, uploadsDir: UPLOADS_DIR });
  app.use('/api', jsonApi);
}

app.get('/', (req, res) => {
  res.send('Backend running ✅');
});

// Global error handler (logs errors before exit)
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

// =====================
// Start Server
// =====================
try {
  app.listen(PORT, () => {
    console.log(`✅ Backend running on http://localhost:${PORT}`);
    console.log(`🌐 CORS allowed from: ${FRONTEND_URLS.join(', ')}`);
  });
} catch (e) {
  console.error('Server failed to start:', e);
  process.exit(1);
}
