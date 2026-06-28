'use strict';

const express = require('express');
const db = require('../db/database');
const { authMiddleware, csrfMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(csrfMiddleware);

// ── GET /api/groups ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const groups = db.prepare(`
    SELECT g.*, COUNT(c.id) AS channel_count
    FROM groups g
    LEFT JOIN channels c ON c.group_id = g.id
    GROUP BY g.id
    ORDER BY g.sort_order, g.name
  `).all();
  res.json({ groups });
});

// ── POST /api/groups ───────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name required.' });
  }
  const cleanName = name.trim().slice(0, 128);
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM groups').get().m;

  try {
    const result = db.prepare('INSERT INTO groups (name, sort_order) VALUES (?, ?)').run(cleanName, maxOrder + 1);
    res.status(201).json(db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Group name already exists.' });
  }
});

// ── PUT /api/groups/:id ────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name required.' });
  }
  const existing = db.prepare('SELECT id FROM groups WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Group not found.' });

  try {
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name.trim().slice(0, 128), id);
    res.json(db.prepare('SELECT * FROM groups WHERE id = ?').get(id));
  } catch {
    res.status(409).json({ error: 'Group name already exists.' });
  }
});

// ── DELETE /api/groups/:id ─────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM groups WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Group not found.' });

  // Channels with this group will have group_id = NULL (ON DELETE SET NULL)
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── PATCH /api/groups/reorder ─────────────────────────────────────────────────
router.patch('/reorder', (req, res) => {
  const { order } = req.body; // [{ id, sort_order }]
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required.' });

  const update = db.prepare('UPDATE groups SET sort_order = ? WHERE id = ?');
  const transaction = db.transaction((items) => {
    for (const item of items) update.run(Number(item.sort_order), Number(item.id));
  });
  transaction(order);
  res.json({ ok: true });
});

// ── POST /api/groups/find-or-create ───────────────────────────────────────────
// Used internally during M3U import
router.post('/find-or-create', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required.' });
  const cleanName = name.trim().slice(0, 128);
  let group = db.prepare('SELECT * FROM groups WHERE name = ?').get(cleanName);
  if (!group) {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM groups').get().m;
    const r = db.prepare('INSERT OR IGNORE INTO groups (name, sort_order) VALUES (?, ?)').run(cleanName, maxOrder + 1);
    group = db.prepare('SELECT * FROM groups WHERE id = ?').get(r.lastInsertRowid) ||
            db.prepare('SELECT * FROM groups WHERE name = ?').get(cleanName);
  }
  res.json(group);
});

module.exports = router;
