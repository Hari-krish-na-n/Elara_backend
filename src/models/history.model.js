const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    songId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Song',
        required: true
    },
    deviceId: String,
    playedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    duration: Number, // How long it was played (seconds)
    isOffline: {
        type: Boolean,
        default: false
    },
    syncedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

const PlaybackHistory = mongoose.model('PlaybackHistory', historySchema);
module.exports = PlaybackHistory;
