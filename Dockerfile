# Hugging-Face-Space `Bryan-HSLU/FP_POC` (Docker-SDK, CPU, Port 7860).
#
# Multi-Stage, weil Frontend-Build (Node/pnpm) und Engines-Laufzeit (Python/uv)
# unterschiedliche Toolchains brauchen; nur das Build-Ergebnis (apps/web/dist)
# wandert in das schlanke Python-Image. Die Repo-Struktur bleibt im Image
# erhalten (/repo/apps/web/dist, /repo/data, /repo/packages/shared,
# /repo/services/engines), weil die Engines Stammdaten und Schemas zur
# Laufzeit über REPO_ROOT relativ zu ihrer eigenen Datei lesen (siehe
# services/engines/src/fp_engines/api.py bzw. space.py).

# --- Stage 1: Frontend bauen -------------------------------------------------
FROM node:22-alpine AS webbuild

RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @fp/web build

# --- Stage 2: Engines-Laufzeit + gebautes Frontend --------------------------
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /uvx /usr/local/bin/

RUN useradd --create-home --uid 1000 user

WORKDIR /repo
COPY . .
COPY --from=webbuild /repo/apps/web/dist ./apps/web/dist
RUN chown -R user:user /repo

USER user
ENV UV_CACHE_DIR=/tmp/uv-cache

RUN uv --project services/engines sync --frozen --no-dev

EXPOSE 7860
# WICHTIG: --no-sync + --frozen, damit `uv run` beim CONTAINERSTART die beim Build
# fertig installierte Umgebung NICHT neu auflöst (kein Netzwerk/Index-Zugriff).
# Ohne das versucht uv run bei jedem Start zu syncen → auf HF flakiger Start
# ("Runtime error"/Startup-Hang). So ist der Start deterministisch und schnell.
CMD ["uv", "--project", "services/engines", "run", "--no-sync", "--frozen", "uvicorn", "fp_engines.space:app", "--host", "0.0.0.0", "--port", "7860"]
