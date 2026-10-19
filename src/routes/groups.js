'use strict';

const express = require('express');
const db = require('../db/database');
const { authMiddleware, csrfMiddleware } = require('../middleware/auth');
const { schedulePublish } = require('../services/gist-publisher');

const router = express.Router();
router.use(authMiddleware);
router.use(csrfMiddleware);

// ── GET /api/groups ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const sourceId = Number(req.query.sourceId) || null;

  // With sourceId the counts only cover that list, and groups it doesn't use are left out
  if (sourceId) {
    const groups = db.prepare(`
      SELECT g.*, COUNT(c.id) AS channel_count
      FROM groups g
      JOIN channels c ON c.group_id = g.id AND c.source_id = ?
      GROUP BY g.id
      ORDER BY g.sort_order, g.name
    `).all(sourceId);
    const ungrouped = db.prepare('SELECT COUNT(*) AS n FROM channels WHERE group_id IS NULL AND source_id = ?').get(sourceId).n;
    return res.json({ groups, ungrouped });
  }

  const groups = db.prepare(`
    SELECT g.*, COUNT(c.id) AS channel_count
    FROM groups g
    LEFT JOIN channels c ON c.group_id = g.id
    GROUP BY g.id
    ORDER BY g.sort_order, g.name
  `).all();
  const ungrouped = db.prepare('SELECT COUNT(*) AS n FROM channels WHERE group_id IS NULL').get().n;
  res.json({ groups, ungrouped });
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

// ── POST /api/groups/bulk-delete ───────────────────────────────────────────────
// Body: { ids: number[], noGroup?: boolean, sourceId?: number, exclude?: boolean }
// With sourceId only that list's channels are removed; otherwise the groups' channels go from every list.
// A group left with no channels is deleted. With exclude, the group names are added to the
// blacklist of every affected source so a later sync doesn't bring them back.
router.post('/bulk-delete', (req, res) => {
  const { noGroup = false, exclude = false } = req.body;
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger))];
  const sourceId = Number(req.body.sourceId) || null;
  if (ids.length === 0 && !noGroup) return res.status(400).json({ error: 'ids required.' });
  if (ids.length > 5000) return res.status(400).json({ error: 'Too many groups.' });

  const result = db.transaction(() => {
    const ph = ids.map(() => '?').join(',');
    const names = ids.length
      ? db.prepare(`SELECT id, name FROM groups WHERE id IN (${ph})`).all(...ids)
      : [];

    const scope = ids.length ? `group_id IN (${ph})` : 'group_id IS NULL';
    const scopeParams = ids.length ? [...ids] : [];
    const withNoGroup = ids.length && noGroup ? ` OR group_id IS NULL` : '';
    const where = `(${scope}${withNoGroup})${sourceId ? ' AND source_id = ?' : ''}`;
    const params = sourceId ? [...scopeParams, sourceId] : scopeParams;

    const affectedSources = db.prepare(`SELECT DISTINCT source_id FROM channels WHERE ${where} AND source_id IS NOT NULL`)
      .all(...params).map((r) => r.source_id);

    const deletedChannels = db.prepare(`DELETE FROM channels WHERE ${where}`).run(...params).changes;

    // Groups of this selection that no channel uses any more
    let deletedGroups = 0;
    if (ids.length) {
      deletedGroups = db.prepare(`
        DELETE FROM groups WHERE id IN (${ph})
          AND id NOT IN (SELECT DISTINCT group_id FROM channels WHERE group_id IS NOT NULL)
      `).run(...ids).changes;
    }

    // Sources only learn about the exclusion for groups that have a name (not "Sin grupo")
    if (exclude && names.length) {
      const read = db.prepare('SELECT excluded_groups FROM sources WHERE id = ?');
      const write = db.prepare('UPDATE sources SET excluded_groups = ? WHERE id = ?');
      const targets = sourceId ? [sourceId] : affectedSources;
      for (const sid of targets) {
        const row = read.get(sid);
        if (!row) continue;
        let current = [];
        try { current = JSON.parse(row.excluded_groups || '[]'); } catch { /* reset */ }
        write.run(JSON.stringify([...new Set([...current, ...names.map((g) => g.name)])]), sid);
      }
    }

    // sources.channel_count is a stored figure; keep it in step with what is left
    const recount = db.prepare('UPDATE sources SET channel_count = (SELECT COUNT(*) FROM channels WHERE source_id = sources.id) WHERE id = ?');
    for (const sid of affectedSources) recount.run(sid);

    return { deletedChannels, deletedGroups };
  })();

  schedulePublish();
  res.json({ ok: true, ...result });
});

// ── DELETE /api/groups/:id ─────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const deleteChannels = req.query.deleteChannels === 'true';
  const existing = db.prepare('SELECT id FROM groups WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Group not found.' });

  try {
    db.transaction(() => {
      if (deleteChannels) {
        db.prepare('DELETE FROM channels WHERE group_id = ?').run(id);
      }
      // Note: If deleteChannels is false, channels with this group will have group_id = NULL due to ON DELETE SET NULL constraint in schema.
      db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    })();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
