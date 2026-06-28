'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const db = require('../db/database');
const config = require('../config');

/**
 * Health Checker — Background Job
 *
 * Periodically checks all active channel stream URLs.
 * - Uses HEAD requests (never downloads content)
 * - Classifies as: healthy (<1s), degraded (1-5s), down (error/timeout)
 * - Auto-switches primary channels to healthy alternatives when primary goes down
 * - Limits concurrency to avoid network saturation
 * - Purges health check history older than 7 days
 */

const getActiveChannelsStmt = db.prepare(`
  SELECT id, url, name, health_status, http_user_agent, referrer FROM channels WHERE is_active = 1
`);

const updateChannelHealthStmt = db.prepare(`
  UPDATE channels
  SET health_status = ?, health_latency_ms = ?, last_health_check = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const insertHealthCheckStmt = db.prepare(`
  INSERT INTO health_checks (channel_id, status, latency_ms, http_status, error_message)
  VALUES (?, ?, ?, ?, ?)
`);

const purgeOldChecksStmt = db.prepare(`
  DELETE FROM health_checks
  WHERE checked_at < datetime('now', '-7 days')
`);

const getAlternativesStmt = db.prepare(`
  SELECT ca.alternative_channel_id AS id, c.url, c.health_status
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

// Track auto-switch events in memory (visible in Health UI)
const autoSwitchLog = [];
const MAX_SWITCH_LOG = 100;

/**
 * Make a HEAD request to a URL with timeout.
 * @param {string} urlStr
 * @param {number} timeoutMs
 * @returns {Promise<{ status: string, latencyMs: number, httpStatus: number|null, error: string|null }>}
 */
function checkUrl(urlStr, timeoutMs, httpUserAgent = '', referrer = '', method = 'HEAD', redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 5) {
      return resolve({ status: 'down', latencyMs: 0, httpStatus: null, error: 'Too many redirects' });
    }

    const start = Date.now();

    let parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch {
      return resolve({ status: 'down', latencyMs: 0, httpStatus: null, error: 'Invalid URL' });
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers = {
      'User-Agent': httpUserAgent || 'VLC/3.0.18 LibVLC/3.0.18',
    };
    if (referrer) {
      headers['Referer'] = referrer;
    }

    const options = {
      method: method,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      headers: headers,
      timeout: timeoutMs,
    };

    const req = transport.request(options, (res) => {
      const latencyMs = Date.now() - start;

      // Handle redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        req.destroy();
        const location = res.headers.location;
        const nextUrl = location.startsWith('http') ? location : new URL(location, urlStr).toString();
        checkUrl(nextUrl, timeoutMs, httpUserAgent, referrer, method, redirectCount + 1)
          .then((redirectResult) => {
            resolve({
              ...redirectResult,
              latencyMs: latencyMs + redirectResult.latencyMs,
            });
          });
        return;
      }

      req.destroy(); // don't read body

      // If HEAD request failed due to client error/method not allowed, retry with GET
      if (method === 'HEAD' && (res.statusCode === 400 || res.statusCode === 403 || res.statusCode === 405 || res.statusCode === 401)) {
        checkUrl(urlStr, timeoutMs, httpUserAgent, referrer, 'GET', redirectCount).then(resolve);
        return;
      }

      let statusStr;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        statusStr = latencyMs < 1000 ? 'healthy' : latencyMs < 5000 ? 'degraded' : 'down';
      } else {
        statusStr = 'down';
      }

      resolve({
        status: statusStr,
        latencyMs,
        httpStatus: res.statusCode,
        error: null,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 'down',
        latencyMs: timeoutMs,
        httpStatus: null,
        error: 'Timeout',
      });
    });

    req.on('error', (err) => {
      // Retry with GET on general errors too, just in case
      if (method === 'HEAD') {
        checkUrl(urlStr, timeoutMs, httpUserAgent, referrer, 'GET', redirectCount).then(resolve);
        return;
      }
      resolve({
        status: 'down',
        latencyMs: Date.now() - start,
        httpStatus: null,
        error: err.message,
      });
    });

    req.end();
  });
}

/**
 * Run health check for a batch of channels with concurrency limit.
 */
async function checkChannels(channels, timeoutMs, concurrency) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < channels.length) {
      const ch = channels[idx++];
      const result = await checkUrl(ch.url, timeoutMs, ch.http_user_agent, ch.referrer);
      results.push({ channel: ch, result });
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, channels.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/**
 * Perform auto-switch for a channel that went 'down'.
 * Finds the best healthy alternative and logs the switch.
 */
function handleAutoSwitch(channel) {
  const alternatives = getAlternativesStmt.all(channel.id);
  const bestAlt = alternatives.find((a) => a.health_status === 'healthy' || a.health_status === 'degraded');

  if (bestAlt) {
    const event = {
      timestamp: new Date().toISOString(),
      channelId: channel.id,
      channelName: channel.name,
      fromUrl: channel.url,
      toUrl: bestAlt.url,
      alternativeId: bestAlt.id,
      reason: 'primary_down',
    };

    autoSwitchLog.unshift(event);
    if (autoSwitchLog.length > MAX_SWITCH_LOG) autoSwitchLog.pop();

    console.log(`[HealthChecker] Auto-switch: "${channel.name}" → alternative #${bestAlt.id}`);
  }
}

/**
 * Run a full health check cycle.
 */
async function runHealthCheck() {
  const enabledSetting = db.prepare("SELECT value FROM settings WHERE key = 'health_check_enabled'").get();
  if (enabledSetting && enabledSetting.value === '0') return;

  const channels = getActiveChannelsStmt.all();
  if (channels.length === 0) return;

  console.log(`[HealthChecker] Checking ${channels.length} channels...`);

  const results = await checkChannels(
    channels,
    config.healthCheck.timeoutMs,
    config.healthCheck.concurrency
  );

  const upsert = db.transaction((items) => {
    for (const { channel, result } of items) {
      const prevStatus = channel.health_status;

      updateChannelHealthStmt.run(result.status, result.latencyMs, channel.id);
      insertHealthCheckStmt.run(
        channel.id,
        result.status,
        result.latencyMs,
        result.httpStatus,
        result.error
      );

      // Auto-switch if newly went down
      if (prevStatus !== 'down' && result.status === 'down') {
        handleAutoSwitch(channel);
      }
    }

    // Purge old history
    purgeOldChecksStmt.run();
  });

  upsert(results);

  const healthy = results.filter((r) => r.result.status === 'healthy').length;
  const degraded = results.filter((r) => r.result.status === 'degraded').length;
  const down = results.filter((r) => r.result.status === 'down').length;
  console.log(`[HealthChecker] Done. ✅ ${healthy} healthy, ⚠️ ${degraded} degraded, ❌ ${down} down`);
}

/**
 * Check a single channel by ID. Used by the API for on-demand checks.
 */
async function checkSingleChannel(channelId) {
  const channel = db.prepare('SELECT id, url, name, health_status, http_user_agent, referrer FROM channels WHERE id = ?').get(channelId);
  if (!channel) return null;

  const result = await checkUrl(channel.url, config.healthCheck.timeoutMs, channel.http_user_agent, channel.referrer);

  const prevStatus = channel.health_status;
  updateChannelHealthStmt.run(result.status, result.latencyMs, channel.id);
  insertHealthCheckStmt.run(channel.id, result.status, result.latencyMs, result.httpStatus, result.error);

  if (prevStatus !== 'down' && result.status === 'down') {
    handleAutoSwitch(channel);
  }

  return { channel, result };
}

/**
 * Start the background health check job.
 * Returns a stop function.
 */
function startHealthChecker() {
  console.log(`[HealthChecker] Starting. Interval: ${config.healthCheck.intervalMs}ms`);

  // Run immediately on startup (delayed 10s to let server stabilize)
  const initialTimeout = setTimeout(() => runHealthCheck().catch(console.error), 10000);

  const interval = setInterval(() => {
    runHealthCheck().catch(console.error);
  }, config.healthCheck.intervalMs);

  return function stop() {
    clearTimeout(initialTimeout);
    clearInterval(interval);
  };
}

module.exports = { startHealthChecker, runHealthCheck, checkSingleChannel, autoSwitchLog };
