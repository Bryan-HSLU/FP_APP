# AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen).

from __future__ import annotations

from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    PositiveFloat,
    RootModel,
    confloat,
    conint,
    constr,
)


class Status(Enum):
    vorschlag = "vorschlag"
    bearbeitet = "bearbeitet"
    final = "final"


class Source(Enum):
    solver = "solver"
    user = "user"


class Type(Enum):
    kuechenzeile = "kuechenzeile"


class Form(Enum):
    i = "i"
    l = "l"
    u = "u"
    galley = "galley"
    insel = "insel"


class Kind(Enum):
    wand_entfernen = "wand-entfernen"
    oeffnung_aendern = "oeffnung-aendern"
    belag = "belag"
    vorwand_neu = "vorwand-neu"


class NormProfile(Enum):
    ch = "ch"
    eu = "eu"


class Meta(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    solverVersion: str
    seed: int = Field(
        ...,
        description="Variante reproduzierbar («würfeln»): gleicher Input + seed ⇒ gleicher Plan.",
    )
    normProfile: NormProfile
    barrierefrei: bool = Field(..., description="Overlay-Flag; Werte erst post-POC.")
    createdAt: AwareDatetime
    contributors: list[str] | None = None


class Uuid(RootModel[UUID]):
    root: UUID


class Semver(RootModel[constr(pattern=r"^\d+\.\d+\.\d+$")]):
    root: constr(pattern=r"^\d+\.\d+\.\d+$")


class Vec2(RootModel[list[float]]):
    root: list[float] = Field(..., max_length=2, min_length=2)


class Pose(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    pos: Vec2
    yawDeg: float


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


class Summary(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    erfuellt: conint(ge=0)
    knapp: conint(ge=0)
    verletzt: conint(ge=0)


class Hard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    ok: bool
    summary: Summary


class Status1(Enum):
    """
    Konfidenz-Ampel. «knapp» = erfüllt, aber Marge < Messunsicherheit → Next-Steps «vor Ort prüfen». «nicht-geprueft» = Regeltyp im aktuellen Stand bewusst nicht ausgewertet (ehrlich statt stilles ok).
    """

    ok = "ok"
    knapp = "knapp"
    verletzt = "verletzt"
    nicht_geprueft = "nicht-geprueft"


class Result(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    ruleId: str
    status: Status1 = Field(
        ...,
        description="Konfidenz-Ampel. «knapp» = erfüllt, aber Marge < Messunsicherheit → Next-Steps «vor Ort prüfen». «nicht-geprueft» = Regeltyp im aktuellen Stand bewusst nicht ausgewertet (ehrlich statt stilles ok).",
    )
    margin_cm: float | None = None
    placements: list[Uuid] | None = None
    hinweis: str | None = None


class SoftScore(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    stil: float
    ergonomie: float
    relation: float


class ConstraintReport(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    hard: Hard
    results: list[Result]
    softScore: SoftScore


class Placement(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    catalogItemId: Uuid = Field(
        ...,
        description="Nur die ID – nie Geometrie einbetten (Box-Platzhalter mit Auto-Upgrade).",
    )
    pose: Pose
    gewerk: Gewerk
    locked: bool
    source: Source
    assembly: Uuid | None = None
    mountHeight: confloat(ge=0.0) | None = Field(
        None, description="Unterkante über Boden (m) bei wandmontierten Objekten."
    )


class Assembly(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    type: Type
    form: Form
    anchorWall: Uuid | None = None
    grid: PositiveFloat | None = None


class Intervention(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    kind: Kind
    target: Uuid | None = None
    params: dict[str, Any] | None = None


class Finish(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    surface: constr(pattern=r"^(wall:[0-9a-fA-F-]{36}|floor|ceiling)$")
    material: Uuid
    area: confloat(ge=0.0) | None = None


class PlanObjekt(BaseModel):
    """
    Vertrag 2: Output Solver → editiert im Viewer → Input Auswertung. constraintReport macht «normkonform» überprüfbar statt behauptet.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    schemaVersion: Semver
    roomRef: Uuid
    stilprofilRef: Uuid
    version: conint(ge=1)
    status: Status
    placements: list[Placement]
    assemblies: list[Assembly] = Field(
        ...,
        description="Lineare Baugruppen (v.a. Küchenzeile): Form + Korpus-Slots im Raster.",
    )
    interventions: list[Intervention] = Field(
        ..., description="Bauliche Massnahmen – treiben Gewerke/Mengen."
    )
    finishes: list[Finish]
    constraintReport: ConstraintReport
    meta: Meta
