const Song = require('../models/song.model');
const fs = require('fs');
const path = require('path');

const getSongs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const songs = await Song.find({ isPublic: true })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Song.countDocuments({ isPublic: true });

        res.json({
            success: true,
            count: songs.length,
            total,
            page,
            pages: Math.ceil(total / limit),
            songs
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const streamSong = async (req, res) => {
    try {
        const song = await Song.findById(req.params.id);
        if (!song) return res.status(404).json({ success: false, error: 'Song not found' });

        // In a real cloud setup, we'd redirect to a signed S3 URL here
        // For local dev, we simulate streaming with range requests
        const filePath = path.join(__dirname, '../../', song.audioUrl);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'Audio file not found' });
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });

            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': song.mimeType || 'audio/mpeg',
            };

            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': song.mimeType || 'audio/mpeg',
            };
            res.writeHead(200, head);
            fs.createReadStream(filePath).pipe(res);
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const searchSongs = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json({ success: true, songs: [] });

        const songs = await Song.find(
            { $text: { $search: q }, isPublic: true },
            { score: { $meta: "textScore" } }
        )
            .sort({ score: { $meta: "textScore" } })
            .limit(20);

        res.json({ success: true, songs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = { getSongs, streamSong, searchSongs };
