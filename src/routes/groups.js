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

// ── POST /api/groups/delete-empty ──────────────────────────────────────────────
router.post('/delete-empty', (req, res) => {
  const result = db.prepare(`
    DELETE FROM groups
    WHERE id NOT IN (
      SELECT DISTINCT group_id FROM channels WHERE group_id IS NOT NULL
    )
  `).run();
  res.json({ ok: true, deletedCount: result.changes });
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

// ── GET /api/groups/auto-suggest ──────────────────────────────────────────────
router.get('/auto-suggest', (req, res) => {
  const channels = db.prepare(`
    SELECT id, name, url, tvg_name FROM channels WHERE group_id IS NULL AND is_active = 1
  `).all();

  const RULES = [
    {
      name: 'Deportes',
      pattern: /deport|sport|espn|fox\s*sport|tyc|dsport|depor|directv|laliga|premiere|motogp|f1|ufc|garage|turbo|golf|nba|nfl/i
    },
    {
      name: 'Infantiles',
      pattern: /cartoon|kids|disney|junior|baby|nick|paka|adult\s*swim|toon|boomerang|gloob|clan|discovery\s*kids/i
    },
    {
      name: 'Noticias',
      pattern: /noticia|news|26tv|a24|c5n|cn23|cnn|cronica|ip\b|nacion|tn\b|telesur|dw\b|france\s*24|rt\s*en|bloomberg/i
    },
    {
      name: 'Cine y Series',
      pattern: /cine|movie|hbo|star|space|tnt|warner|axn|amc|fx\b|universal|mgm|paramount|studio|cinemax|golden|multiplex|a&e|comedy|lifetime/i
    },
    {
      name: 'Documentales',
      pattern: /animal|discovery|history|science|world|encuentro|geo\b|nat\s*geo|odisea|viajar|h&h|hgtv/i
    },
    {
      name: 'Música',
      pattern: /music|htv|cm\b|quiero|mtv|allegro|vh1|urban/i
    },
    {
      name: 'Religión',
      pattern: /enlace|ewtn|remanso|nuevo\s*tiempo|adventista|fe\b|cristiano|oracion/i
    },
    {
      name: 'Nacionales y Variedades',
      pattern: /trece|nueve|telefe|america|publica|ciudad|rural|volver|magazine|canal|tv\b|gourmet|metro|net\s*tv|ucl/i
    }
  ];

  const suggestions = {};
  for (const rule of RULES) {
    suggestions[rule.name] = [];
  }

  for (const ch of channels) {
    const textToMatch = `${ch.name} ${ch.tvg_name || ''}`;
    for (const rule of RULES) {
      if (rule.pattern.test(textToMatch)) {
        suggestions[rule.name].push({
          id: ch.id,
          name: ch.name
        });
        break;
      }
    }
  }

  const result = Object.entries(suggestions)
    .filter(([_, list]) => list.length > 0)
    .map(([groupName, list]) => ({
      groupName,
      channels: list
    }));

  res.json({ suggestions: result });
});

// ── POST /api/groups/auto-suggest/apply ───────────────────────────────────────
router.post('/auto-suggest/apply', (req, res) => {
  const { suggestions } = req.body;
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return res.status(400).json({ error: 'suggestions array required.' });
  }

  const applyTx = db.transaction((groupsList) => {
    for (const item of groupsList) {
      const { groupName, channelIds } = item;
      if (!groupName || !Array.isArray(channelIds) || channelIds.length === 0) continue;

      const cleanGroupName = groupName.trim().slice(0, 128);
      let group = db.prepare('SELECT id FROM groups WHERE name = ?').get(cleanGroupName);
      let groupId;
      if (group) {
        groupId = group.id;
      } else {
        const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM groups').get().m;
        const insertGroupResult = db.prepare('INSERT INTO groups (name, sort_order) VALUES (?, ?)').run(cleanGroupName, maxOrder + 1);
        groupId = insertGroupResult.lastInsertRowid;
      }

      const assignStmt = db.prepare('UPDATE channels SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      for (const chId of channelIds) {
        assignStmt.run(groupId, Number(chId));
      }
    }
  });

  applyTx(suggestions);
  res.json({ ok: true });
});

module.exports = router;
