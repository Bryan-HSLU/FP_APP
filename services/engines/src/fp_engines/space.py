"""Einstiegspunkt für den Hugging-Face-Space `Bryan-HSLU/FP_POC`.

Ein Space, eine Origin: Die Engines-App (`fp_engines.api`) wird unter `/api`
gemountet, das gebaute Frontend (`apps/web/dist`) unter `/`. Damit gilt im
Space **dieselbe Pfad-Semantik wie im Dev-Proxy** (`vite.config.ts`: `/api/x`
→ Engines-Route `/x`) – das Frontend ruft weiterhin nur relative `/api/*`-Pfade
auf (siehe `apps/web/src/api.ts`), ohne Origin-/CORS-Unterschied zwischen
lokalem Dev-Setup und Deploy. So bleibt `services/engines/src/fp_engines/api.py`
unverändert wiederverwendbar; dieses Modul ist reine Deploy-Verdrahtung.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from fp_engines.api import app as api_app

# Gleiche Herleitung wie in api.py: von src/fp_engines/space.py vier Ebenen
# hoch zum Repo-Root (fp_engines -> src -> engines -> services -> Repo-Root).
REPO_ROOT = Path(__file__).resolve().parents[4]
DIST = REPO_ROOT / "apps" / "web" / "dist"

app = FastAPI(title="Future Planning POC")
app.mount("/api", api_app)

if DIST.is_dir():
    # Im Docker-Image liegt das gebaute Frontend vor; lokal (ohne vorherigen
    # `pnpm build`) fehlt dist/ – dann dient der Space nur die API.
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
