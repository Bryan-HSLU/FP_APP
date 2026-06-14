"""Metrik-Kern des Scan-Spikes (M2): geschätzte Raumgeometrie + erkannte Objekte
gegen die Ground Truth messen.

Bewusst **abhängigkeitsfrei** (nur stdlib `math`/`statistics`), damit die
Erfolgskriterien aus `vault/50_Umsetzung/Scan-Validierungs-Spike.md` **testbar**
sind – unabhängig vom GPU-Notebook (`spike_eval.ipynb`), das auf Google Colab
läuft (Depth Anything V2 / Grounding DINO brauchen GPU + Modell-Download).

Trennung der zwei Spike-Spalten:
- **Ohne Korrektur:** geschätztes Polygon aus der Tiefe/Layout-Schätzung (GPU).
- **Mit Ecken-Antippen:** der Nutzer setzt die Raumecken (in Metern, via AR-Pose
  oder Massstab-Anker) – liefert ein geordnetes Polygon wie die Ground Truth.
  Dieser Pfad ist **GPU-frei** und unsere Hauptabsicherung (ADR-0003).
"""

from __future__ import annotations

import math
from statistics import median

Point = tuple[float, float]
Polygon = list[Point]


def kantenlaengen(poly: Polygon) -> list[float]:
    """Wandlängen = Kanten des geschlossenen Polygons, in Eckenreihenfolge (m)."""
    n = len(poly)
    return [math.dist(poly[i], poly[(i + 1) % n]) for i in range(n)]


def flaeche(poly: Polygon) -> float:
    """Polygonfläche via Shoelace (immer positiv, m²)."""
    n = len(poly)
    s = sum(
        poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1]
        for i in range(n)
    )
    return abs(s) / 2


def rechtwinkel_abweichung_grad(poly: Polygon) -> float:
    """Grösste Abweichung der Eckwinkel von 90° (rechtwinklige Räume → 0).

    Misst den Winkel zwischen den beiden Kantenvektoren je Ecke; ein 270°-Innen-
    winkel (Reflex-Ecke der L-Form) ergibt denselben 90°-Zwischenwinkel – wir
    messen also «Rechtwinkligkeit», nicht Konvexität.
    """
    n = len(poly)
    worst = 0.0
    for i in range(n):
        a, b, c = poly[(i - 1) % n], poly[i], poly[(i + 1) % n]
        v1 = (a[0] - b[0], a[1] - b[1])
        v2 = (c[0] - b[0], c[1] - b[1])
        l1, l2 = math.hypot(*v1), math.hypot(*v2)
        if l1 == 0 or l2 == 0:
            continue
        cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)))
        worst = max(worst, abs(math.degrees(math.acos(cos)) - 90.0))
    return worst


def wandlaengen_fehler_cm(est: Polygon, gt: Polygon) -> dict[str, float | bool | None]:
    """Per-Kante |est − gt| in cm – setzt gleiche Eckenreihenfolge voraus
    (Ecken-Antippen liefert geordnete Ecken wie die Ground Truth)."""
    le, lg = kantenlaengen(est), kantenlaengen(gt)
    if len(le) != len(lg):
        return {"median_cm": None, "max_cm": None, "kanten_mismatch": True}
    fehler = [abs(a - b) * 100 for a, b in zip(le, lg, strict=True)]
    return {"median_cm": round(median(fehler), 1), "max_cm": round(max(fehler), 1)}


def flaeche_fehler_pct(est: Polygon, gt: Polygon) -> float | None:
    """Flächenfehler in % der Ground-Truth-Fläche."""
    ag = flaeche(gt)
    return round(100 * abs(flaeche(est) - ag) / ag, 1) if ag else None


def objekt_metriken(erkannt: list[str], gt_objekte: list[dict]) -> dict[str, object]:
    """Recall + Trefferliste der Objektklassen (Labels wie «a toilet» werden normiert)."""
    soll = {o["klasse"] for o in gt_objekte}
    ist = {e.removeprefix("a ").strip() for e in erkannt}
    recall = round(100 * len(soll & ist) / len(soll), 1) if soll else None
    return {"recall_pct": recall, "gefunden": sorted(soll & ist), "verpasst": sorted(soll - ist)}


def evaluate(
    gt: dict,
    est_polygon: Polygon | None = None,
    erkannte_labels: list[str] | None = None,
) -> dict[str, object]:
    """Baut die Spike-Metrik-Zeile aus Ground Truth + (optional) Schätzung/Detektion.

    `est_polygon` None → Geometrie-Metriken bleiben None (z.B. vor dem GPU-Lauf
    oder ohne Ecken-Antippen). `erkannte_labels` None → Objekt-Metriken None.
    """
    out: dict[str, object] = {
        "raum": gt.get("raum"),
        "wandlaengen_fehler_median_cm": None,
        "wandlaengen_fehler_max_cm": None,
        "rechtwinkel_abweichung_grad": None,
        "raumflaechen_fehler_pct": None,
        "objekt_recall_pct": None,
    }
    gt_poly = gt.get("grundriss_polygon_m")
    if est_polygon is not None and gt_poly:
        gt_poly = [(float(p[0]), float(p[1])) for p in gt_poly]
        wl = wandlaengen_fehler_cm(est_polygon, gt_poly)
        out["wandlaengen_fehler_median_cm"] = wl["median_cm"]
        out["wandlaengen_fehler_max_cm"] = wl["max_cm"]
        out["rechtwinkel_abweichung_grad"] = round(rechtwinkel_abweichung_grad(est_polygon), 1)
        out["raumflaechen_fehler_pct"] = flaeche_fehler_pct(est_polygon, gt_poly)
    if erkannte_labels is not None:
        om = objekt_metriken(erkannte_labels, gt.get("objekte", []))
        out["objekt_recall_pct"] = om["recall_pct"]
        out["objekt_detail"] = om
    return out


def gate(report: dict, mit_ecken_antippen: bool = False) -> str:
    """Grobe Go/Anpassen/Pivot-Einordnung aus den Geometrie-Kernkriterien.

    Schwellen aus der Spike-Tabelle (Wandlängen-Median, Flächenfehler):
    ohne Korrektur 8 cm / 8 %, mit Ecken-Antippen 5 cm / 5 %.
    """
    wl_med = report.get("wandlaengen_fehler_median_cm")
    flae = report.get("raumflaechen_fehler_pct")
    if wl_med is None:
        return "unvollständig"
    ziel_med = 5.0 if mit_ecken_antippen else 8.0
    ziel_flae = 5.0 if mit_ecken_antippen else 8.0
    if wl_med <= ziel_med and (flae is None or flae <= ziel_flae):
        return "go-bedingt" if mit_ecken_antippen else "go"
    return "anpassen" if wl_med <= ziel_med * 2 else "pivot"
