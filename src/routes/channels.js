'use strict';

const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const db = require('../db/database');
const { authMiddleware, csrfMiddleware } = require('../middleware/auth');
const path = require('path');
const { Worker } = require('worker_threads');
const config = require('../config');

const router = express.Router();
router.use(authMiddleware);
router.use(csrfMiddleware);

// ── GET /api/channels/logo-proxy ────────────────────────────────────────────────
// A page shows ~100 logos at once, so fetches are cached (hits and failures),
// limited in concurrency and time-boxed: one dead logo host must not stall the server.
const LOGO_TTL_MS = 24 * 60 * 60 * 1000;
const LOGO_FAIL_TTL_MS = 30 * 60 * 1000;
const LOGO_MAX_ENTRIES = 3000;
const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_CONCURRENCY = 6;
const logoCache = new Map(); // url → { at, body, type } | { at, failed: true }
let logoActive = 0;
const logoQueue = [];

function withLogoSlot(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      logoActive++;
      task().then(resolve, reject).finally(() => {
        logoActive--;
        const next = logoQueue.shift();
        if (next) next();
      });
    };
    if (logoActive < LOGO_CONCURRENCY) run();
    else logoQueue.push(run);
  });
}

async function fetchLogo(url) {
  const resp = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(5000),
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const body = Buffer.from(await resp.arrayBuffer());
  if (body.length > LOGO_MAX_BYTES) throw new Error('too large');
  return { body, type: resp.headers.get('content-type') || 'image/png' };
}

router.get('/logo-proxy', async (req, res) => {
  const logoUrl = req.query.url;
  if (!logoUrl) return res.status(400).send('url required');

  let parsedUrl;
  try {
    parsedUrl = new URL(logoUrl);
    if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error('protocol');
  } catch {
    return res.status(400).send('Invalid URL');
  }

  const key = parsedUrl.href;
  let entry = logoCache.get(key);
  if (entry && Date.now() - entry.at > (entry.failed ? LOGO_FAIL_TTL_MS : LOGO_TTL_MS)) entry = null;

  if (!entry) {
    try {
      entry = { at: Date.now(), ...(await withLogoSlot(() => fetchLogo(key))) };
    } catch {
      entry = { at: Date.now(), failed: true };
    }
    if (logoCache.size >= LOGO_MAX_ENTRIES) logoCache.delete(logoCache.keys().next().value);
    logoCache.set(key, entry);
  }

  if (entry.failed) return res.status(404).send('Logo unavailable');
  res.set({ 'Content-Type': entry.type, 'Cache-Control': 'public, max-age=86400' });
  res.send(entry.body);
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
// Detection is expensive on big libraries, so the result is cached per
// (threshold, source) and served in pages. `refresh=1` forces a re-scan.
const DUP_CACHE_TTL_MS = 5 * 60 * 1000;
const dupCache = new Map();

const inflight = new Map();

function findDuplicateGroups(threshold, sourceId, refresh) {
  const key = `${threshold}:${sourceId ?? 'all'}`;
  const hit = dupCache.get(key);
  if (!refresh && hit && Date.now() - hit.at < DUP_CACHE_TTL_MS) return Promise.resolve(hit.groups);
  if (inflight.has(key)) return inflight.get(key);

  const job = new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../services/duplicate-worker.js'), {
      workerData: { dbPath: config.dbPath, threshold, sourceId },
    });
    worker.once('message', ({ groups }) => {
      groups.sort((a, b) => (a.reason === b.reason ? b.score - a.score || b.channels.length - a.channels.length : a.reason === 'url' ? -1 : 1));
      dupCache.set(key, { at: Date.now(), groups });
      resolve(groups);
    });
    worker.once('error', reject);
  }).finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}

function parseDupQuery(q) {
  const threshold = Math.min(100, Math.max(50, parseInt(q.threshold || '80', 10) || 80));
  const sourceId = q.source ? Number(q.source) || null : null;
  return { threshold, sourceId };
}

router.get('/duplicates', async (req, res) => {
  const { threshold, sourceId } = parseDupQuery(req.query);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '30', 10) || 30));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);

  let all;
  try {
    all = await findDuplicateGroups(threshold, sourceId, req.query.refresh === '1');
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  res.json({ groups: all.slice(offset, offset + limit), count: all.length, offset, limit });
});

// ── POST /api/channels/duplicates/auto-group ──────────────────────────────────
// Server-side bulk merge of every detected group (suggested channel = primary)
router.post('/duplicates/auto-group', async (req, res) => {
  const { threshold, sourceId } = parseDupQuery(req.body || {});
  let groups;
  try {
    groups = await findDuplicateGroups(threshold, sourceId, true);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  const insert = db.prepare('INSERT OR IGNORE INTO channel_alternatives (primary_channel_id, alternative_channel_id, priority) VALUES (?, ?, ?)');
  const run = db.transaction(() => {
    for (const g of groups) {
      g.channels.filter((c) => c.id !== g.suggestedPrimaryId).forEach((c, i) => insert.run(g.suggestedPrimaryId, c.id, i));
    }
  });
  run();
  dupCache.clear();
  res.json({ ok: true, groups: groups.length });
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
  dupCache.clear();
  res.status(201).json({ ok: true });
});

// ── POST /api/channels/delete-down ───────────────────────────────────────────
router.post('/delete-down', (req, res) => {
  // Optional `source` (id | 'none' | 'all') limits the purge to one source
  const src = (req.body || {}).source;
  let sql = "DELETE FROM channels WHERE health_status = 'down' AND is_active = 1";
  const params = [];
  if (src === 'none') sql += ' AND source_id IS NULL';
  else if (src !== undefined && src !== 'all' && Number.isInteger(Number(src))) { sql += ' AND source_id = ?'; params.push(Number(src)); }
  const result = db.prepare(sql).run(...params);
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
