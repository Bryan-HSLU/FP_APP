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


class Klasse(Enum):
    """
    Objektklasse (Scene-Dressing-Konzept): B leicht kollisionsrelevant (Bodenobjekt, einfache Kollisionsprüfung + Türkorridor) · C visuelle Mid-Objects (an Wand/Möbel gehängt) · D Deko-Cluster (Mikro-Objekte auf Oberflächen). Klasse A bleibt im Katalog/Solver.
    """

    B = "B"
    C = "C"
    D = "D"


class AnchorType(RootModel[constr(pattern=r"^[a-z0-9-]+$")]):
    root: constr(pattern=r"^[a-z0-9-]+$")


class Platzierung(Enum):
    """
    Ankerart: auf_oberflaeche = auf der Oberkante eines Möbels · an_wand = an einer Raumwand · freie_ecke = in einer freien Raumecke (Boden) · an_moebel = neben/an einem Möbel (Boden) · an_decke = an der Decke über einem Möbel-Anker hängend (Oberkante an Deckenhöhe, masse.h = Hängelänge inkl. Schirm).
    """

    auf_oberflaeche = "auf_oberflaeche"
    an_wand = "an_wand"
    freie_ecke = "freie_ecke"
    an_moebel = "an_moebel"
    an_decke = "an_decke"


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


class Uuid(RootModel[UUID]):
    root: UUID


class Semver(RootModel[constr(pattern=r"^\d+\.\d+\.\d+$")]):
    root: constr(pattern=r"^\d+\.\d+\.\d+$")


class DressingItem(BaseModel):
    """
    Scene-Dressing-Objekt (rein visuelle Deko-Ebene, getrennt vom Plan). NICHT solver-/normrelevant: erscheint nie in plan.placements, constraintReport oder LV. Der Client platziert es deterministisch an Ankern, die aus dem bestehenden Plan abgeleitet werden. Box/Primitiv-Platzhalter mit Auto-Upgrade: ohne gltfRef rendert der Viewer prozedurale Primitive aus masse; sobald gltfRef gesetzt und assetStatus=modeled ist, ersetzt das echte glTF den Platzhalter.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    id: Uuid
    schemaVersion: Semver
    name: constr(min_length=1)
    roomTypes: list[RoomType] = Field(..., min_length=1)
    klasse: Klasse = Field(
        ...,
        description="Objektklasse (Scene-Dressing-Konzept): B leicht kollisionsrelevant (Bodenobjekt, einfache Kollisionsprüfung + Türkorridor) · C visuelle Mid-Objects (an Wand/Möbel gehängt) · D Deko-Cluster (Mikro-Objekte auf Oberflächen). Klasse A bleibt im Katalog/Solver.",
    )
    funktionsTyp: constr(pattern=r"^[a-z0-9-]+$") = Field(
        ...,
        description="Funktionaler Typ des Deko-Objekts – wählt auch den prozeduralen 3D-Bausatz (dressing3d).",
    )
    anchorTypes: list[AnchorType] = Field(
        ...,
        description="Erlaubte Anker: funktionsTypen aus dem Plan (z.B. lavabo, badmoebel, wc) ODER die Schlüsselworte 'wand' bzw. 'ecke'. Ohne passenden Anker im Raum wird das Objekt nicht platziert.",
        min_length=1,
    )
    platzierung: Platzierung = Field(
        ...,
        description="Ankerart: auf_oberflaeche = auf der Oberkante eines Möbels · an_wand = an einer Raumwand · freie_ecke = in einer freien Raumecke (Boden) · an_moebel = neben/an einem Möbel (Boden) · an_decke = an der Decke über einem Möbel-Anker hängend (Oberkante an Deckenhöhe, masse.h = Hängelänge inkl. Schirm).",
    )
    masse: Masse
    achsenTags: dict[str, confloat(ge=-1.0, le=1.0)] = Field(
        ...,
        description="Stil-Achsen-Ausprägungen (gleiche Achsen wie Katalog/Stilprofil) für den Stil-Match (stilNaehe). Steuert die stilabhängige Varianten-/Materialwahl.",
    )
    attributTags: list[constr(pattern=r"^[a-z0-9-]+:[a-z0-9-]+$")]
    assetStatus: AssetStatus
    gltfRef: constr(min_length=1) | None = Field(
        None,
        description="Dateiname (ohne Endung) eines echten glTF-Binary unter apps/web/public/assets/dressing/<gltfRef>.glb. Nur wirksam bei assetStatus=modeled; sonst rendert der prozedurale Platzhalter.",
    )
    modell3d: constr(pattern=r"^[a-z0-9-]+$") | None = Field(
        None,
        description="Optionale prozedurale Bausatz-Variante (analog Katalog modell3d). Fehlt sie, greift der Standard-Bausatz des funktionsTyp.",
    )
