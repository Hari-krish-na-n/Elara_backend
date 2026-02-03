const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const Device = require('../models/device.model');

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        const deviceId = req.header('X-Device-ID');

        if (!token) {
            throw new Error('Authentication required');
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        const user = await User.findById(decoded.id);

        if (!user) {
            throw new Error('User not found');
        }

        // Attach user to request
        req.user = user;
        req.token = token;
        req.deviceId = deviceId;

        // Optional: Log device activity if deviceId is present
        if (deviceId) {
            await Device.findOneAndUpdate(
                { userId: user._id, deviceId },
                { lastSeen: new Date() },
                { upsert: true }
            );
        }

        next();
    } catch (error) {
        res.status(401).json({ success: false, error: 'Please authenticate' });
    }
};

const restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'You do not have permission to perform this action'
            });
        }
        next();
    };
};

module.exports = { auth, restrictTo };
