"""Single source of truth for all data contracts in the M1-M3 pipeline.

Handoff chain:
    M1 -> StyleProfile (style_profile.json)
    M2 -> RoomModel    (room.json + room.gltf)
    M3 -> Directives   (directives.json, LLM output)  ->  Scene (scene.json + scene.gltf)
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, Field

Vec3 = Annotated[list[float], Field(min_length=3, max_length=3)]

# Fixed, ordered names of the 8 style axes (Modul 1).
STYLE_AXES: tuple[str, ...] = (
    "color_temperature",
    "brightness",
    "materiality",
    "form_language",
    "density",
    "epoch",
    "atmosphere",
    "color_intensity",
)


# --------------------------------------------------------------------------- #
# Modul 1 - Stilanalyse
# --------------------------------------------------------------------------- #
class SwipeEvent(BaseModel):
    image_id: str
    liked: bool


class SixStyleVectors(BaseModel):
    """Six parallel preference vectors. M1 only captures; M3 interprets."""

    style_axes: list[float] = Field(description="len == len(STYLE_AXES), each in [0,1]")
    brand_origin: dict[str, float] = Field(default_factory=dict)
    design_element: dict[str, float] = Field(default_factory=dict)
    object_category: dict[str, float] = Field(default_factory=dict)
    accessory: dict[str, float] = Field(default_factory=dict)
    atmosphere_density: list[float] = Field(
        default_factory=lambda: [0.5, 0.5], description="[fullness, liveliness] in [0,1]"
    )


class StyleProfile(BaseModel):
    session_id: str
    swipe_count: int = 0
    vectors: SixStyleVectors

    def top_tags(self, field: str, n: int = 5) -> list[str]:
        d: dict[str, float] = getattr(self.vectors, field)
        return [k for k, _ in sorted(d.items(), key=lambda kv: kv[1], reverse=True)[:n]]


# --------------------------------------------------------------------------- #
# Modul 2 - Raumerfassung
# --------------------------------------------------------------------------- #
class Plane(BaseModel):
    normal: Vec3
    d: float


class Wall(BaseModel):
    id: str
    plane: Plane
    polygon: list[Vec3]


class Opening(BaseModel):
    id: str
    kind: Literal["door", "window"]
    polygon: list[Vec3]
    on_wall: str | None = None


class Fixpoint(BaseModel):
    kind: str  # e.g. "outlet", "radiator", "water"
    position: Vec3


class AABB(BaseModel):
    min: Vec3
    max: Vec3


class DetectedObject(BaseModel):
    category: str
    klass: Literal["main", "accessory"]
    bbox: AABB
    rotation_z: float = 0.0


class RoomModel(BaseModel):
    units: Literal["meters"] = "meters"
    room_type: str = "living_room"
    scale_calibrated: bool = False
    floor_polygon: list[Vec3]
    walls: list[Wall] = Field(default_factory=list)
    ceiling_height: float = 2.5
    openings: list[Opening] = Field(default_factory=list)
    fixpoints: list[Fixpoint] = Field(default_factory=list)
    detected_objects: list[DetectedObject] = Field(default_factory=list)
    gltf_uri: str | None = None

    def floor_bounds(self) -> tuple[float, float, float, float]:
        xs = [p[0] for p in self.floor_polygon]
        ys = [p[1] for p in self.floor_polygon]
        return min(xs), min(ys), max(xs), max(ys)

    def floor_area(self) -> float:
        """Shoelace area of the floor polygon (XY plane)."""
        pts = self.floor_polygon
        area = 0.0
        for i in range(len(pts)):
            x1, y1 = pts[i][0], pts[i][1]
            x2, y2 = pts[(i + 1) % len(pts)][0], pts[(i + 1) % len(pts)][1]
            area += x1 * y2 - x2 * y1
        return abs(area) / 2.0


# --------------------------------------------------------------------------- #
# Modul 3 - Planung: AI <-> Solver contract
# --------------------------------------------------------------------------- #
class OrientationPref(str, Enum):
    face_focal = "face_focal"
    against_wall = "against_wall"
    free = "free"


class FocalPoint(BaseModel):
    type: Literal["window", "door", "wall", "center"]
    ref_id: str | None = None


class Zone(BaseModel):
    name: str
    members: list[str] = Field(default_factory=list)


class GlobalParams(BaseModel):
    density: float = Field(0.5, ge=0.0, le=1.0)
    symmetry: float = Field(0.5, ge=0.0, le=1.0)
    focal_points: list[FocalPoint] = Field(default_factory=list)
    zoning: list[Zone] = Field(default_factory=list)


class DirectiveObject(BaseModel):
    id: str
    catalog_id: str
    klass: Literal["main", "accessory"]
    priority: int = 5
    quantity: int = 1
    orientation_pref: OrientationPref = OrientationPref.free


class RelationType(str, Enum):
    facing = "facing"
    near = "near"
    on_top_footprint = "on_top_footprint"
    against_wall = "against_wall"
    clear_in_front = "clear_in_front"
    not_blocking = "not_blocking"


class Relation(BaseModel):
    type: RelationType
    a: str | None = None
    b: str | None = None
    max_dist: float | None = None
    depth: float | None = None
    wall_pref: str | None = None
    opening: str | None = None


class Directives(BaseModel):
    """Exact JSON the LLM must emit. No final coordinates here."""

    room_type: str = "living_room"
    global_params: GlobalParams = Field(default_factory=GlobalParams)
    objects: list[DirectiveObject] = Field(default_factory=list)
    relations: list[Relation] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Modul 3 - Solver output
# --------------------------------------------------------------------------- #
class PlacedObject(BaseModel):
    instance_id: str
    catalog_id: str
    klass: Literal["main", "accessory"]
    position: Vec3  # center, meters
    rotation_z: float  # radians
    dimensions: Vec3  # w, d, h meters
    color: str = "#cccccc"


class Scene(BaseModel):
    room_type: str = "living_room"
    objects: list[PlacedObject] = Field(default_factory=list)
    solver_status: Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN"] = "UNKNOWN"
    violations: list[str] = Field(default_factory=list)
    gltf_uri: str | None = None


# --------------------------------------------------------------------------- #
# Furniture catalog (placeholder boxes)
# --------------------------------------------------------------------------- #
class FurnitureItem(BaseModel):
    id: str
    name: str
    klass: Literal["main", "accessory"]
    dims: Vec3  # w, d, h meters
    clearance: float = 0.0  # extra walking space inflation, meters per side
    color: str = "#cccccc"


class FurnitureCatalog(BaseModel):
    items: list[FurnitureItem]

    def by_id(self) -> dict[str, FurnitureItem]:
        return {it.id: it for it in self.items}
