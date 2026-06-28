'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { generateM3U } = require('../services/m3u-generator');

const router = express.Router();

// Rate limit the public playlist endpoint to prevent abuse
const playlistLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.params.token || req.ip,
});

// ── GET /playlist/:token/playlist.m3u ─────────────────────────────────────────
router.get('/:token/playlist.m3u', playlistLimiter, (req, res) => {
  const { token } = req.params;

  // Validate token against DB (not against env var — token is in DB)
  const storedToken = db.prepare("SELECT value FROM settings WHERE key = 'playlist_token'").get();
  if (!storedToken || storedToken.value !== token) {
    // Return 404 to not reveal that a playlist exists
    return res.status(404).send('Not found.');
  }

  const m3u = generateM3U();

  res
    .set('Content-Type', 'audio/mpegurl; charset=utf-8')
    .set('Content-Disposition', 'inline; filename="playlist.m3u"')
    .set('Cache-Control', 'no-cache, no-store, must-revalidate')
    .set('Pragma', 'no-cache')
    .set('Expires', '0')
    .set('X-Content-Type-Options', 'nosniff')
    .send(m3u);
});

module.exports = router;
