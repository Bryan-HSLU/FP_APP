"""Modul 2 orchestration: video (real photogrammetry) or synthetic -> room model."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import numpy as np

from fp.m2_capture.export import write_room
from fp.m2_capture.openings import detect_openings
from fp.m2_capture.structure import detect_structure
from fp.schemas import RoomModel


def _load_ply(path: str | Path) -> np.ndarray:
    import trimesh

    geo = trimesh.load(str(path), process=False)
    pts = getattr(geo, "vertices", None)
    if pts is None:
        raise RuntimeError(f"could not read points from {path}")
    return np.asarray(pts)


def reconstruct_cloud(video: str, work_dir: str | Path,
                      scale_ref: float | None, measured: float | None) -> np.ndarray:
    """Real photogrammetry: frames -> COLMAP SfM -> OpenMVS dense -> metric cloud."""
    from fp.m2_capture.colmap import run_sfm
    from fp.m2_capture.frames import extract_frames
    from fp.m2_capture.openmvs import run_dense
    from fp.m2_capture.scale import apply_scale, pick_scale_interactive, scale_from_reference

    work = Path(work_dir)
    frames_dir = work / "frames"
    frames = extract_frames(video, frames_dir)
    if len(frames) < 8:
        raise RuntimeError(f"only {len(frames)} usable frames - film slower / longer")
    model0 = run_sfm(frames_dir, work / "colmap")
    dense_ply = run_dense(model0, frames_dir, work / "openmvs")
    pts = _load_ply(dense_ply)
    if scale_ref:
        factor = (scale_from_reference(scale_ref, measured) if measured
                  else pick_scale_interactive(pts, scale_ref))
        pts = apply_scale(pts, factor)
    return pts


def run_capture(
    video: str | None,
    out_dir: str | Path,
    *,
    scale_ref: float | None = None,
    measured: float | None = None,
    synthetic: bool = False,
    room_type: str = "living_room",
) -> RoomModel:
    if synthetic or not video:
        from fp.m2_capture.synthetic import generate_room_cloud

        print("[M2] using synthetic room cloud (no video / native tools needed)")
        pts = generate_room_cloud()
    else:
        work = Path(tempfile.mkdtemp(prefix="fp_m2_"))
        try:
            pts = reconstruct_cloud(video, work, scale_ref, measured)
        finally:
            shutil.rmtree(work, ignore_errors=True)

    room = detect_structure(pts, room_type=room_type)
    room.openings = detect_openings(pts, room)
    write_room(room, out_dir)
    return room
