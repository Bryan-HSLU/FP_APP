"""OpenMVS dense reconstruction wrapper: COLMAP sparse -> dense point cloud + mesh.

Requires OpenMVS CLI tools (InterfaceCOLMAP, DensifyPointCloud, ReconstructMesh,
TextureMesh) on PATH. CPU builds work; they are the slow part of the pipeline.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def _need(tool: str) -> str:
    path = shutil.which(tool)
    if not path:
        raise RuntimeError(f"{tool} not found - install OpenMVS CLI tools")
    return path


def run_dense(sparse_model: str | Path, image_dir: str | Path,
              work_dir: str | Path) -> Path:
    """Returns path to the dense point cloud (.ply)."""
    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    scene = work / "scene.mvs"

    subprocess.run([_need("InterfaceCOLMAP"), "-i", str(Path(sparse_model).parent.parent),
                    "--image-folder", str(image_dir), "-o", str(scene)], check=True)
    subprocess.run([_need("DensifyPointCloud"), str(scene),
                    "-o", str(work / "scene_dense.mvs")], check=True)
    dense_ply = work / "scene_dense.ply"
    if not dense_ply.exists():
        raise RuntimeError("OpenMVS densification produced no point cloud")
    return dense_ply
