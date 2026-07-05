# fp-scan-worker

GPU-Scan-Worker der App «Future Planning». **Läuft produktiv auf Google Colab
(T4)** und macht aus einem Scan-Bundle (Video + AR-Posen) den SpatialLM-Input und
das Layout:

```
poses.json + video  →  known-pose Tiefen-Fusion  →  z-up, metrisch
                    →  scene.ply (XYZ+RGB)  →  SpatialLM  →  layout.txt
```

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
- `pipeline` – Posen + Tiefen → fusionierte, z-up-Punktwolke.

Die **GPU-/Colab-Teile** (Depth Anything V2 Small, SpatialLM, open3d, cv2,
gradio in `worker.py`) sind ausschliesslich **guarded Imports** mit klarer
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
separat installiert. Keine Modelle/Gewichte ins Git.

## Auf Colab starten

Siehe [`notebooks/colab_worker.ipynb`](../../notebooks/colab_worker.ipynb):
Repo klonen → `pip install -e services/scan-worker[worker]` + GPU-Stack →
Worker mit `share=True` starten. Die share-URL wird **v0 manuell** als
`FP_SCAN_WORKER_URL` im Space hinterlegt (Gist-Automation folgt später).

## Brain-Konzepte (Source of Truth)

- ADR-0012 – Scan-Bundle-Vertrag & Repo-Trennung Worker↔Engines.
- Scan-Laufzeit-Budget-und-Beschleunigung – Keyframe-Hebel, warum kein SLAM.
- Raumerfassung-Detailkonzept – Fusion-/z-up-/Fallback-Kaskade (Stufe 3 = RANSAC).
- POC-Demo-Architektur-HF – Colab-Worker + Space, Deploy-Zeiger v0.
