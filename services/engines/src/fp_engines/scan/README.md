# fp_engines.scan – die Vertrags-Naht der Scan-Pipeline

Überführt den Output der Raumerfassung in das Artefakt, das der Rest der App
bereits versteht: **`raummodell.json`** (Vertrag 1). Ab dieser Naht laufen
Solver, Regeln, Viewer und Exporte unverändert.

| Modul | Zweck |
|---|---|
| `spatiallm.py` | Parser für das SpatialLM-Layout-Textformat (Wände/Türen/Fenster/Objekt-Boxen, z-up) |
| `adapter.py` | Layout (z-up) → schema-valides Raummodell (y-up, normiert, deterministische IDs) |
| `poses.py` | Scan-Bundle-Posen v0: kanonisches `poses.json` der AR-Aufnahme (metrische Posen + Schwerkraft) |

Fixtures: `packages/shared/fixtures/scan/` – das handgebaute R1-WC-Layout muss
nach dem Adapter exakt die Geometrie der Ground Truth
(`fixtures/artefakte/raummodell.r1-wc.json`) ergeben (Test
`test_scan_adapter.py`).

Noch offen (Fahrplan Schritte 3–5): Konverter App-Export → kanonisches
`poses.json` (sobald das Exportformat der gewählten Aufnahme-App fixiert ist),
known-pose Fusion im `services/scan-worker`, Verifikation der Yaw-/Winkel-
Konventionen gegen echte SpatialLM-Ausgaben im R1-Lauf.

Fachliche Vorgabe (Brain): `ADR-0012-scan-pipeline-festlegung`,
`Raumerfassung-Detailkonzept`, `M2-M7-Scan-Pipeline-Fahrplan`,
`Learning-SpatialLM-Input-Contract`.
