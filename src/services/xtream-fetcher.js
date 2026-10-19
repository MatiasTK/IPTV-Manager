'use strict';

/**
 * Xtream Codes API Fetcher
 *
 * Fetches live stream channels from an Xtream Codes panel and converts
 * them into the same channel object format used by m3u-parser.js so the
 * rest of the pipeline (importChannels, etc.) works unchanged.
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Fetch JSON from a URL (follows up to 5 redirects).
 * @param {string} urlStr
 * @returns {Promise<unknown>}
 */
function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const makeRequest = (u, redirectsLeft) => {
      if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));

      let parsed;
      try { parsed = new URL(u); } catch {
        return reject(new Error('Invalid URL: ' + u));
      }

      const transport = parsed.protocol === 'https:' ? https : http;
      const req = transport.get(u, { headers: { 'User-Agent': 'IPTV-Manager/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy();
          const loc = res.headers.location;
          const next = loc.startsWith('http') ? loc : new URL(loc, u).toString();
          return makeRequest(next, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          // Drain body before rejecting
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch {
            reject(new Error('Invalid JSON response from Xtream API'));
          }
        });
        res.on('error', reject);
      });

      req.on('error', reject);
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
    };

    makeRequest(urlStr, 5);
  });
}

/**
 * Build a canonical base URL (strips trailing slash).
 * Ensures the host has a protocol.
 * @param {string} host - e.g. "http://server.com:8080" or "server.com:8080"
 * @returns {string}
 */
function buildBase(host) {
  const h = host.trim();
  if (/^https?:\/\//i.test(h)) return h.replace(/\/+$/, '');
  return `http://${h}`.replace(/\/+$/, '');
}

/**
 * Fetch Xtream Codes live-stream categories.
 * @param {string} base
 * @param {string} user
 * @param {string} pass
 * @returns {Promise<Map<string,string>>} categoryId → categoryName
 */
async function fetchCategories(base, user, pass) {
  const url = `${base}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&action=get_live_categories`;
  const data = await fetchJson(url);

  const map = new Map();
  if (Array.isArray(data)) {
    for (const cat of data) {
      if (cat.category_id != null) {
        map.set(String(cat.category_id), cat.category_name || 'Uncategorized');
      }
    }
  }
  return map;
}

/**
 * Reduce a player_api.php response to the account facts publishing cares about.
 */
function parseAccountInfo(info) {
  const u = (info && info.user_info) || {};
  const exp = Number(u.exp_date);
  const formats = Array.isArray(u.allowed_output_formats)
    ? u.allowed_output_formats.map((f) => String(f).toLowerCase())
    : [];
  return {
    status: u.status || '',
    expiresAt: exp > 0 ? new Date(exp * 1000).toISOString() : null, // null = no expiry
    maxConnections: Number(u.max_connections) || 0,
    activeConnections: Number(u.active_cons) || 0,
    allowedFormats: formats, // empty = panel did not say
    checkedAt: new Date().toISOString(),
  };
}

/** Fetch only the account info (cheap: no stream list). */
async function fetchXtreamAccountInfo(host, username, password) {
  const base = buildBase(host);
  const info = await fetchJson(`${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`);
  if (!info || info.user_info === undefined) throw new Error('Invalid Xtream credentials or server response');
  return parseAccountInfo(info);
}

/**
 * Full account check for the "verify source" action: auth, status, expiry, connections.
 * Account-level problems come back as `problem` instead of throwing.
 */
async function verifyXtreamAccount(host, username, password) {
  const base = buildBase(host);
  const info = await fetchJson(`${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`);
  const u = info && info.user_info;
  if (!u) return { ok: false, problem: 'El servidor no reconoce las credenciales (usuario inexistente o respuesta inválida).' };

  const account = parseAccountInfo(info);
  const auth = Number(u.auth);
  const status = String(u.status || '').toLowerCase();
  let problem = null;
  if (auth === 0) problem = 'Autenticación rechazada: usuario o contraseña incorrectos.';
  else if (status === 'banned') problem = 'La cuenta está baneada.';
  else if (status === 'disabled') problem = 'La cuenta está deshabilitada.';
  else if (status === 'expired' || (account.expiresAt && new Date(account.expiresAt) < new Date())) problem = 'La suscripción está expirada.';
  else if (status && status !== 'active') problem = `Estado de cuenta: ${u.status}.`;

  return {
    ok: !problem,
    problem,
    status: u.status || '',
    expiresAt: account.expiresAt,
    isTrial: String(u.is_trial) === '1',
    maxConnections: account.maxConnections,
    activeConnections: account.activeConnections,
  };
}

/**
 * Fetch all live streams from the Xtream Codes panel and convert them
 * into channel objects compatible with importChannels().
 *
 * @param {string} host     - Xtream server URL, e.g. "http://server.com:8080"
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ channels: Array, epgUrl: string }>}
 */
async function fetchXtreamChannels(host, username, password) {
  const base = buildBase(host);

  // 1. Validate credentials & get server info
  const infoUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const info = await fetchJson(infoUrl);

  if (!info || info.user_info === undefined) {
    throw new Error('Invalid Xtream credentials or server response');
  }
  if (info.user_info && info.user_info.auth === 0) {
    throw new Error('Xtream authentication failed: invalid username or password');
  }

  // Extract EPG URL if present
  const epgUrl = (info.server_info && info.server_info.epg_url) ? info.server_info.epg_url : '';

  // 2. Fetch categories for group-title mapping
  const categories = await fetchCategories(base, username, password);

  // 3. Fetch all live streams
  const streamsUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
  const streams = await fetchJson(streamsUrl);

  if (!Array.isArray(streams)) {
    throw new Error('Unexpected response format from Xtream live streams API');
  }

  // Prefer ts; use m3u8 when the panel only allows that
  const account = parseAccountInfo(info);
  const ext = account.allowedFormats.length && !account.allowedFormats.includes('ts') && account.allowedFormats.includes('m3u8')
    ? 'm3u8'
    : 'ts';

  const channels = streams
    .filter((s) => s && s.stream_id)
    .map((s) => {
      const streamId = String(s.stream_id);
      const groupTitle = categories.get(String(s.category_id)) || s.category_name || '';
      const streamUrl = `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;

      return {
        name: (s.name || s.stream_display_name || 'Unknown Channel').trim(),
        url: streamUrl,
        tvgId:    String(s.epg_channel_id || s.stream_id || ''),
        tvgName:  (s.name || '').trim(),
        tvgLogo:  s.stream_icon || s.thumbnail || '',
        groupTitle,
        catchup:  '',
        catchupSource: '',
        catchupDays: 0,
        httpUserAgent: '',
        referrer: '',
      };
    });

  return { channels, epgUrl, account };
}

module.exports = { fetchXtreamChannels, verifyXtreamAccount, fetchXtreamAccountInfo, buildBase };
