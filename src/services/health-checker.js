const http = require('http');
const https = require('https');
const { URL } = require('url');
const db = require('../db/database');
const config = require('../config');

// Keep-Alive agents to reuse TCP/TLS sockets, speeding up checks and reducing connection overhead
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 40, keepAliveMsecs: 5000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 40, keepAliveMsecs: 5000 });

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
      WHEN 'healthy'      THEN 0
      WHEN 'degraded'     THEN 1
      WHEN 'intermittent' THEN 2
      WHEN 'unknown'      THEN 3
      WHEN 'down'         THEN 4
    END,
    ca.priority
`);

const getHealthHistoryStmt = db.prepare(`
  SELECT status FROM health_checks
  WHERE channel_id = ?
  ORDER BY checked_at DESC
  LIMIT 4
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
      // Sanitize the URL before parsing: encodeURI normalises unescaped characters
      // (spaces, brackets, pipes, etc.) that are common in IPTV stream URLs but
      // cause Node's http.request to throw "Request path contains unescaped characters".
      // We first decode any existing percent-encoding so we don't double-encode,
      // then re-encode the whole thing.
      let safeUrl = urlStr;
      try {
        safeUrl = encodeURI(decodeURI(urlStr));
      } catch {
        // decodeURI can throw on malformed sequences — keep the original in that case
        safeUrl = urlStr;
      }
      parsedUrl = new URL(safeUrl);
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
      headers: headers,
      timeout: timeoutMs,
      agent: isHttps ? httpsAgent : httpAgent,
    };

    const req = transport.request(parsedUrl, options, (res) => {
      const latencyMs = Date.now() - start;

      // Handle redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        req.destroy();
        const location = res.headers.location;
        const rawNext = location.startsWith('http') ? location : new URL(location, urlStr).toString();
        let nextUrl = rawNext;
        try { nextUrl = encodeURI(decodeURI(rawNext)); } catch { /* keep raw */ }
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
 * Make a request with automatic retries on failure (sequential, only if down).
 */
async function checkUrlWithRetries(urlStr, timeoutMs, httpUserAgent = '', referrer = '', method = 'HEAD') {
  let attempt = 0;
  const maxAttempts = 1; // Direct check (no retries) to speed up diagnostic on massive lists
  let lastResult;
  while (attempt < maxAttempts) {
    attempt++;
    lastResult = await checkUrl(urlStr, timeoutMs, httpUserAgent, referrer, method);
    if (lastResult.status === 'healthy' || lastResult.status === 'degraded') {
      return lastResult; // Success! No need to retry.
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return lastResult;
}

/**
 * Run health check for a batch of channels with concurrency limit.
 */
async function checkChannels(channels, timeoutMs, concurrency) {
  const results = [];
  let idx = 0;
  let checkedCount = 0;

  async function worker() {
    while (idx < channels.length) {
      const ch = channels[idx++];
      const result = await checkUrlWithRetries(ch.url, timeoutMs, ch.http_user_agent, ch.referrer);
      results.push({ channel: ch, result });
      
      checkedCount++;
      if (checkedCount % 100 === 0 || checkedCount === channels.length) {
        console.log(`[HealthChecker] Progress: ${checkedCount}/${channels.length} channels checked...`);
      }
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
  const bestAlt = alternatives.find((a) => a.health_status === 'healthy' || a.health_status === 'degraded' || a.health_status === 'intermittent');

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

let isChecking = false;

function isCheckRunning() {
  return isChecking;
}

async function runHealthCheck(force = false) {
  if (!force) {
    const enabledSetting = db.prepare("SELECT value FROM settings WHERE key = 'health_check_enabled'").get();
    if (enabledSetting && enabledSetting.value === '0') {
      console.log('[HealthChecker] Health check is disabled in settings. Skipping.');
      return;
    }
  }

  if (isChecking) {
    console.log('[HealthChecker] Health check is already running. Skipping.');
    return;
  }

  isChecking = true;
  try {

  const channels = getActiveChannelsStmt.all();
  if (channels.length === 0) return;

  console.log(`[HealthChecker] Checking ${channels.length} channels...`);

  const results = await checkChannels(
    channels,
    config.healthCheck.timeoutMs,
    config.healthCheck.concurrency
  );

  // Batch database updates in chunks of 100 to prevent locking the event loop on large playlists
  const batchSize = 100;
  const chunkTx = db.transaction((items) => {
    for (const { channel, result } of items) {
      const prevStatus = channel.health_status;

      // Calculate health status combining current result with recent history (last 4 checks)
      const history = getHealthHistoryStmt.all(channel.id).map(r => r.status);

      const allStatuses = [result.status, ...history];
      const hasSuccess = allStatuses.some(s => s === 'healthy' || s === 'degraded');
      const hasFailure = allStatuses.some(s => s === 'down');

      let finalStatus = result.status;
      if (hasSuccess && hasFailure) {
        finalStatus = 'intermittent';
      }

      updateChannelHealthStmt.run(finalStatus, result.latencyMs, channel.id);
      insertHealthCheckStmt.run(
        channel.id,
        result.status,
        result.latencyMs,
        result.httpStatus,
        result.error
      );

      // Auto-switch if newly went down
      if (prevStatus !== 'down' && finalStatus === 'down') {
        handleAutoSwitch(channel);
      }
    }
  });

  for (let i = 0; i < results.length; i += batchSize) {
    const chunk = results.slice(i, i + batchSize);
    chunkTx(chunk);
    // Yield to the Node.js event loop
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Purge old history once per full cycle
  db.transaction(() => {
    purgeOldChecksStmt.run();
  })();

  const healthy = results.filter((r) => r.result.status === 'healthy').length;
  const degraded = results.filter((r) => r.result.status === 'degraded').length;
  const down = results.filter((r) => r.result.status === 'down').length;

  // Recalculate source priorities automatically
  recalculateSourcePriorities();

  console.log(`[HealthChecker] Done. ✅ ${healthy} healthy, ⚠️ ${degraded} degraded, ❌ ${down} down`);
  } finally {
    isChecking = false;
  }
}

/**
 * Check a single channel by ID. Used by the API for on-demand checks.
 */
async function checkSingleChannel(channelId) {
  const channel = db.prepare('SELECT id, url, name, health_status, http_user_agent, referrer FROM channels WHERE id = ?').get(channelId);
  if (!channel) return null;

  const result = await checkUrlWithRetries(channel.url, config.healthCheck.timeoutMs, channel.http_user_agent, channel.referrer);

  const prevStatus = channel.health_status;

  // Calculate health status combining current result with recent history
  const history = getHealthHistoryStmt.all(channel.id).map(r => r.status);

  const allStatuses = [result.status, ...history];
  const hasSuccess = allStatuses.some(s => s === 'healthy' || s === 'degraded');
  const hasFailure = allStatuses.some(s => s === 'down');

  let finalStatus = result.status;
  if (hasSuccess && hasFailure) {
    finalStatus = 'intermittent';
  }

  updateChannelHealthStmt.run(finalStatus, result.latencyMs, channel.id);
  insertHealthCheckStmt.run(channel.id, result.status, result.latencyMs, result.httpStatus, result.error);

  if (prevStatus !== 'down' && finalStatus === 'down') {
    handleAutoSwitch(channel);
  }

  return { channel, result };
}

/**
 * Recalculate priorities of all sources based on average channel health and latency.
 * Normalizes based on total channel count so list size does not affect priority.
 */
function recalculateSourcePriorities() {
  try {
    const sources = db.prepare('SELECT id, priority, auto_priority FROM sources').all();
    if (sources.length === 0) return;

    const sourcesWithScore = sources.map((s) => {
      const channels = db.prepare('SELECT health_status, health_latency_ms FROM channels WHERE source_id = ? AND is_active = 1').all(s.id);
      if (channels.length === 0) {
        return { id: s.id, priority: s.priority, auto: s.auto_priority, score: 0 };
      }

      let totalHealth = 0;
      let totalLatency = 0;
      const hMap = { healthy: 4, degraded: 3, intermittent: 2, unknown: 1, down: 0 };

      for (const ch of channels) {
        totalHealth += hMap[ch.health_status] ?? 1;
        totalLatency += ch.health_latency_ms || 0;
      }

      const avgHealth = totalHealth / channels.length;
      const avgLatency = totalLatency / channels.length;
      // Health is 0-3. Scaling by 1000 makes health status the dominant factor,
      // and average latency decides ties.
      const score = avgHealth * 1000 - avgLatency;

      return { id: s.id, priority: s.priority, auto: s.auto_priority, score };
    });

    const manual = sourcesWithScore.filter((s) => s.auto === 0).sort((a, b) => a.priority - b.priority);
    const auto = sourcesWithScore.filter((s) => s.auto === 1).sort((a, b) => b.score - a.score);

    const finalOrder = [];
    
    // First, place manual sources at their priority index
    for (const m of manual) {
      const idx = m.priority - 1;
      if (idx >= 0 && idx < sources.length && !finalOrder[idx]) {
        finalOrder[idx] = m;
      } else {
        finalOrder.push(m);
      }
    }

    // Fill remaining empty slots with auto-calculated sources
    let autoIdx = 0;
    for (let i = 0; i < sources.length; i++) {
      if (!finalOrder[i]) {
        if (autoIdx < auto.length) {
          finalOrder[i] = auto[autoIdx++];
        }
      }
    }

    while (autoIdx < auto.length) {
      finalOrder.push(auto[autoIdx++]);
    }

    // Update the database (1-indexed based on their index in the final order)
    const updateStmt = db.prepare('UPDATE sources SET priority = ? WHERE id = ?');
    
    db.transaction(() => {
      finalOrder.forEach((s, index) => {
        if (s) {
          updateStmt.run(index + 1, s.id);
        }
      });
    })();
  } catch (err) {
    console.error('[HealthChecker] Failed to recalculate source priorities:', err);
  }
}

/**
 * Start the background health check job.
 * Returns a stop function.
 */
function startHealthChecker() {
  console.log(`[HealthChecker] Starting. Interval: ${config.healthCheck.intervalMs}ms`);

  // Run immediately on startup (delayed 10s to let server stabilize)
  const initialTimeout = setTimeout(() => {
    console.log('[HealthChecker] Running initial startup check...');
    runHealthCheck().catch(console.error);
  }, 10000);

  const interval = setInterval(() => {
    console.log('[HealthChecker] Running scheduled health check...');
    runHealthCheck().catch(console.error);
  }, config.healthCheck.intervalMs);

  return function stop() {
    clearTimeout(initialTimeout);
    clearInterval(interval);
  };
}

module.exports = { startHealthChecker, runHealthCheck, checkSingleChannel, recalculateSourcePriorities, isCheckRunning, autoSwitchLog };
