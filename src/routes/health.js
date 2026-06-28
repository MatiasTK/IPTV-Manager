'use strict';

const express = require('express');
const db = require('../db/database');
const { authMiddleware, csrfMiddleware } = require('../middleware/auth');
const { runHealthCheck, checkSingleChannel, autoSwitchLog } = require('../services/health-checker');

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

  const summary = { healthy: 0, degraded: 0, down: 0, unknown: 0, total: 0 };
  for (const row of counts) {
    const key = row.health_status || 'unknown';
    summary[key] = (summary[key] || 0) + row.count;
    summary.total += row.count;
  }

  res.json({ summary, autoSwitchLog: autoSwitchLog.slice(0, 20) });
});

// ── GET /api/health/channels ───────────────────────────────────────────────────
router.get('/channels', (req, res) => {
  const channels = db.prepare(`
    SELECT
      c.id, c.name, c.url, c.health_status, c.health_latency_ms, c.last_health_check,
      g.name AS group_name,
      (SELECT COUNT(*) FROM channel_alternatives ca WHERE ca.primary_channel_id = c.id) AS alt_count
    FROM channels c
    LEFT JOIN groups g ON c.group_id = g.id
    WHERE c.is_active = 1
    ORDER BY
      CASE c.health_status
        WHEN 'down'     THEN 0
        WHEN 'degraded' THEN 1
        WHEN 'unknown'  THEN 2
        WHEN 'healthy'  THEN 3
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
  // Fire and forget — respond immediately
  res.json({ ok: true, message: 'Health check started.' });
  try {
    await runHealthCheck();
  } catch (err) {
    console.error('[Health] check-now error:', err.message);
  }
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
