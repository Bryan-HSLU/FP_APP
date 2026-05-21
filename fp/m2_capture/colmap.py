"""COLMAP Structure-from-Motion wrapper: frames -> camera poses + sparse cloud.

This is the real photogrammetry front-end. COLMAP must be installed
(apt-get install colmap, or build from source / use the docker image).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def run_sfm(image_dir: str | Path, work_dir: str | Path, *, sequential: bool = True) -> Path:
    """Run feature extraction -> matching -> mapping. Returns the sparse model dir."""
    if not shutil.which("colmap"):
        raise RuntimeError("colmap not found - install it (apt-get install colmap)")
    image_dir = Path(image_dir)
    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    db = work / "database.db"
    sparse = work / "sparse"
    sparse.mkdir(exist_ok=True)

    def colmap(*args: str) -> None:
        subprocess.run(["colmap", *args], check=True)

    colmap("feature_extractor", "--database_path", str(db),
           "--image_path", str(image_dir),
           "--ImageReader.single_camera", "1")
    matcher = "sequential_matcher" if sequential else "exhaustive_matcher"
    colmap(matcher, "--database_path", str(db))
    colmap("mapper", "--database_path", str(db),
           "--image_path", str(image_dir), "--output_path", str(sparse))
    # mapper writes sub-model 0
    model0 = sparse / "0"
    if not model0.exists():
        raise RuntimeError("COLMAP mapping produced no model (too few features/matches?)")
    return model0
