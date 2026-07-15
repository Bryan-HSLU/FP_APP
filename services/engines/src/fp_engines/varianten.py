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
    MAX_REDUKTIONEN,
    _Kandidat,
    _kandidat_score,
    _merke_platzierung,
    _PlatzKontext,
    baue_rel_map,
    circulation_verletzt,
    markiere_begehbarkeit,
    reduzierte_auswahl,
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
#      robusteres Layout. Die softScore-Felder (stil/relation, seit Welle D vom
#      Solver echt befüllt) fliessen bewusst NICHT ins Ranking: `relation` in
#      Stufe 3 misst dieselben Wünsche kontinuierlich (feiner als der binäre
#      Anteil in softScore.relation), und ein zusätzlicher Term würde die hier
#      dokumentierte Rangfolge stillschweigend ändern. Wer sie aufnehmen will:
#      dokumentieren + Tests (Arbeitsanweisung Welle D).
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
    `loese_mit_varianten` (nur beste) und `loese_varianten_details` (alle Pläne);
    die Begehbarkeits-Leiter lebt in `_waehle_begehbar` (eine Quelle für beide).
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

    Begehbarkeit (Weg «hart am Ende», Begründung in `solver.solve_begehbar`):
    verletzt die Score-beste Variante die circulation-Regel, greift die
    Leiter in `_waehle_begehbar` – (1) nächstbeste BEGEHBARE Variante, (2)
    deterministischer Re-Solve mit reduzierter Auswahl, (3) sichtbarer Hinweis.
    Die Massnahme steht additiv in `variante_info["begehbarkeit"]`; der häufige
    Fall (beste Variante begehbar) bleibt byte-identisch zum alten Verhalten.
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
    plan, variante_info, _ = _waehle_begehbar(
        plaene,
        scores,
        infos,
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
    )
    return plan, variante_info


def _waehle_begehbar(
    plaene: list[dict[str, Any]],
    scores: list[tuple[int, int, float, int]],
    infos: list[dict[str, Any]],
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
) -> tuple[dict[str, Any], dict[str, Any], int | None]:
    """Score-beste Variante wählen + Begehbarkeits-Leiter (EINE Quelle für beide
    öffentlichen Pfade, damit «beste Variante» und «3 Vorschläge» nie divergieren).

    Rückgabe: `(gewählter Plan, varianteInfo, index)` – `index` ist die Position
    in `plaene` oder None, wenn die Leiter einen Reduktions-Plan erzeugt hat
    (der dann NICHT in `plaene` liegt). Leiter wie in `loese_mit_varianten`
    dokumentiert; greift nur bei verletzter circulation des Score-Siegers.
    """
    gewaehlt = max(range(len(scores)), key=lambda i: scores[i])
    variante_info: dict[str, Any] = {
        "gewaehlt": gewaehlt,
        "anzahl": len(plaene),
        "varianten": infos,
    }
    if not circulation_verletzt(plaene[gewaehlt]["constraintReport"], rules):
        return plaene[gewaehlt], variante_info, gewaehlt

    rangfolge = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    alternative = next(
        (i for i in rangfolge if not circulation_verletzt(plaene[i]["constraintReport"], rules)),
        None,
    )
    if alternative is not None:
        variante_info["gewaehlt"] = alternative
        variante_info["begehbarkeit"] = {"massnahme": "andere-variante", "index": alternative}
        return plaene[alternative], variante_info, alternative

    # Alle K verletzt → deterministischer Re-Solve mit reduzierter Auswahl auf
    # dem Basis-seed (gleiche Mechanik wie solve_begehbar).
    by_id = {c["id"]: c for c in catalog}
    for schritt in range(1, MAX_REDUKTIONEN + 1):
        red = reduzierte_auswahl(auswahl_ids, mengen, by_id, schritt)
        if red is None:
            break
        kandidat = solve(
            room,
            red[0],
            relationale_absichten,
            catalog,
            rules,
            seed=seed,
            norm_profile=norm_profile,
            stilprofil_ref=stilprofil_ref,
            style_profile=style_profile,
            anordnung=anordnung,
            farben=farben,
            mengen=red[1],
            created_at=created_at,
        )
        if not circulation_verletzt(kandidat["constraintReport"], rules):
            variante_info["begehbarkeit"] = {"massnahme": "reduktion", "entfernteItems": schritt}
            return kandidat, variante_info, None
    markiere_begehbarkeit(plaene[gewaehlt]["constraintReport"], rules)
    variante_info["begehbarkeit"] = {"massnahme": "hinweis"}
    return plaene[gewaehlt], variante_info, gewaehlt


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

    Rückgabe: `(gewählter Plan, varianteInfo, geordnetePlaene)`. `geordnetePlaene`
    ist die Liste `[{plan, info}, …]` – der GEWÄHLTE Plan steht immer vorn (auch
    wenn die Begehbarkeits-Leiter statt des Score-Siegers eine begehbare
    Alternative oder einen Reduktions-Plan gewählt hat: der Karten-Kopf ist
    exakt der Plan, den `varianten:true` liefern würde), danach die übrigen
    Varianten in Score-Reihenfolge – für die UI-«3 Vorschläge»-Karten. Wird nur
    genutzt, wenn der Client `variantenDetails` anfordert.
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
    plan, variante_info, gewaehlt_index = _waehle_begehbar(
        plaene,
        scores,
        infos,
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
    )
    # Best-first wie die Wahl (stabil dank −index-Tiebreak → deterministisch);
    # der gewählte Plan kommt nach vorn. Reduktions-Plan (gewaehlt_index None)
    # steht vor allen K Varianten und erhält eine eigene kompakte Info-Zeile.
    reihenfolge = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    if gewaehlt_index is None:
        kopf_info = {
            "index": None,
            "seed": plan["meta"]["seed"],
            "platziert": len(plan["placements"]),
            "knapp": plan["constraintReport"]["hard"]["summary"]["knapp"],
            "relationScore": None,
            "begehbarkeit": variante_info.get("begehbarkeit"),
        }
        geordnete = [{"plan": plan, "info": kopf_info}] + [
            {"plan": plaene[i], "info": infos[i]} for i in reihenfolge
        ]
    else:
        rest = [i for i in reihenfolge if i != gewaehlt_index]
        geordnete = [{"plan": plan, "info": infos[gewaehlt_index]}] + [
            {"plan": plaene[i], "info": infos[i]} for i in rest
        ]
    return plan, variante_info, geordnete
