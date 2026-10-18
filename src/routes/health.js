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
router.get('/status', (req, res) => {
  const counts = db.prepare(`
    SELECT health_status, COUNT(*) AS count
    FROM channels
    WHERE is_active = 1
    GROUP BY health_status
  `).all();

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
    autoSwitchLog: autoSwitchLog.slice(0, 20),
    isChecking: isCheckRunning(),
    progress: getProgress(),
    checkingSourceId: getCurrentSourceId(),
    lastCheckAt,
    nextCheckAt: getNextRunAt(),
    intervalMinutes: Math.round(getIntervalMs() / 60000),
  });
});

// ── GET /api/health/channels ───────────────────────────────────────────────────
router.get('/channels', (req, res) => {
  const channels = db.prepare(`
    SELECT
      c.id, c.name, c.url, c.source_id, c.health_status, c.health_latency_ms, c.last_health_check,
      g.name AS group_name,
      s.name AS source_name,
      (SELECT COUNT(*) FROM channel_alternatives ca WHERE ca.primary_channel_id = c.id) AS alt_count
    FROM channels c
    LEFT JOIN groups g ON c.group_id = g.id
    LEFT JOIN sources s ON c.source_id = s.id
    WHERE c.is_active = 1
    ORDER BY
      CASE c.health_status
        WHEN 'down'         THEN 0
        WHEN 'intermittent' THEN 1
        WHEN 'degraded'     THEN 2
        WHEN 'unknown'      THEN 3
        WHEN 'healthy'      THEN 4
      END,
      c.health_latency_ms DESC
  `).all();

  res.json({ channels });
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
