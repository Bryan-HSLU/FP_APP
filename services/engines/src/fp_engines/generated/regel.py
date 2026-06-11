# AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen).

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, constr


class RoomType(Enum):
    """
    «alle» = Basis-Rahmen, gilt in jedem Raum. Im Grossraum gelten Regeln pro Zone.
    """

    alle = "alle"
    bad = "bad"
    kueche = "kueche"
    wohnen = "wohnen"
    schlafen = "schlafen"
    essen = "essen"
    flur = "flur"
    sonstig = "sonstig"


class Kategorie(Enum):
    rahmen = "rahmen"
    objekt_raum = "objekt-raum"
    objekt_objekt = "objekt-objekt"
    sperrzone = "sperrzone"
    anschluss = "anschluss"
    ergonomie = "ergonomie"


class Type(Enum):
    collision = "collision"
    wall_distance = "wall-distance"
    object_distance = "object-distance"
    clearance = "clearance"
    door_swing = "door-swing"
    keep_clear = "keep-clear"
    host_binding = "host-binding"
    connection = "connection"
    circulation = "circulation"
    relation = "relation"


class Severity(Enum):
    """
    hard = Constraint (muss) · soft = Score (Ergonomie/Stil).
    """

    hard = "hard"
    soft = "soft"


class NormProfile(Enum):
    """
    Regel gilt nur in diesem Normprofil; ohne Feld: in allen.
    """

    ch = "ch"
    eu = "eu"


class Status(Enum):
    zu_verifizieren = "zu-verifizieren"
    verifiziert = "verifiziert"


class Regel(BaseModel):
    """
    Vertrag 6: deklarative Norm-Regel (Daten statt Code, Norm-Regelsatz-v0). Beide Interpreter (TS @fp/shared · Python fp_engines) lesen exakt dieses Format. Parameter-Konventionen je type: siehe packages/shared/src/rules/README.md.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    id: constr(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    roomType: RoomType = Field(
        ...,
        description="«alle» = Basis-Rahmen, gilt in jedem Raum. Im Grossraum gelten Regeln pro Zone.",
    )
    appliesTo: constr(min_length=1) = Field(
        ...,
        description="funktionsTyp des Zielobjekts (z.B. wc, lavabo) oder «*» für alle Objekte bzw. raumbezogene Regeln.",
    )
    kategorie: Kategorie
    type: Type
    severity: Severity = Field(
        ..., description="hard = Constraint (muss) · soft = Score (Ergonomie/Stil)."
    )
    params: dict[str, float | str] | None = Field(
        None,
        description="Parametrierung je type (z.B. minDist, depth, width, radius, anschluss, maxDist, measure).",
    )
    normProfile: NormProfile | None = Field(
        None, description="Regel gilt nur in diesem Normprofil; ohne Feld: in allen."
    )
    profilOverrides: dict[str, dict[str, float | str]] | None = Field(
        None, description="Profil → params-Overrides (CH/EU-Werte über der Basis)."
    )
    barrierefreiOverride: dict[str, float | str] | None = Field(
        None,
        description="Strengere Werte, wenn Barrierefrei-Overlay aktiv (Mechanik vorgesehen, Werte post-POC).",
    )
    quelle: constr(min_length=1)
    status: Status
    hinweis: str | None = None
