'use strict';

const express = require('express');
const db = require('../db/database');
const { authMiddleware, csrfMiddleware } = require('../middleware/auth');
const {
  runHealthCheck, checkSingleChannel, isCheckRunning, autoSwitchLog,
  requestCancel, getProgress, getNextRunAt, getIntervalMs, getCurrentSourceId,
} = require('../services/health-checker');

const router = express.Router();
router.use(authMiddleware);
router.use(csrfMiddleware);

// ── GET /api/health/status ─────────────────────────────────────────────────────
// `source` = id | 'none' scopes the summary to one source
function sourceClause(value) {
  if (value === undefined || value === '' || value === 'all') return { sql: '', params: [] };
  if (value === 'none') return { sql: ' AND c.source_id IS NULL', params: [] };
  const id = Number(value);
  return Number.isInteger(id) ? { sql: ' AND c.source_id = ?', params: [id] } : { sql: '', params: [] };
}

router.get('/status', (req, res) => {
  const scope = sourceClause(req.query.source);
  const counts = db.prepare(`
    SELECT c.health_status, COUNT(*) AS count
    FROM channels c
    WHERE c.is_active = 1${scope.sql}
    GROUP BY c.health_status
  `).all(...scope.params);

  const sources = db.prepare(`
    SELECT s.id, s.name,
           COUNT(c.id) AS total,
           SUM(CASE WHEN c.health_status = 'down' THEN 1 ELSE 0 END) AS down
    FROM sources s
    LEFT JOIN channels c ON c.source_id = s.id AND c.is_active = 1
    GROUP BY s.id
    ORDER BY s.priority, s.name COLLATE NOCASE
  `).all().map((r) => ({ ...r, down: r.down || 0 }));

  const summary = { healthy: 0, degraded: 0, intermittent: 0, down: 0, unknown: 0, total: 0 };
  for (const row of counts) {
    const key = row.health_status || 'unknown';
    summary[key] = (summary[key] || 0) + row.count;
    summary.total += row.count;
  }

  const last = db.prepare('SELECT MAX(last_health_check) AS t FROM channels WHERE is_active = 1').get();
  // SQLite guarda "YYYY-MM-DD HH:MM:SS" en UTC; se normaliza a ISO
  const lastCheckAt = last && last.t ? new Date(String(last.t).replace(' ', 'T') + 'Z').toISOString() : null;

  res.json({
    summary,
    sources,
    autoSwitchLog: autoSwitchLog.slice(0, 20),
    isChecking: isCheckRunning(),
    progress: getProgress(),
    checkingSourceId: getCurrentSourceId(),
    lastCheckAt,
    nextCheckAt: getNextRunAt(),
    intervalMinutes: Math.round(getIntervalMs() / 60000),
  });
});

// ── GET /api/health/breakdown ──────────────────────────────────────────────────
// Health totals aggregated per source and per group (no per-channel payload)
router.get('/breakdown', (_req, res) => {
  const agg = `
    COUNT(*) AS total,
    SUM(CASE WHEN c.health_status = 'healthy' THEN 1 ELSE 0 END) AS ok,
    SUM(CASE WHEN c.health_status IN ('degraded', 'intermittent') THEN 1 ELSE 0 END) AS deg,
    SUM(CASE WHEN c.health_status = 'down' THEN 1 ELSE 0 END) AS down`;
  const bySource = db.prepare(`
    SELECT c.source_id AS id, ${agg} FROM channels c
    WHERE c.is_active = 1 AND c.source_id IS NOT NULL GROUP BY c.source_id
  `).all();
  const byGroup = db.prepare(`
    SELECT g.name AS name, ${agg} FROM channels c JOIN groups g ON c.group_id = g.id
    WHERE c.is_active = 1 GROUP BY g.id
  `).all();
  res.json({ bySource, byGroup });
});

// ── GET /api/health/channels ───────────────────────────────────────────────────
// Paged + filtered server side (a library can have 100k channels).
// Query: source (id|none|all), status, q, limit (default 100), offset
const HEALTH_STATUSES = ['healthy', 'degraded', 'intermittent', 'down', 'unknown'];

router.get('/channels', (req, res) => {
  const scope = sourceClause(req.query.source);
  let where = `c.is_active = 1${scope.sql}`;
  const params = [...scope.params];

  if (HEALTH_STATUSES.includes(req.query.status)) {
    where += ' AND c.health_status = ?';
    params.push(req.query.status);
  }
  const q = String(req.query.q || '').trim();
  if (q) {
    where += ' AND c.name LIKE ?';
    params.push(`%${q}%`);
  }

  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '100', 10) || 100));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM channels c WHERE ${where}`).get(...params).n;
  const channels = db.prepare(`
    SELECT
      c.id, c.name, c.url, c.source_id, c.health_status, c.health_latency_ms, c.last_health_check,
      g.name AS group_name,
      s.name AS source_name,
      (SELECT COUNT(*) FROM channel_alternatives ca WHERE ca.primary_channel_id = c.id) AS alt_count
    FROM channels c
    LEFT JOIN groups g ON c.group_id = g.id
    LEFT JOIN sources s ON c.source_id = s.id
    WHERE ${where}
    ORDER BY
      CASE c.health_status
        WHEN 'down'         THEN 0
        WHEN 'intermittent' THEN 1
        WHEN 'degraded'     THEN 2
        WHEN 'unknown'      THEN 3
        WHEN 'healthy'      THEN 4
      END,
      c.health_latency_ms DESC,
      c.id
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ channels, total, offset, limit });
});

// ── GET /api/health/channels/:id/history ──────────────────────────────────────
router.get('/channels/:id/history', (req, res) => {
  const id = Number(req.params.id);
  const history = db.prepare(`
    SELECT id, status, latency_ms, http_status, error_message, checked_at
    FROM health_checks
    WHERE channel_id = ?
    ORDER BY checked_at DESC
    LIMIT 100
  `).all(id);

  res.json({ history });
});

// ── POST /api/health/check-now ─────────────────────────────────────────────────
router.post('/check-now', async (req, res) => {
  // Body opcional: { sourceId } verifica solo los canales de esa fuente
  let sourceId = null;
  if (req.body && req.body.sourceId !== undefined && req.body.sourceId !== null) {
    sourceId = Number(req.body.sourceId);
    if (!Number.isInteger(sourceId) || !db.prepare('SELECT 1 FROM sources WHERE id = ?').get(sourceId)) {
      return res.status(404).json({ error: 'Source not found.' });
    }
  }
  if (isCheckRunning()) {
    return res.status(409).json({ error: 'Ya hay una verificación en curso.' });
  }

  // Fire and forget — respond immediately
  res.json({ ok: true, message: 'Health check started.' });
  try {
    await runHealthCheck(true, sourceId);
  } catch (err) {
    console.error('[Health] check-now error:', err.message);
  }
});

// ── POST /api/health/cancel ────────────────────────────────────────────────────
router.post('/cancel', (req, res) => {
  res.json({ ok: true, wasRunning: requestCancel() });
});

// ── POST /api/health/check/:id ─────────────────────────────────────────────────
router.post('/check/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await checkSingleChannel(id);
    if (!result) return res.status(404).json({ error: 'Channel not found.' });
    res.json({ channel: result.channel, result: result.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/health/switch-log ─────────────────────────────────────────────────
router.get('/switch-log', (req, res) => {
  res.json({ log: autoSwitchLog });
});

module.exports = router;
