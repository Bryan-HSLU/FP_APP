# AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen).

from __future__ import annotations

from enum import Enum
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, RootModel, constr


class Zustand(Enum):
    neu = "neu"
    raumErfasst = "raumErfasst"
    geometrieBestaetigt = "geometrieBestaetigt"
    stilVorhanden = "stilVorhanden"
    planVorschlag = "planVorschlag"
    planBearbeitet = "planBearbeitet"
    ausgewertet = "ausgewertet"


class Typ(Enum):
    kv = "kv"
    mengen = "mengen"
    gewerke = "gewerke"
    einkaufsliste = "einkaufsliste"
    plan_pdf = "plan-pdf"
    plan_dxf = "plan-dxf"
    field_3d_export = "3d-export"
    next_steps = "next-steps"
    bauzeitenplan = "bauzeitenplan"
    lv = "lv"
    offertanfrage = "offertanfrage"


class DokumenteItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    typ: Typ
    pfad: str
    erstellt: AwareDatetime


class Uuid(RootModel[UUID]):
    root: UUID


class Semver(RootModel[constr(pattern=r"^\d+\.\d+\.\d+$")]):
    root: constr(pattern=r"^\d+\.\d+\.\d+$")


class Projekt(BaseModel):
    """
    Projekt-Hülle: bündelt Raum/Stilprofil/Pläne/Dokumente. Privacy-Metadaten (retentionUntil) von Anfang an im Modell (ADR-0009). Zustandsmaschine: Engineering-Grundlagen §2.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    schemaVersion: Semver
    name: constr(min_length=1)
    zustand: Zustand
    raumRefs: list[Uuid] = Field(
        ...,
        description="Modell kann Mehrraum, POC-UI zeigt 1 (Schema-Spezifikation, offene Frage entschieden als design-in).",
    )
    stilprofilRef: Uuid | None = None
    planRefs: list[Uuid]
    dokumente: list[DokumenteItem]
    createdAt: AwareDatetime
    retentionUntil: AwareDatetime
    contributors: list[str] | None = None
