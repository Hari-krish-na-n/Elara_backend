const express = require('express');
const router = express.Router();
const musicController = require('../controllers/music.controller');
const { auth } = require('../middleware/auth.middleware');

router.get('/', musicController.getSongs);
router.get('/search', musicController.searchSongs);
router.get('/:id/stream', musicController.streamSong);

module.exports = router;
