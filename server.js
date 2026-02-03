require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use('/web', express.static(__dirname));

// MongoDB Connection
console.log('🔌 Connecting to MongoDB...');
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/elaramusic')
  .then(() => {
    console.log('✅ MongoDB Connected Successfully!');
    console.log(`📊 Database: ${mongoose.connection.name}`);
  })
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
    console.log('\n💡 Make sure MongoDB is running or use MongoDB Atlas');
  });

// Enhanced Song Schema
const songSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  artist: {
    type: String,
    default: 'Unknown Artist',
    trim: true
  },
  album: {
    type: String,
    default: 'Unknown Album',
    trim: true
  },
  duration: {
    type: Number,
    default: 0
  },
  genre: String,
  year: Number,
  trackNumber: Number,
  filePath: String,
  fileName: String,
  fileSize: Number,
  mimeType: String,
  addedDate: {
    type: Date,
    default: Date.now
  },
  playCount: {
    type: Number,
    default: 0
  },
  lastPlayed: Date,
  isFavorite: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Playlist Schema
const playlistSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  songs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Song'
  }],
  createdDate: {
    type: Date,
    default: Date.now
  },
  coverImage: String,
  isPublic: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

const Song = mongoose.model('Song', songSchema);
const Playlist = mongoose.model('Playlist', playlistSchema);

// Create uploads directory
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed!'));
    }
  }
});

// ==================== ROUTES ====================

// Home route
app.get('/', (req, res) => {
  res.json({
    message: '🎵 Elara Music API',
    status: 'Running',
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    endpoints: {
      songs: {
        getAll: 'GET /api/songs',
        getOne: 'GET /api/songs/:id',
        create: 'POST /api/songs',
        update: 'PUT /api/songs/:id',
        delete: 'DELETE /api/songs/:id',
        upload: 'POST /api/songs/upload',
        search: 'GET /api/songs/search/:query'
      },
      playlists: {
        getAll: 'GET /api/playlists',
        getOne: 'GET /api/playlists/:id',
        create: 'POST /api/playlists',
        update: 'PUT /api/playlists/:id',
        delete: 'DELETE /api/playlists/:id',
        addSong: 'POST /api/playlists/:id/songs/:songId',
        removeSong: 'DELETE /api/playlists/:id/songs/:songId'
      },
      health: 'GET /api/health'
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime()
  });
});

// ==================== SONG ROUTES ====================

// Get all songs
app.get('/api/songs', async (req, res) => {
  try {
    const songs = await Song.find().sort({ addedDate: -1 });
    res.json({ success: true, count: songs.length, songs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single song
app.get('/api/songs/:id', async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    if (!song) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }
    res.json({ success: true, song });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create song (manual entry)
app.post('/api/songs', async (req, res) => {
  try {
    const song = new Song(req.body);
    await song.save();
    res.status(201).json({ success: true, song });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Upload songs (multiple files supported)
app.post('/api/songs/upload', upload.array('audio'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    const created = [];
    for (const file of req.files) {
      let metadata = { common: {}, format: {} };
      try {
        metadata = await mm.parseFile(file.path);
      } catch {}
      const songData = {
        title: metadata.common.title || path.parse(file.originalname).name,
        artist: metadata.common.artist || 'Unknown Artist',
        album: metadata.common.album || 'Unknown Album',
        duration: Math.floor(metadata.format.duration || 0),
        genre: metadata.common.genre ? metadata.common.genre[0] : '',
        year: metadata.common.year,
        trackNumber: metadata.common.track ? metadata.common.track.no : undefined,
        filePath: `/uploads/${file.filename}`,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype
      };
      const song = new Song(songData);
      await song.save();
      created.push(song);
    }
    res.status(201).json({
      success: true,
      message: 'Songs uploaded successfully',
      songs: created
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stream audio by song id
app.get('/api/stream/:id', async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    if (!song || !song.filePath) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }
    const filePath = path.join(__dirname, song.filePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    const stat = fs.statSync(filePath);
    const range = req.headers.range;
    const contentType = song.mimeType || path.extname(filePath);
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update song
app.put('/api/songs/:id', async (req, res) => {
  try {
    const song = await Song.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!song) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }
    
    res.json({ success: true, message: 'Song updated', song });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Delete song
app.delete('/api/songs/:id', async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    
    if (!song) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }
    
    // Delete file from disk
    if (song.filePath) {
      const filePath = path.join(__dirname, song.filePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    // Remove from all playlists
    await Playlist.updateMany(
      { songs: song._id },
      { $pull: { songs: song._id } }
    );
    
    await song.deleteOne();
    
    res.json({ success: true, message: 'Song deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search songs
app.get('/api/songs/search/:query', async (req, res) => {
  try {
    const query = req.params.query;
    const songs = await Song.find({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { artist: { $regex: query, $options: 'i' } },
        { album: { $regex: query, $options: 'i' } }
      ]
    }).sort({ addedDate: -1 });
    
    res.json({ success: true, count: songs.length, songs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Toggle favorite
app.post('/api/songs/:id/favorite', async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    
    if (!song) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }
    
    song.isFavorite = !song.isFavorite;
    await song.save();
    
    res.json({ success: true, message: 'Favorite toggled', song });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Increment play count
app.post('/api/songs/:id/play', async (req, res) => {
  try {
    const song = await Song.findByIdAndUpdate(
      req.params.id,
      {
        $inc: { playCount: 1 },
        lastPlayed: new Date()
      },
      { new: true }
    );
    
    if (!song) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }
    
    res.json({ success: true, message: 'Play count updated', song });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== PLAYLIST ROUTES ====================

// Get all playlists
app.get('/api/playlists', async (req, res) => {
  try {
    const playlists = await Playlist.find().populate('songs').sort({ createdDate: -1 });
    res.json({ success: true, count: playlists.length, playlists });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single playlist
app.get('/api/playlists/:id', async (req, res) => {
  try {
    const playlist = await Playlist.findById(req.params.id).populate('songs');
    
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    
    res.json({ success: true, playlist });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create playlist
app.post('/api/playlists', async (req, res) => {
  try {
    const playlist = new Playlist(req.body);
    await playlist.save();
    res.status(201).json({ success: true, playlist });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Update playlist
app.put('/api/playlists/:id', async (req, res) => {
  try {
    const playlist = await Playlist.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    
    res.json({ success: true, message: 'Playlist updated', playlist });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Delete playlist
app.delete('/api/playlists/:id', async (req, res) => {
  try {
    const playlist = await Playlist.findByIdAndDelete(req.params.id);
    
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    
    res.json({ success: true, message: 'Playlist deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add song to playlist
app.post('/api/playlists/:id/songs/:songId', async (req, res) => {
  try {
    const playlist = await Playlist.findById(req.params.id);
    const song = await Song.findById(req.params.songId);
    
    if (!playlist || !song) {
      return res.status(404).json({ success: false, error: 'Playlist or song not found' });
    }
    
    // Check if song already in playlist
    if (playlist.songs.includes(song._id)) {
      return res.status(400).json({ success: false, error: 'Song already in playlist' });
    }
    
    playlist.songs.push(song._id);
    await playlist.save();
    
    res.json({ success: true, message: 'Song added to playlist', playlist });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove song from playlist
app.delete('/api/playlists/:id/songs/:songId', async (req, res) => {
  try {
    const playlist = await Playlist.findById(req.params.id);
    
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    
    playlist.songs = playlist.songs.filter(
      songId => songId.toString() !== req.params.songId
    );
    
    await playlist.save();
    
    res.json({ success: true, message: 'Song removed from playlist', playlist });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get playlists containing a specific song
app.get('/api/songs/:id/playlists', async (req, res) => {
  try {
    const playlists = await Playlist.find({ songs: req.params.id });
    res.json({ success: true, count: playlists.length, playlists });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🎵 Songs API: http://localhost:${PORT}/api/songs`);
  console.log(`📋 Playlists API: http://localhost:${PORT}/api/playlists`);
  console.log(`📤 Upload: http://localhost:${PORT}/api/songs/upload`);
  console.log(`\n💡 Press Ctrl+C to stop\n`);
});
