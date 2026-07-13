'use strict';

const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const db = require('../db/database');
const { authMiddleware, csrfMiddleware } = require('../middleware/auth');
const { detectDuplicates } = require('../services/duplicate-detector');

const router = express.Router();
router.use(authMiddleware);
router.use(csrfMiddleware);

// ── GET /api/channels/logo-proxy ────────────────────────────────────────────────
router.get('/logo-proxy', (req, res) => {
  const logoUrl = req.query.url;
  if (!logoUrl) return res.status(400).send('url required');

  try {
    const parsedUrl = new URL(logoUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    };

    const proxyReq = client.get(parsedUrl, options, (proxyRes) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        try {
          const redirectUrl = new URL(proxyRes.headers.location, logoUrl);
          const redirectReq = client.get(redirectUrl, options, (redRes) => {
            res.writeHead(redRes.statusCode, {
              'Content-Type': redRes.headers['content-type'] || 'image/png',
              'Cache-Control': 'public, max-age=86400',
            });
            redRes.pipe(res);
          });
          redirectReq.on('error', () => res.status(500).send('Error fetching logo redirect'));
          return;
        } catch {
          // fall through
        }
      }

      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'image/png',
        'Cache-Control': 'public, max-age=86400',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', () => {
      res.status(500).send('Error fetching logo');
    });
  } catch (err) {
    res.status(400).send('Invalid URL');
  }
});

// ── GET /api/channels ──────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { groupId, sourceId, health, search, page = 1, limit = 100, sortBy, sortOrder } = req.query;

  let query = `
    SELECT
      c.id, c.name, c.url, c.tvg_id, c.tvg_name, c.tvg_logo,
      c.group_id, c.source_id, c.sort_order,
      c.catchup, c.catchup_source, c.catchup_days,
      c.http_user_agent, c.referrer,
      c.is_active, c.health_status, c.health_latency_ms, c.last_health_check,
      g.name AS group_name,
      s.name AS source_name,
      (SELECT COUNT(*) FROM channel_alternatives ca WHERE ca.primary_channel_id = c.id) AS alt_count
    FROM channels c
    LEFT JOIN groups g ON c.group_id = g.id
    LEFT JOIN sources s ON c.source_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (groupId === 'none') {
    query += ' AND c.group_id IS NULL';
  } else if (groupId) {
    query += ' AND c.group_id = ?';
    params.push(Number(groupId));
  }
  if (sourceId) { query += ' AND c.source_id = ?'; params.push(Number(sourceId)); }
  if (health) { query += ' AND c.health_status = ?'; params.push(health); }
  if (search) {
    query += ' AND (c.name LIKE ? OR c.tvg_id LIKE ? OR c.url LIKE ?)';
    const pat = `%${search}%`;
    params.push(pat, pat, pat);
  }

  // Server-side sorting
  const dir = sortOrder === 'desc' ? 'DESC' : 'ASC';
  const sortMap = {
    name:    `c.name COLLATE NOCASE ${dir}`,
    group:   `g.name COLLATE NOCASE ${dir}, c.name COLLATE NOCASE ASC`,
    source:  `s.name COLLATE NOCASE ${dir}, c.name COLLATE NOCASE ASC`,
    status:  `c.health_status ${dir}, c.name COLLATE NOCASE ASC`,
    latency: `c.health_latency_ms ${dir}, c.name COLLATE NOCASE ASC`,
  };
  const orderClause = sortMap[sortBy] ||
    `COALESCE((SELECT sort_order FROM groups WHERE id = c.group_id), 9999),
     get_base_name(c.name), COALESCE(s.priority, 9999),
     c.name COLLATE NOCASE, c.sort_order`;
  query += ` ORDER BY ${orderClause}`;

  const pageNum  = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10))); // hard cap 200 per page
  const offset   = (pageNum - 1) * limitNum;

  const countStmt = db.prepare(query.replace(/SELECT[\s\S]+?FROM channels/, 'SELECT COUNT(*) AS cnt FROM channels'));
  const total = countStmt.get(...params)?.cnt ?? 0;

  query += ` LIMIT ? OFFSET ?`;
  params.push(limitNum, offset);

  const channels = db.prepare(query).all(...params);
  res.json({ channels, total, page: pageNum, limit: limitNum });
});

// ── GET /api/channels/ids ──────────────────────────────────────────────────────
// Returns only matching channel IDs (no pagination) – used for cross-page "select all"
router.get('/ids', (req, res) => {
  const { groupId, sourceId, health, search } = req.query;

  let query = 'SELECT c.id FROM channels c WHERE 1=1';
  const params = [];

  if (groupId === 'none') {
    query += ' AND c.group_id IS NULL';
  } else if (groupId) {
    query += ' AND c.group_id = ?';
    params.push(Number(groupId));
  }
  if (sourceId) { query += ' AND c.source_id = ?'; params.push(Number(sourceId)); }
  if (health) { query += ' AND c.health_status = ?'; params.push(health); }
  if (search) {
    query += ' AND (c.name LIKE ? OR c.tvg_id LIKE ? OR c.url LIKE ?)';
    const pat = `%${search}%`;
    params.push(pat, pat, pat);
  }

  const rows = db.prepare(query).all(...params);
  const ids = rows.map((r) => r.id);
  res.json({ ids, total: ids.length });
});

// ── GET /api/channels/duplicates ───────────────────────────────────────────────
router.get('/duplicates', (req, res) => {
  const threshold = parseInt(req.query.threshold || '80', 10);
  const channels = db.prepare(`
    SELECT c.id, c.name, c.url, c.group_id, c.health_status, c.is_active
    FROM channels c
    WHERE c.is_active = 1
  `).all();

  const groups = detectDuplicates(channels, threshold);
  res.json({ groups, count: groups.length });
});

// ── GET /api/channels/:id ──────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const ch = db.prepare(`
    SELECT c.*, g.name AS group_name, s.name AS source_name
    FROM channels c
    LEFT JOIN groups g ON c.group_id = g.id
    LEFT JOIN sources s ON c.source_id = s.id
    WHERE c.id = ?
  `).get(Number(req.params.id));

  if (!ch) return res.status(404).json({ error: 'Channel not found.' });

  const alternatives = db.prepare(`
    SELECT c.id, c.name, c.url, c.health_status, c.health_latency_ms, ca.priority
    FROM channel_alternatives ca
    JOIN channels c ON ca.alternative_channel_id = c.id
    WHERE ca.primary_channel_id = ?
    ORDER BY ca.priority
  `).all(ch.id);

  res.json({ ...ch, alternatives });
});

// ── POST /api/channels ─────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const data = sanitizeChannelInput(req.body);
  if (!data) return res.status(400).json({ error: 'name and url are required.' });

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM channels').get().m;

  const result = db.prepare(`
    INSERT INTO channels
      (name, url, tvg_id, tvg_name, tvg_logo, group_id, source_id, sort_order,
       catchup, catchup_source, catchup_days, http_user_agent, referrer, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    data.name, data.url, data.tvgId, data.tvgName, data.tvgLogo,
    data.groupId, data.sourceId, maxOrder + 1,
    data.catchup, data.catchupSource, data.catchupDays,
    data.httpUserAgent, data.referrer
  );

  const created = db.prepare('SELECT * FROM channels WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// ── PUT /api/channels/:id ──────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM channels WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Channel not found.' });

  const data = sanitizeChannelInput(req.body);
  if (!data) return res.status(400).json({ error: 'name and url are required.' });

  db.prepare(`
    UPDATE channels SET
      name = ?, url = ?, tvg_id = ?, tvg_name = ?, tvg_logo = ?,
      group_id = ?, source_id = ?,
      catchup = ?, catchup_source = ?, catchup_days = ?,
      http_user_agent = ?, referrer = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    data.name, data.url, data.tvgId, data.tvgName, data.tvgLogo,
    data.groupId, data.sourceId,
    data.catchup, data.catchupSource, data.catchupDays,
    data.httpUserAgent, data.referrer,
    id
  );

  res.json(db.prepare('SELECT * FROM channels WHERE id = ?').get(id));
});

// ── DELETE /api/channels/:id ───────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM channels WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Channel not found.' });

  db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── PATCH /api/channels/:id/toggle ────────────────────────────────────────────
router.patch('/:id/toggle', (req, res) => {
  const id = Number(req.params.id);
  const ch = db.prepare('SELECT id, is_active FROM channels WHERE id = ?').get(id);
  if (!ch) return res.status(404).json({ error: 'Channel not found.' });

  const newActive = ch.is_active ? 0 : 1;
  db.prepare('UPDATE channels SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newActive, id);
  res.json({ id, is_active: newActive });
});

// ── PATCH /api/channels/reorder ───────────────────────────────────────────────
router.patch('/reorder', (req, res) => {
  const { order } = req.body; // [{ id, sort_order }]
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required.' });

  const update = db.prepare('UPDATE channels SET sort_order = ? WHERE id = ?');
  const transaction = db.transaction((items) => {
    for (const item of items) {
      update.run(Number(item.sort_order), Number(item.id));
    }
  });
  transaction(order);
  res.json({ ok: true });
});

// ── POST /api/channels/:id/alternatives ───────────────────────────────────────
router.post('/:id/alternatives', (req, res) => {
  const primaryId = Number(req.params.id);
  const { alternativeId, priority = 0 } = req.body;

  if (!alternativeId || primaryId === Number(alternativeId)) {
    return res.status(400).json({ error: 'Valid alternativeId required.' });
  }

  // Verify both channels exist
  const primary = db.prepare('SELECT id FROM channels WHERE id = ?').get(primaryId);
  const alt = db.prepare('SELECT id FROM channels WHERE id = ?').get(Number(alternativeId));
  if (!primary || !alt) return res.status(404).json({ error: 'Channel not found.' });

  try {
    db.prepare(`
      INSERT OR REPLACE INTO channel_alternatives (primary_channel_id, alternative_channel_id, priority)
      VALUES (?, ?, ?)
    `).run(primaryId, Number(alternativeId), Number(priority));
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'Already linked as alternative.' });
  }
});

// ── DELETE /api/channels/:id/alternatives/:altId ───────────────────────────────
router.delete('/:id/alternatives/:altId', (req, res) => {
  const primaryId = Number(req.params.id);
  const altId = Number(req.params.altId);

  db.prepare('DELETE FROM channel_alternatives WHERE primary_channel_id = ? AND alternative_channel_id = ?')
    .run(primaryId, altId);

  res.json({ ok: true });
});

// ── POST /api/channels/:id/set-primary ────────────────────────────────────────
// Swap this channel to be the primary, demoting the current primary to alternative
router.post('/:id/set-primary', (req, res) => {
  const newPrimaryId = Number(req.params.id);
  const { oldPrimaryId } = req.body;

  if (!oldPrimaryId) return res.status(400).json({ error: 'oldPrimaryId required.' });
  const oldId = Number(oldPrimaryId);

  // Verify both exist
  const newPrimary = db.prepare('SELECT * FROM channels WHERE id = ?').get(newPrimaryId);
  const oldPrimary = db.prepare('SELECT * FROM channels WHERE id = ?').get(oldId);
  if (!newPrimary || !oldPrimary) return res.status(404).json({ error: 'Channel not found.' });

  const swap = db.transaction(() => {
    // Remove the alternative link (newPrimary was alternative of oldPrimary)
    db.prepare('DELETE FROM channel_alternatives WHERE primary_channel_id = ? AND alternative_channel_id = ?')
      .run(oldId, newPrimaryId);

    // Get all alternatives of the old primary (except newPrimary)
    const alts = db.prepare('SELECT * FROM channel_alternatives WHERE primary_channel_id = ?').all(oldId);
    db.prepare('DELETE FROM channel_alternatives WHERE primary_channel_id = ?').run(oldId);

    // Make old primary an alternative of new primary
    db.prepare('INSERT OR IGNORE INTO channel_alternatives (primary_channel_id, alternative_channel_id, priority) VALUES (?, ?, 0)')
      .run(newPrimaryId, oldId);

    // Reassign other alternatives to new primary
    for (const alt of alts) {
      if (alt.alternative_channel_id !== newPrimaryId) {
        db.prepare('INSERT OR IGNORE INTO channel_alternatives (primary_channel_id, alternative_channel_id, priority) VALUES (?, ?, ?)')
          .run(newPrimaryId, alt.alternative_channel_id, alt.priority);
      }
    }
  });

  swap();
  res.json({ ok: true });
});

// ── POST /api/channels/bulk-alternatives ──────────────────────────────────────
// Auto-merge a group of duplicate channels (from duplicate detector)
router.post('/bulk-alternatives', (req, res) => {
  const { primaryId, alternativeIds } = req.body;

  if (!primaryId || !Array.isArray(alternativeIds) || alternativeIds.length === 0) {
    return res.status(400).json({ error: 'primaryId and alternativeIds[] required.' });
  }

  const merge = db.transaction(() => {
    for (let i = 0; i < alternativeIds.length; i++) {
      const altId = Number(alternativeIds[i]);
      if (altId === Number(primaryId)) continue;
      db.prepare('INSERT OR IGNORE INTO channel_alternatives (primary_channel_id, alternative_channel_id, priority) VALUES (?, ?, ?)')
        .run(Number(primaryId), altId, i);
    }
  });

  merge();
  res.status(201).json({ ok: true });
});

// ── POST /api/channels/delete-down ───────────────────────────────────────────
router.post('/delete-down', (req, res) => {
  const result = db.prepare("DELETE FROM channels WHERE health_status = 'down' AND is_active = 1").run();
  res.json({ ok: true, deletedCount: result.changes });
});

// ── POST /api/channels/bulk-delete ───────────────────────────────────────────
router.post('/bulk-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required.' });
  }
  const del = db.transaction((ids) => {
    for (const id of ids) {
      db.prepare('DELETE FROM channels WHERE id = ?').run(id);
    }
  });
  del(ids);
  res.json({ ok: true });
});

// ── PATCH /api/channels/bulk-toggle ──────────────────────────────────────────
router.patch('/bulk-toggle', (req, res) => {
  const { ids, is_active } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required.' });
  }
  const toggle = db.transaction((ids) => {
    for (const id of ids) {
      if (is_active !== undefined) {
        db.prepare('UPDATE channels SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(is_active ? 1 : 0, id);
      } else {
        const ch = db.prepare('SELECT is_active FROM channels WHERE id = ?').get(id);
        if (ch) {
          db.prepare('UPDATE channels SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(ch.is_active ? 0 : 1, id);
        }
      }
    }
  });
  toggle(ids);
  res.json({ ok: true });
});

// ── PATCH /api/channels/bulk-edit ────────────────────────────────────────────
router.patch('/bulk-edit', (req, res) => {
  const { ids, groupId } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required.' });
  }
  const gId = (groupId === null || groupId === '' || groupId === undefined) ? null : Number(groupId);
  const edit = db.transaction((ids) => {
    for (const id of ids) {
      db.prepare('UPDATE channels SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(gId, id);
    }
  });
  edit(ids);
  res.json({ ok: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function sanitizeChannelInput(body) {
  const { name, url, tvgId, tvgName, tvgLogo, groupId, sourceId,
    catchup, catchupSource, catchupDays, httpUserAgent, referrer } = body || {};

  if (!name || !url || typeof name !== 'string' || typeof url !== 'string') return null;
  if (name.trim().length === 0 || url.trim().length === 0) return null;

  // Basic URL validation
  try { new URL(url.trim()); } catch { return null; }

  return {
    name: name.trim().slice(0, 255),
    url: url.trim().slice(0, 2048),
    tvgId: String(tvgId || '').trim().slice(0, 255),
    tvgName: String(tvgName || '').trim().slice(0, 255),
    tvgLogo: String(tvgLogo || '').trim().slice(0, 2048),
    groupId: groupId ? Number(groupId) : null,
    sourceId: sourceId ? Number(sourceId) : null,
    catchup: String(catchup || '').trim().slice(0, 64),
    catchupSource: String(catchupSource || '').trim().slice(0, 2048),
    catchupDays: Math.max(0, parseInt(catchupDays || '0', 10)),
    httpUserAgent: String(httpUserAgent || '').trim().slice(0, 512),
    referrer: String(referrer || '').trim().slice(0, 2048),
  };
}

module.exports = router;
