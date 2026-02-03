const express = require('express');
const router = express.Router();
const syncController = require('../controllers/sync.controller');
const { auth } = require('../middleware/auth.middleware');

router.use(auth); // All sync routes require auth

router.post('/playback', syncController.syncPlayback);
router.get('/downloads', syncController.getOfflineStatus);
router.post('/downloads', syncController.markForOffline);

module.exports = router;
