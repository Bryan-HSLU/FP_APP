# AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern.

from __future__ import annotations

from enum import Enum
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PositiveFloat,
    RootModel,
    confloat,
    conint,
)


class Uuid(RootModel[UUID]):
    root: UUID


class MaterialSlug(Enum):
    """
    Geerdete Material-Slugs für Boden/Wand – EINZIGE zulässige Werte. Der Client rendert die Looks prozedural (siehe apps/web/src/oberflaechen.ts). Änderungen hier = bewusster Vertrags-Akt (TS-Union + Python lesen dieselbe Liste).
    """

    fliesen_hell = "fliesen-hell"
    fliesen_gruen = "fliesen-gruen"
    fliesen_anthrazit = "fliesen-anthrazit"
    putz_weiss = "putz-weiss"
    putz_warm = "putz-warm"
    holz_hell = "holz-hell"
    holz_dunkel = "holz-dunkel"
    parkett_eiche = "parkett-eiche"
    beton = "beton"
    naturstein = "naturstein"
    tapete_hell = "tapete-hell"
    taefer_holz = "taefer-holz"


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


class AnordnungItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    itemId: Uuid
    wandIndex: conint(ge=0) | None = Field(
        None, description="0-basierter Index in room.shell.walls."
    )
    relationen: list[str] | None = Field(
        None,
        description="Strings der bestehenden Relations-Grammatik (near/against-wall/corner/facing/opposite/group/pair-with).",
    )
    prioritaet: int | None = Field(
        None,
        description="Kleinere Zahl zuerst (Reihenfolge innerhalb einer Prioritätsklasse).",
    )


class Boden(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    material: MaterialSlug | None = None


class Bereich(Enum):
    """
    Vertikale Ausdehnung; hoeheM nur bei halbhoch/sockel sinnvoll.
    """

    voll = "voll"
    halbhoch = "halbhoch"
    sockel = "sockel"


class WaendeItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    wandIndex: conint(ge=0)
    material: MaterialSlug
    bereich: Bereich | None = Field(
        None,
        description="Vertikale Ausdehnung; hoeheM nur bei halbhoch/sockel sinnvoll.",
    )
    hoeheM: confloat(ge=0.3, le=3.0) | None = Field(
        None, description="Höhe der Materialzone ab Boden (m), nur bei halbhoch/sockel."
    )
    akzent: bool | None = None


class Flaechen(BaseModel):
    """
    Boden-/Wand-Material-Wünsche (Call C). Nur Slugs aus $defs/materialSlug. Der Client leitet die Optik ansonsten deterministisch ab (oberflaechen.ts).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    boden: Boden | None = None
    waende: list[WaendeItem] | None = None


class KuratorResponse(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    auswahl: list[Uuid] = Field(
        ...,
        description="catalogItemIds – MUSS Teilmenge von request.katalogAuszug sein (harte Validierung).",
    )
    relationaleAbsichten: list[RelationaleAbsichtenItem]
    anordnung: list[AnordnungItem] | None = Field(
        None,
        description="Weiche Anordnungs-Anweisungen je Item (Call B). Alle Felder ausser itemId optional. Der Solver behandelt sie als Präferenzen (nie als harte Regeln): wandIndex wird auf die Kandidaten dieser Wand gefiltert (Fallback auf alle, wenn dort kein normkonformer Platz frei ist), relationen ergänzen/überschreiben die relationaleAbsichten, prioritaet ordnet innerhalb P2/P3.",
    )
    flaechen: Flaechen | None = Field(
        None,
        description="Boden-/Wand-Material-Wünsche (Call C). Nur Slugs aus $defs/materialSlug. Der Client leitet die Optik ansonsten deterministisch ab (oberflaechen.ts).",
    )
    begruendung: str | None = None


class KuratorVertrag(BaseModel):
    """
    Vertrag 7: Schnittstelle zum KI-Kurator (ADR-0007). Erdung als Schema-Regel: Response-IDs müssen Teilmenge des katalogAuszug sein – sonst Retry/Fallback deterministische Baseline. v0.2 (additiv/minor): optionale Felder «anordnung» (weiche Anordnungs-Anweisungen je Item) und «flaechen» (Boden-/Wand-Material-Wünsche) – Kurator-Pipeline v2 (3 Calls).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    request: KuratorRequest | None = None
    response: KuratorResponse | None = None
