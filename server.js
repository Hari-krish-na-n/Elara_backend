// server.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const app = express();
const multer = require('multer');
const mm = require('music-metadata');
const mime = require('mime-types');

// Config
const PORT = process.env.PORT || 3000;
const VITE_DEV = process.env.VITE_DEV_ORIGIN || 'https://elara-backend-up86.onrender.com';
const DB_PATH = path.join(__dirname, 'db.json');

// Middleware
app.use(cors({ origin: [VITE_DEV, /http:\/\/localhost:\d+/], credentials: false }));
app.use(express.json());
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// Simple JSON file DB
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

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// Metadata API
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
app.post('/api/metadata', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const { buffer, mimetype, size, originalname } = req.file;
const meta = await mm.parseBuffer(buffer, { mimeType: mimetype, size });
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

// Plays API // good
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
  if (typeof count !== 'number' || count < 0) return res.status(400).json({ error: 'count must be >= 0' });
  const db = readDb();
  db.plays = db.plays || {};
  db.plays[id] = count;
  writeDb(db);
  res.json({ id, count });
});

// Start
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`CORS allowed from ${VITE_DEV}`);
});

