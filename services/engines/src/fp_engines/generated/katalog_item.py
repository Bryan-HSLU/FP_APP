# AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen).

from __future__ import annotations

from datetime import date
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


class RoomType(Enum):
    bad = "bad"
    kueche = "kueche"
    wohnen = "wohnen"
    schlafen = "schlafen"
    essen = "essen"
    flur = "flur"
    sonstig = "sonstig"


class Gewerk(Enum):
    sanitaer = "sanitaer"
    elektro = "elektro"
    schreiner = "schreiner"
    maler = "maler"
    plattenleger = "plattenleger"
    bodenleger = "bodenleger"
    heizung = "heizung"
    lueftung = "lueftung"
    kueche = "kueche"
    moebel = "moebel"
    baumeister = "baumeister"


class Masse(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    w: PositiveFloat
    d: PositiveFloat
    h: PositiveFloat


class AssetStatus(Enum):
    placeholder = "placeholder"
    modeled = "modeled"


class PriorityClass(Enum):
    """
    P1 Pflicht/Anschluss · P2 Funktion · P3 Ergänzung (Gestaltungs-Engine).
    """

    P1 = "P1"
    P2 = "P2"
    P3 = "P3"


class Mount(Enum):
    """
    Host-Bindung; Default boden.
    """

    boden = "boden"
    wand = "wand"


class MountHeightRange(BaseModel):
    """
    Erlaubte Montagehöhe (Unterkante bzw. Oberkante je Konvention der Regel) bei mount=wand.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    min: confloat(ge=0.0)
    max: confloat(ge=0.0)


class AnschluesseEnum(Enum):
    wasser = "wasser"
    abwasser = "abwasser"
    elektro = "elektro"
    starkstrom = "starkstrom"
    lueftung = "lueftung"
    heizung = "heizung"


class NormProfileVariante(Enum):
    ch55 = "ch55"
    eu60 = "eu60"


class Preis(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: confloat(ge=0.0)
    currency: Literal["CHF"]
    stand: date
    quelle: constr(min_length=1) = Field(..., description="Provenance-Pflicht.")
    bandbreitePct: confloat(ge=0.0)


class Uuid(RootModel[UUID]):
    root: UUID


class Semver(RootModel[constr(pattern=r"^\d+\.\d+\.\d+$")]):
    root: constr(pattern=r"^\d+\.\d+\.\d+$")


class KatalogItem(BaseModel):
    """
    Vertrag 4: Möbel-/Objektkatalog (Stammdaten). Box-Platzhalter mit Auto-Upgrade: ohne gltfRef rendert der Viewer eine Box aus masse; Platzierungen referenzieren nur die ID.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    schemaVersion: Semver
    name: constr(min_length=1)
    kategorie: constr(min_length=1)
    funktionsTyp: constr(min_length=1) = Field(
        ...,
        description="Funktionaler Typ, auf den Regeln matchen (z.B. wc, lavabo, dusche, herd, sofa).",
    )
    roomTypes: list[RoomType] = Field(..., min_length=1)
    gewerk: Gewerk
    masse: Masse
    gltfRef: str | None = None
    usdzRef: str | None = Field(
        None, description="AR-Einzelobjekt-Vorschau (Quick Look), Stretch."
    )
    assetStatus: AssetStatus
    priorityClass: PriorityClass = Field(
        ...,
        description="P1 Pflicht/Anschluss · P2 Funktion · P3 Ergänzung (Gestaltungs-Engine).",
    )
    mount: Mount | None = Field(None, description="Host-Bindung; Default boden.")
    mountHeightRange: MountHeightRange | None = Field(
        None,
        description="Erlaubte Montagehöhe (Unterkante bzw. Oberkante je Konvention der Regel) bei mount=wand.",
    )
    achsenTags: dict[str, confloat(ge=-1.0, le=1.0)]
    attributTags: list[constr(pattern=r"^[a-z0-9-]+:[a-z0-9-]+$")]
    anschluesse: list[AnschluesseEnum]
    relationalRules: list[str]
    normProfileVariante: NormProfileVariante | None = None
    bkpCode: str | None = None
    ebkpCode: str | None = None
    npkRef: str | None = None
    preis: Preis
