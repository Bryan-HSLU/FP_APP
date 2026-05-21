"""Metric scale calibration for the SfM reconstruction.

SfM output is scale-ambiguous. The user marks two points on a known reference
(e.g. a door width) and gives the real length; we rescale the whole cloud.
The interactive picker needs a display, so headless runs pass the measured
distance directly via `measured_units`.
"""

from __future__ import annotations

import numpy as np


def apply_scale(points: np.ndarray, factor: float) -> np.ndarray:
    return points * factor


def scale_from_reference(real_meters: float, measured_units: float) -> float:
    if measured_units <= 0:
        raise ValueError("measured reference distance must be > 0")
    return real_meters / measured_units


def pick_scale_interactive(points: np.ndarray, real_meters: float) -> float:
    """Open an Open3D window, let the user pick two points, return the factor."""
    import open3d as o3d

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(points)
    vis = o3d.visualization.VisualizerWithEditing()
    vis.create_window("Pick two reference points (e.g. door edges), then close")
    vis.add_geometry(pcd)
    vis.run()
    vis.destroy_window()
    picked = vis.get_picked_points()
    if len(picked) < 2:
        raise RuntimeError("need two picked points for scale calibration")
    p0, p1 = points[picked[0]], points[picked[1]]
    measured = float(np.linalg.norm(p0 - p1))
    return scale_from_reference(real_meters, measured)
