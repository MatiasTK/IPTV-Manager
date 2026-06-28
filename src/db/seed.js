#!/usr/bin/env node
'use strict';

/**
 * CLI script to create the initial admin user or reset a password.
 * Usage:
 *   node src/db/seed.js --username admin --password <yourpassword>
 *   node src/db/seed.js --username admin --password <yourpassword> --reset
 *
 * NOTE: Never log passwords or hashes to stdout.
 */

const bcrypt = require('bcryptjs');
const db = require('./database');

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { reset: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && args[i + 1]) result.username = args[++i];
    if (args[i] === '--password' && args[i + 1]) result.password = args[++i];
    if (args[i] === '--reset') result.reset = true;
  }
  return result;
}

async function main() {
  const { username, password, reset } = parseArgs();

  if (!username || !password) {
    console.error('Usage: node src/db/seed.js --username <name> --password <pass> [--reset]');
    process.exit(1);
  }

  if (username.length < 3 || username.length > 64) {
    console.error('Error: username must be between 3 and 64 characters.');
    process.exit(1);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Error: password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  if (password.length > 128) {
    console.error('Error: password must not exceed 128 characters.');
    process.exit(1);
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  if (existing) {
    if (!reset) {
      console.error(`Error: user "${username}" already exists. Use --reset to update the password.`);
      process.exit(1);
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);
    console.log(`✅ Password for "${username}" updated successfully.`);
  } else {
    console.log(`Creating user "${username}"...`);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`✅ User "${username}" created successfully.`);
    console.log('   You can now start the server with: npm run dev');
  }

  // NOTE: Do NOT log the password or hash
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
