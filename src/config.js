'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Load .env if present
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

/**
 * Resolve JWT secret with multi-tiered fallback.
 * Resolution: ENV → Local File → Random Gen + Warning
 * TODO(security): In production, use a secrets manager (KMS, Vault, etc.)
 * TODO(security): Random-gen fallback is NOT suitable for multi-instance deployments.
 */
function resolveJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) {
    return process.env.JWT_SECRET;
  }
  const secretFile = path.join(__dirname, '..', 'jwt_secret.txt');
  if (fs.existsSync(secretFile)) {
    const secret = fs.readFileSync(secretFile, 'utf-8').trim();
    if (secret.length >= 32) return secret;
  }
  const generated = crypto.randomBytes(64).toString('hex');
  console.warn(
    '[SECURITY WARNING] JWT_SECRET not configured. Generated ephemeral secret.\n' +
    '  This is NOT suitable for production or multi-instance deployments.\n' +
    '  All sessions will be invalidated on server restart.\n' +
    '  Set JWT_SECRET in your .env file.'
  );
  return generated;
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: '24h',

  dataDir: path.join(__dirname, '..', 'data'),
  dbPath: path.join(__dirname, '..', 'data', 'iptv.db'),

  healthCheck: {
    intervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '900000', 10),
    timeoutMs: parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '5000', 10),
    concurrency: 10,
    historyDays: 7,
  },

  duplicate: {
    similarityThreshold: parseInt(process.env.DUPLICATE_SIMILARITY_THRESHOLD || '80', 10),
  },

  rateLimit: {
    login: { windowMs: 60 * 1000, max: 5 },
    api: { windowMs: 60 * 1000, max: 200 },
  },

  cors: {
    // Only allow same origin by default. Update for production domain.
    origin: process.env.CORS_ORIGIN || false,
  },
};

module.exports = config;
