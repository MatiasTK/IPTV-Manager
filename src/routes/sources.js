'use strict';

const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const db = require('../db/database');
const { authMiddleware, csrfMiddleware } = require('../middleware/auth');
const { parseM3U } = require('../services/m3u-parser');
const { detectDuplicates } = require('../services/duplicate-detector');

const router = express.Router();
router.use(authMiddleware);
router.use(csrfMiddleware);

const MAX_M3U_SIZE = 10 * 1024 * 1024; // 10MB

// ── GET /api/sources ───────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const sources = db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all();
  res.json({ sources });
});

// ── POST /api/sources ──────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, url, type = 'url', autoSync = 0, syncIntervalHours = 24 } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name required.' });
  }

  if (type === 'url') {
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url required for type=url.' });
    }
    try { new URL(url.trim()); } catch {
      return res.status(400).json({ error: 'Invalid URL.' });
    }
  }

  const result = db.prepare(`
    INSERT INTO sources (name, url, type, auto_sync, sync_interval_hours)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    name.trim().slice(0, 255),
    (url || '').trim().slice(0, 2048),
    type,
    autoSync ? 1 : 0,
    Math.max(1, parseInt(syncIntervalHours || '24', 10))
  );

  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(source);
});

// ── PUT /api/sources/:id ───────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const source = db.prepare('SELECT id FROM sources WHERE id = ?').get(id);
  if (!source) return res.status(404).json({ error: 'Source not found.' });

  const { name, url, autoSync, syncIntervalHours } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name required.' });
  }

  db.prepare(`
    UPDATE sources SET name = ?, url = ?, auto_sync = ?, sync_interval_hours = ? WHERE id = ?
  `).run(
    name.trim().slice(0, 255),
    (url || '').trim().slice(0, 2048),
    autoSync ? 1 : 0,
    Math.max(1, parseInt(syncIntervalHours || '24', 10)),
    id
  );

  res.json(db.prepare('SELECT * FROM sources WHERE id = ?').get(id));
});

// ── DELETE /api/sources/:id ────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const source = db.prepare('SELECT id FROM sources WHERE id = ?').get(id);
  if (!source) return res.status(404).json({ error: 'Source not found.' });

  const { deleteChannels } = req.query;
  if (deleteChannels === 'true') {
    db.prepare('DELETE FROM channels WHERE source_id = ?').run(id);
  } else {
    // Orphan channels (keep but unlink from source)
    db.prepare('UPDATE channels SET source_id = NULL WHERE source_id = ?').run(id);
  }
  db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── POST /api/sources/:id/sync ─────────────────────────────────────────────────
router.post('/:id/sync', async (req, res) => {
  const id = Number(req.params.id);
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!source) return res.status(404).json({ error: 'Source not found.' });

  if (!source.url) {
    return res.status(400).json({ error: 'Source has no URL to sync from.' });
  }

  let m3uText;
  try {
    m3uText = await fetchM3U(source.url);
  } catch (err) {
    return res.status(502).json({ error: `Failed to fetch M3U: ${err.message}` });
  }

  const { header, channels: parsed } = parseM3U(m3uText);

  // Import channels into DB
  const imported = importChannels(parsed, id);

  // Update source metadata
  db.prepare(`
    UPDATE sources SET last_synced_at = CURRENT_TIMESTAMP, channel_count = ? WHERE id = ?
  `).run(imported.total, id);

  // Detect duplicates after import
  const allChannels = db.prepare('SELECT id, name, url, group_id, health_status FROM channels WHERE is_active = 1').all();
  const threshold = parseInt(
    (db.prepare("SELECT value FROM settings WHERE key = 'duplicate_threshold'").get() || {}).value || '80',
    10
  );
  const duplicateGroups = detectDuplicates(allChannels, threshold);

  res.json({
    ok: true,
    imported: imported.created,
    updated: imported.updated,
    total: imported.total,
    duplicatesDetected: duplicateGroups.length,
    epgUrls: header.epgUrls,
  });
});

// ── POST /api/sources/import-text ─────────────────────────────────────────────
// Import M3U from pasted text (no URL)
router.post('/import-text', (req, res) => {
  const { text, sourceName = 'Manual Import' } = req.body;

  if (!text || typeof text !== 'string' || text.length > MAX_M3U_SIZE) {
    return res.status(400).json({ error: 'M3U text required (max 10MB).' });
  }

  // Create a "manual" source
  const sourceResult = db.prepare(`
    INSERT INTO sources (name, url, type, last_synced_at)
    VALUES (?, '', 'manual', CURRENT_TIMESTAMP)
  `).run(String(sourceName).trim().slice(0, 255));

  const sourceId = sourceResult.lastInsertRowid;
  const { header, channels: parsed } = parseM3U(text);
  const imported = importChannels(parsed, sourceId);

  db.prepare('UPDATE sources SET channel_count = ? WHERE id = ?').run(imported.total, sourceId);

  res.json({
    ok: true,
    sourceId,
    imported: imported.created,
    updated: imported.updated,
    total: imported.total,
    epgUrls: header.epgUrls,
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Fetch M3U text from a URL, following up to 5 redirects.
 * Enforces 10MB limit.
 */
function fetchM3U(urlStr) {
  return new Promise((resolve, reject) => {
    const makeRequest = (urlStr, redirectsLeft) => {
      if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));

      let parsed;
      try { parsed = new URL(urlStr); } catch {
        return reject(new Error('Invalid URL'));
      }

      const transport = parsed.protocol === 'https:' ? https : http;
      const req = transport.get(urlStr, { headers: { 'User-Agent': 'IPTV-Manager/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy();
          const location = res.headers.location;
          const nextUrl = location.startsWith('http') ? location : new URL(location, urlStr).toString();
          return makeRequest(nextUrl, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        let data = '';
        let size = 0;
        res.setEncoding('utf-8');
        res.on('data', (chunk) => {
          size += Buffer.byteLength(chunk);
          if (size > MAX_M3U_SIZE) {
            req.destroy();
            return reject(new Error('M3U file too large (max 10MB)'));
          }
          data += chunk;
        });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    };

    makeRequest(urlStr, 5);
  });
}

/**
 * Import parsed channels into the DB, creating groups as needed.
 * Returns { created, updated, total }.
 */
function importChannels(parsed, sourceId) {
  let created = 0;
  let updated = 0;

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

  const importTx = db.transaction((channels) => {
    let orderBase = maxOrder;
    for (const ch of channels) {
      const groupId = findOrCreateGroup(ch.groupTitle);

      // Check if this exact URL already exists
      const existing = db.prepare('SELECT id FROM channels WHERE url = ?').get(ch.url);
      if (existing) {
        db.prepare(`
          UPDATE channels SET
            name = ?, tvg_id = ?, tvg_name = ?, tvg_logo = ?,
            group_id = ?, catchup = ?, catchup_source = ?, catchup_days = ?,
            http_user_agent = ?, referrer = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          ch.name, ch.tvgId, ch.tvgName, ch.tvgLogo,
          groupId, ch.catchup, ch.catchupSource, ch.catchupDays,
          ch.httpUserAgent, ch.referrer,
          existing.id
        );
        updated++;
      } else {
        db.prepare(`
          INSERT INTO channels
            (name, url, tvg_id, tvg_name, tvg_logo, group_id, source_id, sort_order,
             catchup, catchup_source, catchup_days, http_user_agent, referrer)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          ch.name, ch.url, ch.tvgId, ch.tvgName, ch.tvgLogo,
          groupId, sourceId, ++orderBase,
          ch.catchup, ch.catchupSource, ch.catchupDays,
          ch.httpUserAgent, ch.referrer
        );
        created++;
      }
    }
  });

  importTx(parsed);
  return { created, updated, total: created + updated };
}

module.exports = router;
