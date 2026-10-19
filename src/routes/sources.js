'use strict';

const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const db = require('../db/database');
const { authMiddleware, csrfMiddleware } = require('../middleware/auth');
const { parseM3U } = require('../services/m3u-parser');
const { fetchXtreamChannels, verifyXtreamAccount } = require('../services/xtream-fetcher');
const { detectDuplicates } = require('../services/duplicate-detector');
const { recalculateSourcePriorities } = require('../services/health-checker');
const { schedulePublish } = require('../services/gist-publisher');

const router = express.Router();
router.use(authMiddleware);
router.use(csrfMiddleware);

const MAX_M3U_SIZE = 150 * 1024 * 1024; // 150MB

/** Normalises a client-supplied list of group names to unique, trimmed strings. */
function cleanGroupNames(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((g) => typeof g === 'string').map((g) => g.trim()).filter(Boolean))];
}

function parseVerifyInfo(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function parseExcluded(raw) {
  try { return cleanGroupNames(JSON.parse(raw || '[]')); } catch { return []; }
}

// ── GET /api/sources ───────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const sources = db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all()
    .map((src) => ({
      ...src,
      excluded_groups: parseExcluded(src.excluded_groups),
      verify_info: parseVerifyInfo(src.verify_info),
    }));
  res.json({ sources });
});

// ── POST /api/sources ──────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const {
    name, url, type = 'url',
    autoSync = 0, syncIntervalHours = 24, priority = 1, autoPriority = 1,
    xtreamHost = '', xtreamUser = '', xtreamPass = '',
  } = req.body;

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

  if (type === 'xtream') {
    if (!xtreamHost || !xtreamUser || !xtreamPass) {
      return res.status(400).json({ error: 'xtreamHost, xtreamUser and xtreamPass required for type=xtream.' });
    }
  }

  const result = db.prepare(`
    INSERT INTO sources (name, url, type, auto_sync, sync_interval_hours, priority, auto_priority, xtream_host, xtream_user, xtream_pass)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim().slice(0, 255),
    (url || '').trim().slice(0, 2048),
    type,
    autoSync ? 1 : 0,
    Math.max(1, parseInt(syncIntervalHours || '24', 10)),
    Number(priority) || 1,
    autoPriority ? 1 : 0,
    String(xtreamHost).trim().slice(0, 512),
    String(xtreamUser).trim().slice(0, 255),
    String(xtreamPass).trim().slice(0, 255)
  );

  // Recalculate priorities in case autoPriority is enabled
  recalculateSourcePriorities();

  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(source);
});

// ── PUT /api/sources/:id ───────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!source) return res.status(404).json({ error: 'Source not found.' });

  const { name, url, autoSync, syncIntervalHours, priority, autoPriority,
          xtreamHost, xtreamUser, xtreamPass, excludedGroups } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name required.' });
  }
  // Only touched when the client sends it, so older callers keep the current exclusions
  const excluded = Array.isArray(excludedGroups)
    ? JSON.stringify(cleanGroupNames(excludedGroups))
    : (source.excluded_groups || '[]');

  db.prepare(`
    UPDATE sources
    SET name = ?, url = ?, auto_sync = ?, sync_interval_hours = ?, priority = ?, auto_priority = ?,
        xtream_host = ?, xtream_user = ?, xtream_pass = ?, excluded_groups = ?
    WHERE id = ?
  `).run(
    name.trim().slice(0, 255),
    (url || '').trim().slice(0, 2048),
    autoSync ? 1 : 0,
    Math.max(1, parseInt(syncIntervalHours || '24', 10)),
    Number(priority) || 1,
    autoPriority ? 1 : 0,
    String(xtreamHost || source.xtream_host || '').trim().slice(0, 512),
    String(xtreamUser || source.xtream_user || '').trim().slice(0, 255),
    String(xtreamPass || source.xtream_pass || '').trim().slice(0, 255),
    excluded,
    id
  );

  // Recalculate priorities after updating a source's priority settings
  recalculateSourcePriorities();

  const updated = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  res.json({ ...updated, excluded_groups: parseExcluded(updated.excluded_groups), verify_info: parseVerifyInfo(updated.verify_info) });
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

/**
 * Light reachability check of an M3U URL: reads only the first bytes, no full download.
 * Resolves { ok, problem?, httpStatus?, latencyMs }.
 */
function probeM3U(urlStr, redirectsLeft = 5) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      resolve({ latencyMs: Date.now() - started, ...r });
    };
    let parsed;
    try { parsed = new URL(urlStr); } catch { return done({ ok: false, problem: 'URL inválida.' }); }
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(urlStr, { headers: { 'User-Agent': 'IPTV-Manager/1.0' } }, (res) => {
      const code = res.statusCode;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return done({ ok: false, problem: 'Demasiadas redirecciones.' });
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : new URL(loc, urlStr).toString();
        settled = true;
        return probeM3U(next, redirectsLeft - 1).then(resolve);
      }
      if (code !== 200) {
        res.resume();
        const hint = code === 401 || code === 403 ? ' (credenciales/token inválido, cuenta baneada o IP bloqueada)'
          : code === 404 ? ' (la lista ya no existe en esa URL)' : '';
        return done({ ok: false, httpStatus: code, problem: `El servidor respondió HTTP ${code}${hint}.` });
      }
      let head = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => {
        head += chunk;
        if (head.length >= 512) req.destroy();
      });
      const finish = () => {
        done(/^\s*#EXTM3U/i.test(head)
          ? { ok: true, httpStatus: 200 }
          : { ok: false, httpStatus: 200, problem: 'Respondió, pero el contenido no es una lista M3U (¿página de error o cuenta expirada?).' });
      };
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', () => {});
    });
    req.on('error', (e) => done({ ok: false, problem: `No se pudo conectar: ${e.message}` }));
    req.setTimeout(15000, () => { done({ ok: false, problem: 'Tiempo de espera agotado.' }); req.destroy(); });
  });
}

// ── POST /api/sources/:id/verify ───────────────────────────────────────────────
// Checks the connection/account of the source itself (not its channels).
router.post('/:id/verify', async (req, res) => {
  const id = Number(req.params.id);
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!source) return res.status(404).json({ error: 'Source not found.' });

  let result;
  try {
    if (source.type === 'xtream') {
      const started = Date.now();
      const r = await verifyXtreamAccount(source.xtream_host, source.xtream_user, source.xtream_pass);
      result = { type: 'xtream', latencyMs: Date.now() - started, ...r };
    } else if (source.type === 'url') {
      result = { type: 'url', ...(await probeM3U(source.url)) };
    } else {
      return res.status(400).json({ error: 'Las fuentes manuales no tienen conexión que verificar.' });
    }
  } catch (e) {
    result = { type: source.type, ok: false, problem: `No se pudo conectar con la fuente: ${e.message}` };
  }

  result.checkedAt = new Date().toISOString();
  db.prepare('UPDATE sources SET verify_info = ? WHERE id = ?').run(JSON.stringify(result), id);
  res.json(result);
});

// ── POST /api/sources/:id/sync ─────────────────────────────────────────────────
router.post('/:id/sync', async (req, res) => {
  const id = Number(req.params.id);
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!source) return res.status(404).json({ error: 'Source not found.' });

  let parsed;
  let epgUrls = [];

  if (source.type === 'xtream') {
    // ── Xtream Codes sync ────────────────────────────────────────────────────
    if (!source.xtream_host || !source.xtream_user || !source.xtream_pass) {
      return res.status(400).json({ error: 'Source is missing Xtream credentials.' });
    }
    try {
      const result = await fetchXtreamChannels(source.xtream_host, source.xtream_user, source.xtream_pass);
      parsed   = result.channels;
      epgUrls  = result.epgUrl ? [result.epgUrl] : [];
      db.prepare('UPDATE sources SET xtream_info = ? WHERE id = ?').run(JSON.stringify(result.account), id);
    } catch (err) {
      return res.status(502).json({ error: `Failed to fetch Xtream: ${err.message}` });
    }
  } else {
    // ── M3U URL sync ─────────────────────────────────────────────────────────
    if (!source.url) {
      return res.status(400).json({ error: 'Source has no URL to sync from.' });
    }
    let m3uText;
    try {
      m3uText = await fetchM3U(source.url);
    } catch (err) {
      return res.status(502).json({ error: `Failed to fetch M3U: ${err.message}` });
    }
    const result = parseM3U(m3uText);
    parsed  = result.channels;
    epgUrls = result.header.epgUrls;
  }

  // Import channels into DB
  const imported = importChannels(parsed, id, null, parseExcluded(source.excluded_groups));

  // Update source metadata
  db.prepare(`
    UPDATE sources SET last_synced_at = CURRENT_TIMESTAMP, channel_count = ?, epg_urls = ? WHERE id = ?
  `).run(imported.total, epgUrls.join('\n'), id);

  // Detect duplicates after import
  const allChannels = db.prepare('SELECT id, name, url, group_id, health_status FROM channels WHERE is_active = 1').all();
  const threshold = parseInt(
    (db.prepare("SELECT value FROM settings WHERE key = 'duplicate_threshold'").get() || {}).value || '80',
    10
  );
  const duplicateGroups = detectDuplicates(allChannels, threshold);

  // Recalculate priorities since channel counts / states might have changed
  recalculateSourcePriorities();
  schedulePublish();

  res.json({
    ok: true,
    imported: imported.created,
    updated: imported.updated,
    total: imported.total,
    duplicatesDetected: duplicateGroups.length,
    epgUrls,
  });
});

// ── POST /api/sources/preview ────────────────────────────────────────────────
// Stateless preview: parse source, detect duplicates, return channel list.
// No DB writes.
router.post('/preview', async (req, res) => {
  const { type, url, text, xtreamHost, xtreamUser, xtreamPass } = req.body;

  if (!['url', 'text', 'xtream'].includes(type)) {
    return res.status(400).json({ error: 'type must be url, text, or xtream.' });
  }

  let rawChannels = [];

  try {
    if (type === 'url') {
      if (!url) return res.status(400).json({ error: 'url required.' });
      const m3uText = await fetchM3U(url);
      rawChannels = parseM3U(m3uText).channels;
    } else if (type === 'text') {
      if (!text || text.length > MAX_M3U_SIZE) return res.status(400).json({ error: 'text required (max 10MB).' });
      rawChannels = parseM3U(text).channels;
    } else {
      if (!xtreamHost || !xtreamUser || !xtreamPass) {
        return res.status(400).json({ error: 'xtreamHost, xtreamUser and xtreamPass required.' });
      }
      const result = await fetchXtreamChannels(xtreamHost, xtreamUser, xtreamPass);
      rawChannels = result.channels;
    }
  } catch (err) {
    return res.status(502).json({ error: `Failed to fetch source: ${err.message}` });
  }

  // ─ Step 1: detect internal duplicates (exact URL match) ──────────────────────
  const seenUrls = new Set();
  let internalDuplicateCount = 0;
  const annotated = rawChannels.map((ch) => {
    const isInternal = seenUrls.has(ch.url);
    if (!isInternal) seenUrls.add(ch.url);
    else internalDuplicateCount++;
    return { ...ch, isDuplicate: false, isInternalDuplicate: isInternal };
  });

  // ─ Step 2: batch-check against DB (only non-internal channels) ─────────────
  const uniqueUrls = [...seenUrls]; // URLs seen (first occurrence only)
  const dbExisting = checkDbDuplicates(uniqueUrls);
  let dbDuplicateCount = 0;

  const channels = annotated.map((ch) => {
    const isDb = !ch.isInternalDuplicate && dbExisting.has(ch.url);
    if (isDb) dbDuplicateCount++;
    return { ...ch, isDuplicate: isDb };
  });

  // ─ Step 3: extract sorted unique groups ───────────────────────────────
  const groups = [...new Set(channels.map((c) => c.groupTitle).filter(Boolean))].sort();

  res.json({
    channels,
    groups,
    total: channels.length,
    dbDuplicateCount,
    internalDuplicateCount,
  });
});

// ── POST /api/sources/import-url ──────────────────────────────────────────────
// Fetch M3U from URL, create source, import selected channels.
router.post('/import-url', async (req, res) => {
  const { name, url, selectedUrls, excludedGroups,
          autoSync = 0, syncIntervalHours = 24, priority = 1, autoPriority = 1 } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name required.' });
  }
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url required.' });
  }
  try { new URL(url.trim()); } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  const excluded = cleanGroupNames(excludedGroups);

  let m3uText;
  try {
    m3uText = await fetchM3U(url.trim());
  } catch (err) {
    return res.status(502).json({ error: `Failed to fetch M3U: ${err.message}` });
  }

  const { header, channels: parsed } = parseM3U(m3uText);
  const urlSet = Array.isArray(selectedUrls) && selectedUrls.length > 0
    ? new Set(selectedUrls)
    : null;

  const sourceResult = db.prepare(`
    INSERT INTO sources (name, url, type, last_synced_at, auto_sync, sync_interval_hours, priority, auto_priority, excluded_groups)
    VALUES (?, ?, 'url', CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
  `).run(
    name.trim().slice(0, 255),
    url.trim().slice(0, 2048),
    autoSync ? 1 : 0,
    Math.max(1, parseInt(syncIntervalHours || '24', 10)),
    Number(priority) || 1,
    autoPriority ? 1 : 0,
    JSON.stringify(excluded)
  );

  const sourceId = sourceResult.lastInsertRowid;
  const imported = importChannels(parsed, sourceId, urlSet, excluded);

  db.prepare('UPDATE sources SET channel_count = ?, epg_urls = ? WHERE id = ?').run(imported.total, header.epgUrls.join('\n'), sourceId);
  recalculateSourcePriorities();

  res.status(201).json({
    ok: true,
    sourceId,
    imported: imported.created,
    updated: imported.updated,
    skipped: imported.skipped,
    total: parsed.length,
    epgUrls: header.epgUrls,
  });
});

// ── POST /api/sources/import-xtream ──────────────────────────────────────────
// One-shot Xtream import: creates source + fetches channels immediately
router.post('/import-xtream', async (req, res) => {
  const { name = 'Xtream Import', xtreamHost, xtreamUser, xtreamPass,
          selectedUrls, excludedGroups,
          autoSync = 0, syncIntervalHours = 24, priority = 1, autoPriority = 1 } = req.body;

  if (!xtreamHost || !xtreamUser || !xtreamPass) {
    return res.status(400).json({ error: 'xtreamHost, xtreamUser and xtreamPass are required.' });
  }

  let channels, epgUrl, account;
  try {
    const result = await fetchXtreamChannels(xtreamHost, xtreamUser, xtreamPass);
    channels = result.channels;
    epgUrl   = result.epgUrl;
    account  = result.account;
  } catch (err) {
    return res.status(502).json({ error: `Failed to connect to Xtream: ${err.message}` });
  }

  const urlSet = Array.isArray(selectedUrls) && selectedUrls.length > 0
    ? new Set(selectedUrls)
    : null;
  const excluded = cleanGroupNames(excludedGroups);

  // Create source
  const sourceResult = db.prepare(`
    INSERT INTO sources (name, url, type, last_synced_at, auto_sync, sync_interval_hours, priority, auto_priority, xtream_host, xtream_user, xtream_pass, excluded_groups)
    VALUES (?, '', 'xtream', CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(name).trim().slice(0, 255),
    autoSync ? 1 : 0,
    Math.max(1, parseInt(syncIntervalHours || '24', 10)),
    Number(priority) || 1,
    autoPriority ? 1 : 0,
    String(xtreamHost).trim().slice(0, 512),
    String(xtreamUser).trim().slice(0, 255),
    String(xtreamPass).trim().slice(0, 255),
    JSON.stringify(excluded)
  );

  const sourceId = sourceResult.lastInsertRowid;
  const imported = importChannels(channels, sourceId, urlSet, excluded);

  db.prepare('UPDATE sources SET channel_count = ?, xtream_info = ?, epg_urls = ? WHERE id = ?').run(imported.total, JSON.stringify(account), epgUrl || '', sourceId);
  recalculateSourcePriorities();

  res.json({
    ok: true,
    sourceId,
    imported: imported.created,
    updated: imported.updated,
    skipped: imported.skipped,
    total: channels.length,
    epgUrl,
  });
});

// ── POST /api/sources/import-text ─────────────────────────────────────────────
// Import M3U from pasted text (no URL)
router.post('/import-text', (req, res) => {
  const { text, sourceName = 'Manual Import', selectedUrls, excludedGroups } = req.body;

  if (!text || typeof text !== 'string' || text.length > MAX_M3U_SIZE) {
    return res.status(400).json({ error: 'M3U text required (max 10MB).' });
  }

  const urlSet = Array.isArray(selectedUrls) && selectedUrls.length > 0
    ? new Set(selectedUrls)
    : null;

  const excluded = cleanGroupNames(excludedGroups);

  // Create a "manual" source
  const sourceResult = db.prepare(`
    INSERT INTO sources (name, url, type, last_synced_at, excluded_groups)
    VALUES (?, '', 'manual', CURRENT_TIMESTAMP, ?)
  `).run(String(sourceName).trim().slice(0, 255), JSON.stringify(excluded));

  const sourceId = sourceResult.lastInsertRowid;
  const { header, channels: parsed } = parseM3U(text);
  const imported = importChannels(parsed, sourceId, urlSet, excluded);

  db.prepare('UPDATE sources SET channel_count = ?, epg_urls = ? WHERE id = ?').run(imported.total, header.epgUrls.join('\n'), sourceId);

  // Recalculate priorities since channels were added
  recalculateSourcePriorities();

  res.json({
    ok: true,
    sourceId,
    imported: imported.created,
    updated: imported.updated,
    skipped: imported.skipped,
    total: parsed.length,
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
 * Batch-check a list of URLs against the channels table.
 * Splits into batches of 999 to respect SQLite's variable limit.
 * Returns a Set<string> of URLs that already exist in the DB.
 */
const DB_BATCH = 999;
function checkDbDuplicates(urls) {
  const existing = new Set();
  if (!urls || urls.length === 0) return existing;
  for (let i = 0; i < urls.length; i += DB_BATCH) {
    const batch = urls.slice(i, i + DB_BATCH);
    const placeholders = batch.map(() => '?').join(',');
    db.prepare(`SELECT url FROM channels WHERE url IN (${placeholders})`)
      .all(...batch)
      .forEach((r) => existing.add(r.url));
  }
  return existing;
}

/**
 * Import parsed channels into the DB, creating groups as needed.
 * @param {Array}    parsed   - channel objects from parseM3U / fetchXtreamChannels
 * @param {number}   sourceId - source row id
 * @param {Set|null} urlSet   - if provided, only channels whose url is in this Set are imported
 * @param {string[]} excludedGroups - group names whose channels are never imported (per-source blacklist)
 * Returns { created, updated, skipped, total }.
 */
const findByUrlStmt = db.prepare('SELECT id FROM channels WHERE url = ? AND source_id = ?');
const findOrphanByUrlStmt = db.prepare('SELECT id FROM channels WHERE url = ? AND source_id IS NULL');

function importChannels(parsed, sourceId, urlSet, excludedGroups = []) {
  const excludedSet = new Set(excludedGroups);
  const toImport = parsed.filter((ch) =>
    (!urlSet || urlSet.has(ch.url)) && !(ch.groupTitle && excludedSet.has(ch.groupTitle))
  );

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
      // Same URL in another source is a separate channel (each source is published on its own);
      // channels without a source (orphans) are adopted.
      const existing = findByUrlStmt.get(ch.url, sourceId) || findOrphanByUrlStmt.get(ch.url);
      if (existing) {
        db.prepare(`
          UPDATE channels SET
            source_id = ?, name = ?, tvg_id = ?, tvg_name = ?, tvg_logo = ?,
            group_id = ?, catchup = ?, catchup_source = ?, catchup_days = ?,
            http_user_agent = ?, referrer = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          sourceId, ch.name, ch.tvgId, ch.tvgName, ch.tvgLogo,
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

  importTx(toImport);
  const skipped = parsed.length - toImport.length;
  return { created, updated, skipped, total: created + updated };
}

module.exports = router;

