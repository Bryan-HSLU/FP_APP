# Setup-Script für Windows (Bryans Dev-System).
# Ziel: «eine Stunde sauber starten» – frische Maschine → lauffähiges Repo.
#
# Voraussetzungen (einmalig, falls nicht vorhanden):
#   winget install OpenJS.NodeJS.LTS        # Node 22 LTS
#   winget install astral-sh.uv             # uv (holt Python 3.12 selbst)
#   corepack enable                          # aktiviert pnpm (gepinnt in package.json)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "==> Prüfe Werkzeuge..." -ForegroundColor Green
node --version
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { corepack enable }
pnpm --version
uv --version

Write-Host "==> Installiere Frontend-/Shared-Abhängigkeiten (pnpm)..." -ForegroundColor Green
pnpm install --frozen-lockfile

Write-Host "==> Installiere Python-Engines (uv, holt Python 3.12 bei Bedarf)..." -ForegroundColor Green
uv --project services/engines sync

Write-Host "==> Verifiziere: Lint + Typecheck + Tests..." -ForegroundColor Green
pnpm lint
pnpm typecheck
pnpm test

Write-Host ""
Write-Host "Setup OK. Starten mit:" -ForegroundColor Green
Write-Host "  pnpm dev   # Frontend  -> http://localhost:5173"
Write-Host "  pnpm api   # Engines   -> http://localhost:8000"
