'use strict';

/**
 * IPTV Checker Route
 *
 * POST /api/checker/check
 * Body: { urls: string[] }  — array of Xtream or M3U URLs
 *
 * For each URL, detects type (xtream player_api vs plain m3u) and returns:
 *  - status: 'online' | 'offline'
 *  - responseTimeMs: number
 *  - channelCount: number | null
 *  - expiresAt: string | null   (ISO date, Xtream only)
 *  - serverInfo: object | null
 *  - error: string | null
 */

const express  = require('express');
const https    = require('https');
const http     = require('http');
const { URL }  = require('url');
const { authMiddleware, csrfMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(csrfMiddleware);

const TIMEOUT_MS  = 15_000;
const MAX_URLS    = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Timed HTTP/HTTPS GET that resolves with { statusCode, body, elapsedMs }.
 * body is the first up to 512KB of the response (enough for Xtream JSON or
 * M3U header detection).
 */
function timedGet(urlStr, timeoutMs = TIMEOUT_MS, maxBody = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch {
      return reject(new Error('Invalid URL'));
    }

    const transport  = parsed.protocol === 'https:' ? https : http;
    const startTime  = Date.now();
    let finished     = false;

    const req = transport.get(urlStr, {
      headers: { 'User-Agent': 'IPTV-Checker/1.0' },
      // Skip SSL verification for self-signed certs common in IPTV panels
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      let size     = 0;

      res.on('data', (chunk) => {
        size += chunk.length;
        if (size <= maxBody) chunks.push(chunk);
      });

      res.on('end', () => {
        if (finished) return;
        finished = true;
        resolve({
          statusCode: res.statusCode,
          body:       Buffer.concat(chunks).toString('utf-8'),
          headers:    res.headers,
          elapsedMs:  Date.now() - startTime,
        });
      });

      res.on('error', (err) => {
        if (finished) return;
        finished = true;
        reject(err);
      });
    });

    req.on('error', (err) => {
      if (finished) return;
      finished = true;
      reject(err);
    });

    req.setTimeout(timeoutMs, () => {
      if (finished) return;
      finished = true;
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

/**
 * Parse a Unix timestamp (seconds) into an ISO string, or null if invalid.
 */
function parseExpiry(ts) {
  if (!ts) return null;
  const num = Number(ts);
  if (!Number.isFinite(num) || num <= 0) return null;
  return new Date(num * 1000).toISOString();
}

/**
 * Detect if a URL is an Xtream Codes panel URL.
 * Heuristic: contains player_api.php, or has username= & password= params.
 * Also handles "get.php?username=...&password=..." style URLs.
 */
function detectXtream(urlStr) {
  try {
    const u   = new URL(urlStr);
    const sp  = u.searchParams;
    const hasCredentials = sp.has('username') && sp.has('password');
    if (hasCredentials) return true;
    if (u.pathname.includes('player_api')) return true;
    // Check path pattern: /live/user/pass/ or /user/pass/
    // Common M3U-as-xtream links end in .m3u or .m3u8
    if (/\.(m3u8?|ts)$/i.test(u.pathname)) return false;
    return false;
  } catch {
    return false;
  }
}

/**
 * Extract Xtream credentials from a URL.
 * Supports:
 *  - http://host/player_api.php?username=U&password=P
 *  - http://host/get.php?username=U&password=P&type=m3u_plus
 *  - http://host/U/P/...
 */
function extractXtreamCredentials(urlStr) {
  try {
    const u  = new URL(urlStr);
    const sp = u.searchParams;

    if (sp.has('username') && sp.has('password')) {
      const base = `${u.protocol}//${u.host}`;
      return {
        base,
        username: sp.get('username'),
        password: sp.get('password'),
      };
    }

    // Try path-based: /username/password/streamid
    const parts = u.pathname.replace(/^\//, '').split('/');
    if (parts.length >= 2) {
      const base = `${u.protocol}//${u.host}`;
      return { base, username: parts[0], password: parts[1] };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Check an Xtream Codes source.
 * Returns { status, responseTimeMs, channelCount, expiresAt, serverInfo, error }
 */
async function checkXtream(urlStr) {
  const creds = extractXtreamCredentials(urlStr);
  if (!creds) {
    return {
      status: 'offline', responseTimeMs: 0,
      channelCount: null, expiresAt: null, serverInfo: null,
      error: 'Could not extract Xtream credentials from URL',
    };
  }

  const { base, username, password } = creds;
  const apiUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

  let res;
  try {
    res = await timedGet(apiUrl);
  } catch (err) {
    return {
      status: 'offline', responseTimeMs: 0,
      channelCount: null, expiresAt: null, serverInfo: null,
      error: err.message,
    };
  }

  const responseTimeMs = res.elapsedMs;

  if (res.statusCode !== 200) {
    return {
      status: 'offline', responseTimeMs,
      channelCount: null, expiresAt: null, serverInfo: null,
      error: `HTTP ${res.statusCode}`,
    };
  }

  let data;
  try { data = JSON.parse(res.body); } catch {
    return {
      status: 'offline', responseTimeMs,
      channelCount: null, expiresAt: null, serverInfo: null,
      error: 'Invalid JSON from Xtream API',
    };
  }

  // Auth failed
  if (data?.user_info?.auth === 0) {
    return {
      status: 'offline', responseTimeMs,
      channelCount: null, expiresAt: null, serverInfo: null,
      error: 'Authentication failed: invalid credentials',
    };
  }

  const userInfo   = data?.user_info   || {};
  const serverInfo = data?.server_info || {};

  // Expiry: exp_date (unix timestamp)
  const expiresAt = parseExpiry(userInfo.exp_date);

  // Max connections / active connections counts
  const maxConnections    = userInfo.max_connections    ?? null;
  const activeConnections = userInfo.active_connections ?? null;

  // Try to get live stream count
  let channelCount = null;
  try {
    const streamsUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
    const streamsRes = await timedGet(streamsUrl, 10_000, 10 * 1024 * 1024); // Up to 10MB to count streams
    if (streamsRes.statusCode === 200) {
      const streams = JSON.parse(streamsRes.body);
      if (Array.isArray(streams)) channelCount = streams.length;
    }
  } catch {
    // non-fatal — we already know it's online
  }

  return {
    status: 'online',
    responseTimeMs,
    channelCount,
    expiresAt,
    serverInfo: {
      url:             base,
      timezone:        serverInfo.timezone         || null,
      serverProtocol:  serverInfo.server_protocol  || null,
      port:            serverInfo.port             || null,
      httpsPort:       serverInfo.https_port       || null,
      maxConnections,
      activeConnections,
      isTrial:         userInfo.is_trial === '1' || userInfo.is_trial === 1,
      username,
    },
    error: null,
  };
}

/**
 * Check a plain M3U URL.
 * Fetches the URL and counts EXTINF entries.
 */
async function checkM3U(urlStr) {
  let res;
  try {
    res = await timedGet(urlStr);
  } catch (err) {
    return {
      status: 'offline', responseTimeMs: 0,
      channelCount: null, expiresAt: null, serverInfo: null,
      error: err.message,
    };
  }

  const responseTimeMs = res.elapsedMs;

  if (res.statusCode !== 200) {
    return {
      status: 'offline', responseTimeMs,
      channelCount: null, expiresAt: null, serverInfo: null,
      error: `HTTP ${res.statusCode}`,
    };
  }

  // Detect if it's actually an M3U
  const body = res.body;
  const isM3U = body.trimStart().startsWith('#EXTM3U');
  if (!isM3U) {
    return {
      status: 'offline', responseTimeMs,
      channelCount: null, expiresAt: null, serverInfo: null,
      error: 'Response does not appear to be a valid M3U playlist',
    };
  }

  // Count channels (EXTINF lines)
  let channelCount = 0;
  for (const line of body.split('\n')) {
    if (line.trimStart().startsWith('#EXTINF')) channelCount++;
  }

  return {
    status: 'online',
    responseTimeMs,
    channelCount: channelCount || null,
    expiresAt: null,
    serverInfo: null,
    error: null,
  };
}

/**
 * Dispatch to the right checker based on URL type.
 */
async function checkUrl(urlStr) {
  const trimmed = urlStr.trim();

  let type = 'm3u';
  if (detectXtream(trimmed)) {
    type = 'xtream';
  }

  try {
    if (type === 'xtream') {
      const result = await checkXtream(trimmed);
      return { url: trimmed, type: 'xtream', ...result };
    } else {
      const result = await checkM3U(trimmed);
      return { url: trimmed, type: 'm3u', ...result };
    }
  } catch (err) {
    return {
      url: trimmed, type,
      status: 'offline', responseTimeMs: 0,
      channelCount: null, expiresAt: null, serverInfo: null,
      error: err.message,
    };
  }
}

// ── POST /api/checker/check ───────────────────────────────────────────────────
router.post('/check', async (req, res) => {
  const { urls } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls must be a non-empty array.' });
  }

  if (urls.length > MAX_URLS) {
    return res.status(400).json({ error: `Maximum ${MAX_URLS} URLs per request.` });
  }

  // Validate each URL
  const validated = [];
  for (const u of urls) {
    if (typeof u !== 'string' || u.trim().length === 0) continue;
    try {
      new URL(u.trim());
      validated.push(u.trim());
    } catch {
      validated.push(u.trim()); // will fail gracefully in checkUrl
    }
  }

  if (validated.length === 0) {
    return res.status(400).json({ error: 'No valid URLs provided.' });
  }

  // Check all URLs in parallel
  const results = await Promise.all(validated.map(checkUrl));

  res.json({ results });
});

// ── POST /api/checker/channels ────────────────────────────────────────────────
// Fetches the full channel list for a single online source and health-checks
// each stream (HEAD request with short timeout). Returns channels with statuses
// and a summary counter per status.
//
// Body: { url: string, limit?: number }
// limit defaults to 500 (to keep response times reasonable)
router.post('/channels', async (req, res) => {
  const { url, limit } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required.' });
  }

  const trimmed = url.trim();
  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 100000), 100000);

  const isXtream = detectXtream(trimmed);

  let channels = []; // { name, url, group, logo }

  // ── 1. Collect channel list ─────────────────────────────────────────────────
  if (isXtream) {
    const creds = extractXtreamCredentials(trimmed);
    if (!creds) {
      return res.status(400).json({ error: 'Could not extract Xtream credentials.' });
    }
    const { base, username, password } = creds;

    try {
      // Fetch categories for group names
      const catUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_categories`;
      const catRes = await timedGet(catUrl, 10_000, 2 * 1024 * 1024); // Up to 2MB for categories
      const catMap = new Map();
      if (catRes.statusCode === 200) {
        try {
          const cats = JSON.parse(catRes.body);
          if (Array.isArray(cats)) {
            cats.forEach(c => c.category_id && catMap.set(String(c.category_id), c.category_name || ''));
          }
        } catch { /* non-fatal */ }
      }

      // Fetch live streams
      const streamsUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
      const streamsRes = await timedGet(streamsUrl, 15_000, 15 * 1024 * 1024); // Up to 15MB for live streams list
      if (streamsRes.statusCode !== 200) {
        return res.status(502).json({ error: `Xtream API returned HTTP ${streamsRes.statusCode}` });
      }

      const streams = JSON.parse(streamsRes.body);
      if (!Array.isArray(streams)) {
        return res.status(502).json({ error: 'Unexpected Xtream API response format.' });
      }

      channels = streams.slice(0, safeLimit).map(s => ({
        name:  (s.name || s.stream_display_name || 'Unknown').trim(),
        url:   `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${s.stream_id}.ts`,
        group: catMap.get(String(s.category_id)) || s.category_name || '',
        logo:  s.stream_icon || s.thumbnail || '',
      }));
    } catch (err) {
      return res.status(502).json({ error: `Failed to fetch Xtream channels: ${err.message}` });
    }
  } else {
    // M3U: fetch and parse
    try {
      const m3uRes = await fetchLargeBody(trimmed, 10 * 1024 * 1024); // 10MB limit
      if (m3uRes.statusCode !== 200) {
        return res.status(502).json({ error: `M3U URL returned HTTP ${m3uRes.statusCode}` });
      }
      const body = m3uRes.body;
      if (!body.trimStart().startsWith('#EXTM3U')) {
        return res.status(400).json({ error: 'URL does not return a valid M3U playlist.' });
      }

      const parsed = parseM3USimple(body);
      channels = parsed.slice(0, safeLimit);
    } catch (err) {
      return res.status(502).json({ error: `Failed to fetch M3U: ${err.message}` });
    }
  }

  if (channels.length === 0) {
    return res.json({ channels: [], summary: { total: 0, online: 0, slow: 0, offline: 0 } });
  }

  // If check is not true, just return the channel list immediately without health-checking
  if (req.body.check !== true) {
    const initialChannels = channels.map(ch => ({
      ...ch,
      health: 'unknown',
      latencyMs: 0
    }));
    return res.json({
      channels: initialChannels,
      summary: { total: initialChannels.length, online: 0, slow: 0, offline: 0 }
    });
  }

  // ── 2. Stream results via Newline-Delimited JSON (NDJSON) ────────────────────
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');

  const initialChannels = channels.map(ch => ({
    ...ch,
    health: 'checking',
    latencyMs: 0
  }));

  // Send the initial list of channels immediately
  res.write(JSON.stringify({ type: 'init', channels: initialChannels }) + '\n');

  const PROBE_TIMEOUT   = 5_000;   // 5s per channel
  const SLOW_THRESHOLD  = 2_000;   // >2s = slow
  const CONCURRENCY     = 30;      // max parallel probes

  const results = new Array(channels.length);

  // Concurrency-limited pool
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= channels.length) break;
      const ch = channels[i];
      const probeResult = await probeStream(ch.url, PROBE_TIMEOUT, SLOW_THRESHOLD);
      results[i] = { ...ch, ...probeResult };

      // Stream the check result for this specific channel
      res.write(JSON.stringify({
        type: 'update',
        index: i,
        health: probeResult.health,
        latencyMs: probeResult.latencyMs
      }) + '\n');
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, worker);
  await Promise.all(workers);

  // ── 3. Build and send summary ───────────────────────────────────────────────
  const summary = { total: results.length, online: 0, slow: 0, offline: 0 };
  for (const r of results) {
    if (r.health === 'online')  summary.online++;
    else if (r.health === 'slow') summary.slow++;
    else summary.offline++;
  }

  res.write(JSON.stringify({ type: 'done', summary }) + '\n');
  res.end();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Probe a stream URL with a HEAD (or GET with immediate abort) request.
 * Returns { health: 'online'|'slow'|'offline', latencyMs: number }
 */
function probeStream(streamUrl, timeoutMs, slowThreshold) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(streamUrl); } catch {
      return resolve({ health: 'offline', latencyMs: 0 });
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    const start     = Date.now();
    let done        = false;

    const finish = (health) => {
      if (done) return;
      done = true;
      const latencyMs = Date.now() - start;
      resolve({ health, latencyMs });
    };

    const req = transport.request(streamUrl, {
      method:   'HEAD',
      headers:  { 'User-Agent': 'IPTV-Checker/1.0' },
      rejectUnauthorized: false,
    }, (res_) => {
      // Drain to free socket
      res_.resume();
      const latencyMs = Date.now() - start;
      const ok = res_.statusCode < 400;
      if (!done) {
        done = true;
        resolve({
          health:    ok ? (latencyMs > slowThreshold ? 'slow' : 'online') : 'offline',
          latencyMs: ok ? latencyMs : 0,
        });
      }
      req.destroy();
    });

    req.on('error', () => finish('offline'));
    req.setTimeout(timeoutMs, () => { req.destroy(); finish('offline'); });
    req.end();
  });
}

/**
 * Fetch a potentially large HTTP body (streams until maxBytes or end).
 */
function fetchLargeBody(urlStr, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try { parsedUrl = new URL(urlStr); } catch {
      return reject(new Error('Invalid URL'));
    }

    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const start     = Date.now();

    const req = transport.get(urlStr, {
      headers: { 'User-Agent': 'IPTV-Checker/1.0' },
      rejectUnauthorized: false,
    }, (res_) => {
      if (res_.statusCode >= 300 && res_.statusCode < 400 && res_.headers.location) {
        req.destroy();
        const next = res_.headers.location.startsWith('http')
          ? res_.headers.location
          : new URL(res_.headers.location, urlStr).toString();
        return fetchLargeBody(next, maxBytes).then(resolve).catch(reject);
      }

      const chunks = [];
      let size = 0;

      res_.on('data', (chunk) => {
        size += chunk.length;
        if (size <= maxBytes) chunks.push(chunk);
        else { req.destroy(); }
      });

      res_.on('end', () => resolve({
        statusCode: res_.statusCode,
        body:       Buffer.concat(chunks).toString('utf-8'),
        elapsedMs:  Date.now() - start,
      }));

      res_.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Minimal M3U parser — extracts name, url, group-title, tvg-logo only.
 * Returns array of { name, url, group, logo }
 */
function parseM3USimple(text) {
  const lines   = text.split('\n');
  const result  = [];
  let meta       = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      const commaIdx = line.indexOf(',');
      const attrStr  = commaIdx > 0 ? line.slice(8, commaIdx) : '';
      const name     = commaIdx > 0 ? line.slice(commaIdx + 1).trim() : 'Unknown';

      const logoMatch  = attrStr.match(/tvg-logo="([^"]*)"/i);
      const groupMatch = attrStr.match(/group-title="([^"]*)"/i);

      meta = {
        name:  name || 'Unknown',
        logo:  logoMatch  ? logoMatch[1]  : '',
        group: groupMatch ? groupMatch[1] : '',
      };
    } else if (!line.startsWith('#') && line.startsWith('http') && meta) {
      result.push({ ...meta, url: line });
      meta = null;
    }
  }

  return result;
}

// ── POST /api/checker/probe ──────────────────────────────────────────────────
// Health checks a single channel stream URL (HEAD request).
// Returns { health: 'online'|'slow'|'offline', latencyMs: number }
router.post('/probe', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  try {
    const PROBE_TIMEOUT = 5000;
    const SLOW_THRESHOLD = 2000;
    const result = await probeStream(url, PROBE_TIMEOUT, SLOW_THRESHOLD);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

