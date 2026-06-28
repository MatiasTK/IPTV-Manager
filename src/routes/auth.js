'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const config = require('../config');

const router = express.Router();

// Rate limit: 5 login attempts per minute per IP
const loginLimiter = rateLimit({
  windowMs: config.rateLimit.login.windowMs,
  max: config.rateLimit.login.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many login attempts. Try again later.' }),
  skipSuccessfulRequests: true,
});

// __Host- prefix requires HTTPS (Secure flag). Use plain names in HTTP dev.
const COOKIE_NAME = config.isProduction ? '__Host-session' : 'session';
const CSRF_COOKIE = config.isProduction ? '__Host-csrf' : 'csrf';

/**
 * Set session + CSRF cookies.
 * __Host- prefix enforces: no Domain, Secure, Path=/
 */
function setSessionCookies(res, token, csrfToken) {
  const secure = config.isProduction;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24h
  });

  // CSRF cookie is NOT httpOnly — frontend JS must read it
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'Strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookies(res) {
  const opts = { httpOnly: true, secure: config.isProduction, sameSite: 'Strict', path: '/' };
  res.clearCookie(COOKIE_NAME, opts);
  res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password required.' });
  }

  // Sanitize: only allow printable ASCII for username
  if (username.length > 64 || password.length > 128) {
    return res.status(400).json({ error: 'Invalid credentials.' });
  }

  // NOTE: Never log username or password, even on failure
  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);

  // Always compare — prevent timing attacks on user enumeration
  const fakeHash = '$2b$12$invalidhashfortimingnnnnnnnnnnnnnnnnnnnnn';
  const hashToCompare = user ? user.password_hash : fakeHash;

  const valid = await bcrypt.compare(password, hashToCompare);

  if (!user || !valid) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const csrfToken = crypto.randomBytes(32).toString('hex');

  const token = jwt.sign(
    { sub: user.id, username: user.username },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: config.jwtExpiresIn }
  );

  setSessionCookies(res, token, csrfToken);
  return res.json({ ok: true, username: user.username });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  clearSessionCookies(res);
  return res.json({ ok: true });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    return res.json({ id: payload.sub, username: payload.username });
  } catch {
    clearSessionCookies(res);
    return res.status(401).json({ error: 'Session expired.' });
  }
});

module.exports = router;
