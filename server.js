// server.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mm = require('music-metadata');
const mime = require('mime-types');

const app = express();

// =====================
// Config
// =====================
const PORT = process.env.PORT || 3000;
const FRONTEND_URLS = [
  'https://elara-frontend.vercel.app', // deployed frontend
  'http://localhost:5173',             // local development
];

const DB_PATH = path.join(__dirname, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// =====================
// Middleware
// =====================
app.use(cors({
  origin: FRONTEND_URLS,
  credentials: true
}));

app.use(express.json());

// Ensure uploads folder exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Serve uploaded images
app.use('/uploads', express.static(UPLOADS_DIR));

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
// Metadata API
// =====================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 } // 200 MB
});

app.post('/api/metadata', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const { buffer, mimetype, size, originalname } = req.file;
    const meta = await mm.parseBuffer(buffer, { mimeType: mimetype, size });
    const common = meta.common || {};
    const format = meta.format || {};

    // Handle cover image
    let coverUrl = null;
    const pic = (common.picture && common.picture[0]) || null;

    if (pic && pic.data) {
      const ext = mime.extension(pic.format || 'image/jpeg') || 'jpg';
      const fileName = `cover-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const outPath = path.join(UPLOADS_DIR, fileName);
      fs.writeFileSync(outPath, pic.data);
      coverUrl = `/uploads/${fileName}`;
    }

    res.json({
      sourceName: originalname,
      title: common.title || path.parse(originalname).name,
      artist: common.artist || 'Unknown',
      album: common.album || 'Unknown',
      duration: typeof format.duration === 'number' ? format.duration : null,
      coverUrl
    });
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

    for (const p of paths) {
      try {
        const stat = fs.statSync(p);
        const cached = db.metadata[p];
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          results.push({ path: p, ...cached.meta });
          continue;
        }
        const meta = await mm.parseFile(p);
        const common = meta.common || {};
        const format = meta.format || {};
        let coverUrl = null;
        const pic = (common.picture && common.picture[0]) || null;
        if (pic && pic.data) {
          const ext = mime.extension(pic.format || 'image/jpeg') || 'jpg';
          const fileName = `cover-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const outPath = path.join(UPLOADS_DIR, fileName);
          fs.writeFileSync(outPath, pic.data);
          coverUrl = `/uploads/${fileName}`;
        }
        const metaLite = {
          title: common.title || path.parse(p).name,
          artist: common.artist || 'Unknown',
          album: common.album || 'Unknown',
          duration: typeof format.duration === 'number' ? format.duration : null,
          coverUrl
        };
        db.metadata[p] = { mtimeMs: stat.mtimeMs, size: stat.size, meta: metaLite };
        results.push({ path: p, ...metaLite });
      } catch (err) {
        results.push({ path: p, error: 'unreadable' });
      }
    }
    writeDb(db);
    res.json({ items: results });
  } catch (e) {
    console.error('scan-paths error', e);
    res.status(500).json({ error: 'scan_failed' });
  }
});

// =====================
// Plays API
// =====================
app.get('/api/plays', (_req, res) => {
  const db = readDb();
  res.json(db.plays || {});
});

app.post('/api/plays/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.plays = db.plays || {};
  db.plays[id] = (db.plays[id] || 0) + 1;
  writeDb(db);
  res.json({ id, count: db.plays[id] });
});

app.put('/api/plays/:id', (req, res) => {
  const { id } = req.params;
  const { count } = req.body || {};
  if (typeof count !== 'number' || count < 0) {
    return res.status(400).json({ error: 'count must be >= 0' });
  }
  const db = readDb();
  db.plays = db.plays || {};
  db.plays[id] = count;
  writeDb(db);
  res.json({ id, count });
});

// =====================
// Start Server
// =====================
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  console.log(`🌐 CORS allowed from: ${FRONTEND_URLS.join(', ')}`);
});
