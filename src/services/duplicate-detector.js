'use strict';

/**
 * Duplicate Detector
 *
 * Detects duplicate channels by:
 * 1. Same IP/hostname+path (URL match)
 * 2. Similar channel names (Levenshtein similarity ≥ threshold)
 *
 * Returns groups of suspected duplicates for admin review.
 */

/**
 * Normalize a channel name for comparison:
 * - Lowercase
 * - Remove accents (é→e, á→a, etc.)
 * - Strip common quality/variant suffixes
 * - Remove extra spaces
 */
function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/\b(hd|fhd|4k|sd|uhd|hevc|h\.265|h265|plus|\+|premium|tv)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the base host+path from a stream URL for deduplication.
 * Returns a simplified key, ignoring query params and auth tokens.
 */
function urlKey(url) {
  try {
    const u = new URL(url);
    // Key = protocol + host + port + first 2 path segments
    const pathParts = u.pathname.split('/').filter(Boolean).slice(0, 2);
    return `${u.protocol}//${u.host}/${pathParts.join('/')}`;
  } catch {
    return url.toLowerCase().trim();
  }
}

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = 1 + Math.min(
          matrix[i - 1][j],     // deletion
          matrix[i][j - 1],     // insertion
          matrix[i - 1][j - 1]  // substitution
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Similarity percentage between two strings (0-100).
 */
function similarity(a, b) {
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  return Math.round((1 - levenshtein(a, b) / maxLen) * 100);
}

/**
 * Main detection function.
 *
 * @param {Array} channels - Array of channel objects with { id, name, url, group_id }
 * @param {number} threshold - Name similarity threshold (0-100, default 80)
 * @returns {Array} Array of duplicate groups:
 *   { channels: [...], reason: 'url'|'name', score: number, suggestedPrimaryId: number }
 */
function detectDuplicates(channels, threshold = 80) {
  const groups = [];
  const processed = new Set(); // channel IDs already grouped

  // ── Phase 1: URL-based deduplication ────────────────────────────────────────
  const urlMap = new Map(); // urlKey → [channels]
  for (const ch of channels) {
    const key = urlKey(ch.url);
    if (!urlMap.has(key)) urlMap.set(key, []);
    urlMap.get(key).push(ch);
  }

  for (const [, group] of urlMap) {
    if (group.length < 2) continue;
    if (group.every((c) => processed.has(c.id))) continue;

    const ids = group.map((c) => c.id);
    ids.forEach((id) => processed.add(id));

    // Suggest primary: prefer active + best health, then longest name (more descriptive)
    const suggested = group.reduce((best, c) => {
      if (!best) return c;
      const scoreA = healthScore(best.health_status);
      const scoreB = healthScore(c.health_status);
      if (scoreB > scoreA) return c;
      if (scoreB === scoreA && c.name.length > best.name.length) return c;
      return best;
    }, null);

    groups.push({
      channels: group,
      reason: 'url',
      score: 100,
      suggestedPrimaryId: suggested ? suggested.id : group[0].id,
    });
  }

  // ── Phase 2: Name similarity deduplication ───────────────────────────────────
  const remaining = channels.filter((c) => !processed.has(c.id));

  for (let i = 0; i < remaining.length; i++) {
    if (processed.has(remaining[i].id)) continue;
    const a = remaining[i];
    const normA = normalizeName(a.name);
    if (!normA) continue;

    const matchGroup = [a];

    for (let j = i + 1; j < remaining.length; j++) {
      if (processed.has(remaining[j].id)) continue;
      const b = remaining[j];
      const normB = normalizeName(b.name);
      if (!normB) continue;

      const score = similarity(normA, normB);
      if (score >= threshold) {
        matchGroup.push(b);
      }
    }

    if (matchGroup.length < 2) continue;

    matchGroup.forEach((c) => processed.add(c.id));

    const suggested = matchGroup.reduce((best, c) => {
      if (!best) return c;
      const scoreA = healthScore(best.health_status);
      const scoreB = healthScore(c.health_status);
      if (scoreB > scoreA) return c;
      return best;
    }, null);

    const avgScore = matchGroup.reduce((sum, c, idx) => {
      if (idx === 0) return sum;
      return sum + similarity(normalizeName(matchGroup[0].name), normalizeName(c.name));
    }, 100) / matchGroup.length;

    groups.push({
      channels: matchGroup,
      reason: 'name',
      score: Math.round(avgScore),
      suggestedPrimaryId: suggested ? suggested.id : matchGroup[0].id,
    });
  }

  return groups;
}

/**
 * Map health_status to a numeric score for comparison.
 */
function healthScore(status) {
  const map = { healthy: 4, degraded: 3, intermittent: 2, unknown: 1, down: 0 };
  return map[status] ?? 1;
}

module.exports = { detectDuplicates, normalizeName, similarity };
