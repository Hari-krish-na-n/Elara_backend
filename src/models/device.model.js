const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    deviceId: {
        type: String,
        required: true,
        unique: true // Unique identifier (e.g., from browser fingerprint or UUID)
    },
    name: {
        type: String,
        required: true,
        default: 'Web Browser'
    },
    platform: {
        type: String,
        enum: ['web', 'mobile', 'desktop'],
        default: 'web'
    },
    lastSeen: {
        type: Date,
        default: Date.now
    },
    pushToken: {
        type: String // For future notifications
    },
    isOfflineSyncEnabled: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Avoid duplicate devices for the same user
deviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

const Device = mongoose.model('Device', deviceSchema);
module.exports = Device;
