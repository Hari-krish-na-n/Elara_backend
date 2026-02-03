const Song = require('../models/song.model');
const PlaybackHistory = require('../models/history.model');
const Download = require('../models/download.model');

const syncPlayback = async (req, res) => {
    try {
        const { history } = req.body; // Array of { songId, playedAt, duration, isOffline }
        if (!Array.isArray(history)) {
            return res.status(400).json({ success: false, error: 'History must be an array' });
        }

        const records = history.map(item => ({
            userId: req.user._id,
            deviceId: req.deviceId,
            ...item,
            syncedAt: new Date()
        }));

        await PlaybackHistory.insertMany(records);

        // Update global play counts for songs
        const songIds = history.map(h => h.songId);
        await Song.updateMany(
            { _id: { $in: songIds } },
            { $inc: { playCount: 1 } }
        );

        res.json({ success: true, message: `Synced ${records.length} records` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const getOfflineStatus = async (req, res) => {
    try {
        const downloads = await Download.find({
            userId: req.user._id,
            deviceId: req.deviceId
        }).populate('songId');

        // Check if any song was modified since download
        const status = downloads.map(d => ({
            songId: d.songId._id,
            status: d.status,
            isOutdated: d.lastModifiedAtDownload < d.songId.lastModified
        }));

        res.json({ success: true, downloads: status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const markForOffline = async (req, res) => {
    try {
        const { songIds } = req.body;
        if (!Array.isArray(songIds)) {
            return res.status(400).json({ success: false, error: 'songIds must be an array' });
        }

        const songs = await Song.find({ _id: { $in: songIds } });
        const downloadRecords = songs.map(song => ({
            userId: req.user._id,
            deviceId: req.deviceId,
            songId: song._id,
            lastModifiedAtDownload: song.lastModified,
            status: 'pending'
        }));

        // Use bulkWrite for efficiency or loop for simpler logic
        for (const record of downloadRecords) {
            await Download.findOneAndUpdate(
                { userId: record.userId, deviceId: record.deviceId, songId: record.songId },
                record,
                { upsert: true }
            );
        }

        res.json({ success: true, message: 'Songs marked for offline' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = { syncPlayback, getOfflineStatus, markForOffline };
