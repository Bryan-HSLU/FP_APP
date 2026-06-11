# AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen).

from __future__ import annotations

from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, RootModel, confloat, conint, constr


class Method(Enum):
    swipe = "swipe"
    preset = "preset"


class RoomType(Enum):
    """
    Profil ist raumtyp-gebunden (Bad-Projekt → Bad-Bilder).
    """

    bad = "bad"
    kueche = "kueche"
    wohnen = "wohnen"
    schlafen = "schlafen"
    essen = "essen"
    flur = "flur"
    sonstig = "sonstig"


class Uuid(RootModel[UUID]):
    root: UUID


class Semver(RootModel[constr(pattern=r"^\d+\.\d+\.\d+$")]):
    root: constr(pattern=r"^\d+\.\d+\.\d+$")


class Meta(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    method: Method
    presetId: Uuid | None = None
    roomType: RoomType = Field(
        ..., description="Profil ist raumtyp-gebunden (Bad-Projekt → Bad-Bilder)."
    )
    likes: conint(ge=0) | None = None
    dislikes: conint(ge=0) | None = None
    sampleSufficient: bool = Field(..., description="Mindest-Stichprobe erreicht?")


class Stilprofil(BaseModel):
    """
    Vertrag 3: Stil-Engine → Kurator/Solver. Reine Achsen statt benannter Stile (ADR-0006); Achsen-Set datengetrieben über die Taxonomie.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    schemaVersion: Semver
    taxonomyVersion: Semver
    styleVector: dict[str, confloat(ge=-1.0, le=1.0)] = Field(
        ...,
        description="Achsen-ID (aus data/taxonomy/) → Wert −1…+1 (Gegensatzpaare, 0 = neutral). Erweiterbar ohne Schema-Änderung.",
    )
    derivedRequirements: list[str]
    palette: list[constr(pattern=r"^#[0-9a-fA-F]{6}$")]
    meta: Meta
