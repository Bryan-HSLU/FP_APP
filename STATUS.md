# STATUS – wo stehen wir?

> **Übergabe-Dokument zwischen Arbeits-Sessions.** Jede Session (Mensch oder
> KI) aktualisiert dieses File nach jedem abgeschlossenen Schritt: Was ist
> fertig, was ist in Arbeit, was ist als Nächstes dran, welche bewussten
> Abweichungen gibt es. Meilenstein-Definitionen: Brain →
> `vault/50_Umsetzung/Bauplan-Meilensteine.md`.

**Stand: 2026-06-11**

## Meilensteine

| M | Inhalt | Status |
|---|---|---|
| **M0** Repo-Setup | Monorepo-Gerüst, Pins, Setup-Scripts, CI, CLAUDE.md/README | 🟢 fertig |
| **M1** Verträge & Regel-Kern | JSON-Schemas (7 Verträge) + Codegen + Regel-Interpreter TS & Python + Paritätstest | 🟢 fertig |
| **M2** Scan-Spike | Eval-Notebook, Messung R1–R3 (parallel, blockiert nichts) | 🟡 gestartet |
| **M3** Durchstich BAD ⭐ | Sample-Bad → Baseline → Solver P1–P3 → Viewer → Report → Mengen/KV-PDF | 🟢 DoD erfüllt |
| **M4** Auswertung voll + Kurator | LV, Bauzeitenplan, Offert-Paket, DXF · Kurator + Mini-Eval · Stil-UI | 🟡 weitgehend (s.u.) |
| **M5** Durchstich WOHNEN | | ⚪ offen |
| **M6** Durchstich KÜCHE | | ⚪ offen |
| **M7** Scan-Integration (+AR) | | ⚪ offen |

## Was konkret existiert

- **M0:** pnpm-Workspace (Node 22 LTS, pnpm gepinnt) · `apps/web`
  (React+Vite+TS, r3f-Smoke-Szene) · `services/engines` (uv, Python 3.12,
  FastAPI-Skeleton mit `/health`) · `packages/shared` (Schemas/Fixtures/
  TS-Quellcode) · `data/`-Ordnerstruktur mit READMEs · Setup-Scripts
  (`scripts/setup.ps1` für Windows = Bryans Dev-System, `setup.sh` für CI) ·
  GitHub-Actions-CI (Lint → Typecheck → Tests → Schema-Check) · `LICENSES.md`.
- **M1:** 9 JSON-Schemas in `packages/shared/schemas/` (7 Verträge laut
  Schema-Spezifikation + Projekt-Hülle + Taxonomie) · Codegen beidseitig
  (`pnpm codegen` → TS-Typen + pydantic-v2-Modelle, generiert & eingecheckt) ·
  **Regel-Interpreter doppelt** (`packages/shared/src/rules/` ↔
  `services/engines/src/fp_engines/rules/`, Semantik-Doku im rules-README) ·
  Stammdaten `data/rules/basis.json` + `bad.json` (Norm-Regelsatz-v0,
  Richtwerte «zu-verifizieren») + `data/taxonomy/stilachsen.json` (8 Achsen,
  ADR-0006) · goldene Fixtures (Sample-Bad 3.0×2.4 m, Plan ok/verletzt) +
  **Paritätstest grün** in vitest UND pytest · `POST /validate` liefert den
  `constraintReport` über die API (inkl. Fehler-Envelope).

- **M2 (gestartet 2026-06-11):** `notebooks/scan-spike/` mit Colab-Notebook
  `spike_eval.ipynb` (P0–P5-Skelett: Frames+Gate, Tiefe DA-V2-Small,
  Grounding DINO; P1 Layout / P4 Spiegel als TODO bis zum ersten GPU-Lauf) ·
  `capture_check.py` (lokaler Vorabcheck) · **R1-Testvideos von Bryan**
  (Bad, normal + weitwinkel) in `testdata/r1/` · Vorabcheck-Report mit
  **Aufnahme-Guideline v1** in `reports/r1-vorabcheck.md` (Befund: Material
  zu unscharf/texturarm für die Kette → R1 nach Guideline wiederholen;
  Weitwinkel ~3× besser) · **Ground Truth R1 erfasst** (Bryan 2026-06-11):
  L-förmig, 1.8×1.0 m mit Versatz 0.3 m (Nische 0.7×0.8 m), 1.56 m² →
  `ground-truth/r1.json` + reales Fixture
  `packages/shared/fixtures/artefakte/raummodell.r1-wc.json` (6 Wände,
  erster nicht-rechteckiger Grundriss). Offen: Raumhöhe, Türbreite,
  Objektmasse, Neuaufnahme nach Guideline.

- **M3 (2026-06-11):** kompletter End-to-End-Klickpfad: Raum wählen
  (Sample-Bad ODER echtes R1-WC) → «Plan vorschlagen» (Baseline-Kurator +
  Feasibility-first-Solver P1–P3, `data/catalog/bad.json`) → 3D-Viewer
  (r3f: Hülle + Box-Platzhalter, Auswahl, Pfeiltasten/«r» verschieben/
  rotieren, sperren) mit **Live-Norm-Ampel** (TS-Interpreter, dieselben
  Regel-JSONs) → «Variante würfeln» (Seed) → Auswertung (Mengen + KV mit
  Bandbreite + Next-Steps) → **KV-PDF** (ReportLab, CI-Look).
  **Solver-Invariante ⭐ als Property-Test grün** (12 Seeds × 2 Räume, 0 ❌;
  Plan validiert gegen Plan-Schema; Determinismus + Varianten getestet).
  API: /samples/rooms · /catalog/{rt} · /rules/{rt} · /solve · /validate ·
  /evaluate · /export/kv-pdf (Fehler-Envelope, 422 NO_FEASIBLE_PLACEMENT).

- **M4 (2026-06-11, weitgehend):**
  - **Dokumente:** LV (deklarativer Positionskatalog `data/positions/bad.json`,
    Trigger→Template, rückverfolgbar via herkunft) · Bauzeitenplan
    (Sequenz-DAG `data/sequence/bad.json` mit Trocknungs-Wartekanten) ·
    Offertanfrage-Paket je Gewerk (ohne Preise + Rückgabeblatt) · DXF-
    Grundriss (ezdxf) · alles als API-Exporte (+PDF) und getestet.
  - **Kurator-Port** (`fp_engines/kurator.py`): Vorfilter → Prompt
    (`data/prompts/kurator-rolle.md`) → Validierung → Repair → Fallback;
    Ports baseline | llm-api/llm-local (FP_KURATOR_URL). **Mini-Eval**
    `scripts/kurator_eval.py`; **Gate-Stand: Baseline aktiv** (kein LLM
    konfiguriert – mit FP_KURATOR_URL erneut messen).
  - **Stil-UI:** 8 Sample-Bilder (SVG-Platzhalter) + Bild-Katalog
    `data/images/bad.json` · Swipe-Overlay + Preset-Klick · Smart Spider
    (SVG-Radar, Achsen aus /taxonomy) · POST /style/profile · Klickpfad
    Stil → /curate → /solve im Viewer verdrahtet (Begründung wird gezeigt).
  - **Offen für M4-Abschluss:** 2D-Plan als PDF, 3D-Export, separate
    Gewerke-Übersicht/Einkaufsliste (Daten stecken in KV/LV), Mensch-Rating
    der Mini-Eval (Bryan), echte Bad-Fotos taggen (ersetzt SVG-Platzhalter).

## Nächste Schritte (für die nächste Session)

1. **M4 abschliessen:** 2D-Plan-PDF, 3D-Export, Gewerke-Übersicht/
   Einkaufsliste als eigene Dokumente; Kurator-Mini-Eval mit echtem LLM
   (FP_KURATOR_URL setzen) + Mensch-Rating. Danach M3-Polituren
   (2D-Grundriss-Ansicht, austauschen, Drag&Drop, circulation-Analyse)
   oder **M5 Durchstich WOHNEN** (Regelsatz/Katalog/Bilder wohnen).
2. **M2 Scan-Spike weiterführen:** Restmasse R1 (Raumhöhe, Türbreite,
   Objektmasse) + Neuaufnahme nach Guideline (Bryan); danach
   `spike_eval.ipynb` in Colab (T4) auf altem+neuem Material laufen lassen,
   Wandlängen-/Flächen-Fehler gegen die Ground Truth rechnen, P1/P4 ausbauen.
3. Goldens bewusst aktualisieren: `uv run python scripts/update_goldens.py`
   (aus `services/engines/`), nur zusammen mit Interpreter-Änderung committen.

## Bewusste Abweichungen / Engineering-Entscheide

| Entscheid | Grund | Wo dokumentiert |
|---|---|---|
| Eigener Code proprietär (kein LICENSE-File) | Entscheid Bryan 2026-06-11 | README, CLAUDE.md |
| Regel-Typ `circulation` weiterhin Stub (`nicht-geprueft`) | Freiraum-Analyse nicht DoD-kritisch für M3; kommt als M3-Politur/M4 (beidseitig + Goldens) | STATUS, rules-README |
| Kollision prüft vertikale Überlappung (Höhenintervalle) | Spiegel ÜBER Lavabo ist keine Kollision – nötig für P2-Wandobjekte | Interpreter beidseitig, Learning im Brain |
| Editor v0: Pfeiltasten/Buttons statt Drag&Drop; «austauschen» fehlt | minimal gemäss DoD («ansehen + minimal editieren + Ampel»); Ausbau M4 | STATUS |
| `door-swing` v0 als Rechteck (Breite×Radius) statt Viertelkreis | identische, einfache Geometrie in TS & Python; konservative Näherung | Code-Kommentar + Fixtures |

## Offene Fragen an Bryan

- AR-Vorschau (Stretch) bestätigen → `vault/50_Umsetzung/AR-Vorschau-Konzept.md`.
- Erste Katalog-Quelle für echte Items/Preise (POC-Fallback: Sample-Daten).
- Spike-Testräume R1–R3 aufnehmen (sobald Eval-Notebook steht).
