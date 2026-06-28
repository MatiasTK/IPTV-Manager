'use strict';

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('./config');

// ── Initialize DB (runs schema migrations) ────────────────────────────────────
require('./db/database');

// ── Import Routes ─────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const channelRoutes = require('./routes/channels');
const groupRoutes = require('./routes/groups');
const sourcesRoutes = require('./routes/sources');
const settingsRoutes = require('./routes/settings');
const healthRoutes = require('./routes/health');
const rawEditorRoutes = require('./routes/raw-editor');
const playlistRoutes = require('./routes/playlist');

const app = express();

// ── Security Headers (Helmet) ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow loading cross-origin resources like logos
  frameguard: { action: 'deny' },
  xContentTypeOptions: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Disable X-Powered-By
app.disable('x-powered-by');

// ── CORS ──────────────────────────────────────────────────────────────────────
// No CORS for API — same-origin only (BFF pattern)
// The public playlist endpoint is open, handled separately

// ── Body Parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '11mb' })); // Allow up to 10MB M3U + overhead
app.use(express.urlencoded({ extended: false, limit: '11mb' }));
app.use(cookieParser());

// ── Global Rate Limiting ──────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: config.rateLimit.api.windowMs,
  max: config.rateLimit.api.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests.' }),
}));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/sources', sourcesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/raw', rawEditorRoutes);

// ── Public Playlist Endpoint (no auth required) ───────────────────────────────
app.use('/playlist', playlistRoutes);

// ── Static Files (Admin Frontend) ─────────────────────────────────────────────
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, {
  index: 'index.html',
  etag: true,
  lastModified: true,
}));

// ── SPA Fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  // Don't serve SPA for API or playlist routes
  if (req.path.startsWith('/api/') || req.path.startsWith('/playlist/')) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ── Error Handler ─────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // Log detailed error server-side, never expose to client
  console.error('[Error]', err.stack || err.message);
  res.status(err.status || 500).json({ error: 'Internal server error.' });
});

// ── Start Server ──────────────────────────────────────────────────────────────
// Listen on 127.0.0.1 (localhost only) — use a reverse proxy for public access
const HOST = '127.0.0.1';

app.listen(config.port, HOST, () => {
  console.log(`\n🚀 IPTV Manager running at http://${HOST}:${config.port}`);
  console.log(`   Admin panel: http://${HOST}:${config.port}/`);
  console.log(`   Environment: ${config.nodeEnv}`);
  if (!config.isProduction) {
    const token = require('./db/database').prepare("SELECT value FROM settings WHERE key = 'playlist_token'").get();
    if (token) {
      console.log(`\n📺 M3U Link: http://${HOST}:${config.port}/playlist/${token.value}/playlist.m3u`);
    }
  }

  // ── Start Health Checker Background Job ────────────────────────────────────
  const { startHealthChecker } = require('./services/health-checker');
  startHealthChecker();
});

module.exports = app;
