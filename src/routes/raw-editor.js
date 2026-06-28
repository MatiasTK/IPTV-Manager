'use strict';

const express = require('express');
const db = require('../db/database');
const { authMiddleware, csrfMiddleware } = require('../middleware/auth');
const { generateM3U } = require('../services/m3u-generator');
const { parseM3U } = require('../services/m3u-parser');

const router = express.Router();
router.use(authMiddleware);
router.use(csrfMiddleware);

const MAX_RAW_SIZE = 10 * 1024 * 1024; // 10MB

// ── GET /api/raw/preview ───────────────────────────────────────────────────────
// Returns the current M3U as plain text (exactly what TiviMate would receive)
router.get('/preview', (_req, res) => {
  const m3u = generateM3U();
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(m3u);
});

// ── PUT /api/raw/apply ─────────────────────────────────────────────────────────
// Parse edited M3U text and sync changes back to the DB
router.put('/apply', (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text required.' });
  }
  if (text.length > MAX_RAW_SIZE) {
    return res.status(400).json({ error: 'M3U text too large (max 10MB).' });
  }

  // Validate: must start with #EXTM3U
  if (!text.trim().startsWith('#EXTM3U') && !text.trim().startsWith('#extm3u')) {
    return res.status(400).json({ error: 'Invalid M3U: must start with #EXTM3U.' });
  }

  const { header, channels: parsed } = parseM3U(text);

  // Update EPG URLs from header if present
  if (header.epgUrls && header.epgUrls.length > 0) {
    const epgStr = header.epgUrls.join('\n');
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('epg_urls', epgStr);
  }

  // Sync channels:
  // - URLs present in the raw M3U: update or create
  // - URLs NOT present: deactivate (soft delete — don't hard delete)
  const parsedUrls = new Set(parsed.map((c) => c.url));

  const groupCache = new Map();
  const findOrCreateGroup = (name) => {
    if (!name) return null;
    if (groupCache.has(name)) return groupCache.get(name);
    let group = db.prepare('SELECT id FROM groups WHERE name = ?').get(name);
    if (!group) {
      const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM groups').get().m;
      const r = db.prepare('INSERT OR IGNORE INTO groups (name, sort_order) VALUES (?, ?)').run(name, maxOrder + 1);
      group = db.prepare('SELECT id FROM groups WHERE id = ?').get(r.lastInsertRowid) ||
              db.prepare('SELECT id FROM groups WHERE name = ?').get(name);
    }
    groupCache.set(name, group.id);
    return group.id;
  };

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM channels').get().m;

  const syncTx = db.transaction(() => {
    // Deactivate channels not in the raw M3U
    const allActive = db.prepare('SELECT id, url FROM channels WHERE is_active = 1').all();
    for (const ch of allActive) {
      if (!parsedUrls.has(ch.url)) {
        db.prepare('UPDATE channels SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ch.id);
      }
    }

    // Upsert channels from raw M3U
    let orderBase = maxOrder;
    for (let i = 0; i < parsed.length; i++) {
      const ch = parsed[i];
      const groupId = findOrCreateGroup(ch.groupTitle);
      const existing = db.prepare('SELECT id FROM channels WHERE url = ?').get(ch.url);

      if (existing) {
        db.prepare(`
          UPDATE channels SET
            name = ?, tvg_id = ?, tvg_name = ?, tvg_logo = ?,
            group_id = ?, catchup = ?, catchup_source = ?, catchup_days = ?,
            http_user_agent = ?, referrer = ?,
            sort_order = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          ch.name, ch.tvgId, ch.tvgName, ch.tvgLogo,
          groupId, ch.catchup, ch.catchupSource, ch.catchupDays,
          ch.httpUserAgent, ch.referrer,
          i + 1, existing.id
        );
      } else {
        db.prepare(`
          INSERT INTO channels
            (name, url, tvg_id, tvg_name, tvg_logo, group_id, sort_order,
             catchup, catchup_source, catchup_days, http_user_agent, referrer)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          ch.name, ch.url, ch.tvgId, ch.tvgName, ch.tvgLogo,
          groupId, ++orderBase,
          ch.catchup, ch.catchupSource, ch.catchupDays,
          ch.httpUserAgent, ch.referrer
        );
      }
    }
  });

  syncTx();

  const total = db.prepare('SELECT COUNT(*) AS c FROM channels WHERE is_active = 1').get().c;
  res.json({ ok: true, activeChannels: total });
});

module.exports = router;
