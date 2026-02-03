const mongoose = require('mongoose');

const songSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    artist: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    album: {
        type: String,
        trim: true,
        index: true
    },
    duration: {
        type: Number, // in seconds
        required: true
    },
    genre: [String],
    coverArtUrl: {
        type: String,
        default: '/defaults/cover-art.png'
    },
    audioUrl: {
        type: String,
        required: true
    },
    fileSize: Number,
    mimeType: String,
    bitrate: Number,
    lastModified: {
        type: Date,
        default: Date.now // Tracks when the audio file itself changed
    },
    playCount: {
        type: Number,
        default: 0
    },
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    isPublic: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Full-text search index
songSchema.index({
    title: 'text',
    artist: 'text',
    album: 'text'
});

const Song = mongoose.model('Song', songSchema);
module.exports = Song;
