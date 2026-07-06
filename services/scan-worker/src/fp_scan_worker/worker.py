"""Gradio-Worker für Colab: Scan-Bundle → scene.ply + layout.txt.

Diese Datei bündelt die Colab-/GPU-Teile. Alle schweren Imports (gradio, cv2,
torch/transformers, SpatialLM) passieren **innerhalb** der Funktionen und sind
guarded – so bleibt das Modul auf einer reinen CPU-Maschine importierbar (der
Geometrie-Kern und die Tests hängen nicht daran). Ablauf und Deploy-Zeiger v0
sind im Brain beschrieben (POC-Demo-Architektur-HF).
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from fp_scan_worker.pipeline import (
    PosenLite,
    TiefenProvider,
    baue_punktwolke,
    outlier_filter,
    parse_posen_lite,
)
from fp_scan_worker.ply import schreibe_ply

__all__ = ["erstelle_app", "schaetze_intrinsics"]

_NUR_COLAB = "läuft nur auf Colab, siehe notebooks/colab_worker.ipynb"


def schaetze_intrinsics(breite: int, hoehe: int) -> NDArray[np.float64]:
    """Grobe Intrinsics aus der Video-Auflösung (v0).

    fx = fy ≈ 0.9 · max(Breite, Höhe), Hauptpunkt in der Bildmitte – eine für
    Handy-Weitwinkel brauchbare Schätzung. Später kommen die echten Werte aus den
    AR-Metadaten (ARKit/ARCore liefern die Kamera-Intrinsics pro Frame mit).
    """
    f = 0.9 * float(max(breite, hoehe))
    return np.array(
        [
            [f, 0.0, breite / 2.0],
            [0.0, f, hoehe / 2.0],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )


def _frames_aus_video(
    video: Path, indizes: list[int]
) -> tuple[dict[int, NDArray[np.uint8]], int, int]:
    """Liest die angeforderten Frame-Indizes aus dem Video (guarded cv2)."""
    try:
        import cv2
    except ImportError as e:  # pragma: no cover - nur Colab
        raise RuntimeError(f"cv2 (opencv-python-headless) {_NUR_COLAB}") from e

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError(f"Video nicht lesbar: {video}")
    gesucht = set(indizes)
    frames: dict[int, NDArray[np.uint8]] = {}
    breite = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    hoehe = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    i = 0
    while gesucht:
        ok, bild = cap.read()
        if not ok:
            break
        if i in gesucht:
            frames[i] = cv2.cvtColor(bild, cv2.COLOR_BGR2RGB)
            gesucht.discard(i)
        i += 1
    cap.release()
    return frames, breite, hoehe


def _depth_anything_provider(frames: dict[int, NDArray[np.uint8]]) -> TiefenProvider:
    """Baut einen ``TiefenProvider`` mit Depth Anything V2 Small (guarded torch/transformers).

    Depth Anything V2 **Small** ist Apache-lizenziert (CLAUDE.md §4); grössere
    Varianten sind CC-BY-NC und hier verboten.
    """
    try:
        import torch  # noqa: F401  (Verfügbarkeit prüfen; pipeline nutzt es intern)
        from transformers import pipeline as hf_pipeline
    except ImportError as e:  # pragma: no cover - nur Colab
        raise RuntimeError(f"Depth Anything (torch/transformers) {_NUR_COLAB}") from e

    schaetzer = hf_pipeline(
        task="depth-estimation",
        model="depth-anything/Depth-Anything-V2-Small-hf",
    )

    def provider(index: int) -> NDArray[np.float32]:
        from PIL import Image

        bild = Image.fromarray(frames[index])
        tiefe = schaetzer(bild)["depth"]
        return np.asarray(tiefe, dtype=np.float32)

    return provider


# Standard-Checkpoint: SpatialLM 1.1 mit Qwen-0.5B-Backbone (CC-BY-NC → nur
# Colab). Über FP_SPATIALLM_MODELL überschreibbar (z. B. die Llama-1B-Variante).
_SPATIALLM_MODELL_DEFAULT = "manycore-research/SpatialLM1.1-Qwen-0.5B"


def _lauf_spatiallm(ply_pfad: Path) -> str:
    """Führt SpatialLM auf der Punktwolke aus und liefert den ``layout.txt``-Text.

    Verdrahtet die SpatialLM-Vorverarbeitung **nicht** neu, sondern ruft das
    offizielle ``inference.py`` aus dem geklonten SpatialLM-Repo als Subprozess
    auf (``-p <ply> -o <layout.txt> -m <modell>``). Dessen Textausgabe
    (``layout.to_language_string()``) *ist* der ``layout.txt``-Vertrag, den
    ``fp_engines.scan.spatiallm`` parst – so bleibt der Aufruf robust gegen
    interne API-Änderungen von SpatialLM statt sie nachzubauen.

    SpatialLM ist CC-BY-NC – nur Colab, nie feste Dependency (CLAUDE.md §4). Das
    Repo-Verzeichnis kommt aus ``FP_SPATIALLM_DIR`` (Default: ``SpatialLM``); die
    Setup-Zelle des Colab-Notebooks klont es dorthin und setzt die Env-Variablen.
    """
    repo_dir = Path(os.environ.get("FP_SPATIALLM_DIR", "SpatialLM"))
    inferenz = repo_dir / "inference.py"
    if not inferenz.is_file():  # pragma: no cover - nur Colab
        raise RuntimeError(
            f"SpatialLM-Repo nicht gefunden ({inferenz}) – {_NUR_COLAB}. "
            "Die Setup-Zelle klont es nach FP_SPATIALLM_DIR."
        )

    modell = os.environ.get("FP_SPATIALLM_MODELL", _SPATIALLM_MODELL_DEFAULT)
    layout_pfad = ply_pfad.with_suffix(".layout.txt")
    ergebnis = subprocess.run(
        [
            sys.executable,
            "inference.py",
            "-p",
            str(ply_pfad),
            "-o",
            str(layout_pfad),
            "-m",
            modell,
        ],
        cwd=str(repo_dir),
        capture_output=True,
        text=True,
    )
    if ergebnis.returncode != 0 or not layout_pfad.is_file():  # pragma: no cover - nur Colab
        schwanz = (ergebnis.stderr or ergebnis.stdout or "")[-2000:]
        raise RuntimeError(
            f"SpatialLM-Inferenz fehlgeschlagen (Code {ergebnis.returncode}, Modell "
            f"{modell}):\n{schwanz}"
        )
    return layout_pfad.read_text(encoding="utf-8")


def _scanne(
    bundle_zip: str | None,
    keyframe_schritt: int = 10,
) -> tuple[str, str | None, str | None]:
    """Gradio-Handler: Scan-Bundle (.zip) → (Status-Text, scene.ply, layout.txt)."""
    if not bundle_zip:
        return "Kein Scan-Bundle hochgeladen.", None, None

    arbeit = Path(tempfile.mkdtemp(prefix="fp_scan_"))
    with zipfile.ZipFile(bundle_zip) as zf:
        zf.extractall(arbeit)

    poses_datei = next(arbeit.rglob("poses.json"), None)
    if poses_datei is None:
        return "poses.json fehlt im Bundle.", None, None
    video_datei = next(
        (p for p in arbeit.rglob("video.*") if p.suffix.lower() in {".mp4", ".mov", ".m4v"}),
        None,
    )
    if video_datei is None:
        return "video.* (mp4/mov) fehlt im Bundle.", None, None

    posen: PosenLite = parse_posen_lite(poses_datei.read_text(encoding="utf-8"))
    indizes = list(range(0, len(posen.frames), keyframe_schritt))
    frames, breite, hoehe = _frames_aus_video(video_datei, indizes)
    k = schaetze_intrinsics(breite, hoehe)

    tiefen = _depth_anything_provider(frames)
    wolke = baue_punktwolke(posen, tiefen, k, keyframe_schritt=keyframe_schritt)
    wolke = outlier_filter(wolke)

    ply_pfad = arbeit / "scene.ply"
    schreibe_ply(ply_pfad, wolke)

    layout_text = _lauf_spatiallm(ply_pfad)
    layout_pfad = arbeit / "layout.txt"
    layout_pfad.write_text(layout_text, encoding="utf-8")

    status = f"OK: {len(wolke)} Punkte aus {len(indizes)} Keyframes fusioniert."
    return status, str(ply_pfad), str(layout_pfad)


def erstelle_app() -> Any:
    """Baut die Gradio-App (Import von gradio erst hier – Colab-only)."""
    try:
        import gradio as gr
    except ImportError as e:  # pragma: no cover - nur Colab
        raise RuntimeError(f"gradio {_NUR_COLAB} (pip install fp-scan-worker[worker])") from e

    with gr.Blocks(title="FP Scan-Worker") as app:
        gr.Markdown(
            "# Future Planning – Scan-Worker\n"
            "Scan-Bundle (.zip mit `video.*` + `poses.json`) hochladen und scannen."
        )
        bundle = gr.File(label="Scan-Bundle (.zip)", file_types=[".zip"], type="filepath")
        knopf = gr.Button("Scannen", variant="primary")
        status = gr.Textbox(label="Status", interactive=False)
        ply_out = gr.File(label="scene.ply")
        layout_out = gr.File(label="layout.txt")
        knopf.click(_scanne, inputs=bundle, outputs=[status, ply_out, layout_out])

    return app


if __name__ == "__main__":
    app = erstelle_app()
    app.launch(share=True)
    print(
        "Zeiger v0: share-URL manuell im Space als FP_SCAN_WORKER_URL setzen "
        "(Gist-Automation folgt später)."
    )
