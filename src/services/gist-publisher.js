'use strict';

const { spawn } = require('child_process');
const db = require('../db/database');
const { generateSourceM3U, generateEmptyM3U } = require('./slot-generator');
const { fetchXtreamAccountInfo } = require('./xtream-fetcher');

/**
 * Publishes each slot as a file (slot-01.m3u ...) in one secret GitHub gist,
 * through the `gh` CLI (REST API; `gh gist` rejects .m3u). No token is stored:
 * the server relies on `gh` being authenticated.
 */

const getSetting = (key) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) || {}).value || '';
const setSetting = (key, value) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));

const fileName = (slot) => `slot-${String(slot).padStart(2, '0')}.m3u`;

let publishing = false;

function gh(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? '`gh` CLI not found in PATH' : e.message)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error((err || out).trim().slice(0, 500) || `gh exited with ${code}`));
      resolve(out);
    });
    child.stdin.end(input || '');
  });
}

let ownerCache = null;
async function getOwner() {
  if (!ownerCache) ownerCache = (await gh(['api', 'user', '--jq', '.login'])).trim();
  return ownerCache;
}

/** Stable raw URL (no revision hash, so it never changes between edits). */
async function slotUrl(slot) {
  const id = getSetting('publish_gist_id');
  if (!id) return null;
  return `https://gist.githubusercontent.com/${await getOwner()}/${id}/raw/${fileName(slot)}`;
}

/** Refresh account info (expiry, allowed formats) of the assigned Xtream sources. Best effort. */
async function refreshXtreamInfo(sourceIds = null) {
  const sources = db.prepare(`
    SELECT s.id, s.xtream_host, s.xtream_user, s.xtream_pass FROM sources s
    JOIN publish_slots p ON p.source_id = s.id WHERE s.type = 'xtream'`).all()
    .filter((s) => !sourceIds || sourceIds.includes(s.id));
  const upd = db.prepare('UPDATE sources SET xtream_info = ? WHERE id = ?');
  await Promise.all(sources.map(async (s) => {
    try { upd.run(JSON.stringify(await fetchXtreamAccountInfo(s.xtream_host, s.xtream_user, s.xtream_pass)), s.id); }
    catch (e) { console.warn(`[Publish] Xtream info for source ${s.id} failed: ${e.message}`); }
  }));
}

function buildSlot(row) {
  return row.source_id ? generateSourceM3U(row.source_id, row.slot) : generateEmptyM3U(row.slot);
}

/**
 * Publish pending slots (or only `onlySlots`). Files whose content hash is
 * unchanged are skipped. Per-slot errors go to last_error.
 */
async function publish(onlySlots = null, { force = false } = {}) {
  if (publishing) throw new Error('A publish is already in progress.');
  publishing = true;
  try {
    const rows = db.prepare('SELECT * FROM publish_slots ORDER BY slot').all()
      .filter((r) => !onlySlots || onlySlots.includes(r.slot));
    await refreshXtreamInfo(rows.map((r) => r.source_id).filter(Boolean));

    const files = {};
    const built = {};
    for (const row of rows) {
      try {
        const gen = buildSlot(row);
        if (!force && getSetting('publish_gist_id') && gen.hash === row.content_hash && !row.last_error) continue;
        built[row.slot] = gen;
        files[fileName(row.slot)] = { content: gen.content };
      } catch (e) {
        db.prepare('UPDATE publish_slots SET last_error = ? WHERE slot = ?').run(e.message, row.slot);
      }
    }

    const gistId = getSetting('publish_gist_id');
    if (Object.keys(files).length === 0 && gistId) return { published: [], skipped: rows.length };

    try {
      if (!gistId) {
        // First time: the gist must contain every slot file.
        for (const row of db.prepare('SELECT * FROM publish_slots ORDER BY slot').all()) {
          const f = fileName(row.slot);
          if (!files[f]) { const gen = buildSlot(row); built[row.slot] = gen; files[f] = { content: gen.content }; }
        }
        const created = JSON.parse(await gh(['api', 'gists', '--input', '-'],
          JSON.stringify({ description: 'iptv-manager slots', public: false, files })));
        setSetting('publish_gist_id', created.id);
      } else {
        await gh(['api', '-X', 'PATCH', `gists/${gistId}`, '--input', '-'], JSON.stringify({ files }));
      }
    } catch (e) {
      const upd = db.prepare('UPDATE publish_slots SET last_error = ? WHERE slot = ?');
      for (const slot of Object.keys(built)) upd.run(e.message, Number(slot));
      throw e;
    }

    const upd = db.prepare(`
      UPDATE publish_slots SET content_hash = ?, published_at = CURRENT_TIMESTAMP,
        channel_count = ?, dead_excluded = ?, last_error = NULL WHERE slot = ?`);
    for (const [slot, gen] of Object.entries(built)) upd.run(gen.hash, gen.channelCount, gen.deadExcluded, Number(slot));
    return { published: Object.keys(built).map(Number), skipped: rows.length - Object.keys(built).length };
  } finally {
    publishing = false;
  }
}

/** Rotate: forget the current gist and create a new one (new URLs). Old gist is left for the user to delete. */
async function rotate() {
  const oldId = getSetting('publish_gist_id');
  setSetting('publish_gist_id', '');
  db.prepare('UPDATE publish_slots SET content_hash = NULL, published_at = NULL, last_error = NULL').run();
  try {
    return { ...(await publish(null, { force: true })), oldGistId: oldId };
  } catch (e) {
    setSetting('publish_gist_id', oldId);
    throw e;
  }
}

/** Debounced auto-publish for sync/checker hooks (no-op unless publish_auto = 1 and a gist exists). */
let autoTimer = null;
function schedulePublish(delayMs = 15_000) {
  if (getSetting('publish_auto') !== '1' || !getSetting('publish_gist_id')) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    publish().catch((e) => console.error('[Publish] auto-publish failed:', e.message));
  }, delayMs);
  autoTimer.unref();
}

module.exports = { refreshXtreamInfo, schedulePublish, publish, rotate, slotUrl, fileName, isPublishing: () => publishing };
