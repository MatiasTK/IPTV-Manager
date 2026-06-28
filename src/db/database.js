'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

// Ensure data directory exists
if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

const db = new Database(config.dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialize all tables and indexes.
 * Uses CREATE TABLE IF NOT EXISTS — safe to run on every startup (idempotent).
 */
function initSchema() {
  db.exec(`
    -- ─── Users ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ─── Groups / Categories ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ─── Sources (imported M3U playlists) ────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT DEFAULT '',
      type TEXT NOT NULL DEFAULT 'url',
      last_synced_at DATETIME,
      auto_sync INTEGER DEFAULT 0,
      sync_interval_hours INTEGER DEFAULT 24,
      channel_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ─── Channels ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      tvg_id TEXT DEFAULT '',
      tvg_name TEXT DEFAULT '',
      tvg_logo TEXT DEFAULT '',
      group_id INTEGER,
      source_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      catchup TEXT DEFAULT '',
      catchup_source TEXT DEFAULT '',
      catchup_days INTEGER DEFAULT 0,
      http_user_agent TEXT DEFAULT '',
      referrer TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      health_status TEXT DEFAULT 'unknown',
      health_latency_ms INTEGER DEFAULT 0,
      last_health_check DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
    );

    -- ─── Channel Alternatives (duplicate grouping) ────────────────────────────
    CREATE TABLE IF NOT EXISTS channel_alternatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      primary_channel_id INTEGER NOT NULL,
      alternative_channel_id INTEGER NOT NULL,
      priority INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (primary_channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (alternative_channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      UNIQUE(primary_channel_id, alternative_channel_id)
    );

    -- ─── Health Checks (history) ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS health_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      http_status INTEGER,
      error_message TEXT,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );

    -- ─── Settings (key-value) ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- ─── Indexes ──────────────────────────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_channels_source   ON channels(source_id);
    CREATE INDEX IF NOT EXISTS idx_channels_group    ON channels(group_id);
    CREATE INDEX IF NOT EXISTS idx_channels_active   ON channels(is_active);
    CREATE INDEX IF NOT EXISTS idx_channels_health   ON channels(health_status);
    CREATE INDEX IF NOT EXISTS idx_hc_channel        ON health_checks(channel_id);
    CREATE INDEX IF NOT EXISTS idx_hc_checked_at     ON health_checks(checked_at);
    CREATE INDEX IF NOT EXISTS idx_ca_primary        ON channel_alternatives(primary_channel_id);
    CREATE INDEX IF NOT EXISTS idx_ca_alternative    ON channel_alternatives(alternative_channel_id);
  `);

  // Seed default settings if not present
  const defaults = [
    ['playlist_token', generateToken()],
    ['playlist_name', 'My IPTV Playlist'],
    ['epg_urls', ''],
    ['health_check_enabled', '1'],
    ['duplicate_threshold', '80'],
  ];

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of defaults) {
    insertSetting.run(key, value);
  }
}

function generateToken() {
  const { v4: uuidv4 } = require('uuid');
  return uuidv4();
}

initSchema();

module.exports = db;
