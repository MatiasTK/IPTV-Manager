#!/usr/bin/env bash
# Levanta la aplicación completa.
#   ./scripts/run.sh          desarrollo: backend (nodemon, :3000) + frontend (vite, :5173)
#   ./scripts/run.sh --prod   producción: compila el frontend a /public y sirve todo desde :3000
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="dev"
[[ "${1:-}" == "--prod" ]] && MODE="prod"

log() { printf '\033[1;33m▶ %s\033[0m\n' "$*"; }

if [[ ! -d node_modules ]]; then log "Instalando dependencias del backend…"; npm install; fi
if [[ ! -d frontend/node_modules ]]; then log "Instalando dependencias del frontend…"; (cd frontend && npm install); fi

# Aviso si todavía no hay ningún usuario administrador
if [[ -f data/iptv.db ]]; then
  USERS=$(node -e "const D=require('better-sqlite3');try{console.log(new D('data/iptv.db',{readonly:true}).prepare('select count(*) c from users').get().c)}catch{console.log(0)}" 2>/dev/null || echo 0)
else
  USERS=0
fi
if [[ "$USERS" == "0" ]]; then
  log "No hay usuarios. Creá uno con:  npm run setup -- --username admin --password <clave-de-12+-caracteres>"
fi

if [[ "$MODE" == "prod" ]]; then
  log "Compilando frontend…"
  (cd frontend && npm run build)
  log "Backend + frontend en http://127.0.0.1:${PORT:-3000}"
  NODE_ENV=production exec node src/server.js
fi

PIDS=()
cleanup() { trap - INT TERM EXIT; kill "${PIDS[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup INT TERM EXIT

log "Backend  → http://127.0.0.1:3000"
npm run dev &
PIDS+=($!)

log "Frontend → http://localhost:5173  (abrí esta URL)"
(cd frontend && npm run dev) &
PIDS+=($!)

wait -n "${PIDS[@]}"
