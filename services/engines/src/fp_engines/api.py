"""Lokaler FastAPI-Dienst – API-Oberfläche gemäss Engineering-Grundlagen-POC §1.

Endpunkte kommen meilensteinweise dazu (M1: /validate, M3: /solve, /evaluate …).
Fehler-Envelope einheitlich: {code, message, details}.
"""

from typing import Any

from fastapi import FastAPI

from fp_engines import __version__

app = FastAPI(title="Future Planning – Engines", version=__version__)


@app.get("/health")
def health() -> dict[str, Any]:
    """Lebenszeichen für Setup-Script und Frontend-Proxy."""
    return {"status": "ok", "version": __version__}
