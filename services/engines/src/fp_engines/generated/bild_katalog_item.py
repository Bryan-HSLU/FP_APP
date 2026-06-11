# AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen).

from __future__ import annotations

from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, RootModel, confloat, constr


class RoomType(Enum):
    bad = "bad"
    kueche = "kueche"
    wohnen = "wohnen"
    schlafen = "schlafen"
    essen = "essen"
    flur = "flur"
    sonstig = "sonstig"


class Lizenz(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    quelle: constr(min_length=1)
    rechte: constr(min_length=1)


class Uuid(RootModel[UUID]):
    root: UUID


class Semver(RootModel[constr(pattern=r"^\d+\.\d+\.\d+$")]):
    root: constr(pattern=r"^\d+\.\d+\.\d+$")


class BildKatalogItem(BaseModel):
    """
    Vertrag 5: Bild-Katalog für Swipe & Presets (Stammdaten). Bilder sind raumtyp-gebunden; Lizenz ist Pflichtfeld (Content-Pipeline).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    schemaVersion: Semver
    bildRef: constr(min_length=1)
    roomType: RoomType
    achsenTags: dict[str, confloat(ge=-1.0, le=1.0)]
    attributTags: list[constr(pattern=r"^[a-z0-9-]+:[a-z0-9-]+$")]
    palette: list[constr(pattern=r"^#[0-9a-fA-F]{6}$")]
    lizenz: Lizenz
    istPreset: bool
    presetProfile: dict[str, confloat(ge=-1.0, le=1.0)] | None = Field(
        None,
        description="Kuratierter Achsen-Vektor hinter dem Preset-Bild (nur wenn istPreset).",
    )
