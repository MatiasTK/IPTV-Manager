'use strict';

/**
 * Runs duplicate detection off the main thread: it opens its own read-only DB
 * connection, so the multi-second scan never blocks HTTP requests.
 */
const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');
const { detectDuplicates } = require('./duplicate-detector');

const { dbPath, threshold, sourceId } = workerData;
const db = new Database(dbPath, { readonly: true });
try {
  // Channels already grouped as alternatives are not candidates anymore
  const channels = db.prepare(`
    SELECT c.id, c.name, c.url, c.group_id, c.health_status, c.health_latency_ms, c.is_active,
           s.name AS source_name
    FROM channels c
    LEFT JOIN sources s ON c.source_id = s.id
    WHERE c.is_active = 1
      AND (? IS NULL OR c.source_id = ?)
      AND c.id NOT IN (SELECT alternative_channel_id FROM channel_alternatives)
  `).all(sourceId, sourceId);
  parentPort.postMessage({ groups: detectDuplicates(channels, threshold) });
} finally {
  db.close();
}
