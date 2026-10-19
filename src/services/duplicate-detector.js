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
    // Key = protocol + host + port + full path. Only the first segments is too coarse:
    // every channel of one Xtream account (/live/user/pass/<id>.ts) would collide.
    return `${u.protocol}//${u.host}${u.pathname}`;
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

  let prev = new Array(a.length + 1);
  let cur = new Array(a.length + 1);
  for (let j = 0; j <= a.length; j++) prev[j] = j;

  for (let i = 1; i <= b.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= a.length; j++) {
      cur[j] = b[i - 1] === a[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[a.length];
}

/**
 * True when similarity(a, b) >= threshold. Bails out as soon as the edit distance
 * can no longer stay under the allowed maximum (no full matrix for clear misses).
 */
function charProfile(str) {
  const p = new Uint8Array(37); // a-z, 0-9, space
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    p[c === 32 ? 36 : c >= 97 ? c - 97 : c - 22]++;
  }
  return p;
}

function isSimilar(a, b, threshold, pa, pb) {
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  const maxDist = Math.floor(maxLen * (1 - threshold / 100) + 1e-9);
  if (Math.abs(a.length - b.length) > maxDist) return false;
  if (maxDist === 0) return false;
  if (pa && pb) {
    // each edit changes the letter histogram by at most 2, so a big gap can't be within maxDist
    let diff = 0;
    for (let k = 0; k < 37; k++) diff += pa[k] > pb[k] ? pa[k] - pb[k] : pb[k] - pa[k];
    if (diff > 2 * maxDist) return false;
  }

  let prev = new Array(a.length + 1);
  let cur = new Array(a.length + 1);
  for (let j = 0; j <= a.length; j++) prev[j] = j;
  for (let i = 1; i <= b.length; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= a.length; j++) {
      const v = b[i - 1] === a[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return false;
    [prev, cur] = [cur, prev];
  }
  return prev[a.length] <= maxDist;
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
  // Channels are first collapsed by normalized name (O(n)); fuzzy comparison then runs
  // only between distinct names that share a 3-char prefix and a compatible length,
  // instead of every pair of channels.
  const byName = new Map(); // normalized name → [channels]
  for (const c of channels) {
    if (processed.has(c.id)) continue;
    const norm = normalizeName(c.name);
    if (!norm) continue;
    if (!byName.has(norm)) byName.set(norm, []);
    byName.get(norm).push(c);
  }

  const blocks = new Map(); // prefix → [normalized names]
  for (const norm of byName.keys()) {
    const key = norm.slice(0, 3);
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(norm);
  }

  const usedNames = new Set();
  const profiles = new Map(); // normalized name → letter histogram (prefilter)
  for (const norm of byName.keys()) profiles.set(norm, charProfile(norm));

  for (const names of blocks.values()) {
    names.sort((x, y) => x.length - y.length);
    for (let i = 0; i < names.length; i++) {
      const normA = names[i];
      if (usedNames.has(normA)) continue;

      const members = [normA];
      for (let j = i + 1; j < names.length; j++) {
        const normB = names[j];
        // sorted by length: once the gap exceeds the allowed distance, no later name can match
        if (normB.length - normA.length > Math.floor(normB.length * (1 - threshold / 100) + 1e-9)) break;
        if (usedNames.has(normB)) continue;
        if (isSimilar(normA, normB, threshold, profiles.get(normA), profiles.get(normB))) members.push(normB);
      }

      const matchGroup = members.flatMap((n) => byName.get(n));
      members.forEach((n) => usedNames.add(n));
      if (matchGroup.length < 2) continue;

      const suggested = matchGroup.reduce((best, c) => {
        if (!best) return c;
        return healthScore(c.health_status) > healthScore(best.health_status) ? c : best;
      }, null);

      const avgScore = members.length === 1
        ? 100
        : matchGroup.reduce((sum, c) => sum + similarity(normA, normalizeName(c.name)), 0) / matchGroup.length;

      groups.push({
        channels: matchGroup,
        reason: 'name',
        score: Math.round(avgScore),
        suggestedPrimaryId: suggested ? suggested.id : matchGroup[0].id,
      });
    }
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
