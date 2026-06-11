#!/usr/bin/env bash
# Setup-Script für Linux/macOS und CI. Windows: scripts/setup.ps1
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Prüfe Werkzeuge..."
node --version
command -v pnpm >/dev/null || corepack enable
pnpm --version
uv --version

echo "==> Installiere Frontend-/Shared-Abhängigkeiten (pnpm)..."
pnpm install --frozen-lockfile

echo "==> Installiere Python-Engines (uv, holt Python 3.12 bei Bedarf)..."
uv --project services/engines sync

echo "==> Verifiziere: Lint + Typecheck + Tests..."
pnpm lint
pnpm typecheck
pnpm test

echo
echo "Setup OK. Starten mit:"
echo "  pnpm dev   # Frontend  -> http://localhost:5173"
echo "  pnpm api   # Engines   -> http://localhost:8000"
