"""Orchestrates Modul 3: profile + room -> directives (AI) -> scene (solver) -> artifacts."""

from __future__ import annotations

import json
from pathlib import Path

from fp.m3_planning.llm import generate_directives
from fp.m3_planning.solver import solve_layout
from fp.m3_planning.viz import export_gltf, render_layout
from fp.schemas import Directives, FurnitureCatalog, RoomModel, Scene, StyleProfile


def load_catalog(path: str | Path) -> FurnitureCatalog:
    return FurnitureCatalog.model_validate_json(Path(path).read_text())


def load_room(path: str | Path) -> RoomModel:
    return RoomModel.model_validate_json(Path(path).read_text())


def load_profile(path: str | Path) -> StyleProfile:
    return StyleProfile.model_validate_json(Path(path).read_text())


def plan(
    room: RoomModel,
    profile: StyleProfile,
    catalog: FurnitureCatalog,
    out_dir: str | Path,
    *,
    use_llm: bool | None = None,
) -> tuple[Directives, Scene, str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    directives, source = generate_directives(profile, room, catalog, use_llm=use_llm)
    (out / "directives.json").write_text(directives.model_dump_json(indent=2))

    scene = solve_layout(room, directives, catalog)
    gltf_path = out / "scene.gltf"
    scene.gltf_uri = str(gltf_path)
    (out / "scene.json").write_text(scene.model_dump_json(indent=2))

    export_gltf(room, scene, str(gltf_path))
    render_layout(room, scene, str(out / "layout.png"))
    return directives, scene, source
