'use strict';

const db = require('../db/database');

/**
 * M3U Generator
 *
 * Generates a well-formed Extended M3U string from the database.
 *
 * Multi-stream support:
 *   - Each primary channel and its alternatives are emitted as consecutive
 *     M3U entries sharing the same tvg-id. TiviMate groups these into a
 *     single channel entry and lets the user (or TiviMate itself) switch
 *     between streams on failure.
 *   - Streams are ordered: healthy → degraded → unknown → down, so the
 *     best available stream is always first.
 *   - Channels with no tvg-id get a synthetic one (ch_<id>) solely to
 *     enable TiviMate grouping. It won't match EPG data but avoids
 *     duplicates appearing as separate channels.
 *
 * Only active channels are included. Alternatives marked as inactive are skipped.
 * UTF-8, LF line endings, no BOM. Fully compatible with TiviMate.
 */

const HEALTH_ORDER = { healthy: 0, degraded: 1, unknown: 2, down: 3 };

const getSettingsStmt = db.prepare('SELECT key, value FROM settings');

// Primary channels only (not alternatives of another channel)
const getPrimaryChannelsStmt = db.prepare(`
  SELECT
    c.id, c.name, c.url, c.tvg_id, c.tvg_name, c.tvg_logo,
    c.catchup, c.catchup_source, c.catchup_days,
    c.http_user_agent, c.referrer,
    c.health_status, c.is_active,
    g.name AS group_name, c.sort_order
  FROM channels c
  LEFT JOIN groups g ON c.group_id = g.id
  WHERE c.is_active = 1
    AND c.id NOT IN (
      SELECT alternative_channel_id FROM channel_alternatives
    )
  ORDER BY
    COALESCE((SELECT sort_order FROM groups WHERE id = c.group_id), 9999),
    c.sort_order,
    c.name
`);

// All active alternatives for a given primary, ordered by health then priority
const getAlternativesStmt = db.prepare(`
  SELECT
    c.id, c.url, c.name, c.health_status,
    c.http_user_agent, c.referrer,
    ca.priority
  FROM channel_alternatives ca
  JOIN channels c ON ca.alternative_channel_id = c.id
  WHERE ca.primary_channel_id = ?
    AND c.is_active = 1
  ORDER BY
    CASE c.health_status
      WHEN 'healthy'  THEN 0
      WHEN 'degraded' THEN 1
      WHEN 'unknown'  THEN 2
      WHEN 'down'     THEN 3
    END,
    ca.priority
`);

/**
 * Generate the full M3U playlist string.
 * @returns {string} M3U content
 */
function generateM3U() {
  // Load settings
  const settingsRows = getSettingsStmt.all();
  const settings = {};
  for (const row of settingsRows) {
    settings[row.key] = row.value;
  }

  const playlistName = settings['playlist_name'] || 'My IPTV Playlist';
  const epgUrls = settings['epg_urls'] || '';

  const lines = [];

  // ── Header ──────────────────────────────────────────────────────────────────
  let headerLine = '#EXTM3U';
  if (epgUrls) {
    const urls = epgUrls
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean)
      .join(',');
    if (urls) headerLine += ` x-tvg-url="${urls}"`;
  }
  lines.push(headerLine);
  lines.push('');

  // ── Channels ─────────────────────────────────────────────────────────────────
  const channels = getPrimaryChannelsStmt.all();

  for (const ch of channels) {
    const alternatives = getAlternativesStmt.all(ch.id);

    // Build the ordered stream list (primary first, then alternatives)
    const primaryStream = {
      url: ch.url,
      health: ch.health_status,
      httpUserAgent: ch.http_user_agent || '',
      referrer: ch.referrer || '',
    };

    const altStreams = alternatives.map((alt) => ({
      url: alt.url,
      health: alt.health_status,
      httpUserAgent: alt.http_user_agent || ch.http_user_agent || '',
      referrer: alt.referrer || ch.referrer || '',
    }));

    // Sort all streams: best health first.
    // Primary and alternatives compete equally — if primary is down but an
    // alternative is healthy, the healthy one goes first in the M3U so
    // TiviMate starts with the working stream.
    const allStreams = [primaryStream, ...altStreams].sort(
      (a, b) => (HEALTH_ORDER[a.health] ?? 2) - (HEALTH_ORDER[b.health] ?? 2)
    );

    // Shared tvg-id for TiviMate grouping. Without a common tvg-id TiviMate
    // treats each entry as a separate channel, defeating the purpose.
    const tvgId = ch.tvg_id ? ch.tvg_id : `ch_${ch.id}`;

    // Shared metadata (logo, group, catchup) always comes from the primary
    const tvgName = ch.tvg_name || ch.name;
    const tvgLogo = ch.tvg_logo || '';
    const groupTitle = ch.group_name || '';
    const catchup = ch.catchup || '';
    const catchupSource = ch.catchup_source || '';
    const catchupDays = ch.catchup_days > 0 ? ch.catchup_days : 0;

    for (const stream of allStreams) {
      const attrs = [];

      attrs.push(`tvg-id="${escapeAttr(tvgId)}"`);
      attrs.push(`tvg-name="${escapeAttr(tvgName)}"`);
      if (tvgLogo) attrs.push(`tvg-logo="${escapeAttr(tvgLogo)}"`);
      if (groupTitle) attrs.push(`group-title="${escapeAttr(groupTitle)}"`);
      if (catchup) attrs.push(`catchup="${escapeAttr(catchup)}"`);
      if (catchupSource) attrs.push(`catchup-source="${escapeAttr(catchupSource)}"`);
      if (catchupDays) attrs.push(`catchup-days="${catchupDays}"`);
      if (stream.httpUserAgent) attrs.push(`http-user-agent="${escapeAttr(stream.httpUserAgent)}"`);

      lines.push(`#EXTINF:-1 ${attrs.join(' ')},${ch.name}`);

      if (stream.httpUserAgent) lines.push(`#EXTVLCOPT:http-user-agent=${stream.httpUserAgent}`);
      if (stream.referrer) lines.push(`#EXTVLCOPT:http-referrer=${stream.referrer}`);

      lines.push(stream.url);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Escape double-quotes in attribute values to prevent attribute breakout.
 */
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

module.exports = { generateM3U };
