'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authMiddleware, csrfMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(csrfMiddleware);

// ── GET /api/settings ──────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json(settings);
});

// ── PUT /api/settings ──────────────────────────────────────────────────────────
router.put('/', (req, res) => {
  const allowed = ['playlist_name', 'epg_urls', 'health_check_enabled', 'duplicate_threshold'];
  const updates = req.body;

  if (typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'Object of settings required.' });
  }

  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction((obj) => {
    for (const key of allowed) {
      if (key in obj) {
        let val = String(obj[key]);
        // Validate specific keys
        if (key === 'playlist_name') val = val.trim().slice(0, 255) || 'My IPTV Playlist';
        if (key === 'duplicate_threshold') {
          const n = parseInt(val, 10);
          if (isNaN(n) || n < 0 || n > 100) continue; // skip invalid
          val = String(n);
        }
        if (key === 'health_check_enabled') val = val === '0' ? '0' : '1';
        upsert.run(key, val);
      }
    }
  });

  tx(updates);

  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json(settings);
});

// ── POST /api/settings/regenerate-token ───────────────────────────────────────
router.post('/regenerate-token', (req, res) => {
  const newToken = uuidv4();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('playlist_token', newToken);
  res.json({ token: newToken });
});

module.exports = router;
