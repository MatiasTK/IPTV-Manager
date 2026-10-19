'use strict';

const crypto = require('crypto');
const db = require('../db/database');

/**
 * Per-source M3U generator for publish slots.
 *
 * Unlike m3u-generator.js (one global playlist merging sources and duplicates
 * as alternatives), each slot contains ONE source with its own groups and
 * attributes. Only channels marked 'down' by the checker are left out.
 */

const channelsStmt = db.prepare(`
  SELECT c.name, c.url, c.tvg_id, c.tvg_name, c.tvg_logo,
         c.catchup, c.catchup_source, c.catchup_days,
         c.http_user_agent, c.referrer, c.health_status,
         g.name AS group_name
  FROM channels c
  LEFT JOIN groups g ON c.group_id = g.id
  WHERE c.source_id = ? AND c.is_active = 1
  ORDER BY COALESCE(g.sort_order, 9999), g.name COLLATE NOCASE, c.sort_order, c.name COLLATE NOCASE
`);

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

function cleanComment(str) {
  return String(str).replace(/[\r\n"]+/g, ' ').trim();
}

function epgUrlsFor(source) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'epg_urls'").get();
  const split = (v) => (v || '').split(/[\n,]+/).map((u) => u.trim()).filter(Boolean);
  // Source's own EPG first, then the global ones
  const urls = [...split(source.epg_urls), ...split(row && row.value)];
  if (source.type === 'xtream' && source.xtream_host && source.xtream_user) {
    const host = source.xtream_host.replace(/\/+$/, '');
    urls.push(`${host}/xmltv.php?username=${encodeURIComponent(source.xtream_user)}&password=${encodeURIComponent(source.xtream_pass)}`);
  }
  return [...new Set(urls)];
}

function parseInfo(source) {
  try { return source.xtream_info ? JSON.parse(source.xtream_info) : null; } catch { return null; }
}

/** Panels that only allow m3u8: stored `.ts` stream URLs are rewritten at publish time. */
function needsM3u8(source) {
  const f = (parseInfo(source) || {}).allowedFormats || [];
  return source.type === 'xtream' && f.length > 0 && !f.includes('ts') && f.includes('m3u8');
}

/**
 * @returns {{ content: string, hash: string, channelCount: number, deadExcluded: number }}
 *   `hash` covers the channel body only (not the timestamp), so unchanged sources are not republished.
 */
function generateSourceM3U(sourceId, slot) {
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId);
  if (!source) throw new Error(`Source ${sourceId} not found`);

  const epg = epgUrlsFor(source);
  const toM3u8 = needsM3u8(source);
  const body = [];
  let channelCount = 0;
  let deadExcluded = 0;

  for (const ch of channelsStmt.all(sourceId)) {
    if (ch.health_status === 'down') { deadExcluded++; continue; }
    const attrs = [];
    if (ch.tvg_id) attrs.push(`tvg-id="${escapeAttr(ch.tvg_id)}"`);
    attrs.push(`tvg-name="${escapeAttr(ch.tvg_name || ch.name)}"`);
    if (ch.tvg_logo) attrs.push(`tvg-logo="${escapeAttr(ch.tvg_logo)}"`);
    if (ch.group_name) attrs.push(`group-title="${escapeAttr(ch.group_name)}"`);
    if (ch.catchup) attrs.push(`catchup="${escapeAttr(ch.catchup)}"`);
    if (ch.catchup_source) attrs.push(`catchup-source="${escapeAttr(ch.catchup_source)}"`);
    if (ch.catchup_days > 0) attrs.push(`catchup-days="${ch.catchup_days}"`);
    if (ch.http_user_agent) attrs.push(`http-user-agent="${escapeAttr(ch.http_user_agent)}"`);

    body.push(`#EXTINF:-1 ${attrs.join(' ')},${ch.name}`);
    if (ch.http_user_agent) body.push(`#EXTVLCOPT:http-user-agent=${ch.http_user_agent}`);
    if (ch.referrer) body.push(`#EXTVLCOPT:http-referrer=${ch.referrer}`);
    body.push(toM3u8 && /\/live\/.+\.ts$/.test(ch.url) ? ch.url.replace(/\.ts$/, '.m3u8') : ch.url);
    channelCount++;
  }

  const bodyText = body.join('\n');
  const hash = crypto.createHash('sha256').update(epg.join(',') + '\n' + bodyText).digest('hex');
  const header = `#EXTM3U${epg.length ? ` x-tvg-url="${epg.join(',')}"` : ''}`;
  const trace = `# iptv-manager slot=${String(slot).padStart(2, '0')} source_id=${source.id} ` +
    `source="${cleanComment(source.name)}" type=${source.type} published=${new Date().toISOString()} ` +
    `channels=${channelCount} dead_excluded=${deadExcluded}`;

  return { content: `${header}\n${trace}\n${bodyText}\n`, hash, channelCount, deadExcluded };
}

/** M3U for an unassigned slot: a single marker entry so the playlist is valid. */
function generateEmptyM3U(slot) {
  const n = String(slot).padStart(2, '0');
  const content =
    `#EXTM3U\n# iptv-manager slot=${n} empty\n` +
    `#EXTINF:-1 group-title="Libre",Slot ${n} libre\nhttp://127.0.0.1/slot-${n}-libre\n`;
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return { content, hash, channelCount: 0, deadExcluded: 0 };
}

/** Non-blocking issues worth showing next to a slot. */
function slotWarnings(source, row) {
  const warnings = [];
  const info = parseInfo(source);
  if (source.type === 'xtream' && info) {
    if (info.status && String(info.status).toLowerCase() !== 'active') warnings.push(`Cuenta Xtream ${info.status}`);
    if (info.expiresAt) {
      const days = Math.ceil((new Date(info.expiresAt).getTime() - Date.now()) / 86_400_000);
      if (days < 0) warnings.push('Cuenta Xtream vencida');
      else if (days <= 7) warnings.push(`Cuenta Xtream vence en ${days} día${days === 1 ? '' : 's'}`);
    }
    const f = info.allowedFormats || [];
    if (f.length && !f.includes('ts') && !f.includes('m3u8')) warnings.push(`Formatos permitidos: ${f.join(', ')} (ni ts ni m3u8)`);
    else if (needsM3u8(source)) warnings.push('El panel solo permite m3u8: se publica con .m3u8');
  }
  const thr = Number((db.prepare("SELECT value FROM settings WHERE key = 'publish_dead_warn_pct'").get() || {}).value) || 30;
  const total = (row.channel_count || 0) + (row.dead_excluded || 0);
  if (total > 0 && (row.dead_excluded / total) * 100 >= thr) {
    warnings.push(`${Math.round((row.dead_excluded / total) * 100)}% de canales caídos`);
  }
  return warnings;
}

module.exports = { slotWarnings, generateSourceM3U, generateEmptyM3U };
