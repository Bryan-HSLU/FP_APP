"""K-Varianten (generate-and-select) für den Solver – Kurator-Pipeline v3, Welle 5.

Statt eines einzelnen Solver-Laufs werden K deterministisch aus dem seed
abgeleitete Varianten erzeugt und die beste per festem Scoring gewählt.
**0 zusätzliche LLM-Calls** – reine Solver-Läufe. Der Determinismus-Grundsatz
bleibt: gleicher Input + gleicher seed ⇒ gleiche Sub-Seeds ⇒ gleiche Varianten
⇒ gleiche Wahl. Jede Variante läuft durch das normale `solve()`, hat also
**0 ❌ per Konstruktion** (Solver-Invariante).

Fachliche Vorgabe: Brain [[Kurator-Pipeline-v3-Konzept]] «Welle 5»,
[[ADR-0013-kurator-pipeline-v3]] (K-Varianten ersetzt den früher angedachten
Kritik-Call).
"""

from __future__ import annotations

from typing import Any

from fp_engines.relationen import Relation
from fp_engines.rules.geometry import Vec2
from fp_engines.solver import (
    _Kandidat,
    _kandidat_score,
    _merke_platzierung,
    _PlatzKontext,
    baue_rel_map,
    solve,
)

K_VARIANTEN = 3

# Sub-Seeds deterministisch aus dem Basis-seed: XOR mit festen, gut gestreuten
# Mischkonstanten (goldener-Schnitt- bzw. SplitMix64-Konstanten). Index 0 nutzt
# 0x0 → Sub-Seed == Basis-seed, d.h. **Variante 0 ist exakt der Plan, den
# `varianten:false` liefern würde**. Das macht «best ≥ single» wörtlich prüfbar
# und hält `varianten:true`/`false` bei Gleichstand konsistent. Die übrigen
# Konstanten streuen die seed-gesteuerte Kandidaten-Mischung (rnd.shuffle in
# solve) → andere, ebenfalls zulässige Layouts.
_SUBSEED_XOR: tuple[int, ...] = (
    0x0,
    0x9E3779B97F4A7C15,
    0xD1B54A32D192ED03,
)

# --- Scoring ----------------------------------------------------------------
# Die Rangfolge der Varianten ist **lexikografisch** (nicht eine gewichtete
# Summe): jede Stufe entscheidet nur bei Gleichstand der vorherigen. Warum
# lexikografisch statt gewichteter Summe – die Signale haben unvergleichbare
# Einheiten (Stückzahl vs. Regel-Zähler vs. Meter-Präferenz); eine Summe bräuchte
# willkürliche Normierungsgewichte. Die klare Prioritätsordnung ist erklärbar
# und stabil. Reihenfolge (höher = besser, siehe `_bewerte`):
#
#   1. platziert (desc) – Überlebensrate. Der Solver lässt optionale (P2/P3)
#      Items weg, wenn kein zulässiger Platz frei ist → mehr platzierte Items =
#      vollständigerer, wertvollerer Raum. Primärsignal.
#   2. komfort = −knapp (desc) – alle Varianten haben 0 ❌ (Invariante), aber
#      weniger «knappe» harte Regeln im constraintReport = mehr Luft zur Norm =
#      robusteres Layout. Das ist das EINZIGE echte Soft-Signal, das der
#      generische Solver in den Report schreibt: die `softScore`-Felder bleiben
#      0.0 (nur die Küche füllt `ergonomie` extern), deshalb NICHT als Kriterium
#      verwendet.
#   3. relation (desc) – weiche Relations-/Stil-Zufriedenheit des fertigen Plans,
#      bewertet mit dem SOLVER-EIGENEN Soft-Objektiv (`_kandidat_score` über den
#      voll besetzten Kontext). Die Variante, die near/facing/opposite/group/
#      pair/corner + Stil-Platzierung am besten trifft, gewinnt den Gleichstand.
#      Bewusst der kontinuierliche Präferenz-Summenwert statt eines Schwellen-
#      Zählers (keine willkürlichen «erfüllt ab X m»-Schwellen, reine
#      Wiederverwendung getesteter Logik).
#   4. −index (desc) – stabiler Tiebreak auf den kleinsten Sub-Seed-Index → bei
#      exaktem Gleichstand gewinnt Variante 0 (Basis-seed). Sichert Determinismus.


def _relation_score(
    plan: dict[str, Any],
    room: dict[str, Any],
    by_id: dict[str, dict[str, Any]],
    rel_map: dict[str, list[Relation]],
    style_profile: dict[str, Any] | None,
) -> float:
    """Weiche Relations-/Stil-Zufriedenheit des fertigen Plans (höher = besser).

    Baut den Platz-Kontext mit ALLEN Endposen auf (so kennt jede Relation ihren
    Anker – anders als im greedy Solver-Lauf, wo nur schon Platziertes zählt) und
    summiert das solver-eigene `_kandidat_score` je Placement. So misst das
    Scoring die Layout-Güte mit demselben Objektiv, das die Platzierung ordnet.
    """
    floor: list[Vec2] = [(float(p[0]), float(p[1])) for p in room["shell"]["floor"]["polygon"]]
    ctx = _PlatzKontext(
        floor=floor,
        style_vector=(style_profile or {}).get("styleVector", {}) or {},
        typ_pos={},
        id_pos={},
        gruppen_pos={},
    )
    for pl in plan["placements"]:
        it = by_id[pl["catalogItemId"]]
        pos = (pl["pose"]["pos"][0], pl["pose"]["pos"][1])
        _merke_platzierung(ctx, it, rel_map.get(it["id"], []), pos)
    total = 0.0
    for pl in plan["placements"]:
        it = by_id[pl["catalogItemId"]]
        kandidat = _Kandidat(
            pos=(pl["pose"]["pos"][0], pl["pose"]["pos"][1]),
            yaw_deg=float(pl["pose"]["yawDeg"]),
            wall_index=-1,
        )
        total += _kandidat_score(kandidat, rel_map.get(it["id"], []), ctx)
    return total


def _bewerte(
    plan: dict[str, Any],
    index: int,
    room: dict[str, Any],
    by_id: dict[str, dict[str, Any]],
    rel_map: dict[str, list[Relation]],
    style_profile: dict[str, Any] | None,
) -> tuple[tuple[int, int, float, int], dict[str, Any]]:
    """Score-Tupel (höher = besser) + kompakte Info-Zeile für `varianteInfo`."""
    platziert = len(plan["placements"])
    knapp = plan["constraintReport"]["hard"]["summary"]["knapp"]
    relation = _relation_score(plan, room, by_id, rel_map, style_profile)
    score = (platziert, -knapp, relation, -index)
    info = {
        "index": index,
        "seed": plan["meta"]["seed"],
        "platziert": platziert,
        "knapp": knapp,
        "relationScore": round(relation, 4),
    }
    return score, info


def _alle_varianten(
    room: dict[str, Any],
    auswahl_ids: list[str],
    relationale_absichten: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    *,
    seed: int,
    norm_profile: str,
    stilprofil_ref: str | None,
    style_profile: dict[str, Any] | None,
    anordnung: list[dict[str, Any]] | None,
    farben: dict[str, str] | None,
    mengen: dict[str, int] | None,
    created_at: str,
    k: int,
) -> tuple[list[dict[str, Any]], list[tuple[int, int, float, int]], list[dict[str, Any]]]:
    """K Sub-Seed-Läufe erzeugen; je Variante (Plan, Score-Tupel, Info) zurückgeben.

    Index-ausgerichtet (Position i = Sub-Seed-Index i). Gemeinsamer Kern von
    `loese_mit_varianten` (nur beste) und `loese_varianten_details` (alle Pläne).
    """
    by_id = {c["id"]: c for c in catalog}
    rel_map = baue_rel_map(relationale_absichten, anordnung)
    subseeds = [seed ^ x for x in _SUBSEED_XOR[:k]]

    plaene: list[dict[str, Any]] = []
    scores: list[tuple[int, int, float, int]] = []
    infos: list[dict[str, Any]] = []
    for index, sub in enumerate(subseeds):
        plan = solve(
            room,
            auswahl_ids,
            relationale_absichten,
            catalog,
            rules,
            seed=sub,
            norm_profile=norm_profile,
            stilprofil_ref=stilprofil_ref,
            style_profile=style_profile,
            anordnung=anordnung,
            farben=farben,
            mengen=mengen,
            created_at=created_at,
        )
        score, info = _bewerte(plan, index, room, by_id, rel_map, style_profile)
        plaene.append(plan)
        scores.append(score)
        infos.append(info)
    return plaene, scores, infos


def loese_mit_varianten(
    room: dict[str, Any],
    auswahl_ids: list[str],
    relationale_absichten: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    *,
    seed: int,
    norm_profile: str = "ch",
    stilprofil_ref: str | None = None,
    style_profile: dict[str, Any] | None = None,
    anordnung: list[dict[str, Any]] | None = None,
    farben: dict[str, str] | None = None,
    mengen: dict[str, int] | None = None,
    created_at: str = "1970-01-01T00:00:00Z",
    k: int = K_VARIANTEN,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """K deterministische Solver-Varianten erzeugen und die beste wählen.

    Rückgabe: `(bester Plan, varianteInfo)`. `varianteInfo` ist die kompakte
    Auswahl-Spur (gewählter Index, Anzahl, Scores aller Varianten) für die
    API-Response-Hülle – bewusst NICHT im Plan-Artefakt (keine Schema-Änderung).
    Parameter spiegeln `solve()`; der Aufrufer entscheidet per Flag, ob er
    `solve()` (eine Variante) oder diese Funktion (K Varianten) nutzt.
    """
    plaene, scores, infos = _alle_varianten(
        room,
        auswahl_ids,
        relationale_absichten,
        catalog,
        rules,
        seed=seed,
        norm_profile=norm_profile,
        stilprofil_ref=stilprofil_ref,
        style_profile=style_profile,
        anordnung=anordnung,
        farben=farben,
        mengen=mengen,
        created_at=created_at,
        k=k,
    )
    gewaehlt = max(range(len(scores)), key=lambda i: scores[i])
    variante_info = {
        "gewaehlt": gewaehlt,
        "anzahl": len(plaene),
        "varianten": infos,
    }
    return plaene[gewaehlt], variante_info


def loese_varianten_details(
    room: dict[str, Any],
    auswahl_ids: list[str],
    relationale_absichten: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    *,
    seed: int,
    norm_profile: str = "ch",
    stilprofil_ref: str | None = None,
    style_profile: dict[str, Any] | None = None,
    anordnung: list[dict[str, Any]] | None = None,
    farben: dict[str, str] | None = None,
    mengen: dict[str, int] | None = None,
    created_at: str = "1970-01-01T00:00:00Z",
    k: int = K_VARIANTEN,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    """Wie `loese_mit_varianten`, aber zusätzlich ALLE K Pläne in Score-Reihenfolge.

    Rückgabe: `(bester Plan, varianteInfo, geordnetePlaene)`. `geordnetePlaene`
    ist die Liste `[{plan, info}, …]` **best-first** (dieselbe lexikografische
    Ordnung wie die Wahl) – für die UI-«3 Vorschläge»-Karten. `varianteInfo`
    bleibt index-orientiert und identisch zu `loese_mit_varianten` (der gewählte
    Index ist `reihenfolge[0]`), damit der bestehende Pfad unberührt bleibt. Wird
    nur genutzt, wenn der Client `variantenDetails` anfordert.
    """
    plaene, scores, infos = _alle_varianten(
        room,
        auswahl_ids,
        relationale_absichten,
        catalog,
        rules,
        seed=seed,
        norm_profile=norm_profile,
        stilprofil_ref=stilprofil_ref,
        style_profile=style_profile,
        anordnung=anordnung,
        farben=farben,
        mengen=mengen,
        created_at=created_at,
        k=k,
    )
    # Best-first: gleiche Ordnung wie die `max`-Wahl (höheres Score-Tupel gewinnt),
    # stabil dank −index-Tiebreak → deterministisch.
    reihenfolge = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    gewaehlt = reihenfolge[0]
    variante_info = {
        "gewaehlt": gewaehlt,
        "anzahl": len(plaene),
        "varianten": infos,
    }
    geordnete = [{"plan": plaene[i], "info": infos[i]} for i in reihenfolge]
    return plaene[gewaehlt], variante_info, geordnete
