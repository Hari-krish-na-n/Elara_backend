const mongoose = require('mongoose');

const downloadSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    deviceId: {
        type: String, // Reference to device identifier
        required: true,
        index: true
    },
    songId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Song',
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'downloaded', 'failed', 'outdated'],
        default: 'pending'
    },
    downloadedAt: Date,
    lastModifiedAtDownload: Date // Stores the Song.lastModified value at the time of download
}, {
    timestamps: true
});

// Ensure unique record per user/device/song
downloadSchema.index({ userId: 1, deviceId: 1, songId: 1 }, { unique: true });

const Download = mongoose.model('Download', downloadSchema);
module.exports = Download;
