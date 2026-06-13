# Regel-Interpreter (TS) – Spiegel von `fp_engines/rules`

Wertet das deklarative Regel-JSON (`data/rules/`, Schema `regel`) gegen eine
Szene (Raummodell + Plan + Katalog) aus und liefert den `constraintReport`
mit Konfidenz-Ampel: **ok | knapp | verletzt | nicht-geprueft**.
«knapp» = erfüllt, aber Marge < Messunsicherheit (`estimatedError_cm`; 0 nach
`geometryConfirmed`).

## Parameter-Konventionen je Regel-Typ (v0)

| `type`            | params                                             | Semantik                                                                                                          |
| ----------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `collision`       | –                                                  | kein Überlappen; vollständig im Raum (Ecken-Heuristik)                                                            |
| `wall-distance`   | `minDist`                                          | Objekt-**Mitte** → nächste massive Wand ≥ minDist                                                                 |
| `object-distance` | `target`, `minDist`, `measure: edge\|center`       | Abstand zu Objekten vom Typ target                                                                                |
| `clearance`       | `depth`, `width?` (Default Objektbreite)           | Zone vor der Objekt-**Front** (lokal +z) frei + im Raum                                                           |
| `door-swing`      | `radius`                                           | v0: Rechteck Türbreite × radius ins Rauminnere (statt Viertelkreis – konservative Näherung)                       |
| `keep-clear`      | `depth`, `maxObjektHoehe`                          | Streifen vor Fenster frei von Objekten mit Gesamthöhe > maxObjektHoehe                                            |
| `host-binding`    | `mount`, `maxWandabstand`, `minHoehe?`/`maxHoehe?` | Wand-/Bodenbindung; Höhenfenster prüft die **Oberkante** = `mountHeight` (Unterkante, Plan) + Korpushöhe          |
| `connection`      | `anschluss`, `maxDist`                             | passender Fixpunkt in Reichweite des Footprints                                                                   |
| `circulation`     | `minWidth`                                         | v0 **soft**: Grid/Erosion-Freiraumanalyse – durchgehender Korridor ≥ minWidth zwischen Türen (Marge grob ±Raster) |
| `relation`        | `relation`                                         | soft, **nicht-geprueft** bis M3 (Solver-Scoring)                                                                  |

## ⚠️ Paritäts-Gesetz

`geometry.ts`/`scene.ts`/`interpreter.ts` sind 1:1 in
`services/engines/src/fp_engines/rules/` gespiegelt – gleiche Formeln, gleiche
Operationsreihenfolge. Wer eine Seite ändert, ändert **im selben Commit** die
andere Seite und die goldenen Fixtures (`packages/shared/fixtures/`). Der
Paritätstest (vitest **und** pytest) erzwingt identische Urteile.
