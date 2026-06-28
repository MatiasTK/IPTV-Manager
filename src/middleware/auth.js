'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

// Must match the names used in routes/auth.js
// __Host- prefix requires HTTPS — use plain names in HTTP dev
const COOKIE_NAME = config.isProduction ? '__Host-session' : 'session';
const CSRF_COOKIE  = config.isProduction ? '__Host-csrf'    : 'csrf';

/**
 * JWT Authentication Middleware.
 *
 * Reads the JWT from the HttpOnly cookie (name depends on environment).
 * Rejects algorithm 'none' and hardcodes HS256 verification.
 * Validates 'exp' claim automatically via jsonwebtoken.
 *
 * On success: sets req.user = { id, username }
 * On failure: returns 401 JSON (fail-closed)
 */
function authMiddleware(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  let payload;
  try {
    // Hardcode algorithm — never derive from unverified token header
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    // Clear invalid cookie
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'Strict',
      path: '/',
    });
    return res.status(401).json({ error: 'Session expired or invalid.' });
  }

  req.user = { id: payload.sub, username: payload.username };
  next();
}

/**
 * CSRF Double-Submit Cookie Middleware.
 *
 * For state-changing requests (POST, PUT, PATCH, DELETE):
 *  - Reads 'X-CSRF-Token' from request headers
 *  - Compares against the CSRF cookie value
 *  - Uses timing-safe comparison to prevent timing attacks
 *
 * The frontend must:
 *  1. Read the CSRF cookie value via document.cookie (not HttpOnly)
 *  2. Send it in the X-CSRF-Token header on every mutating request
 */
function csrfMiddleware(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();

  const tokenFromHeader = req.headers['x-csrf-token'];
  const tokenFromCookie = req.cookies && req.cookies[CSRF_COOKIE];

  if (!tokenFromHeader || !tokenFromCookie) {
    return res.status(403).json({ error: 'CSRF token missing.' });
  }

  // Timing-safe comparison
  const crypto = require('crypto');
  const a = Buffer.from(tokenFromHeader);
  const b = Buffer.from(tokenFromCookie);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'CSRF token mismatch.' });
  }

  next();
}

module.exports = { authMiddleware, csrfMiddleware };
