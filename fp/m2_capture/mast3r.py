"""Modul 2 — neural dense reconstruction via MASt3R/DUSt3R.

Requires: pip install git+https://github.com/naver/mast3r.git
GPU (CUDA) required; 6-8 GB VRAM recommended.
Not installed on Streamlit Cloud — the synthetic path is the cloud fallback.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np


def run_mast3r(
    frames_dir: str | Path,
    work_dir: str | Path,
    *,
    device: str = "cuda",
    max_frames: int = 40,
    image_size: int = 512,
) -> np.ndarray:
    """Extract a metric point cloud from pre-extracted frames using MASt3R.

    Returns an (N, 3) float32 array of 3-D points in metres (up to a global
    scale that must be resolved by the caller via structure.py).
    """
    try:
        from mast3r.model import AsymmetricMASt3R
        from dust3r.cloud_opt import GlobalAlignerMode, global_aligner
        from dust3r.image_pairs import make_pairs
        from dust3r.inference import inference
        from dust3r.utils.image import load_images
    except ImportError as exc:
        raise RuntimeError(
            "MASt3R ist nicht installiert.\n"
            "Installiere: pip install git+https://github.com/naver/mast3r.git\n"
            "Voraussetzung: CUDA-GPU mit ≥6 GB VRAM."
        ) from exc

    frames = sorted(Path(frames_dir).glob("*.jpg"))[:max_frames]
    if len(frames) < 4:
        raise RuntimeError(
            f"Zu wenige Frames ({len(frames)}) in {frames_dir}. "
            "Mindestens 4 scharfe Frames erforderlich."
        )

    model = AsymmetricMASt3R.from_pretrained(
        "naver/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric"
    ).to(device)

    images = load_images([str(f) for f in frames], size=image_size)
    pairs = make_pairs(images, scene_graph="swin", prefilter=None, symmetrize=True)
    output = inference(pairs, model, device, batch_size=4)

    scene = global_aligner(output, device=device, mode=GlobalAlignerMode.PointCloudOptimizer)
    scene.compute_global_alignment(init="mst", niter=300, schedule="cosine", lr=0.01)

    pts3d = scene.get_pts3d()
    masks = scene.get_masks()
    cloud = np.concatenate(
        [p[m].reshape(-1, 3) for p, m in zip(pts3d, masks)]
    ).astype(np.float32)
    return cloud
