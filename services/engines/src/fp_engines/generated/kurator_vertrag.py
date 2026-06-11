# AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen).

from __future__ import annotations

from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, PositiveFloat, RootModel


class Uuid(RootModel[UUID]):
    root: UUID


class RoomType(Enum):
    bad = "bad"
    kueche = "kueche"
    wohnen = "wohnen"
    schlafen = "schlafen"
    essen = "essen"
    flur = "flur"
    sonstig = "sonstig"


class FixpunkteEnum(Enum):
    wasser = "wasser"
    abwasser = "abwasser"
    elektro = "elektro"
    starkstrom = "starkstrom"
    lueftung = "lueftung"
    heizung = "heizung"


class OeffnungenEnum(Enum):
    door = "door"
    window = "window"


class RaumFakten(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    roomType: RoomType
    flaeche_m2: PositiveFloat
    zonen: list[str] | None = None
    fixpunkte: list[FixpunkteEnum] | None = None
    oeffnungen: list[OeffnungenEnum] | None = None


class PriorityClass(Enum):
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"


class Masse(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    w: float
    d: float
    h: float


class KatalogAuszugItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    funktionsTyp: str
    priorityClass: PriorityClass
    masse: Masse | None = None
    achsenTags: dict[str, float] | None = None
    attributTags: list[str] | None = None


class NormProfile(Enum):
    ch = "ch"
    eu = "eu"


class KuratorRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    stilprofilRef: Uuid
    raumFakten: RaumFakten
    katalogAuszug: list[KatalogAuszugItem] = Field(
        ...,
        description="Vorgefilterte Items (IDs + Tags + Masse + Klasse) – der Kurator wählt NUR daraus.",
        min_length=1,
    )
    budget: PositiveFloat | None = None
    normProfile: NormProfile


class RelationaleAbsichtenItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    itemId: Uuid
    relation: str = Field(..., description="Mini-Grammatik, z.B. near:lavabo:1.2.")
    targetId: Uuid | None = None
    zone: str | None = None


class KuratorResponse(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    auswahl: list[Uuid] = Field(
        ...,
        description="catalogItemIds – MUSS Teilmenge von request.katalogAuszug sein (harte Validierung).",
    )
    relationaleAbsichten: list[RelationaleAbsichtenItem]
    begruendung: str | None = None


class KuratorVertrag(BaseModel):
    """
    Vertrag 7: Schnittstelle zum KI-Kurator (ADR-0007). Erdung als Schema-Regel: Response-IDs müssen Teilmenge des katalogAuszug sein – sonst Retry/Fallback deterministische Baseline.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    request: KuratorRequest | None = None
    response: KuratorResponse | None = None
