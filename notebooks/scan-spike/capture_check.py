"""Aufnahme-Vorabcheck für Spike-Videos (P5-Vorstufe, läuft lokal ohne GPU).

Misst pro Video, ob das Material für die Scan-Kette überhaupt taugt, BEVOR
GPU-Zeit in Colab investiert wird: Schärfe (Laplacian-Varianz), Helligkeit,
Anteil unscharfer Frames, Dauer/Auflösung. Schwellwerte sind v0-Richtwerte
aus der Praxis (Blur < 100 gilt bei 1080p als unscharf).

Aufruf:
    uv run --with opencv-python-headless --with numpy \
        python capture_check.py testdata/r1/*.mov
Ausgabe: Markdown-Tabelle auf stdout (für reports/ kopieren) + JSON daneben.
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np

# v0-Richtwerte: Laplacian-Varianz auf Graubild (1080p). Unter BLUR_HART ist
# ein Frame für Tiefe/Detektion praktisch unbrauchbar.
BLUR_HART = 60.0
BLUR_WEICH = 100.0
SAMPLE_FPS = 4  # geprüfte Frames pro Sekunde (Kompromiss Genauigkeit/Laufzeit)


def analysiere(video: Path) -> dict[str, object]:
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"Kann Video nicht öffnen: {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    schritt = max(1, round(fps / SAMPLE_FPS))

    blur_werte: list[float] = []
    helligkeit: list[float] = []
    idx = 0
    while True:
        ok = cap.grab()
        if not ok:
            break
        if idx % schritt == 0:
            ok, frame = cap.retrieve()
            if ok:
                grau = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                blur_werte.append(float(cv2.Laplacian(grau, cv2.CV_64F).var()))
                helligkeit.append(float(grau.mean()))
        idx += 1
    cap.release()

    blur = np.array(blur_werte)
    hell = np.array(helligkeit)
    return {
        "video": video.name,
        "aufloesung": f"{w}×{h}",
        "fps": round(fps, 2),
        "dauer_s": round(n_frames / fps, 1) if fps else None,
        "gepruefte_frames": len(blur_werte),
        "blur_median": round(float(np.median(blur)), 1),
        "blur_p10": round(float(np.percentile(blur, 10)), 1),
        "anteil_unscharf_hart_pct": round(float((blur < BLUR_HART).mean() * 100), 1),
        "anteil_unscharf_weich_pct": round(float((blur < BLUR_WEICH).mean() * 100), 1),
        "helligkeit_median": round(float(np.median(hell)), 1),
        "anteil_dunkel_pct": round(float((hell < 60).mean() * 100), 1),
        "anteil_ueberbelichtet_pct": round(float((hell > 220).mean() * 100), 1),
    }


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        raise SystemExit(__doc__)
    ergebnisse = [analysiere(Path(p)) for p in argv[1:]]

    spalten = list(ergebnisse[0].keys())
    print("| " + " | ".join(spalten) + " |")
    print("|" + "---|" * len(spalten))
    for e in ergebnisse:
        print("| " + " | ".join(str(e[s]) for s in spalten) + " |")

    out = Path(argv[1]).parent / "capture-check.json"
    out.write_text(json.dumps(ergebnisse, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nJSON: {out}")


if __name__ == "__main__":
    main(sys.argv)
