"""Extract sharp frames from a room video (ffmpeg + Laplacian sharpness filter)."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def extract_frames(video: str, out_dir: str | Path, fps: float = 2.0,
                   max_width: int = 1600) -> list[Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not found - install it (apt-get install ffmpeg)")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(video),
         "-vf", f"fps={fps},scale={max_width}:-1",
         str(out / "frame_%04d.jpg")],
        check=True, capture_output=True,
    )
    frames = sorted(out.glob("frame_*.jpg"))
    return _drop_blurry(frames)


def _drop_blurry(frames: list[Path], min_var: float = 60.0) -> list[Path]:
    try:
        import cv2
    except ImportError:
        return frames
    kept: list[Path] = []
    for f in frames:
        img = cv2.imread(str(f), cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue
        if cv2.Laplacian(img, cv2.CV_64F).var() >= min_var:
            kept.append(f)
    return kept or frames  # never drop everything
