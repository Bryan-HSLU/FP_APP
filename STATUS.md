# STATUS – wo stehen wir?

> **Übergabe-Dokument zwischen Arbeits-Sessions.** Jede Session (Mensch oder
> KI) aktualisiert dieses File nach jedem abgeschlossenen Schritt: Was ist
> fertig, was ist in Arbeit, was ist als Nächstes dran, welche bewussten
> Abweichungen gibt es. Meilenstein-Definitionen: Brain →
> `vault/50_Umsetzung/Bauplan-Meilensteine.md`.

**Stand: 2026-06-12**

## Meilensteine

| M | Inhalt | Status |
|---|---|---|
| **M0** Repo-Setup | Monorepo-Gerüst, Pins, Setup-Scripts, CI, CLAUDE.md/README | 🟢 fertig |
| **M1** Verträge & Regel-Kern | JSON-Schemas (7 Verträge) + Codegen + Regel-Interpreter TS & Python + Paritätstest | 🟢 fertig |
| **M2** Scan-Spike | Eval-Notebook, Messung R1–R3 (parallel, blockiert nichts) | 🟡 gestartet |
| **M3** Durchstich BAD ⭐ | Sample-Bad → Baseline → Solver P1–P3 → Viewer → Report → Mengen/KV-PDF | 🟢 DoD erfüllt |
| **M4** Auswertung voll + Kurator | LV, Bauzeitenplan, Offert-Paket, DXF · Kurator + Mini-Eval · Stil-UI | 🟢 DoD erfüllt |
| **M5** Durchstich WOHNEN | Sample-Wohnzimmer → Regelsatz/Katalog/Bilder wohnen → Solver mit freier Boden-Platzierung → LV/Bauzeit/Dokumente | 🟢 fertig |
| **M6** Durchstich KÜCHE | Phase A (Stammdaten/Sample-Räume/Zonen-Ableitung) fertig; Phase B (Formwahl + lineare Baugruppe) offen | 🟡 Phase A fertig |
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

- **M4 (2026-06-11, DoD erfüllt):**
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
  - **Alle MVP-Dokumente generierbar (DoD):** KV · Mengen · LV ·
    Bauzeitenplan · Offertanfrage-Paket · Gewerke-Übersicht · Einkaufsliste ·
    2D-Plan (PDF **und** DXF) · 3D-Export (glTF 2.0, handgebauter Writer,
    deckungsgleich mit dem Box-Viewer) · Next-Steps (im KV). Im Viewer als
    «📄 Dokumente…»-Menü. **Eval-Gate entschieden: Baseline aktiv** (LLM darf
    sie per FP_KURATOR_URL herausfordern).
  - **Nicht code-seitig (bei Bryan):** Mini-Eval mit echtem LLM messen +
    Mensch-Rating; echte Bad-Fotos taggen (ersetzt SVG-Platzhalter).

- **M5 (2026-06-12, Durchstich WOHNEN):**
  - **Sample-Raum:** `raummodell.wohnen-sample` (Wohnzimmer 4.5×3.6 m, 16.2 m²,
    4 massive Wände, Tür 0.9 m an kurzer Wand, Fenster als Öffnung, KEINE
    Fixpunkte = Trockenraum). In `/samples/rooms` automatisch eingehängt.
  - **Stammdaten wohnen:** `data/rules/wohnen.json` (host-binding Regal/
    Wandbild, soft object-distance Sofa↔Couchtisch, hard clearance Esstisch
    ≥1.0 m + Sideboard ≥0.6 m; circulation bleibt Basis-Stub) ·
    `data/catalog/wohnen.json` (28 Items: sofa/esstisch/tvmoebel P1,
    couchtisch/regal/sideboard/stehleuchte P2, teppich/pflanze/wandbild/
    beistelltisch P3 – je 2–3 Stil-Varianten, Präfix `bbbbbbbb-…`) ·
    `data/images/wohnen.json` + 8 SVG-Platzhalter (2 Presets) ·
    `data/positions/wohnen.json` (Trockenraum-Gewerke: Maler Wände+Decke,
    Bodenleger, Elektro Leuchten-Anschluss, Möbel-/Wandmontage) ·
    `data/sequence/wohnen.json` (Ausräumen → Maler[Trocknung] → Boden →
    Elektro → Montage → Endreinigung).
  - **Solver – freie Boden-Platzierung:** neu `_floor_candidates` (0.25-m-
    Raster über der Bodenpolygon-BBox, Yaw 0/90/180/270, nur mount=boden) +
    `_candidates` (Wand- ⊕ Boden-Kandidaten). Vorfilter/Caps unverändert
    (P2 300 / P3 200), neu Cap P1-Backtracking 400. Determinismus gewahrt
    (Kandidatenreihenfolge deterministisch vor dem seed-shuffle). Solve
    wohnen ~0.05–0.11 s, Testsuite 109 grün in ~12 s.
  - **Beweis freie Platzierung:** Property-Test + dedizierter Test (Couchtisch
    steht frei vor dem Sofa, Wandabstand >0.3 m). Alle Dokument-Exporte
    (LV/Bauzeit/KV/DXF/glTF/Plan-PDF) laufen für wohnen E2E.

- **M6 Phase A (2026-06-12, Durchstich KÜCHE – Stammdaten/Zonen):**
  - **Sample-Räume:** `raummodell.kueche-sample` (geschlossene Küche 3.2×2.6 m,
    4 massive Wände, Tür 0.9 m, Fenster, Fixpunkte wasser/abwasser/starkstrom/
    elektro/lueftung an der Anschluss-Längswand) · `raummodell.grossraum-sample`
    (eine Hülle 7.0×4.5 m, `zones[]` = Küche 2.8×4.5 + Wohnen; Zonengrenze als
    `wall.kind:"offen"` mitten im Raum; Fixpunkte mit `zone`-Referenz an der
    massiven Stirnwand der Küchenzone). Beide automatisch in `/samples/rooms`.
  - **Stammdaten küche:** `data/rules/kueche.json` (connection spüle→wasser/
    abwasser, kochfeld→starkstrom, GS→wasser/abwasser, kühlschrank→elektro je
    hard, dunstabzug→lueftung soft · object-distance kochfeld↔spüle 0.3 hard ·
    clearance ≥1.0 m je Haupttyp · host-binding Hängeschrank/Dunstabzug an Wand)
    · `data/catalog/kueche.json` (37 Items, `normProfileVariante` ch55/eu60 für
    Korpusse+Geräte, Präfix `cccccccc-…`) · `data/images/kueche.json` + 8 SVG
    (2 Presets) · `data/positions/kueche.json` (Gewerke Küchenbauer/Sanitär/
    Elektro/Lüftung/Maler/Bodenleger) · `data/sequence/kueche.json` (Demontage →
    Roh-Installation → Maler[Trocknung] → Boden → Küchenmontage →
    Fein-Installation → Endreinigung).
  - **Zonen-Ableitung:** `services/engines/src/fp_engines/zonen.py` –
    `zone_room(room, zone_id)` projiziert eine Zone auf ein eigenständiges,
    schema-valides Teilraum-Raummodell (floor=Zonen-Polygon via Shoelace, Wände
    auf die Zonenkanten geclippt: deckende Hüllenwand erbt kind massiv/offen,
    sonst synthetisch `virtuell`; Öffnungen + Offset umgehängt; nur Fixpunkte
    der Zone). Solver/Interpreter laufen unverändert darauf (nutzen nur
    `kind=="massiv"`). v0-Annahme: achsparallele Rechteck-Zonen.
  - **Tests:** `test_zonen.py` (Teilraum schema-valide, floor=Zonen-Polygon,
    nur Küchen-Fixpunkte, virtuelle Kante bei fehlender Hüllenwand, offene
    Zonengrenze nicht montierbar, massive Stirnwand erhalten, reine Funktion) ·
    Schema-Check + beide Schema-Tests (TS+Py) um die 3 neuen Raum-Fixtures und
    die Regelsätze wohnen/kueche erweitert. Alles grün (Python 122, vitest 19).

## Nächste Schritte (für die nächste Session)

1. **M6 Phase B Durchstich KÜCHE:** Küchen-Solver = Formwahl (I/L/U/Galley/
   Insel aus Stil + Geometrie, Küchen-Detailkonzept Teil 1) + **lineare
   Baugruppe** (`plan.assemblies`, Raster ch55/eu60, Slot-/Zonenlogik Teil 2,
   Füllstücke). Grossraum über `zone_room` ableiten und je Zone solven.
   M3-Polituren **weiterhin offen:** 2D-Grundriss-Ansicht im Viewer,
   «austauschen», Drag&Drop, circulation-Freiraum-Analyse (beidseitig!).
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
| M5: Bett-Regel «Zugang ≥1 Längsseite» nicht umgesetzt → Wohnzimmer-Fokus | Mit den aktuellen Regel-Typen (clearance/object-distance/host-binding) nicht ausdrückbar; Schlafen-Spezifika (Bett, beidseitiger Zugang) auf später verschoben statt Interpreter zu ändern (Paritäts-Gesetz) | STATUS, wohnen.json |
| M5: Esstisch inkl. Stühlen als EIN Footprint | POC-Vereinfachung – Stuhl-Einzelplatzierung wäre eigene Solver-Stufe; Footprint deckt Tisch + ausgezogene Stühle ab, clearance-Regel zusätzlich ≥1.0 m | catalog/wohnen.json (Item-Beschreibung) |
| M5: relationalRules-Distanzen wohnen als Zentrum-zu-Zentrum kalibriert (z.B. `near:sofa:1.3` statt 0.45) | Der Solver-Relationsfilter misst Zentrumsabstand; bei grossen Ankern (Sofa 2.1×0.95) wäre der ergonomische Kantenabstand 0.40–0.45 m als Zentrumswert kollidierend. Die ergonomische Norm bleibt als **soft** object-distance-Regel (Kantenmass 0.40 m) erhalten | catalog/wohnen.json, rules/wohnen.json |
| M6-A: Grossraum-Sample mit echter `wall.kind:"offen"`-Kante mitten im Raum (statt nur Zonen-Polygone) | Code verträgt innenliegende Segmente problemlos (kein Hüllen-Closure-Validator; Solver/Interpreter filtern auf `kind=="massiv"`). Die offene Kante modelliert die reale offene Zonengrenze explizit; `zone_room` clippt sie auf die Zonenkante und erhält `kind:"offen"`. Die synthetische `virtuell`-Erzeugung greift nur, wenn KEINE Hüllenwand die Zonenkante deckt (separat getestet) | grossraum-sample, zonen.py, test_zonen.py |
| M6-A: GS↔Spüle-«maxDist»-Regel NICHT als `object-distance` umgesetzt | Der Regel-Interpreter kennt bei `object-distance` nur `minDist` (kein maxDist). «Geschirrspüler direkt neben Spüle» ist Baugruppen-/Slot-Logik → kommt in Phase B; Interpreter wird (Paritäts-Gesetz) nicht erweitert. Nähe bleibt v0 über `relationalRules:["near:spuele:0.9"]` am Katalog-Item | rules/kueche.json, catalog/kueche.json, STATUS |
| M6-A: clearance je Küchen-Haupttyp (spuele/kochfeld/geschirrspueler/unterschrank) statt einer Sammelregel | `appliesTo` matcht auf `funktionsTyp`; eine Regel pro Typ ist die mit den bestehenden Regel-Typen ausdrückbare Form des «Gang vor Zeile ≥ 1.0 m». Echte Zeilen-/Gang-Geometrie (circulation) kommt mit Phase B | rules/kueche.json |

## Offene Fragen an Bryan

- AR-Vorschau (Stretch) bestätigen → `vault/50_Umsetzung/AR-Vorschau-Konzept.md`.
- Erste Katalog-Quelle für echte Items/Preise (POC-Fallback: Sample-Daten).
- Spike-Testräume R1–R3 aufnehmen (sobald Eval-Notebook steht).
