# AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen).

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, constr


class AchsenItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: constr(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    negativPol: constr(min_length=1) = Field(..., description="Bedeutung bei −1.")
    positivPol: constr(min_length=1) = Field(..., description="Bedeutung bei +1.")
    beschreibung: str | None = None


class AttributKategorienItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: constr(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    beschreibung: str | None = None
    werte: list[constr(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")] | None = Field(
        None,
        description="Optional: bekannte Werte; offenes Vokabular, neue Werte erlaubt.",
    )


class Taxonomie(BaseModel):
    """
    Stützschema (Stammdaten): datengetriebenes Achsen-Set (ADR-0006) + offenes Attribut-Vokabular. Erweiterung der Achsen/Attribute braucht KEINE Schema-Änderung – nur eine neue Taxonomie-Version.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    taxonomyVersion: constr(pattern=r"^\d+\.\d+\.\d+$")
    achsen: list[AchsenItem] = Field(..., min_length=1)
    attributKategorien: list[AttributKategorienItem]
