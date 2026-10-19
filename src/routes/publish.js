'use strict';

const express = require('express');
const db = require('../db/database');
const { authMiddleware, csrfMiddleware } = require('../middleware/auth');
const { generateSourceM3U, generateEmptyM3U, slotWarnings } = require('../services/slot-generator');
const publisher = require('../services/gist-publisher');

const router = express.Router();
router.use(authMiddleware);
router.use(csrfMiddleware);

const getSetting = (key) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) || {}).value || '';

function toIso(t) {
  return t ? new Date(String(t).replace(' ', 'T') + 'Z').toISOString() : null;
}

function respondError(res, err) {
  console.error('[Publish]', err.message);
  res.status(502).json({ error: err.message });
}

// ── GET /api/publish/slots ─────────────────────────────────────────────────────
router.get('/slots', async (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, s.name AS source_name, s.type AS source_type, s.xtream_info, s.xtream_host
    FROM publish_slots p LEFT JOIN sources s ON s.id = p.source_id
    ORDER BY p.slot
  `).all();

  const gistId = getSetting('publish_gist_id');
  let urls = {};
  if (gistId) {
    try {
      for (const r of rows) urls[r.slot] = await publisher.slotUrl(r.slot);
    } catch { /* gh unavailable: URLs omitted */ }
  }

  res.json({
    gistId: gistId || null,
    auto: getSetting('publish_auto') === '1',
    publishing: publisher.isPublishing(),
    slots: rows.map((r) => {
      let pending = false;
      try {
        const gen = r.source_id ? generateSourceM3U(r.source_id, r.slot) : generateEmptyM3U(r.slot);
        pending = gen.hash !== r.content_hash;
      } catch { /* reported via lastError */ }
      return {
        slot: r.slot,
        sourceId: r.source_id,
        sourceName: r.source_name,
        sourceType: r.source_type,
        assignedAt: toIso(r.assigned_at),
        publishedAt: toIso(r.published_at),
        channelCount: r.channel_count,
        deadExcluded: r.dead_excluded,
        lastError: r.last_error,
        pending,
        warnings: r.source_id ? slotWarnings({ type: r.source_type, xtream_info: r.xtream_info }, r) : [],
        url: urls[r.slot] || null,
      };
    }),
  });
});

// ── PUT /api/publish/slots/:n  { sourceId: number | null } ─────────────────────
// Assign, replace or free a slot. The previous assignment is kept in history.
router.put('/slots/:n', async (req, res) => {
  const slot = Number(req.params.n);
  const row = db.prepare('SELECT * FROM publish_slots WHERE slot = ?').get(slot);
  if (!row) return res.status(404).json({ error: 'Slot not found.' });

  const { sourceId } = req.body || {};
  let source = null;
  if (sourceId !== null && sourceId !== undefined) {
    source = db.prepare('SELECT id, name FROM sources WHERE id = ?').get(Number(sourceId));
    if (!source) return res.status(404).json({ error: 'Source not found.' });
    const other = db.prepare('SELECT slot FROM publish_slots WHERE source_id = ? AND slot != ?').get(source.id, slot);
    if (other) return res.status(409).json({ error: `Source is already assigned to slot ${other.slot}.` });
  }
  if ((row.source_id || null) === (source ? source.id : null)) return res.json({ ok: true });

  db.transaction(() => {
    if (row.source_id) {
      const prev = db.prepare('SELECT name FROM sources WHERE id = ?').get(row.source_id);
      db.prepare('INSERT INTO publish_slot_history (slot, source_id, source_name, assigned_at) VALUES (?, ?, ?, ?)')
        .run(slot, row.source_id, prev ? prev.name : null, row.assigned_at);
    }
    db.prepare(`
      UPDATE publish_slots SET source_id = ?, assigned_at = ?, content_hash = NULL, last_error = NULL,
        channel_count = 0, dead_excluded = 0 WHERE slot = ?
    `).run(source ? source.id : null, source ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null, slot);
  })();

  // Changing a slot is an explicit action: publish it now (once a gist exists), regardless of auto-publish.
  if (!getSetting('publish_gist_id')) return res.json({ ok: true, published: false });
  try {
    await publisher.publish([slot], { force: true });
    res.json({ ok: true, published: true });
  } catch (e) {
    res.json({ ok: true, published: false, publishError: e.message });
  }
});

// ── GET /api/publish/history ───────────────────────────────────────────────────
router.get('/history', (req, res) => {
  res.json(db.prepare('SELECT * FROM publish_slot_history ORDER BY id DESC LIMIT 200').all());
});

// ── POST /api/publish  (all pending slots) ─────────────────────────────────────
router.post('/', async (req, res) => {
  try { res.json({ ok: true, ...(await publisher.publish()) }); } catch (e) { respondError(res, e); }
});

// ── POST /api/publish/validate  (refresh Xtream account info of assigned sources)
router.post('/validate', async (req, res) => {
  try { await publisher.refreshXtreamInfo(); res.json({ ok: true }); } catch (e) { respondError(res, e); }
});

// ── POST /api/publish/rotate ───────────────────────────────────────────────────
router.post('/rotate', async (req, res) => {
  try { res.json({ ok: true, ...(await publisher.rotate()) }); } catch (e) { respondError(res, e); }
});

// ── POST /api/publish/:n ───────────────────────────────────────────────────────
router.post('/:n', async (req, res) => {
  const slot = Number(req.params.n);
  if (!db.prepare('SELECT 1 FROM publish_slots WHERE slot = ?').get(slot)) {
    return res.status(404).json({ error: 'Slot not found.' });
  }
  try { res.json({ ok: true, ...(await publisher.publish([slot], { force: true })) }); } catch (e) { respondError(res, e); }
});

// ── GET /api/publish/preview/:n ────────────────────────────────────────────────
router.get('/preview/:n', (req, res) => {
  const slot = Number(req.params.n);
  const row = db.prepare('SELECT * FROM publish_slots WHERE slot = ?').get(slot);
  if (!row) return res.status(404).json({ error: 'Slot not found.' });
  try {
    const gen = row.source_id ? generateSourceM3U(row.source_id, slot) : generateEmptyM3U(slot);
    res.json({
      pending: gen.hash !== row.content_hash,
      channelCount: gen.channelCount,
      deadExcluded: gen.deadExcluded,
      previousChannelCount: row.channel_count,
      sample: gen.content.split('\n').slice(0, 40).join('\n'),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
