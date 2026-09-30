"""Gradio-Worker für Colab: Scan-Bundle → scene.ply + layout.txt.

Diese Datei bündelt die Colab-/GPU-Teile. Alle schweren Imports (gradio, cv2,
torch/transformers, SpatialLM) passieren **innerhalb** der Funktionen und sind
guarded – so bleibt das Modul auf einer reinen CPU-Maschine importierbar (der
Geometrie-Kern und die Tests hängen nicht daran). Ablauf und Deploy-Zeiger v0
sind im Brain beschrieben (POC-Demo-Architektur-HF).
"""

from __future__ import annotations

import gc
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from fp_scan_worker.frames import schaerfe, waehle_frames
from fp_scan_worker.fusion import fuse_mit_farben
from fp_scan_worker.pipeline import (
    PosenLite,
    TiefenProvider,
    baue_punktwolke,
    outlier_filter,
    parse_posen_lite,
)
from fp_scan_worker.ply import schreibe_ply
from fp_scan_worker.rekonstruktion import punkte_aus_vorhersagen, richte_rekonstruktion_aus

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
    # Eigene Python-Umgebung für SpatialLM (pinnt torch 2.4.1), getrennt von der
    # MapAnything-Umgebung – sonst streiten sich die torch-Versionen.
    python = os.environ.get("FP_SPATIALLM_PYTHON", sys.executable)
    layout_pfad = ply_pfad.with_suffix(".layout.txt")
    ergebnis = subprocess.run(
        [
            python,
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


_VIDEO_SUFFIXE = {".mp4", ".mov", ".m4v"}

# Apache-2.0-Variante (kommerziell nutzbar) – die Standard-Variante
# «facebook/map-anything» ist CC-BY-NC. Über FP_MAPANYTHING_MODELL überschreibbar.
_MAPANYTHING_MODELL_DEFAULT = "facebook/map-anything-apache"
# Plausibler Raumhöhen-Bereich (m). Ausserhalb → Massstab im Korrektur-Modus prüfen.
_RAUMHOEHE_PLAUSIBEL = (2.0, 3.5)


def _oeffne_video(video: Path) -> Any:
    """cv2-VideoCapture mit ausgewerteter Orientierung (Hochformat-Videos vom iPhone)."""
    try:
        import cv2
    except ImportError as e:  # pragma: no cover - nur Colab
        raise RuntimeError(f"cv2 (opencv-python-headless) {_NUR_COLAB}") from e
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError(f"Video nicht lesbar: {video}")
    if hasattr(cv2, "CAP_PROP_ORIENTATION_AUTO"):
        cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)
    return cap


def _kandidaten_aus_video(
    video: Path, analyse_breite: int = 320
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Durchlauf 1: Zeitstempel + Schärfe JEDES Frames (auf kleiner Auflösung, schnell)."""
    import cv2

    cap = _oeffne_video(video)
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
    zeiten: list[float] = []
    schaerfen: list[float] = []
    i = 0
    while True:
        ok, bild = cap.read()
        if not ok:
            break
        grau = cv2.cvtColor(bild, cv2.COLOR_BGR2GRAY)
        h, w = grau.shape
        klein = cv2.resize(grau, (analyse_breite, max(3, round(h * analyse_breite / w))))
        zeiten.append(i / fps)
        schaerfen.append(schaerfe(klein))
        i += 1
    cap.release()
    return np.asarray(zeiten), np.asarray(schaerfen)


def _speichere_frames(video: Path, indizes: list[int], ziel: Path) -> list[Path]:
    """Durchlauf 2: die gewählten Frames in voller Auflösung als JPG ablegen."""
    import cv2

    ziel.mkdir(parents=True, exist_ok=True)
    gesucht = set(indizes)
    pfade: list[Path] = []
    cap = _oeffne_video(video)
    i = 0
    while gesucht:
        ok, bild = cap.read()
        if not ok:
            break
        if i in gesucht:
            pfad = ziel / f"{i:06d}.jpg"
            cv2.imwrite(str(pfad), bild, [cv2.IMWRITE_JPEG_QUALITY, 95])
            pfade.append(pfad)
            gesucht.discard(i)
        i += 1
    cap.release()
    return pfade


def _mapanything(bildpfade: list[Path]) -> dict[str, Any]:
    """MapAnything auf den Keyframes: Weltpunkte, Masken, Farben, Kamera-Posen.

    Gibt den GPU-Speicher danach wieder frei – SpatialLM läuft direkt im Anschluss
    auf derselben T4. ``memory_efficient_inference`` erlaubt viele Views auf
    kleinem Speicher (laut MapAnything-README vernachlässigbar langsamer).
    """
    try:
        import torch
        from mapanything.models import MapAnything
        from mapanything.utils.image import load_images
    except ImportError as e:  # pragma: no cover - nur Colab
        raise RuntimeError(f"MapAnything (torch/mapanything) {_NUR_COLAB}") from e

    modell_id = os.environ.get("FP_MAPANYTHING_MODELL", _MAPANYTHING_MODELL_DEFAULT)
    geraet = "cuda" if torch.cuda.is_available() else "cpu"
    modell = MapAnything.from_pretrained(modell_id).to(geraet)
    try:
        views = load_images([str(p) for p in bildpfade])
        vorhersagen = modell.infer(
            views,
            memory_efficient_inference=True,
            use_amp=True,
            amp_dtype="bf16",  # fällt auf der T4 (kein bf16) laut README auf fp16 zurück
            apply_mask=True,
            mask_edges=True,
            apply_confidence_mask=True,
            confidence_percentile=10,
        )
        return {
            "punkte": [v["pts3d"][0].float().cpu().numpy() for v in vorhersagen],
            "masken": [v["mask"][0, ..., 0].bool().cpu().numpy() for v in vorhersagen],
            "bilder": [v["img_no_norm"][0].float().cpu().numpy() for v in vorhersagen],
            "posen": np.stack(
                [v["camera_poses"][0].float().cpu().numpy() for v in vorhersagen]
            ).astype(np.float64),
        }
    finally:
        del modell
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def _ist_speicherfehler(e: BaseException) -> bool:
    return "out of memory" in str(e).lower()


def _outlier_mit_farben(
    punkte: NDArray[np.float64], farben: NDArray[np.uint8]
) -> tuple[NDArray[np.float64], NDArray[np.uint8]]:
    """Statistischer Ausreisser-Filter, der die Farben mitnimmt (guarded open3d)."""
    try:
        import open3d as o3d
    except ImportError:
        return punkte, farben
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(punkte)
    _, behalten = pcd.remove_statistical_outlier(nb_neighbors=10, std_ratio=1.5)
    idx = np.asarray(behalten, dtype=np.int64)
    return punkte[idx], farben[idx]


def scanne_video(
    video: Path,
    arbeit: Path,
    *,
    ziel_fps: float = 3.0,
    max_frames: int = 120,
    raumhoehe_m: float = 0.0,
) -> tuple[str, Path, Path]:
    """Normales Handy-Video (ohne AR-App, ohne LiDAR) → scene.ply + layout.txt.

    Kette (Brain: ADR-0016): Frame-Auswahl (Schärfe, ``ziel_fps`` je Sekunde –
    höher bei zügigem Filmen) → MapAnything (metrische Punkte + Posen) →
    Ausrichtung (Hochachse aus den Kameras + Bodenebene) → optional Massstab aus
    bekannter Raumhöhe → Voxel-Fusion mit Farbe → PLY → SpatialLM.
    Reicht der GPU-Speicher nicht, wird mit halb so vielen Frames wiederholt.
    """
    zeiten, schaerfen = _kandidaten_aus_video(video)
    indizes = waehle_frames(zeiten, schaerfen, ziel_fps=ziel_fps, max_frames=max_frames)
    if len(indizes) < 3:
        raise RuntimeError("Zu wenige scharfe Frames im Video – langsamer/heller filmen.")
    pfade = _speichere_frames(video, indizes, arbeit / "frames")

    hinweise: list[str] = []
    while True:
        try:
            erg = _mapanything(pfade)
            break
        except RuntimeError as e:  # torch.cuda.OutOfMemoryError erbt von RuntimeError
            if not _ist_speicherfehler(e) or len(pfade) <= 12:
                raise
            pfade = pfade[::2]
            hinweise.append(f"GPU-Speicher knapp → mit {len(pfade)} Frames wiederholt")

    punkte, farben = punkte_aus_vorhersagen(erg["punkte"], erg["masken"], erg["bilder"])
    a = richte_rekonstruktion_aus(punkte, erg["posen"])
    p = a.punkte
    faktor = 1.0
    if raumhoehe_m > 0:
        faktor = raumhoehe_m / a.raumhoehe
        p = p * faktor
        hinweise.append(f"Massstab aus Raumhöhe {raumhoehe_m:.2f} m (Faktor {faktor:.3f})")
    elif not (_RAUMHOEHE_PLAUSIBEL[0] <= a.raumhoehe <= _RAUMHOEHE_PLAUSIBEL[1]):
        hinweise.append(
            f"⚠️ Raumhöhe {a.raumhoehe:.2f} m unplausibel – Massstab im Korrektur-Modus prüfen"
        )

    p, f = fuse_mit_farben(p, farben, voxel=0.02)
    p, f = _outlier_mit_farben(p, f)
    ply_pfad = arbeit / "scene.ply"
    schreibe_ply(ply_pfad, p, f)

    layout_pfad = arbeit / "layout.txt"
    layout_pfad.write_text(_lauf_spatiallm(ply_pfad), encoding="utf-8")

    status = (
        f"OK: {len(pfade)} Keyframes aus {len(zeiten)} Frames, {len(p)} Punkte. "
        f"Raumhöhe {a.raumhoehe * faktor:.2f} m, "
        f"Kamerahöhe {a.kamerahoehe_median * faktor:.2f} m, Hochachse {a.oben_achse} "
        f"(Konsistenz {a.konsistenz:.2f}, Boden-Korrektur {a.korrektur_grad:.1f}°)."
    )
    if hinweise:
        status += " " + " · ".join(hinweise)
    return status, ply_pfad, layout_pfad


def _scanne_ar_bundle(arbeit: Path, keyframe_schritt: int) -> tuple[str, str | None, str | None]:
    """Alter Weg (ADR-0012): Video + AR-Posen → Depth Anything → known-pose Fusion."""
    poses_datei = next(arbeit.rglob("poses.json"))
    video_datei = next(
        (p for p in arbeit.rglob("video.*") if p.suffix.lower() in _VIDEO_SUFFIXE),
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

    status = f"OK (AR-Posen): {len(wolke)} Punkte aus {len(indizes)} Keyframes fusioniert."
    return status, str(ply_pfad), str(layout_pfad)


def _scanne(
    datei: str | None,
    ziel_fps: float = 3.0,
    max_frames: int = 120,
    raumhoehe_m: float = 0.0,
    keyframe_schritt: int = 10,
) -> tuple[str, str | None, str | None]:
    """Gradio-Handler: Video ODER Scan-Bundle (.zip) → (Status, scene.ply, layout.txt).

    - Video bzw. .zip ohne ``poses.json`` → **Standardweg ohne AR-App** (MapAnything).
    - .zip mit ``poses.json`` → alter AR-Posen-Weg (bleibt als Option erhalten).
    """
    if not datei:
        return "Kein Video / Scan-Bundle hochgeladen.", None, None

    arbeit = Path(tempfile.mkdtemp(prefix="fp_scan_"))
    quelle = Path(datei)
    if quelle.suffix.lower() == ".zip":
        with zipfile.ZipFile(quelle) as zf:
            zf.extractall(arbeit)
        if next(arbeit.rglob("poses.json"), None) is not None:
            return _scanne_ar_bundle(arbeit, keyframe_schritt)
        video = next((p for p in arbeit.rglob("*") if p.suffix.lower() in _VIDEO_SUFFIXE), None)
        if video is None:
            return "Kein Video (mp4/mov) im Bundle.", None, None
    elif quelle.suffix.lower() in _VIDEO_SUFFIXE:
        video = quelle
    else:
        return "Bitte ein Video (mp4/mov) oder ein .zip hochladen.", None, None

    try:
        status, ply, layout = scanne_video(
            video,
            arbeit,
            ziel_fps=float(ziel_fps),
            max_frames=int(max_frames),
            raumhoehe_m=float(raumhoehe_m or 0.0),
        )
    except RuntimeError as e:
        return f"Fehler: {e}", None, None
    return status, str(ply), str(layout)


def erstelle_app() -> Any:
    """Baut die Gradio-App (Import von gradio erst hier – Colab-only)."""
    try:
        import gradio as gr
    except ImportError as e:  # pragma: no cover - nur Colab
        raise RuntimeError(f"gradio {_NUR_COLAB} (pip install fp-scan-worker[worker])") from e

    with gr.Blocks(title="FP Scan-Worker") as app:
        gr.Markdown(
            "# Future Planning – Scan-Worker\n"
            "Normales Handy-Video des Raums hochladen (kein LiDAR, keine Spezial-App). "
            "Ein .zip mit `poses.json` nutzt den alten AR-Posen-Weg."
        )
        datei = gr.File(
            label="Video (mp4/mov) oder Scan-Bundle (.zip)",
            file_types=[".mp4", ".mov", ".m4v", ".zip"],
            type="filepath",
        )
        with gr.Row():
            ziel_fps = gr.Slider(
                1,
                8,
                value=3,
                step=0.5,
                label="Keyframes pro Sekunde (höher bei zügig gefilmtem Video)",
            )
            max_frames = gr.Slider(24, 200, value=120, step=4, label="max. Keyframes (GPU)")
            raumhoehe = gr.Number(value=0, label="bekannte Raumhöhe in m (optional, 0 = aus)")
        knopf = gr.Button("Scannen", variant="primary")
        status = gr.Textbox(label="Status", interactive=False)
        ply_out = gr.File(label="scene.ply")
        layout_out = gr.File(label="layout.txt")
        knopf.click(
            _scanne,
            inputs=[datei, ziel_fps, max_frames, raumhoehe],
            outputs=[status, ply_out, layout_out],
        )

    return app


if __name__ == "__main__":
    app = erstelle_app()
    app.launch(share=True)
    print(
        "Zeiger v0: share-URL manuell im Space als FP_SCAN_WORKER_URL setzen "
        "(Gist-Automation folgt später)."
    )
