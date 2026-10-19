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

// A "scope" is a source id, or "none" for channels without a source.
function parseScope(value) {
  if (value === 'none') return { id: null };
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return db.prepare('SELECT id FROM sources WHERE id = ?').get(id) ? { id } : null;
}

const escapeAttr = (str) => String(str).replace(/"/g, '&quot;');

const scopeChannelsSql = `
  SELECT c.name, c.url, c.tvg_id, c.tvg_name, c.tvg_logo,
         c.catchup, c.catchup_source, c.catchup_days,
         c.http_user_agent, c.referrer, g.name AS group_name
  FROM channels c
  LEFT JOIN groups g ON c.group_id = g.id
  WHERE c.is_active = 1 AND c.source_id %S
  ORDER BY COALESCE(g.sort_order, 9999), g.name COLLATE NOCASE, c.sort_order, c.name COLLATE NOCASE
`;
const channelsBySourceStmt = db.prepare(scopeChannelsSql.replace('%S', '= ?'));
const channelsNoSourceStmt = db.prepare(scopeChannelsSql.replace('%S', 'IS NULL'));

/** Plain M3U of ONE source (no alternatives merging), so it stays small and fast to render. */
function generateScopeM3U(scope) {
  const epgRow = db.prepare("SELECT value FROM settings WHERE key = 'epg_urls'").get();
  const epg = ((epgRow && epgRow.value) || '').split(/[\n,]+/).map((u) => u.trim()).filter(Boolean);
  const lines = [`#EXTM3U${epg.length ? ` x-tvg-url="${epg.join(',')}"` : ''}`, ''];
  const rows = scope.id === null ? channelsNoSourceStmt.all() : channelsBySourceStmt.all(scope.id);
  for (const ch of rows) {
    const attrs = [];
    if (ch.tvg_id) attrs.push(`tvg-id="${escapeAttr(ch.tvg_id)}"`);
    attrs.push(`tvg-name="${escapeAttr(ch.tvg_name || ch.name)}"`);
    if (ch.tvg_logo) attrs.push(`tvg-logo="${escapeAttr(ch.tvg_logo)}"`);
    if (ch.group_name) attrs.push(`group-title="${escapeAttr(ch.group_name)}"`);
    if (ch.catchup) attrs.push(`catchup="${escapeAttr(ch.catchup)}"`);
    if (ch.catchup_source) attrs.push(`catchup-source="${escapeAttr(ch.catchup_source)}"`);
    if (ch.catchup_days > 0) attrs.push(`catchup-days="${ch.catchup_days}"`);
    if (ch.http_user_agent) attrs.push(`http-user-agent="${escapeAttr(ch.http_user_agent)}"`);
    lines.push(`#EXTINF:-1 ${attrs.join(' ')},${ch.name}`);
    if (ch.http_user_agent) lines.push(`#EXTVLCOPT:http-user-agent=${ch.http_user_agent}`);
    if (ch.referrer) lines.push(`#EXTVLCOPT:http-referrer=${ch.referrer}`);
    lines.push(ch.url, '');
  }
  return lines.join('\n');
}

// ── GET /api/raw/sources ───────────────────────────────────────────────────────
// Tabs for the editor: every source with its active channel count (+ orphan channels)
router.get('/sources', (_req, res) => {
  const sources = db.prepare(`
    SELECT s.id, s.name, s.type,
           (SELECT COUNT(*) FROM channels c WHERE c.source_id = s.id AND c.is_active = 1) AS channelCount
    FROM sources s ORDER BY s.priority, s.name COLLATE NOCASE
  `).all();
  const orphans = db.prepare('SELECT COUNT(*) AS c FROM channels WHERE source_id IS NULL AND is_active = 1').get().c;
  res.json({ sources, orphans });
});

// ── GET /api/raw/preview?source=<id|none> ──────────────────────────────────────
// One source as plain text. Without `source` the merged playlist is returned (slow on big libraries).
router.get('/preview', (req, res) => {
  let m3u;
  if (req.query.source === undefined) {
    m3u = generateM3U();
  } else {
    const scope = parseScope(String(req.query.source));
    if (!scope) return res.status(404).json({ error: 'Source not found.' });
    m3u = generateScopeM3U(scope);
  }
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(m3u);
});

// ── PUT /api/raw/apply?source=<id|none> ────────────────────────────────────────
// Parse edited M3U text and sync changes back to the DB, limited to that source
router.put('/apply', (req, res) => {
  const { text } = req.body;
  const scope = parseScope(String(req.query.source));
  if (!scope) return res.status(400).json({ error: 'Valid source required.' });

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

  void header; // EPG is global; a per-source edit must not overwrite it
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
    const allActive = scope.id === null
      ? db.prepare('SELECT id, url FROM channels WHERE is_active = 1 AND source_id IS NULL').all()
      : db.prepare('SELECT id, url FROM channels WHERE is_active = 1 AND source_id = ?').all(scope.id);
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
      const existing = scope.id === null
        ? db.prepare('SELECT id FROM channels WHERE url = ? AND source_id IS NULL').get(ch.url)
        : db.prepare('SELECT id FROM channels WHERE url = ? AND source_id = ?').get(ch.url, scope.id);

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
             catchup, catchup_source, catchup_days, http_user_agent, referrer, source_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          ch.name, ch.url, ch.tvgId, ch.tvgName, ch.tvgLogo,
          groupId, ++orderBase,
          ch.catchup, ch.catchupSource, ch.catchupDays,
          ch.httpUserAgent, ch.referrer, scope.id
        );
      }
    }
  });

  syncTx();

  const total = db.prepare('SELECT COUNT(*) AS c FROM channels WHERE is_active = 1').get().c;
  res.json({ ok: true, activeChannels: total, sourceChannels: parsed.length });
});

module.exports = router;
