const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const Device = require('../models/device.model');

const register = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const user = new User({ username, email, password });
        await user.save();

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret_key', {
            expiresIn: '30d'
        });

        res.status(201).json({ success: true, token, user });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

const login = async (req, res) => {
    try {
        const { email, password, deviceName, deviceId } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }

        const user = await User.findOne({ email }).select('+password');
        if (!user || !(await user.comparePassword(password, user.password))) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret_key', {
            expiresIn: '30d'
        });

        // Track device
        if (deviceId) {
            await Device.findOneAndUpdate(
                { userId: user._id, deviceId },
                {
                    name: deviceName || 'Web Browser',
                    lastSeen: new Date(),
                    isOfflineSyncEnabled: true
                },
                { upsert: true }
            );
        }

        res.json({
            success: true,
            token,
            user: {
                _id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                preferences: user.preferences
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const getMe = async (req, res) => {
    res.json({ success: true, user: req.user });
};

const updatePreferences = async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.user._id,
            { preferences: { ...req.user.preferences, ...req.body } },
            { new: true }
        );
        res.json({ success: true, user });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

module.exports = { register, login, getMe, updatePreferences };
