# fp-scan-worker

GPU-Scan-Worker der App «Future Planning». **Läuft auf Google Colab (T4)** und
macht aus einem Raum-Video den SpatialLM-Input und das Layout.

**Standardweg (ADR-0016): normales Handy-Video, kein LiDAR, keine Spezial-App**

```
video  →  scharfe Keyframes (frames: Schärfe + N pro Sekunde)
       →  MapAnything (Apache): metrische Punkte + Kamera-Posen
       →  Ausrichtung (rekonstruktion: Hochachse aus den Kameras + Bodenebene)
       →  Voxel-Fusion mit Farbe  →  scene.ply (XYZ+RGB)  →  SpatialLM  →  layout.txt
```

Zügig gefilmte Videos brauchen **mehr Keyframes pro Sekunde** (Regler im Worker,
Default 3) – sonst fehlt die Überlappung zwischen den Bildern. Verwackelte Frames
fallen automatisch weg. Reicht der GPU-Speicher nicht, wiederholt der Worker mit
halb so vielen Frames.

**Alter Weg (ADR-0012, optional):** `.zip` mit `video.*` + `poses.json` aus einer
AR-App → Depth Anything V2 Small → known-pose Fusion. Bleibt erhalten, ist aber
nicht mehr Pflicht (es gibt keine Gratis-iOS-App, die ohne LiDAR Posen exportiert).

`layout.txt` + `scene.ply` gehen zurück an den Server; der **Adapter** in
`services/engines` (`fp_engines.scan`) macht daraus das Raummodell. **Der Worker
importiert nie aus den Engines** – strikte Repo-Trennung (Brain: ADR-0012).

## Was hier CPU-testbar ist

Der **Geometrie-Kern** läuft CPU-only mit numpy und ist voll getestet:

- `kamera` – OpenCV-Pinhole unproject (Pixel + Tiefe → Weltpunkt), Pose aus
  Quaternion. Achsen-Konvention: Kamera = OpenCV (+X rechts, +Y runter,
  +Z Blick); Pose `T_wc` (Kamera→Welt).
- `fusion` – deterministisches Voxel-Downsampling.
- `ausrichtung` – z-up aus Schwerkraft (+ RANSAC-Boden-Fallback ohne Gravity).
- `skalierung` – Metrik-Fallback aus der Raumhöhe (normal ≈ 1.0, da AR metrisch).
- `ply` – SpatialLM-Contract-PLY (binär, XYZ+RGB) schreiben/lesen.
- `pipeline` – Posen + Tiefen → fusionierte, z-up-Punktwolke (AR-Weg).
- `frames` – Schärfemass + zeitbasierte Keyframe-Auswahl.
- `rekonstruktion` – MapAnything-Ausgabe → z-up: Hochachse aus den Kamera-
  Posen (Bild-oben aller Frames), Verfeinerung per Bodenebene (RANSAC + Fit),
  Boden auf z = 0, Diagnose (Raumhöhe, Kamerahöhe).

Die **GPU-/Colab-Teile** (MapAnything, Depth Anything V2 Small, SpatialLM,
open3d, cv2, gradio in `worker.py`) sind ausschliesslich **guarded Imports** mit klarer
Fehlermeldung – auf einer CPU-Maschine ist das Paket importierbar, nur eben nicht
lauffähig.

## Setup & Tests (lokal, CPU)

```bash
uv sync
uv run pytest -q
uv run ruff check . && uv run mypy src
```

Basis-Dependency ist nur `numpy`; `gradio` steckt im Extra `worker`
(`uv sync --extra worker`). `torch` / `spatiallm` / `depth-anything` sind
**nie** feste Dependencies (NC-Lizenz SpatialLM, nur Colab) und werden dort
separat installiert – SpatialLM sogar in einer **eigenen Python-Umgebung**
(`FP_SPATIALLM_PYTHON`), weil es torch 2.4.1 pinnt. MapAnything nur als
Apache-Variante (`facebook/map-anything-apache`). Keine Modelle/Gewichte ins Git.

## Auf Colab starten

Siehe [`notebooks/colab_worker.ipynb`](../../notebooks/colab_worker.ipynb):
Repo klonen → Setup-Zelle (Worker + MapAnything; SpatialLM im eigenen venv) →
Worker mit `share=True` starten → Video hochladen. Die share-URL wird **v0 manuell** als
`FP_SCAN_WORKER_URL` im Space hinterlegt (Gist-Automation folgt später).

## Brain-Konzepte (Source of Truth)

- ADR-0016 – Scan ohne LiDAR/AR-App: Video → MapAnything (ersetzt die AR-Posen-Pflicht).
- ADR-0012 – Scan-Bundle-Vertrag & Repo-Trennung Worker↔Engines.
- Scan-Laufzeit-Budget-und-Beschleunigung – Keyframe-Hebel, warum kein SLAM.
- Raumerfassung-Detailkonzept – Fusion-/z-up-/Fallback-Kaskade (Stufe 3 = RANSAC).
- POC-Demo-Architektur-HF – Colab-Worker + Space, Deploy-Zeiger v0.
