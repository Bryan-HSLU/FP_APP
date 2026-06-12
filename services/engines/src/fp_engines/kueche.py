"""Küchen-Solver: Formwahl + lineare Baugruppe (Küchen-Detailkonzept M6 Phase B).

Die Küche ist – anders als Bad/Wohnen – KEIN freies Einzelmöbel-Problem, sondern
eine **lineare Baugruppe** (Zeile) auf einem Normraster (CH 0.55 / EU 0.60). Der
Ablauf in zwei Stufen (Brain: Küchen-Detailkonzept):

1. **Formwahl** (`formwahl`): aus Wandzügen + Stilprofil die Top-3 Küchenformen
   (I/Galley/L/U/Insel) bestimmen – harte geometrische Mindestmasse (Tabelle 1a)
   filtern, ein gewichteter Soft-Score (Stil/Ergonomie/Arbeitsplatte/Stauraum)
   rankt.
2. **Lineare Baugruppe** (`solve_kueche`): die gewählte Form wird mit Funktions-
   zonen (AMK: Bevorraten→Aufbewahren→Spülen→Vorbereiten→Kochen) auf Rasterslots
   gefüllt (P1 Geräte an Anschlüsse → P2 Korpusse/Hängeschränke → P3 Deko). Jeder
   Schritt wird gegen den Regel-Interpreter geprüft; die Solver-Invariante (0 ❌)
   gilt unverändert.

Determinismus: gleicher Input + seed ⇒ gleicher Plan (Seed variiert nur Stil-
Gleichstände, P2-Reihenfolge und P3 – nie die P1-Anschlusslogik).

v0-Vereinfachungen (bewusst, dokumentiert in STATUS.md):
- Wandzüge = achsparallele massive Wände; Nutzlänge = Wandlänge minus Tür-Bereich
  (Zeile nie über eine Tür; Fenster werden für Unterschränke ignoriert, nur die
  Hängeschrank-Ebene meidet Fenster).
- L/U: Schenkel nacheinander gefüllt, die Ecke bleibt v0 Totraum (kein Eckschrank).
- Insel braucht Boden-Fixpunkt; ohne ihn fällt die Form raus.
- Arbeitsdreieck/Ergonomie nur als einfache Proxies (kompakte Zeile, L/U-Bonus).
"""

from __future__ import annotations

import math
import random
import uuid
from dataclasses import dataclass, field
from typing import Any

from fp_engines.kurator import _cos
from fp_engines.rules.geometry import dist_point_to_segment
from fp_engines.solver import (
    SOLVER_VERSION,
    NoFeasiblePlacement,
    _als_placement,
    _Kandidat,
    _schnell_unzulaessig,
    _zulaessig,
)

# Normraster je Profil (Küchen-Detailkonzept Teil 0): CH = 55er, EU = 60er.
GRID = {"ch": 0.55, "eu": 0.60}
NORM_VARIANTE = {"ch": "ch55", "eu": "eu60"}

# Reichweite (m), in der eine Tür-Öffnung die Wand-Nutzlänge blockiert.
_REST_MIN = 0.05  # Restmass < 5 cm ignorieren (kein Füllstück).

# Stil→Form-Heuristik (Küchen-Detailkonzept 1b): pro Form ein Ziel-Stilvektor auf
# den Achsen aus data/taxonomy/stilachsen.json. raumgefuehl: offen(+)/geborgen(−);
# opulenz: schlicht(−)/opulent(+); epoche: klassisch(−)/modern(+).
_FORM_STILZIEL: dict[str, dict[str, float]] = {
    "i": {"opulenz": -0.6, "raumgefuehl": 0.0},
    "galley": {"opulenz": -0.4, "raumgefuehl": -0.4},
    "l": {"epoche": -0.4, "raumgefuehl": 0.0},
    "u": {"opulenz": 0.4, "raumgefuehl": -0.6, "epoche": -0.3},
    "insel": {"raumgefuehl": 0.8, "opulenz": 0.5, "epoche": 0.4},
}


@dataclass
class _Wandzug:
    """Ein nutzbarer, massiver, achsparalleler Wandzug für die Küchenzeile."""

    wall: dict[str, Any]
    start: tuple[float, float]
    end: tuple[float, float]
    laenge: float  # geometrische Länge (m)
    nutzlaenge: float  # Länge minus Tür-Bereiche (m)
    u: tuple[float, float]  # Einheitsvektor entlang der Wand
    n: tuple[float, float]  # Einheits-Normale Richtung Rauminneres
    yaw: float  # yaw, sodass front_dir(yaw) == n
    fenster: list[tuple[float, float]] = field(default_factory=list)  # (von, bis) entlang u


def _einheit(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float, float]:
    dx, dz = b[0] - a[0], b[1] - a[1]
    laenge = math.hypot(dx, dz)
    if laenge == 0:
        return 0.0, 0.0, 0.0
    return dx / laenge, dz / laenge, laenge


def _inward_normal(
    u: tuple[float, float], mid: tuple[float, float], centroid: tuple[float, float]
) -> tuple[float, float]:
    nx, nz = -u[1], u[0]
    if (centroid[0] - mid[0]) * nx + (centroid[1] - mid[1]) * nz < 0:
        nx, nz = -nx, -nz
    return nx, nz


def _yaw_aus_normale(n: tuple[float, float]) -> float:
    yaw = math.degrees(math.atan2(n[0], n[1])) % 360
    for exakt in (0.0, 90.0, 180.0, 270.0):
        if abs(yaw - exakt) < 1e-6:
            return exakt
    return yaw


def _tuer_bereiche(
    room: dict[str, Any], wall: dict[str, Any]
) -> list[tuple[float, float]]:
    """Tür-Intervalle (von, bis) entlang der Wand – hier darf keine Zeile stehen."""
    bereiche: list[tuple[float, float]] = []
    for op in room["openings"]:
        if op["hostWall"] == wall["id"] and op["type"] == "door":
            bereiche.append((op["offset"], op["offset"] + op["width"]))
    return bereiche


def _fenster_bereiche(
    room: dict[str, Any], wall: dict[str, Any]
) -> list[tuple[float, float]]:
    return [
        (op["offset"], op["offset"] + op["width"])
        for op in room["openings"]
        if op["hostWall"] == wall["id"] and op["type"] == "window"
    ]


def _wandzuege(room: dict[str, Any]) -> list[_Wandzug]:
    """Alle nutzbaren massiven Wandzüge mit Geometrie und Nutzlänge."""
    floor = room["shell"]["floor"]["polygon"]
    cx = sum(p[0] for p in floor) / len(floor)
    cz = sum(p[1] for p in floor) / len(floor)
    out: list[_Wandzug] = []
    for wall in room["shell"]["walls"]:
        if wall["kind"] != "massiv":
            continue
        a = (wall["start"][0], wall["start"][1])
        b = (wall["end"][0], wall["end"][1])
        ux, uz, laenge = _einheit(a, b)
        if laenge < 0.5:
            continue
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        n = _inward_normal((ux, uz), mid, (cx, cz))
        tueren = _tuer_bereiche(room, wall)
        # Nutzlänge = grösstes türfreies Teilstück (Zeile nie über eine Tür, v0).
        nutz = _groesstes_freies_teilstueck(laenge, tueren)
        out.append(
            _Wandzug(
                wall=wall,
                start=a,
                end=b,
                laenge=laenge,
                nutzlaenge=nutz,
                u=(ux, uz),
                n=n,
                yaw=_yaw_aus_normale(n),
                fenster=_fenster_bereiche(room, wall),
            )
        )
    return out


def _groesstes_freies_teilstueck(laenge: float, sperr: list[tuple[float, float]]) -> float:
    """Längstes türfreies Teilintervall von [0, laenge]."""
    if not sperr:
        return laenge
    punkte = [0.0, laenge]
    for von, bis in sperr:
        punkte.extend((von, bis))
    punkte = sorted(set(p for p in punkte if 0.0 <= p <= laenge))
    best = 0.0
    for i in range(len(punkte) - 1):
        mitte = (punkte[i] + punkte[i + 1]) / 2
        if any(von - 1e-6 < mitte < bis + 1e-6 for von, bis in sperr):
            continue
        best = max(best, punkte[i + 1] - punkte[i])
    return best


def _angrenzend(a: _Wandzug, b: _Wandzug) -> bool:
    """Teilen zwei Wandzüge einen Eckpunkt (für L/U)?"""
    ecken = (a.start, a.end)
    return any(math.hypot(e[0] - f[0], e[1] - f[1]) < 1e-3 for e in ecken for f in (b.start, b.end))


def _parallel(a: _Wandzug, b: _Wandzug) -> bool:
    return abs(a.u[0] * b.u[1] - a.u[1] * b.u[0]) < 1e-3


def _zonenbreite_quer(room: dict[str, Any], zug: _Wandzug) -> float:
    """Senkrechter Raumabstand vor dem Wandzug (Proxy für Gang/Zonenbreite)."""
    floor = room["shell"]["floor"]["polygon"]
    # maximale Projektion der Bodenecken auf die Innen-Normale ab Wandmitte.
    mid = ((zug.start[0] + zug.end[0]) / 2, (zug.start[1] + zug.end[1]) / 2)
    return max(
        float((p[0] - mid[0]) * zug.n[0] + (p[1] - mid[1]) * zug.n[1]) for p in floor
    )


def _anschlusswand(room: dict[str, Any], zuege: list[_Wandzug]) -> _Wandzug | None:
    """Wandzug, dem die Wasser/Abwasser-Fixpunkte am nächsten liegen."""
    fix = [
        (f["position"][0], f["position"][1])
        for f in room["fixpoints"]
        if f["type"] in ("wasser", "abwasser")
    ]
    if not fix or not zuege:
        return zuege[0] if zuege else None
    return min(
        zuege,
        key=lambda z: sum(dist_point_to_segment(p, z.start, z.end) for p in fix),
    )


def _hat_boden_fixpunkt(room: dict[str, Any]) -> bool:
    return any(f.get("mount") == "boden" for f in room["fixpoints"])


def _stil_score(stil_ziel: dict[str, float], style_profile: dict[str, Any] | None) -> float:
    """Cosinus-Nähe Stilprofil ↔ Form-Zielvektor, auf [0,1] normiert (0.5 = neutral)."""
    if not style_profile or not style_profile.get("styleVector"):
        return 0.5
    cos = _cos(style_profile["styleVector"], stil_ziel)
    return (cos + 1) / 2


def formwahl(
    room: dict[str, Any],
    style_profile: dict[str, Any] | None,
    norm_profile: str,
) -> list[dict[str, Any]]:
    """Top-3 Küchenformen aus Wandzügen + Stilprofil (Küchen-Detailkonzept Teil 1).

    Rückgabe je Form: {form, score, begruendung, anchorWallIds, nutzlaenge_m}.
    Hart gefiltert nach Tabelle 1a (v0-Mindestmasse); weich gerankt über
    0.35·stil + 0.30·ergo + 0.20·arbeitsplatte + 0.15·stauraum.
    """
    zuege = _wandzuege(room)
    anker = _anschlusswand(room, zuege)
    kandidaten: list[dict[str, Any]] = []

    def ap_norm(nutz: float) -> float:
        # Arbeitsplattenmeter normiert (4 m ≈ sehr gut).
        return min(nutz / 4.0, 1.0)

    def stau_norm(nutz: float) -> float:
        # Stauraum = Zeilenmeter × (1 + Hängeschrank-Ebene); 2 Ebenen → ×2.
        return min(nutz * 2 / 8.0, 1.0)

    # --- I-Zeile: 1 Wandzug ≥ 2.4 m, Querbreite ≥ 1.6 m -----------------------
    for z in zuege:
        if z.nutzlaenge >= 2.4 and _zonenbreite_quer(room, z) >= 1.6:
            ergo = 1.0 - min(z.nutzlaenge / 6.0, 0.5)  # kompakter = besser (Proxy)
            _add(
                kandidaten, "i", [z], anker, z.nutzlaenge, style_profile,
                ergo, ap_norm(z.nutzlaenge), stau_norm(z.nutzlaenge),
                f"Eine Zeile an einer Wand ({z.nutzlaenge:.1f} m nutzbar).",
            )

    # --- Galley: 2 parallele Wandzüge, Querbreite ≥ 2.4 m ---------------------
    for i in range(len(zuege)):
        for j in range(i + 1, len(zuege)):
            a, b = zuege[i], zuege[j]
            if _parallel(a, b) and not _angrenzend(a, b):
                breite = _zonenbreite_quer(room, a)
                if breite >= 2.4 and a.nutzlaenge >= 2.4 and b.nutzlaenge >= 2.4:
                    nutz = a.nutzlaenge + b.nutzlaenge
                    _add(
                        kandidaten, "galley", [a, b], anker, nutz, style_profile,
                        0.8, ap_norm(nutz), stau_norm(nutz),
                        "Zwei parallele Zeilen (Galley) mit Gang dazwischen.",
                    )

    # --- L: 2 angrenzende Wandzüge ≥ 1.8 m + ≥ 1.2 m --------------------------
    for i in range(len(zuege)):
        for j in range(i + 1, len(zuege)):
            a, b = zuege[i], zuege[j]
            if _angrenzend(a, b) and not _parallel(a, b):
                lang, kurz = sorted((a, b), key=lambda z: z.nutzlaenge, reverse=True)
                if lang.nutzlaenge >= 1.8 and kurz.nutzlaenge >= 1.2:
                    nutz = lang.nutzlaenge + kurz.nutzlaenge
                    _add(
                        kandidaten, "l", [lang, kurz], anker, nutz, style_profile,
                        0.9, ap_norm(nutz), stau_norm(nutz),
                        "L-Form über zwei angrenzende Wände (mehr Arbeitsfläche).",
                    )

    # --- U: 3 Wandzüge, Innenbreite ≥ 1.2 m -----------------------------------
    _u_kandidat(room, zuege, anker, style_profile, kandidaten, ap_norm, stau_norm)

    # --- Insel: Zeile + freie Fläche, Breite ≥ 3.4 m UND Boden-Fixpunkt -------
    if _hat_boden_fixpunkt(room) and anker is not None:
        breite = _zonenbreite_quer(room, anker)
        if breite >= 3.4 and anker.nutzlaenge >= 2.4:
            nutz = anker.nutzlaenge
            _add(
                kandidaten, "insel", [anker], anker, nutz, style_profile,
                0.7, ap_norm(nutz + 1.5), stau_norm(nutz + 1.0),
                "Zeile plus freistehende Insel (Boden-Anschluss vorhanden).",
            )

    # Pro Form nur den besten Kandidaten behalten → drei DISTINKTE Formen als
    # Varianten (passt zur «Variante würfeln»-UX).
    bestes_je_form: dict[str, dict[str, Any]] = {}
    for k in kandidaten:
        vorhanden = bestes_je_form.get(k["form"])
        if vorhanden is None or k["score"] > vorhanden["score"]:
            bestes_je_form[k["form"]] = k
    distinkt = sorted(bestes_je_form.values(), key=lambda k: (-k["score"], k["form"]))
    return distinkt[:3]


def _u_kandidat(
    room: dict[str, Any],
    zuege: list[_Wandzug],
    anker: _Wandzug | None,
    style_profile: dict[str, Any] | None,
    kandidaten: list[dict[str, Any]],
    ap_norm: Any,
    stau_norm: Any,
) -> None:
    # U = ein Wandzug mit zwei angrenzenden Schenkeln; Innenbreite über die
    # Querbreite des Basis-Zugs approximiert (v0).
    for basis in zuege:
        schenkel = [z for z in zuege if z is not basis and _angrenzend(z, basis)]
        if len(schenkel) >= 2 and _zonenbreite_quer(room, basis) >= 2.4:
            schenkel = sorted(schenkel, key=lambda z: z.nutzlaenge, reverse=True)[:2]
            beteiligt = [basis, *schenkel]
            nutz = sum(z.nutzlaenge for z in beteiligt)
            _add(
                kandidaten, "u", beteiligt, anker, nutz, style_profile,
                0.85, ap_norm(nutz), stau_norm(nutz),
                "U-Form über drei Wände (maximaler Stauraum, geborgen).",
            )
            return


def _add(
    kandidaten: list[dict[str, Any]],
    form: str,
    zuege: list[_Wandzug],
    anker: _Wandzug | None,
    nutzlaenge: float,
    style_profile: dict[str, Any] | None,
    ergo: float,
    ap: float,
    stau: float,
    begruendung: str,
) -> None:
    """Hart filtern (Anschlusswand enthalten) + Soft-Score, dann hinzufügen."""
    if anker is not None and not any(z.wall["id"] == anker.wall["id"] for z in zuege):
        return  # Anschlusswand muss in der Form enthalten sein (hart).
    stil = _stil_score(_FORM_STILZIEL.get(form, {}), style_profile)
    score = 0.35 * stil + 0.30 * ergo + 0.20 * ap + 0.15 * stau
    kandidaten.append(
        {
            "form": form,
            "score": round(score, 4),
            "begruendung": begruendung,
            "anchorWallIds": [z.wall["id"] for z in zuege],
            "nutzlaenge_m": round(nutzlaenge, 2),
        }
    )


# --------------------------------------------------------------------------- #
#  Teil 2 – Lineare Baugruppe                                                  #
# --------------------------------------------------------------------------- #


@dataclass
class _Slot:
    """Ein Rasterplatz entlang eines Wandzugs (Zentrum + Pose, leer/belegt)."""

    zug: _Wandzug
    t_mitte: float  # Distanz entlang der Wand bis zur Slot-Mitte
    breite: float  # Slotbreite (= grid)
    pos: tuple[float, float]  # Welt-Position des Slot-Zentrums (auf Tiefe d/2)
    yaw: float


def _slot_center(zug: _Wandzug, t: float, tiefe: float) -> tuple[float, float]:
    px = zug.start[0] + zug.u[0] * t + zug.n[0] * (tiefe / 2)
    pz = zug.start[1] + zug.u[1] * t + zug.n[1] * (tiefe / 2)
    return round(px, 4), round(pz, 4)


def _slots_fuer_zug(zug: _Wandzug, grid: float, tiefe: float) -> list[_Slot]:
    """Aufeinanderfolgende Rasterslots ab Wandzug-Anfang (türfreies Teilstück).

    v0: Slots ab Wand-Start; das längste türfreie Teilstück bestimmt die Länge.
    Falls eine Tür am Anfang liegt, startet die Zeile hinter der Tür.
    """
    # Start-Offset = Anfang des grössten türfreien Teilstücks.
    start_off, laenge = _freies_teilstueck_intervall(zug)
    n = int((laenge + 1e-6) / grid)
    slots: list[_Slot] = []
    for i in range(n):
        t = start_off + i * grid + grid / 2
        slots.append(
            _Slot(
                zug=zug,
                t_mitte=t,
                breite=grid,
                pos=_slot_center(zug, t, tiefe),
                yaw=zug.yaw,
            )
        )
    return slots


def _freies_teilstueck_intervall(zug: _Wandzug) -> tuple[float, float]:
    """(Start-Offset, Länge) des grössten türfreien Teilstücks des Wandzugs."""
    # zug.fenster zählt NICHT als Sperre für Unterschränke (v0).
    # Tür-Bereiche müssen aus dem Raum kommen; sie stecken bereits in nutzlaenge.
    # Hier rekonstruieren wir das Intervall aus laenge/nutzlaenge konservativ:
    # ohne Tür → [0, laenge]; mit Tür → wir suchen via gespeicherter Sperren.
    sperr = getattr(zug, "_tueren", None)
    if not sperr:
        return 0.0, zug.nutzlaenge
    punkte = sorted({0.0, zug.laenge, *(p for s in sperr for p in s)})
    best = (0.0, 0.0)
    for i in range(len(punkte) - 1):
        mitte = (punkte[i] + punkte[i + 1]) / 2
        if any(von - 1e-6 < mitte < bis + 1e-6 for von, bis in sperr):
            continue
        laenge = punkte[i + 1] - punkte[i]
        if laenge > best[1]:
            best = (punkte[i], laenge)
    return best


def _vor_fenster(slot: _Slot) -> bool:
    """Liegt der Slot (entlang der Wand) im Fenster-Bereich?"""
    return any(von - 1e-6 < slot.t_mitte < bis + 1e-6 for von, bis in slot.zug.fenster)


def _naechster_fixpunkt_dist(
    room: dict[str, Any], pos: tuple[float, float], typ: str
) -> float:
    best = math.inf
    for f in room["fixpoints"]:
        if f["type"] != typ:
            continue
        d = math.hypot(pos[0] - f["position"][0], pos[1] - f["position"][1])
        best = min(best, d)
    return best


def _stil_bestes(
    items: list[dict[str, Any]], style_profile: dict[str, Any] | None, rnd: random.Random
) -> dict[str, Any] | None:
    """Item mit höchstem Stil-Cosinus (Gleichstand seed-aufgelöst)."""
    if not items:
        return None
    if not style_profile or not style_profile.get("styleVector"):
        return rnd.choice(items)
    sv = style_profile["styleVector"]
    return max(items, key=lambda it: (_cos(sv, it.get("achsenTags", {})), rnd.random()))


def solve_kueche(
    room: dict[str, Any],
    catalog: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    *,
    form: str,
    norm_profile: str,
    seed: int,
    style_profile: dict[str, Any] | None = None,
    stilprofil_ref: str | None = None,
    created_at: str = "1970-01-01T00:00:00Z",
) -> dict[str, Any]:
    """Küchenzeile als lineare Baugruppe – normkonformer Plan (Detailkonzept Teil 2).

    Füllt Rasterslots gemäss AMK-Funktionszonen: P1 Geräte an Anschlüsse, P2
    Korpusse/Hängeschränke, P3 Deko. Jede Platzierung wird gegen den Regel-
    Interpreter geprüft; bei hartem Konflikt wird der Slot weitergeschoben, sonst
    ehrlich NoFeasiblePlacement. Solver-Invariante: verletzt == 0.
    """
    rnd = random.Random(seed)
    grid = GRID[norm_profile]
    variante = NORM_VARIANTE[norm_profile]
    tiefe = 0.6  # Arbeitstiefe (Korpus), Detailkonzept Teil 0.

    # Katalog auf passende Normvariante (+ profilneutrale Items wie Deko) filtern.
    passend = [
        c
        for c in catalog
        if c.get("normProfileVariante") in (variante, None)
    ]
    by_typ: dict[str, list[dict[str, Any]]] = {}
    for c in passend:
        by_typ.setdefault(c["funktionsTyp"], []).append(c)
    by_id = {c["id"]: c for c in catalog}

    zuege = _wandzuege(room)
    # Tür-Sperren an die Wandzüge hängen (für korrektes Slot-Intervall).
    for z in zuege:
        z.__dict__["_tueren"] = _tuer_bereiche(room, z.wall)
    anker = _anschlusswand(room, zuege)
    form_zuege = _zuege_der_form(room, zuege, anker, form)
    if not form_zuege:
        raise NoFeasiblePlacement("kuechenzeile")

    assembly_id = str(uuid.UUID(int=rnd.getrandbits(128), version=4))
    anchor_wall_id = anker.wall["id"] if anker else form_zuege[0].wall["id"]

    # Slots über alle Schenkel (Ecke als Totraum: Schenkel nacheinander, v0).
    slots: list[_Slot] = []
    for z in form_zuege:
        slots.extend(_slots_fuer_zug(z, grid, tiefe))

    placements: list[dict[str, Any]] = []
    belegt: set[int] = set()

    def setze(item: dict[str, Any], slot_idx: int, *, mount_height: float | None = None) -> bool:
        slot = slots[slot_idx]
        placement = _slot_placement(item, slot, rnd, assembly_id, mount_height)
        placements.append(placement)
        if not _schnell_unzulaessig(room, placements, by_id, placement) and (
            _zulaessig(room, placements, catalog, rules, norm_profile) is not None
        ):
            belegt.add(slot_idx)
            return True
        placements.pop()
        return False

    # ---- P1: Geräte an Anschlüsse (Detailkonzept 2c) -------------------------
    spuele_idx = _platziere_spuele(room, slots, belegt, by_typ, style_profile, rnd, setze)
    if spuele_idx is None:
        raise NoFeasiblePlacement("spuele")

    # P1 ist Pflicht (Detailkonzept 2c): fehlt ein Gerät, ist der Plan kein
    # ehrliches Ergebnis – NoFeasiblePlacement statt stillem Rumpf-Plan.
    # Einzige Ausnahme: Dunstabzug (connection lueftung ist soft) bleibt
    # best-effort.
    gs_idx = _platziere_geschirrspueler(
        slots, belegt, by_typ, style_profile, rnd, setze, spuele_idx
    )
    if gs_idx is None:
        raise NoFeasiblePlacement("geschirrspueler")
    kochfeld_idx = _platziere_kochfeld(
        room, slots, belegt, by_typ, style_profile, rnd, setze, spuele_idx, grid
    )
    if kochfeld_idx is None:
        raise NoFeasiblePlacement("kochfeld")
    if _platziere_kuehlschrank(slots, belegt, by_typ, style_profile, rnd, setze) is None:
        raise NoFeasiblePlacement("kuehlschrank")
    _platziere_dunstabzug(
        room, slots, belegt, by_typ, by_id, style_profile, placements,
        assembly_id, kochfeld_idx, norm_profile, catalog, rules, rnd,
    )

    # ---- P2: Restslots mit Korpussen + Hängeschränken ------------------------
    _fuelle_unterschraenke(
        slots, belegt, by_typ, style_profile, rnd, setze, kochfeld_idx
    )
    _fuelle_haengeschraenke(
        room, slots, belegt, by_typ, by_id, style_profile, placements,
        assembly_id, kochfeld_idx, norm_profile, catalog, rules, tiefe, rnd,
    )
    _fuelle_fuellstuecke(room, form_zuege, slots, belegt, by_typ, placements, by_id,
                         assembly_id, grid, tiefe, norm_profile, catalog, rules, rnd)

    # ---- P3: Deko auf Restfläche (Boden-Kandidaten aus solver.py) ------------
    _platziere_deko(
        room, by_typ, by_id, placements, catalog, rules, norm_profile, rnd
    )

    report = _zulaessig(room, placements, catalog, rules, norm_profile)
    assert report is not None  # Solver-Invariante: per Konstruktion 0 ❌.

    return {
        "id": str(uuid.UUID(int=rnd.getrandbits(128), version=4)),
        "schemaVersion": "0.1.0",
        "roomRef": room["id"],
        "stilprofilRef": stilprofil_ref or str(uuid.UUID(int=0, version=4)),
        "version": 1,
        "status": "vorschlag",
        "placements": placements,
        "assemblies": [
            {
                "id": assembly_id,
                "type": "kuechenzeile",
                "form": form,
                "anchorWall": anchor_wall_id,
                "grid": grid,
            }
        ],
        "interventions": [],
        "finishes": [],
        "constraintReport": report,
        "meta": {
            "solverVersion": SOLVER_VERSION,
            "seed": seed,
            "normProfile": norm_profile,
            "barrierefrei": False,
            "createdAt": created_at,
        },
    }


def _slot_placement(
    item: dict[str, Any],
    slot: _Slot,
    rnd: random.Random,
    assembly_id: str,
    mount_height: float | None,
) -> dict[str, Any]:
    kand = _Kandidat(slot.pos, slot.yaw, -1)
    placement = _als_placement(item, kand, rnd)
    if mount_height is not None:
        placement["mountHeight"] = round(mount_height, 3)
    placement["assembly"] = assembly_id
    return placement


def _zuege_der_form(
    room: dict[str, Any],
    zuege: list[_Wandzug],
    anker: _Wandzug | None,
    form: str,
) -> list[_Wandzug]:
    """Wählt die zur Form passenden Wandzüge (Anschlusswand zuerst)."""
    if not zuege:
        return []
    basis = anker or max(zuege, key=lambda z: z.nutzlaenge)
    if form in ("i", "insel"):
        return [basis]
    if form == "galley":
        partner = next(
            (
                z
                for z in zuege
                if z is not basis and _parallel(z, basis) and not _angrenzend(z, basis)
            ),
            None,
        )
        return [basis, partner] if partner else [basis]
    if form == "l":
        partner = max(
            (
                z
                for z in zuege
                if z is not basis and _angrenzend(z, basis) and not _parallel(z, basis)
            ),
            key=lambda z: z.nutzlaenge,
            default=None,
        )
        return [basis, partner] if partner else [basis]
    if form == "u":
        schenkel = sorted(
            (z for z in zuege if z is not basis and _angrenzend(z, basis)),
            key=lambda z: z.nutzlaenge,
            reverse=True,
        )[:2]
        return [basis, *schenkel]
    return [basis]


def _platziere_spuele(
    room: dict[str, Any],
    slots: list[_Slot],
    belegt: set[int],
    by_typ: dict[str, list[dict[str, Any]]],
    style_profile: dict[str, Any] | None,
    rnd: random.Random,
    setze: Any,
) -> int | None:
    """P1: Spüle an den wasser/abwasser-Fixpunkten (connection maxDist beachtet)."""
    item = _stil_bestes(by_typ.get("spuele", []), style_profile, rnd)
    if item is None:
        return None
    # Slots nach Nähe zum Wasser-Fixpunkt sortieren – die connection-Regel prüft hart.
    rang = sorted(
        (i for i in range(len(slots)) if i not in belegt),
        key=lambda i: _naechster_fixpunkt_dist(room, slots[i].pos, "wasser"),
    )
    for i in rang:
        if setze(item, i):
            return i
    return None


def _platziere_geschirrspueler(
    slots: list[_Slot],
    belegt: set[int],
    by_typ: dict[str, list[dict[str, Any]]],
    style_profile: dict[str, Any] | None,
    rnd: random.Random,
    setze: Any,
    spuele_idx: int,
) -> int | None:
    """P1: Geschirrspüler DIREKT neben der Spüle (Nachbar-Slot bevorzugt)."""
    item = _stil_bestes(by_typ.get("geschirrspueler", []), style_profile, rnd)
    if item is None:
        return None
    for nachbar in (spuele_idx + 1, spuele_idx - 1, spuele_idx + 2, spuele_idx - 2):
        if 0 <= nachbar < len(slots) and nachbar not in belegt:
            if slots[nachbar].zug is slots[spuele_idx].zug and setze(item, nachbar):
                return nachbar
    return None


def _platziere_kochfeld(
    room: dict[str, Any],
    slots: list[_Slot],
    belegt: set[int],
    by_typ: dict[str, list[dict[str, Any]]],
    style_profile: dict[str, Any] | None,
    rnd: random.Random,
    setze: Any,
    spuele_idx: int,
    grid: float,
) -> int | None:
    """P1: Kochfeld mit ≥1 Slot Vorbereiten-Abstand zur Spüle UND nahe Starkstrom."""
    item = _stil_bestes(by_typ.get("kochfeld", []), style_profile, rnd)
    if item is None:
        return None
    sp = slots[spuele_idx]
    kand = [
        i
        for i in range(len(slots))
        if i not in belegt
        # mind. ein Slot «Vorbereiten» dazwischen (≥ 0.6 m Slotabstand auf der Zeile)
        and (slots[i].zug is not sp.zug or abs(slots[i].t_mitte - sp.t_mitte) >= grid + 1e-6)
    ]
    kand.sort(key=lambda i: _naechster_fixpunkt_dist(room, slots[i].pos, "starkstrom"))
    for i in kand:
        if setze(item, i):
            return i
    return None


def _platziere_kuehlschrank(
    slots: list[_Slot],
    belegt: set[int],
    by_typ: dict[str, list[dict[str, Any]]],
    style_profile: dict[str, Any] | None,
    rnd: random.Random,
    setze: Any,
) -> int | None:
    """P1: Kühlschrank an ein Zeilen-Ende (Endslots bevorzugt)."""
    item = _stil_bestes(by_typ.get("kuehlschrank", []), style_profile, rnd)
    if item is None:
        return None
    frei = [i for i in range(len(slots)) if i not in belegt]
    if not frei:
        return None
    # Distanz zum nächsten Zeilen-Ende (Slot 0 oder letzter Slot je Zug).
    enden = {0, len(slots) - 1}
    frei.sort(key=lambda i: min(abs(i - e) for e in enden))
    for i in frei:
        if setze(item, i):
            return i
    return None


def _platziere_dunstabzug(
    room: dict[str, Any],
    slots: list[_Slot],
    belegt: set[int],
    by_typ: dict[str, list[dict[str, Any]]],
    by_id: dict[str, dict[str, Any]],
    style_profile: dict[str, Any] | None,
    placements: list[dict[str, Any]],
    assembly_id: str,
    kochfeld_idx: int,
    norm_profile: str,
    catalog: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    rnd: random.Random,
) -> None:
    """P1: Wand-Dunstabzug ÜBER dem Kochfeld (Wand-Placement, mountHeight)."""
    item = _stil_bestes(by_typ.get("dunstabzug", []), style_profile, rnd)
    if item is None:
        return
    slot = slots[kochfeld_idx]
    hr = item.get("mountHeightRange") or {"min": 1.5, "max": 1.6}
    mh = round((hr["min"] + hr["max"]) / 2, 3)
    # An die Wand (Tiefe d/2 von der Wand), über dem Kochfeld-Slot.
    pos = _slot_center(slot.zug, slot.t_mitte, item["masse"]["d"])
    placement = _slot_placement(
        item, _Slot(slot.zug, slot.t_mitte, slot.breite, pos, slot.yaw),
        rnd, assembly_id, mh,
    )
    placements.append(placement)
    if _schnell_unzulaessig(room, placements, by_id, placement) or (
        _zulaessig(room, placements, catalog, rules, norm_profile) is None
    ):
        placements.pop()


def _fuelle_unterschraenke(
    slots: list[_Slot],
    belegt: set[int],
    by_typ: dict[str, list[dict[str, Any]]],
    style_profile: dict[str, Any] | None,
    rnd: random.Random,
    setze: Any,
    kochfeld_idx: int | None,
) -> None:
    """P2: Restslots mit Unter-/Hochschränken; Hochschränke an Enden gruppieren."""
    frei = [i for i in range(len(slots)) if i not in belegt]
    rnd.shuffle(frei)  # Seed-Variation der P2-Reihenfolge.
    enden = {0, len(slots) - 1}
    # Hochschränke (Vorrat) bevorzugt an Enden.
    hoch = _stil_bestes(by_typ.get("hochschrank", []), style_profile, rnd)
    if hoch is not None:
        for i in sorted(frei, key=lambda i: min(abs(i - e) for e in enden)):
            if i not in belegt and setze(hoch, i):
                break
    unter = _stil_bestes(by_typ.get("unterschrank", []), style_profile, rnd)
    if unter is None:
        return
    for i in [i for i in frei if i not in belegt]:
        setze(unter, i)


def _fuelle_haengeschraenke(
    room: dict[str, Any],
    slots: list[_Slot],
    belegt: set[int],
    by_typ: dict[str, list[dict[str, Any]]],
    by_id: dict[str, dict[str, Any]],
    style_profile: dict[str, Any] | None,
    placements: list[dict[str, Any]],
    assembly_id: str,
    kochfeld_idx: int | None,
    norm_profile: str,
    catalog: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    tiefe: float,
    rnd: random.Random,
) -> None:
    """P2: Hängeschrank-Ebene an der Wand über den Unterschränken.

    Nicht über dem Kochfeld (da hängt der Dunstabzug) und nicht vor Fenstern.
    """
    item = _stil_bestes(by_typ.get("haengeschrank", []), style_profile, rnd)
    if item is None:
        return
    hr = item.get("mountHeightRange") or {"min": 1.4, "max": 1.5}
    mh = round((hr["min"] + hr["max"]) / 2, 3)
    for i, slot in enumerate(slots):
        if kochfeld_idx is not None and i == kochfeld_idx:
            continue
        if _vor_fenster(slot):
            continue
        pos = _slot_center(slot.zug, slot.t_mitte, item["masse"]["d"])
        placement = _slot_placement(
            item, _Slot(slot.zug, slot.t_mitte, slot.breite, pos, slot.yaw),
            rnd, assembly_id, mh,
        )
        placements.append(placement)
        if _schnell_unzulaessig(room, placements, by_id, placement) or (
            _zulaessig(room, placements, catalog, rules, norm_profile) is None
        ):
            placements.pop()


def _fuelle_fuellstuecke(
    room: dict[str, Any],
    form_zuege: list[_Wandzug],
    slots: list[_Slot],
    belegt: set[int],
    by_typ: dict[str, list[dict[str, Any]]],
    placements: list[dict[str, Any]],
    by_id: dict[str, dict[str, Any]],
    assembly_id: str,
    grid: float,
    tiefe: float,
    norm_profile: str,
    catalog: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    rnd: random.Random,
) -> None:
    """P2: Restmass je Wandzug am Zeilenende mit Füllstücken (0.05/0.15) schliessen."""
    fuell = sorted(
        by_typ.get("fuellstueck", []), key=lambda c: c["masse"]["w"], reverse=True
    )
    if not fuell:
        return
    for zug in form_zuege:
        start_off, laenge = _freies_teilstueck_intervall(zug)
        n = int((laenge + 1e-6) / grid)
        rest = laenge - n * grid
        t = start_off + n * grid  # ab Ende der Korpus-Slots
        for stueck in fuell:
            w = stueck["masse"]["w"]
            while rest >= w - 1e-6 and rest >= _REST_MIN:
                pos = _slot_center(zug, t + w / 2, tiefe)
                placement = _slot_placement(
                    stueck, _Slot(zug, t + w / 2, w, pos, zug.yaw),
                    rnd, assembly_id, None,
                )
                placements.append(placement)
                if _schnell_unzulaessig(room, placements, by_id, placement) or (
                    _zulaessig(room, placements, catalog, rules, norm_profile) is None
                ):
                    placements.pop()
                    break
                rest -= w
                t += w


def _platziere_deko(
    room: dict[str, Any],
    by_typ: dict[str, list[dict[str, Any]]],
    by_id: dict[str, dict[str, Any]],
    placements: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    norm_profile: str,
    rnd: random.Random,
) -> None:
    """P3: 1–2 Deko-Items auf Restfläche (freie Boden-Kandidaten aus solver.py)."""
    from fp_engines.solver import _floor_candidates

    deko = [
        c
        for typ in ("deko", "pflanze")
        for c in by_typ.get(typ, [])
    ]
    rnd.shuffle(deko)
    gesetzt = 0
    for item in deko:
        if gesetzt >= 2:
            break
        kand = _floor_candidates(room, item)
        rnd.shuffle(kand)
        for k in kand[:200]:
            placement = _als_placement(item, k, rnd)
            placements.append(placement)
            if not _schnell_unzulaessig(room, placements, by_id, placement) and (
                _zulaessig(room, placements, catalog, rules, norm_profile) is not None
            ):
                gesetzt += 1
                break
            placements.pop()
