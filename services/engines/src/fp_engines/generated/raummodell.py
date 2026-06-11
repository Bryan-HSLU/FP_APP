# AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen).

from __future__ import annotations

from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PositiveFloat,
    RootModel,
    confloat,
    constr,
)


class Source(Enum):
    scan = "scan"
    video = "video"
    plan_import = "plan-import"
    sample = "sample"
    manuell = "manuell"


class Kind(Enum):
    massiv = "massiv"
    offen = "offen"
    virtuell = "virtuell"


class Ceiling(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    height: PositiveFloat


class Type(Enum):
    door = "door"
    window = "window"


class Mount(Enum):
    wand = "wand"
    boden = "boden"


class Origin(Enum):
    bestand = "bestand"
    vorwand = "vorwand"
    manuell = "manuell"


class Repr(Enum):
    bbox = "bbox"
    mesh_simpl = "mesh-simpl"
    voxel = "voxel"


class CaptureMethod(Enum):
    ar = "ar"
    sfm = "sfm"
    plan = "plan"
    sample = "sample"
    manuell = "manuell"


class Meta(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    captureMethod: CaptureMethod
    coverageScore: confloat(ge=0.0, le=1.0) | None = None
    estimatedError_cm: confloat(ge=0.0)
    geometryConfirmed: bool = Field(
        ...,
        description="Nutzer hat Masse bestätigt → Unsicherheits-Marge der Konfidenz-Ampel wird 0.",
    )
    geometryRef: str | None = None


class Uuid(RootModel[UUID]):
    root: UUID


class Semver(RootModel[constr(pattern=r"^\d+\.\d+\.\d+$")]):
    root: constr(pattern=r"^\d+\.\d+\.\d+$")


class Vec2(RootModel[list[float]]):
    """
    [x, z] in Metern (Grundriss-Ebene).
    """

    root: list[float] = Field(
        ...,
        description="[x, z] in Metern (Grundriss-Ebene).",
        max_length=2,
        min_length=2,
    )


class Pose(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    pos: Vec2
    yawDeg: float = Field(..., description="Rotation um y in Grad (POC: 2D-Top-Down).")


class Masse(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    w: PositiveFloat
    d: PositiveFloat
    h: PositiveFloat


class RoomType(Enum):
    bad = "bad"
    kueche = "kueche"
    wohnen = "wohnen"
    schlafen = "schlafen"
    essen = "essen"
    flur = "flur"
    sonstig = "sonstig"


class AnschlussTyp(Enum):
    wasser = "wasser"
    abwasser = "abwasser"
    elektro = "elektro"
    starkstrom = "starkstrom"
    lueftung = "lueftung"
    heizung = "heizung"


class Wall(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    start: Vec2
    end: Vec2
    height: PositiveFloat
    thickness: confloat(ge=0.0)
    kind: Kind
    openings: list[Uuid] | None = None


class Floor(BaseModel):
    """
    Wird aus den Wand-Segmenten ABGELEITET/validiert, nicht doppelt gepflegt.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    polygon: list[Vec2] = Field(..., min_length=3)
    area: confloat(ge=0.0) | None = None


class Shell(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    walls: list[Wall] = Field(
        ...,
        description="Wand-SEGMENTE (kein Polygon): nur Segmente tragen kind massiv/offen/virtuell je Kante (Grossraum). Validator: Hülle geschlossen.",
        min_length=3,
    )
    floor: Floor = Field(
        ...,
        description="Wird aus den Wand-Segmenten ABGELEITET/validiert, nicht doppelt gepflegt.",
    )
    ceiling: Ceiling


class Opening(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    type: Type
    hostWall: Uuid
    offset: confloat(ge=0.0) = Field(
        ...,
        description="Abstand des Öffnungs-Anfangs vom Wand-Start entlang der Wand (m).",
    )
    width: PositiveFloat
    height: PositiveFloat
    sill: confloat(ge=0.0) = Field(..., description="Brüstungshöhe; Türen: 0.")


class Zone(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    name: str
    roomType: RoomType
    polygon: list[Vec2] = Field(..., min_length=3)


class Fixpoint(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    type: AnschlussTyp
    position: Vec2
    wall: Uuid | None = None
    heightFromFloor: confloat(ge=0.0) | None = None
    mount: Mount
    origin: Origin
    zone: Uuid | None = None


class Geometry(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    repr: Repr
    bbox: Masse
    meshRef: str | None = None


class Object(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    label: constr(min_length=1)
    geometry: Geometry
    pose: Pose
    movable: bool
    confidence: confloat(ge=0.0, le=1.0)
    needsReview: bool | None = None


class Raummodell(BaseModel):
    """
    Vertrag 1: Output Raum-Engine → Input Solver/Viewer. y-up, rechtshändig, Meter; Grundriss in der x/z-Ebene. Quelle: Brain → Domaenenmodell-Schema-Spezifikation.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    schemaVersion: Semver
    name: constr(min_length=1)
    roomType: RoomType
    source: Source
    units: Literal["m"]
    shell: Shell
    openings: list[Opening]
    zones: list[Zone] = Field(
        ...,
        description="Funktionsbereiche innerhalb einer Hülle (Grossraum). Regeln gelten pro Zone.",
    )
    fixpoints: list[Fixpoint] = Field(
        ...,
        description="Anschlüsse – die Brücke zu den harten connection-Regeln. Standort genügt.",
    )
    objects: list[Object] = Field(
        ..., description="Erkannte Bestandsobjekte (für Umbau ggf. entfernen/behalten)."
    )
    meta: Meta
