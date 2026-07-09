# STATUS – wo stehen wir?

> **Übergabe-Dokument zwischen Arbeits-Sessions.** Jede Session (Mensch oder
> KI) aktualisiert dieses File nach jedem abgeschlossenen Schritt: Was ist
> fertig, was ist in Arbeit, was ist als Nächstes dran, welche bewussten
> Abweichungen gibt es. Meilenstein-Definitionen: Brain →
> `vault/50_Umsetzung/Bauplan-Meilensteine.md`.

**Stand: 2026-07-09**

### 3D-Volumetrie + Scene-Dressing für ALLE Raumtypen komplett (2026-07-09)
- **Modelle** in höherer Volumetrie (rundbox/lathe/torus + Glas/Chrom) für
  **Bad, Wohnen UND Küche** – alle `moebel3d`-Bauer klar erkennbar, nicht mehr
  schematisch; Ampel-/Solver-Logik unberührt, bbox-Invariante bleibt.
- **Scene-Dresser** für alle drei Raumtypen: `data/dressing/{bad,wohnen,kueche}.json`
  + Kits in `dressing3d-kits.ts`, generischer Loader/Engine, „Deko"-Toggle.
  Sparsam, „frisch gebaut". Verändert Plan/`constraintReport`/LV NICHT (0 ❌).
- **Offen/Backlog:** komplett neue Möbeltypen aus Bryans Wunschliste (Recamiere,
  Weinkühler, Doppelwaschtisch, Barwagen …) = eigener Schritt (Katalog+Regeln+
  Solver). Deko-Sonderfall „an Gerätegriff hängen" bräuchte neue Platzierungsart.
  Echtes Spiegel-Chrom bräuchte Environment-Map. Bryans echte `.glb` ersetzen
  Platzhalter über `apps/web/public/assets/dressing/`.

### 3D-Modelle Bad – höhere Volumetrie (2026-07-09)
- **Primitiv-System erweitert** (`apps/web/src/moebel3d.tsx`): neben box/zyl/kugel
  neu **`rundbox`** (RoundedBox), **`lathe`** (Rotationskörper), **`torus`** –
  plus Material-Rollen **`glas`** (echt transparent) und **`chrom`** (metallisch).
  Ampel-Farblogik unangetastet (Rolle steuert nur Oberflächen-Physik).
- **Alle Bad-Objekte + 5 Deko-Kits** auf klar erkennbare, plastische Volumetrie
  gehoben (WC/Lavabo/Dusche als Flagship, dann Fan-out: Badewanne, Spiegel,
  Badmöbel, Hochschrank, Regal, Handtuchstange/-heizung, Urinal, Bidet,
  Badteppich, Wandleuchte, Pflanze; Deko: Seifenspender, Zahnputzbecher,
  gefaltete Handtücher, Tray, Pflanze). `dressing3d.tsx`-Renderer auf die neuen
  Primitive erweitert. bbox-Invariante (`passtInBbox`/`clampTeil`) bleibt.
- **Offen:** Fan-out Wohnen/Küche-Modelle im gleichen Detailgrad; echtes
  Spiegel-Chrom bräuchte eine Environment-Map (aktuell mattes Metall).

### Scene Dressing – Bad-Durchstich (2026-07-09)
- **Neue visuelle Deko-Ebene**, client-seitig & getrennt vom Plan (Konzept:
  Brain `vault/50_Umsetzung/Scene-Dressing-Konzept.md`). `sceneDressing()` in
  `apps/web/src/dressing.ts` (Seed/Anker/Stil/Klasse-B-Kollision), gerendert als
  `DressingLayer3D` mit **„Deko"-Toggle** im 3D-Viewer. Verändert
  `placements`/`constraintReport` NICHT → 0 ❌ unberührt (Regressions-Test).
- **Ästhetik „frisch gebaut, nicht bewohnt":** 5 sparsame Bad-Objekte
  (Seifenspender, Zahnputzbecher, Tray, gefaltete Handtücher, Pflanze).
- **Asset-Drop-in:** `apps/web/public/assets/dressing/<gltfRef>.glb` (README dort);
  `assetStatus:"modeled"`+`gltfRef` → ersetzt Platzhalter automatisch. Bryan
  modelliert + lädt hoch, Rest macht die App.
- Bugfix: Ecken-Footprint (rotiert) stach durch die Wand → inkrementell nach
  innen rücken. Details: `vault/10_Learnings/Learning-Scene-Dressing-Bad-Durchstich.md`.
- **Offen:** Fan-out Wohnen/Küche; Klasse C (`an_wand`) in Engine da, ungenutzt.

### Zuletzt (2026-07-08, diese Session)
- **UI-Feinschliff:** Schein nach innen stärker & überall, mehr CI-Grün,
  Piktogramme überall grösser (`fp.css`/`theme.ts`/`Piktogramm.tsx` + Ansichten).
- **Solver/Kurator «Stufe 1»:** reiche Anordnungs-Grammatik (`near`,
  `against-wall`, `corner`, `facing:<typ>`, `opposite:<typ>`, `group:<id>`,
  `pair-with:<itemId>`) als weiche Constraints in P2/P3 + **stil-abhängige
  Platzierung** (v0: Achse `raumgefuehl` → Wand-Nähe, kleines Gewicht). Harter
  Norm-Filter/Interpreter/Parität unangetastet → 0 ❌ bleibt beweisbar. Neu:
  `services/engines/src/fp_engines/relationen.py`; `solve()` um `style_profile`
  additiv erweitert; `kurator-rolle.md` lehrt die Grammatik; `wohnen.json` demo.
  **Offen (Kalibrierung):** welche Stilachsen welchen Platzierungs-Bias steuern →
  Brain-Learning `vault/10_Learnings/Learning-Solver-Stufe1-Anordnung-Stil.md`.
- **2D-Grundriss CAD-Look:** Wand-Aussenkante liegt auf der Raumlinie, Stärke
  wächst nach innen, Gehrungs-Ecken (`innenPolygon`/`wandBaender` in `plan2d.ts`);
  Öffnungen sitzen im Band.
- **Objekt-Panel erweitert:** `ObjektInfoPanel.tsx` – Kosten + Wechsel-Alternativen
  (Thumbnail = 2D-Symbol, Preis, Masse, Stil-Match). Produktfotos je Item fehlen
  noch (Asset-Pipeline-Thema) → Thumbnail als Austauschpunkt vorbereitet.
- **(läuft)** mehr Beispielräume (`packages/shared/fixtures/artefakte/raummodell.*`).

## Meilensteine

| M | Inhalt | Status |
|---|---|---|
| **M0** Repo-Setup | Monorepo-Gerüst, Pins, Setup-Scripts, CI, CLAUDE.md/README | 🟢 fertig |
| **M1** Verträge & Regel-Kern | JSON-Schemas (7 Verträge) + Codegen + Regel-Interpreter TS & Python + Paritätstest | 🟢 fertig |
| **M2** Scan-Spike | Eval-Notebook, Messung R1–R3 (parallel, blockiert nichts) | 🟡 gestartet |
| **M3** Durchstich BAD ⭐ | Sample-Bad → Baseline → Solver P1–P3 → Viewer → Report → Mengen/KV-PDF | 🟢 DoD erfüllt |
| **M4** Auswertung voll + Kurator | LV, Bauzeitenplan, Offert-Paket, DXF · Kurator + Mini-Eval · Stil-UI | 🟢 DoD erfüllt |
| **M5** Durchstich WOHNEN | Sample-Wohnzimmer → Regelsatz/Katalog/Bilder wohnen → Solver mit freier Boden-Platzierung → LV/Bauzeit/Dokumente | 🟢 fertig |
| **M6** Durchstich KÜCHE | Formwahl + lineare Baugruppe + API + Frontend; Grossraum über Zone geplant | 🟢 DoD erfüllt |
| **M7** Scan-Integration (+AR) | Adapter · Space-Deploy · scan-worker · Upload/`/scan` · Korrektur-Modus fertig; offen: R1-Gate auf Colab (Schritt 5) | 🟡 gestartet |

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
- **M2 (2026-06-14, getesteter Metrik-Kern):** `notebooks/scan-spike/`
  `eval_metrics.py` – **GPU-freier, abhängigkeitsfreier** Mess-Kern
  (Wandlängen-Fehler Median/Max, Fläche %, Rechtwinkligkeit, Objekt-Recall) +
  `gate()` (Go/Anpassen/Pivot aus den Spike-Schwellen). **`test_eval_metrics.py`
  grün** (5 Tests gegen R1-Ground-Truth: perfekte Schätzung = 0 Fehler, 1.56 m²/
  5.6 m reproduziert, 5-cm-Störung erkannt, Eckenzahl-Mismatch gemeldet, Recall).
  Notebook nutzt jetzt diesen Kern und kennt die **Ecken-Antippen-Variante**
  (`corners/<raum>.json`, Wandgenauigkeit GPU-frei). Die schweren ML-Schritte
  (Depth Anything V2, Grounding DINO, SAM2) brauchen GPU+Modell-Download →
  laufen auf **Colab (T4)**, nicht in dieser Umgebung (kein GPU, HF 403).

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

- **M6 Phase B (2026-06-12, Durchstich KÜCHE – Formwahl + Baugruppe):**
  - **Küchen-Solver** `services/engines/src/fp_engines/kueche.py`:
    - `formwahl(room, style_profile, norm_profile)` – Wandzüge (massiv,
      achsparallel) + Anschlusswand (Wasser/Abwasser-Fixpunkte am nächsten);
      Kandidaten-Formen nach Tabelle 1a hart gefiltert (I ≥2.4 m + Querbreite
      ≥1.6; Galley 2 parallel + Breite ≥2.4; L ≥1.8+≥1.2; U 3 Züge + Innenbreite
      ≥1.2; Insel Breite ≥3.4 UND Boden-Fixpunkt); Soft-Score
      0.35·stil+0.30·ergo+0.20·arbeitsplatte+0.15·stauraum mit Stil→Form-
      Heuristik (`_FORM_STILZIEL` auf den Stilachsen). Rückgabe Top-3 DISTINKTE
      Formen (Begründung, Score, anchorWallIds, Nutzlänge).
    - `solve_kueche(...)` – lineare Baugruppe: Raster ch55/eu60, Slots ab
      Wandzug-Anfang (türfreies Teilstück), AMK-Füllung **P1** Spüle@Wasser →
      GS direkt daneben → Kochfeld ≥1 Slot Abstand + nahe Starkstrom → Kühl an
      Zeilenende → Dunstabzug als Wand-Placement über dem Kochfeld; **P2**
      Hochschrank an Enden, Unterschränke in Restslots, Hängeschrank-Ebene (nicht
      über Kochfeld, nicht vor Fenster), Füllstücke (0.05/0.15) ans Zeilenende;
      **P3** 1–2 Deko über `_floor_candidates`. Jede Platzierung gegen
      `_zulaessig` (evaluate_rules) – Solver-Invariante **verletzt==0** gewahrt,
      sonst `NoFeasiblePlacement`. `plan.assemblies` = eine kuechenzeile-UUID je
      Zeile, `meta.normProfile`. Stil-Auswahl reuse über `kurator._cos`.
      Regel-Interpreter **nicht angefasst** (Paritäts-Gesetz). Solve-Zeiten:
      geschlossene Küche ~0.09–0.12 s, Grossraum-Zone ~0.13 s (< 2 s).
  - **API:** `POST /kueche/formen` (Top-3) · `/solve` erweitert um
    `normProfile`/`form`/`zoneId`, Routing über `_effektiver_raum` (zoneId ODER
    Auto-Küchenzone im Grossraum → `zone_room`), Küchen-Pfad → `solve_kueche`;
    Response liefert zusätzlich `room` (effektiv geplanter Teilraum) für Viewer +
    Live-Ampel. Alle `/export/*` laufen für Küchen-Pläne (placements-basiert).
  - **Frontend:** Küchen-Erkennung (roomType kueche ODER Küchen-Zone);
    Normprofil-Toggle CH/EU, Formwahl-Karten (Name, Begründung, Score-Balken),
    Grossraum-Hinweis «geplant wird die Zone Küche»; Viewer + Ampel nutzen den
    von `/solve` zurückgegebenen effektiven Raum; «Variante würfeln» behält
    Form + Normprofil. Bad/Wohnen-Flows unverändert.
  - **Tests:** `test_kueche.py` (Formwahl: Insel ausgeschlossen, Anschlusswand
    in jeder Top-Form, Stil verschiebt Ranking · Baugruppe Property-Test
    {kueche, grossraum+zone}×{ch,eu}×6 Seeds = 0 ❌ + schema-valide +
    deterministisch · GS neben Spüle · Kochfeld↔Spüle ≥0.6 m · eine Assembly-ID
    je Zeile · Rasterpositionen · ch55/eu60-Varianten · Grossraum-Placements in
    Zone · Seed-Variation) + Endpoint-Tests (/kueche/formen, /solve kueche,
    /solve Grossraum-Zone, 1 Export-Smoke). **Gesamt: Python 163 grün (~9 s),
    vitest 19 grün, mypy/ruff sauber, Schema-Check 11 Files.**

- **M3-Politur (2026-06-13, Verkehrsweg-Freiraumanalyse `circulation`):**
  Der seit M3 offene `circulation`-Stub ist jetzt ein **echter Evaluator** in
  BEIDEN Interpretern (1:1, ganzzahlige Raster/Erosion-Analyse: Bodenraster →
  freie Zellen → Manhattan-Distanztransform → Bottleneck via Union-Find über
  fallende Clearance-Schwellen; Anker = Türmünder, bei 1 Tür zusätzlich der
  offenste Punkt). **Marge = 2·Bottleneck − minWidth** (0.05-m-Raster). Die
  Live-Ampel und alle Reports zeigen jetzt ein Verkehrsweg-Urteil.
  - **Bewusst SOFT in v0** (Norm-Regelsatz lässt hard/soft offen): informiert,
    ohne die Solver-Invariante zu berühren. Der Solver ist noch nicht
    verkehrsweg-optimierend → seine Pläne zeigen oft eine **soft**
    circulation-Verletzung (bad knapp, wohnen/kueche verletzt) – ehrlich.
  - **Performance:** circulation läuft NICHT im Solver-Hot-Path – `_zulaessig`
    wertet dort per `nur_hart=True` nur harte Regeln (verhaltensneutral, da
    soft nie in `hard.summary` zählt); voller Report inkl. circulation nur 1×.
  - **Parität:** neuer goldener Fall `flur-circulation-verletzt` (Trennwand
    pincht Korridor) lockt den Verletzungs-Pfad TS↔Python; +4 Unit-Tests.
  - **Gesamt grün:** Python 171 (~20 s, 0.05-Raster), vitest 23, Parität
    beidseitig, mypy/ruff/Prettier/Schema sauber.

- **M3-Politur (2026-06-13, 2D-Grundriss-Ansicht):** Neuer **Aufriss von oben**
  als SVG (`apps/web/src/Viewer2D.tsx`) – Header-Umschalter 3D↔2D, **2D ist
  Default** (normgerecht beurteilbar). Wände (massiv/offen), Öffnungen mit
  **Türschwenk**, Footprints **nach der Norm-Ampel eingefärbt** (verletzt/knapp/
  ok/gesperrt), wandmontierte Objekte gestrichelt+transparent, klick-auswählbar,
  Legende. Geometrie-Kern `plan2d.ts` nutzt **`footprint()` aus @fp/shared/rules**
  → exakt deckungsgleich mit Solver/Interpreter/3D-Viewer (kein zweites
  Rotations-Mathe). **Test-Infra für `apps/web` neu aufgesetzt** (vitest 4.1.8):
  `plan2d.test.ts` (Transform/Footprint/Normale) + `Viewer2D.test.tsx`
  (Render-Smoke via renderToStaticMarkup). apps/web 8 Tests grün, Build ok.
  - **Drag&Drop (2026-06-13):** Footprints im 2D-Grundriss per Maus/Touch
    ziehen (unverriegelte Items), Live-Ampel rechnet sofort mit. Pointer→Welt
    über die SVG-CTM + `toWorld` (Umkehrung von `toScreen`, Roundtrip-Test).
    Pfeiltasten/«r»/sperren bleiben.
  - **«austauschen» (2026-06-13):** Im Auswahl-Panel das Item gegen eine
    Katalog-Alternative tauschen (gleicher Funktionstyp + gleiche
    normProfileVariante → Küchenzeile bleibt konsistent); Pose bleibt, Ampel
    rechnet die neuen Masse sofort durch.

- **Verkehrsweg-aware Solver, Schritt 1 (2026-06-14, Tür-Korridor-Freihaltung):**
  Optionale (P2/P3) Objekte werden NICHT mehr in einen Tür-Zugangsstreifen
  (Türbreite × 0.9 m ins Rauminnere) platziert – reiner Geometrie-Filter in
  `solver.py` (`_tuer_korridore`/`_blockiert_korridor`), billig, paritätsneutral
  (kein Interpreter/Goldens, kein Grid im Hot-Path), P1 unberührt. **Effekt: Bad
  von knapp/verletzt auf circulation ok (+60 cm)** – genau «Korridor in P2/P3
  freihalten». Test `test_tuer_korridor_frei_von_optionalen`. Suite 172 grün.
- **Verkehrsweg-aware Solver, Schritt 2 (2026-06-14, Metrik-Fix Tür-Anker):**
  Die in Schritt 1 gefundene «Metrik-Fragilität» war der **Tür-Anker am Türmund**
  (1.5 Zellen) – dadurch war faktisch die fixe **Türbreite** der Engpass statt
  des durch Möbel beeinflussbaren Innenraum-Korridors. **Fix (1:1 TS & Python):
  Anker ~minWidth/2 HINTER die Tür** (ins Korridor-Innere). Der grosse Refactor
  (Chamfer/Wände-als-Hindernis) war NICHT nötig. **Effekt (echter Evaluator):
  wohnen −70 → ok +10, kueche −70 → knapp 0, bad bleibt ok +60, flur (echte
  Sperre) bleibt verletzt −30.** Goldens neu (Parität bit-identisch), 172 pytest
  + 23 vitest grün. Die Metrik urteilt jetzt sinnvoll & verteidigbar.
  - **hard-Hochstufung jetzt plausibel, aber bewusst noch soft:** Solverpläne
    sind jetzt circulation ok/knapp (kein verletzt in der Praxis). Hürde für hard
    ist nicht mehr die Metrik, sondern die **Hot-Path-Performance** (circulation
    ist teuer ~0.4 s/Auswertung; als hard liefe sie je Kandidat). Der billige
    Tür-Korridor-Filter (Schritt 1) verhindert die häufigsten Verletzungen schon
    ohne Grid – ein finaler Hard-Check + Keep-out könnte reichen. Mit Bryan
    abstimmen, ob/wann hard. Details: Brain `Learning-Circulation-Metrik-Fragilitaet`.
- **Küchen-Politur (2026-06-14, Arbeitsdreieck als echter Score):** Der bisher
  fix auf 0.0 gesetzte `softScore.ergonomie` wird für Küchenpläne mit dem
  **gemessenen AMK-Arbeitsdreieck** (Spüle–Kochfeld–Kühlschrank) befüllt: drei
  Seitenlängen + Summe → Trapez-Score [0,1] (Seite ideal 1.2–2.7 m, Summe
  4–8 m = effizient). Berechnet **nach** der Platzierung (`arbeitsdreieck()` in
  `kueche.py`) – **ohne Regel-Interpreter, Schema oder Goldens zu berühren**: das
  Feld existierte bereits im Plan-Schema, der Solver post-prozessiert nur den
  fertigen `constraintReport` (Paritäts-Gesetz unberührt, Invariante bleibt 0 ❌).
  `/solve` liefert für Küchen zusätzlich ein `arbeitsdreieck`-Detail (Seiten/
  Summe/Bewertung); der Viewer zeigt es als Panel (effizient/akzeptabel/beengt/
  weitläufig). Ehrliche Werte (echter Evaluator): Sample-Küche 3.2×2.6 m =
  **beengt** (0.26, Summe 2.2 m), Grossraum-Zone = **akzeptabel** (0.67, Summe
  3.3 m) – differenziert nach Raumgrösse. `formwahl` (Pre-Placement-Ranking)
  bleibt bewusst beim Proxy (das echte Dreieck ist vor der Platzierung unbekannt).
  Suite: 187 pytest + 23 vitest + 8 apps/web-vitest grün, mypy/ruff/Prettier/
  Schema sauber. Brain: Learning-Arbeitsdreieck-Ergonomie-Score.

- **M7 Schritt 1 (2026-07-05, Scan-Vertrags-Naht):** Neues Paket
  `fp_engines/scan/` – **SpatialLM-Layout-Parser** (`spatiallm.py`, z-up-
  Textformat Wall/Door/Window/Bbox) + **Adapter** (`adapter.py`: z-up→y-up
  **ohne Spiegelung** (x,y,z)→(x,z,−y), Normierung auf min=0, mm-Rundung,
  Wand-Ketten→Boden-Polygon mit 2-cm-Toleranz, Öffnungen mit hostWall/offset/
  sill, Objekt-Boxen mit needsReview, **deterministische uuid5-IDs**, ehrlicher
  `AdapterFehler` bei offener Hülle) + **Scan-Bundle-Posen v0** (`poses.py`:
  kanonisches `poses.json` – Meter/Sekunden/Quaternion xyzw + gravity; App-
  Exporte werden am Rand dorthin konvertiert). **Kernbeweis:** handgebautes
  R1-WC-Layout (`fixtures/scan/r1-wc.layout.txt`) ergibt nach dem Adapter
  **exakt** das Ground-Truth-Polygon von `raummodell.r1-wc.json` (1.56 m²,
  6 Wände). 11 neue Tests (Schema+pydantic-valide, Determinismus, Segment-
  Reihenfolge egal, Posen-Validierung). **Suite 198 grün**, mypy/ruff/Schema ok.
  Kontext: Brain ADR-0012 (Scan-Kette fix: AR-App-Aufnahme → known-pose Fusion
  → SpatialLM), Code-Fahrplan in `M2-M7-Scan-Pipeline-Fahrplan`.
  **Offen im Adapter-Umfeld:** Yaw-Vorzeichen + Winkel/Scale-Konvention gegen
  echte SpatialLM-Ausgabe verifizieren (R1-Lauf, Schritt 5); Konverter
  App-Export→poses.json, sobald Voxelio-/ARCore-Exportformat fixiert ist.

## Nächste Schritte (für die nächste Session)

1. **Scan-Code-Fahrplan (Brain: `M2-M7-Scan-Pipeline-Fahrplan`, von Bryan
   freigegeben 2026-07):** ✅ Schritt 1 Adapter fertig (s.o.) · ✅ **Schritt 2
   Space-Deploy-Gerüst (2026-07-05):** `fp_engines/space.py` (EIN Origin:
   `/api` → Engines, `/` → gebautes Frontend – exakt die Dev-Proxy-Semantik,
   kein CORS) + `Dockerfile` (multi-stage Node-Build → Python/uv, Port 7860,
   User 1000) + `.dockerignore` + `deploy-space.yml` (pusht bei jedem
   main-Push einen frischen Einzel-Commit OHNE notebooks/.git – die 50 MB
   R1-Videos überschreiten HFs 10-MB-Grenze – mit HF-Frontmatter-README in
   den Space `Bryan-HSLU/FP_POC`; Secret `HF_TOKEN` liegt in GitHub).
   2 neue Tests (test_space.py), Suite 200 grün, Smoke lokal ok (API +
   index.html). **Erster echter Space-Build läuft mit diesem Push** –
   Ergebnis auf huggingface.co/spaces/Bryan-HSLU/FP_POC prüfen; Groq-Secrets
   (`FP_KURATOR_URL/_MODEL/_API_KEY`) später in den Space-Settings setzen.
   · ✅ **Schritt 3 scan-worker (2026-07-05):** neues Paket
   `services/scan-worker` (eigenes uv-Projekt, Base-Dep nur numpy; gradio als
   Extra `worker`; torch/spatiallm/open3d NIE als Deps – nur Colab, NC!).
   **CPU-getesteter Geometrie-Kern:** `kamera.py` (OpenCV-Pinhole-unproject,
   Quaternion→Pose) · `fusion.py` (Voxel-Zentroid-Downsampling, deterministisch)
   · `ausrichtung.py` (z-up aus gravity via Rodrigues + `boden_ransac`-Fallback,
   Boden→z=0) · `skalierung.py` (Wandhöhen-Fallback; Posen metrisch ⇒ Skala 1)
   · `ply.py` (binary PLY XYZ+RGB = SpatialLM-Contract) · `pipeline.py`
   (Keyframe-Sampling = Laufzeit-Hebel, TiefenProvider injizierbar) ·
   `worker.py` (Gradio-App, GPU-Teile guarded) · `notebooks/colab_worker.ipynb`
   (Starter: PAT-Clone, EINE Setup-Zelle mit Drive-Wheel-Cache-TODO, share-URL
   → manuell als `FP_SCAN_WORKER_URL` in den Space = Zeiger v0).
   **Kamera-Konvention festgezurrt** (poses.py-Docstring: OpenCV-Pinhole,
   T_wc; ARKit-Konverter = R·diag(1,−1,−1)). CI erweitert (lint/typecheck/
   test + sync). **Suite: 200 engines + 22 scan-worker = 222 grün.**
   · ✅ **Schritt 5 vorbereitet (2026-07-06):** `_lauf_spatiallm` **verdrahtet** –
   ruft das offizielle SpatialLM-`inference.py` als Subprozess
   (`-p scene.ply -o layout.txt -m manycore-research/SpatialLM1.1-Qwen-0.5B`),
   dessen `to_language_string()`-Ausgabe = unser `layout.txt`-Vertrag (robust
   gegen SpatialLM-API-Änderungen, kein Nachbau der Vorverarbeitung). Repo-Pfad
   + Modell über `FP_SPATIALLM_DIR`/`FP_SPATIALLM_MODELL`. Notebook-Setup-Zelle
   klont SpatialLM, installiert den 1.1-Stack (Poetry + `poe install-sonata`)
   mit **flash-attn-Wheel-Cache auf Drive**. **Korrektur:** SpatialLM 1.1 nutzt
   **Sonata + flash-attn** als Backbone, **nicht** TorchSparse (das war nur 1.0)
   → Wheel-Cache zielt jetzt auf flash-attn.
   **Offen (= der eigentliche R1-Gate, Schritt 5):** erster echter Colab-Lauf –
   torch/CUDA-Pins an die Session anpassen (SpatialLM will 2.4.1/CUDA 12.4),
   Genauigkeit gegen R1 messen, Intrinsics aus AR-Metadaten statt Schätzung.
   Braucht Bryans AR-App-Aufnahmen (R1/R2/R3).
   · ✅ **Schritt 4 Upload-UI + `/scan` (2026-07-05):** `POST /scan`
   (multipart) nimmt ein **vorberechnetes Scan-Bundle** (`layout.txt` einzeln
   ODER `.zip` mit `layout.txt`/`poses.json`) → `_bundle_dateien` entpackt →
   `parse_layout` + `layout_to_raummodell` → schema-valides Raummodell +
   `warnungen` (needsReview-Objekte, fehlende Anschlüsse). `poses.json` wird,
   falls vorhanden, validiert (Warnung statt Abbruch). Fehler-Envelope:
   SCAN_INVALID (roomType/Layout kaputt) · SCAN_NO_LAYOUT (nur Video → Live-Weg
   folgt Schritt 5). Frontend: Header-Bedienung «📷 Scan laden» + Raumtyp-Select
   → `api.scan` (FormData) → Raum wird in die Liste gehängt und über
   `raumWaehlen` in den bestehenden Klickpfad eingespeist. **v0 = Vorberechnen**
   (Demo-Regel); Live-Weiterleitung an `FP_SCAN_WORKER_URL` bleibt Schritt-5-
   TODO. 6 neue Endpoint-Tests + Live-Smoke (R1-Layout → 1.56 m², 6 Wände,
   2 Öffnungen). Suite: **206 engines + 22 scan-worker grün**, Frontend
   lint/typecheck/build sauber.
   · ✅ **3D-Objekte statt Box-Platzhalter (2026-07-05, Bryan-Wunsch):**
   `moebel3d.tsx` – alle 31 Katalog-funktionsTypen als Primitiv-Kompositionen
   (2–7 Teile; WC/Lavabo/Dusche mit Glaswänden/Sofa/Kochfeld …), Fallback =
   alte Box. **bbox-Treue als Test-Invariante** (`passtInBbox` über 5 Grössen):
   kein Primitiv verlässt w×d×h, Gruppen-Transform + Klick 1:1 wie vorher →
   Norm-Ampel-Farben/Logik unangetastet. Hinweis: glTF-Export bleibt bewusst
   Boxen (Viewer detaillierter als Export – POC-ok).
   · ✅ **Manueller Raum-Editor (2026-07-05, Bryan-Wunsch, Brain:
   Raum-Editor-Manuell):** dritte Erstellungsvariante «✏️ Raum erstellen» –
   `raumbau.ts` (pure, getestet: Rechteck/L-Form-Polygone, Shoelace, Öffnungs-
   Validierung, R1-L-Form = 6 Wände/1.56 m²) + `RaumEditor.tsx` (SVG-Draufsicht,
   Werkzeuge Tür/Fenster/Anschluss per Wand-Klick, Pflicht-Anschluss-Hinweis je
   Raumtyp, nutzt `plan2d`-Transform) → schema-konformes Raummodell
   (source manuell, `geometryConfirmed true` → keine Unsicherheits-Marge),
   geht wie Scan/Sample durch `raumWaehlen` in den Klickpfad.
   apps/web: 30 Tests grün, tsc/eslint/prettier/build sauber.
   · ✅ **Corporate-Identity-Theme (2026-07-05, Brain: Corporate-Identity):**
   `theme.ts` mit den 5 CI-Tokens (Dunkelgrün #243D35 primär, Orange #D6914F
   CTA, Off-White #F0F7F2 Grund, Dunkelblau, Salbeigrau) · Header-Wortmarke
   FUTURE (weiss) / PLANNING (orange, gesperrt) + Claim «Meet. Match. Build.»
   · alle alten Marken-Hexwerte in App/Stil/RaumEditor/Viewer2D/Viewer3D auf
   Tokens · **Ampel-/Statusfarben bewusst unangetastet** (verletzt/knapp/
   gesperrt + P2/P3; P1 war schon CI-Grün, jetzt via Token + Klarstellungs-
   Kommentar) · CI-Fonts NICHT eingebettet (Lizenz offen lt. Brain, Kommentar
   im Code) · index.html-Titel mit Claim.
   · ✅ **Wizard-UI + Pitch-Grafikstil + Logos + Möbel-Materialfarben
   (2026-07-06, Bryan-Vorgaben aus CD-Sheet/Flyer/App-Mockups – Brain:
   Corporate-Identity §Layout- & Grafiksprache):**
   - **Schritt-für-Schritt-Wizard** statt alles auf einem Screen: 1 Projekt
     (Sample-Karten/Scan/Raum erstellen) → 2 Stil → 3 Vorschlag (Küche:
     Formwahl) → 4 Anpassen (Viewer/Ampel/würfeln) → 5 Auswertung & Export.
     Auto-Weiter nach Raumwahl und Plan; Badge-Navigation; keine Funktion
     entfernt (Checkliste im Commit).
   - **Pitch-Grafikstil als Tokens:** harter Schlagschatten OHNE Blur
     (8px 8px 0) + weisser Innen-Schein auf allen Karten; orange Pill-Buttons;
     dünne Versal-Titel; heller Verlauf-Grund (dunkler Flyer-Look = Marketing).
   - **Echte Logos:** `public/FP-Logo-horizontal.png` im hellen Header +
     Signet als Favicon (aus Brain-assets).
   - **Möbel-Materialfarben:** MATERIAL_FARBE je funktionsTyp (Keramik/Holz/
     Salbei/Edelstahl/Terracotta/Grün) – greift NUR bei Ampel-Status ok;
     verletzt/knapp/gesperrt behalten Statusfarben (Ampel dominiert). Dafür
     Viewer3D jetzt mit statusById → **Norm-Ampel auch in 3D sichtbar**.
   apps/web 32 Tests grün, alle Gates sauber. CI-Fonts weiter bewusst nicht
   eingebettet (Lizenz offen). Bryan liefert eigene Piktogramme nach →
   gleicher Stil (inner glow + harter Schatten).
   · ✅ **Schritt 6 Scan-Korrektur-Modus (2026-07-06, Brain: ADR-0003 /
   M2-M7-Scan-Pipeline-Fahrplan):** nutzergeführte Korrektur gescannter Räume
   (~8.5 cm Unsicherheit, kein LiDAR). Reine Geometrie `korrektur.ts` (getestet,
   DOM-frei): `ecken` (eindeutige Ecken via Endpunkt-Matching mit Epsilon –
   Wand-Array NICHT umlauf-sortiert), `verschiebeEcke` (angrenzende Wände
   wandern mit), `snappe` (Achsen-Snap auf Nachbar-x/z < 7 cm → rechtwinklig =
   das Anti-8.5-cm-Werkzeug, dann 5-cm-Raster), `kettePolygon` (Umlauf schliessen
   analog `_kette` in adapter.py, offene Hülle = Fehler-Objekt statt Wurf →
   UI blockt «Übernehmen»), `wendeAn` (Öffnungs-offset-Clamp, Fixpunkt behält
   relatives t auf der Wandachse, Fläche/Polygon neu, Objekte
   bestätigt→needsReview:false / entfernt raus, geometryConfirmed→true, IDs
   stabil, 2-Dezimal-Rundung). UI `ScanKorrektur.tsx` (Muster RaumEditor):
   SVG-Draufsicht, Ecken als ziehbare Griffe (Pointer = Maus **und** Touch/
   Antippen, live-Snap + Längen), Werkzeuge Tür/Fenster/Anschluss per Wand-Klick,
   Scan-Objekte als gestrichelte rotierte bbox (needsReview orange), rechte
   Spalte mit Scan-Warnungen + fehlenden Pflicht-Anschlüssen + Öffnungs-/
   Anschluss-/Objekt-Listen, «Übernehmen» gesperrt bei Öffnungs-Fehler oder
   offener Hülle. App.tsx: `scanLaden` öffnet jetzt das Korrektur-Modal (State
   `korrektur`) statt direkt zu wählen; «Übernehmen» → korrigierter Raum in den
   Klickpfad, «Abbrechen» → Scan unkorrigiert (geometryConfirmed bleibt false);
   «📐 Korrigieren»-Knopf im Schritt «Projekt» für gescannte Räume
   (`meta.captureMethod === "ar"`, defensiv). 16 neue Tests (korrektur.test.ts,
   inkl. Schema-Validierung des korrigierten Raums). apps/web **52 Tests grün**,
   tsc/eslint/prettier/build sauber.
   · ✅ **Bild-Katalog aus Bryans Metadaten + echte Fotos (2026-07-06):**
   `data/images/{bad,wohnen,kueche}.json` von je 8 Platzhaltern auf **je 30 real
   getaggte Bilder** (aus Bryans ZIP-Metadaten generiert; alle 8 Achsen + reiche
   `attributTags` + Palette + Lizenz; schema-sauber, ungültiger `roomType:`-Tag
   entfernt). **Die echten PNG-Fotos hat Bryan direkt auf `main` hochgeladen**
   (`data/images/{roomType}/…png`, 90 Dateien ~2 MB) – bildRef ↔ Datei matcht
   1:1 (0 fehlend). `BildKachel` zeigt als Fallback die Farbpalette, falls ein
   Foto mal fehlt. Tests robust: Bildzahl-Assert dynamisch, Preset-Test skippt
   (Bryans Bilder alle istPreset=false). Bryans neue detailliertere `moebel3d`-
   Objekte via `clampTeil`-Sicherheitsnetz bbox-treu gehalten (Norm-Ampel).
   · ✅ **Möbel-3D-Varianten-Bibliothek (2026-07-06, Brain:
   Moebel-3D-Varianten-Bibliothek):** neues optionales Katalog-Feld
   `modell3d` (Schema additiv + Codegen TS/pydantic) → Viewer-Lookup
   `modell3d → funktionsTyp-Standard → Box` via `bausatzSchluessel()`.
   5 erste Varianten-Bausätze (wc-wandhaengend, lavabo-aufsatz, lavabo-doppel,
   sofa-l, dusche-eck) + 7 Katalog-Items zugeordnet. **Stil entscheidet die
   Variante** (Kurator-Score über achsenTags – Beleg: Profil warm/natürlich →
   Wc Klassik + Naturstein-Aufsatzbecken; Profil kühl/modern → wandhängendes
   Design-WC + Eckdusche). Erweitern = Katalog-Item mit achsenTags (+ optional
   neuer Bausatz), 3-Schritte-Anleitung im moebel3d-Docstring. Suite: Web 36 +
   engines 205/1 skip + scan-worker 22 grün.
   · ✅ **3D-Viewer: Türen/Fenster + stilgetriebene Oberflächen (2026-07-07,
   Bryan-Wunsch):** Wände jetzt aus massiven Segment-Quadern statt einer Voll-Box
   → Türen/Fenster sind **echte Löcher** (Vollsegmente + Sturz + Brüstung, ohne
   CSG). `raum3d.ts` (rein, getestet: `wandSegmente`/`clipZone`/`oeffnungsPose`) +
   `raum3d.tsx` (`Tuer3D` mit ~20°-Türblatt/Griff, `Fenster3D` mit getöntem Glas +
   Sprosse, `WandMitOeffnungen`, prozedurale CanvasTexture für Boden/Wand). Boden-
   & Wandoptik werden aus dem Stilprofil abgeleitet (`oberflaechen.ts`, rein/
   deterministisch, **kein Schema-Eingriff** – Konvention wie `MATERIAL_FARBE`):
   Bad→Fliesen+Wandsockel 1.2 m, Wohnen→Parkett, Küche→Stein/Fliesen je
   Materialität; Achsen temperatur/helligkeit/materialitaet/farbigkeit steuern die
   Farbe (HSL-Herleitung). Ohne Stilprofil bleibt die heutige neutrale Optik;
   Türen/Fenster erscheinen immer. Abweichung dokumentiert: Wand-Fliesenzone per
   Höhen-Clip (2 gestapelte Zonen) statt CSG-Zonenschnitt – robust & dependency-
   frei. Suite: **Web +21 (raum3d 12 · oberflaechen 9)**, Gates lint/typecheck/
   test(73)/build grün.
   · ✅ **3D-Viewer v2: Ansichts-Presets, Orbit+Begehung, 3D-Drag/Rotate,
   Ebenen, waehlbare Oberflaechen (2026-07-07, Bryan):** `Viewer3D.tsx`
   generalüberholt. **Ansichts-Presets** (Perspektive/Draufsicht/Front/Seite)
   als Leiste über dem Canvas – Kamera-Posen aus der Raum-BBox skaliert
   (`presetKamera`), OrbitControls-Ziel = Raumzentrum, Draufsicht mit winzigem
   z-Versatz gegen die Gimbal-Entartung. **Zwei Begehungsmodi**: 🌀 Orbit (wie
   bisher) und 🚶 Begehung = First-Person (Augenhöhe 1.6 m, WASD/Pfeile gehen,
   Drag umsehen, Doppeltipp = Schritt vorwärts – Maus **und** Touch, ohne
   PointerLock; **keine** Wandkollision, POC-bewusst). **Direkte Objekt-
   Interaktion wie im 2D**: gewähltes Möbel per Drag auf der y=0-Ebene
   verschieben (Raycast → 5-cm-Raster, `verschiebeNach`-Constraints), Doppelklick
   = +90° (`rotiereNach`); Klick öffnet weiterhin die Elementkarte. Nur in
   Schritt 4 (`interaktiv`), Vorschau read-only. **Ebenen-Toggles** Ampel
   (Statusfarben an/aus) + Wände (ausblendbar für freie Sicht von aussen).
   **Oberflächen als wählbare Objekte**: Klick auf Boden/Wand (kein Möbel
   getroffen) wählt die Fläche → Elementkarte-Ersatz «Oberfläche» in
   `SchrittAnpassen.tsx` mit 3 vordefinierten Boden-/Wandvarianten je Raumtyp
   (`variantenFuer`); die Wahl überschreibt lokal die stilabgeleitete Spez
   (`wendeVariantenAn`, **rein visuell, kein Schema-/API-Eingriff**) und **bleibt
   beim «Variante würfeln» erhalten** (eigener State, `loesen` fasst ihn nicht
   an; nur Raumwechsel setzt zurück). Reine Logik in `viewer3d-logik.ts`
   (getestet: BBox, Preset-Posen, Begehungs-Schrittvektor, Blickrichtung). Im
   Begehungsmodus ruhen die Möbel-Pfeiltasten (`viewer3dModus` in App, Konflikt
   vermeiden). Bewusst weggelassen: Wandkollision (POC), 3D-Labels/Beschriftungs-
   Ebene (der 3D-Viewer trägt keine Text-Labels), PointerLock (Drag-Look ist
   robuster + mobiltauglich). Suite: **Web +19 (viewer3d-logik 13 · oberflaechen
   +6) → 120**, Gates lint/typecheck/test/build grün.
   · ✅ **Viewer-Feinschliff (2026-07-07, Bryan):** (1) **3D-Bearbeitungsmodus
   entfernt** – Möbel werden im 3D NICHT mehr verschoben/gedreht (Drag/Rotate +
   DragEbene raus); 3D = reine Ansicht/Begehung, Klick wählt weiterhin aus
   (Produktkarte) und Flächen/Oberflächen bleiben wählbar. Bearbeiten läuft nur
   noch im 2D-Grundriss. (2) **2D-Planlook bei Ampel-aus**: ist die Ampel-Ebene
   aus, zeichnen die Objektsymbole mit schwarzem Stift (`FARBE_PLAN`) und
   **weisser Schraffur-Füllung** (SVG-`<pattern>` 45°), Boden wird reinweiss –
   Architektenplan-Optik; Ampel an = farbig wie bisher. (3) **Zurück zur
   Titelseite**: «Zurück» auf Schritt 1 führt zurück ins Startmenü
   (`setPhase("menue")`, Label «← Zur Startseite»); AppRahmen um `zurueckLabel`
   erweitert. Gates grün, 120 Tests.
   · ✅ **Space-Deploy entschlackt + HF-Build-Fix (2026-07-07, Bryan):** Der HF-
   Space bekam bei jedem Deploy ~233 MB Bilder (wahrscheinliche Build-Fehler-
   Ursache). Fotos `data/images` von **PNG 941×1672 (1.7–2.8 MB)** → **JPEG q82,
   max 1400px** (197 MB → 19 MB), `bildRef` in bad/kueche/wohnen.json auf `.jpg`
   (StaticFiles serviert weiter). 43 ungenutzte Piktogramm-Originale (35 MB, teils
   Umlaut-Dateinamen) entfernt – die App lädt nur die 25 ASCII-Registry-Kopien.
   Deploy-Bilder gesamt **233 → 37 MB**. Engines 205 + Web 120 Tests grün.
   · ✅ **2D Layer-System v2 + Wand-/Fenster-Look (2026-07-07, Bryan):** Die vier
   «Ebenen»-Checkboxen ersetzt durch ein **Layer-Panel** (`layer2d.ts`): 8
   **Darstellungs-Layer** (Wände/Öffnungen/Objekte/Bounding-Boxen/**Platzbedarf**/
   Beschriftung/Masse/Ampel, Defaults: Boxen/Platzbedarf/Masse aus) + **Objekt-
   Layer** (jedes Möbel einzeln ein-/ausblendbar, CAD-artig, `versteckteObjekte`).
   **Platzbedarf-Layer**: Clearance-Zonen aus den `type:"clearance"`-Regeln
   (`clearanceRect` in plan2d) als Bewegungsflächen vor den Objekten (halbtransp.
   + gestrichelt, Tooltip = `hinweis`). **Fenster jetzt IN der Wandstärke** (echte
   Aussparung via `wandLuecken`, Glas über volle Wandstärke) statt Linie obenauf;
   **Wand-Look nach Referenzbild** (helle graue Füllung `#d3d3d3` + dünne Kante).
   `rules` von App an Viewer2D durchgereicht; Planlook (Ampel aus) bleibt.
   +11 Tests (plan2d clearance/wandLuecken, layer2d) → **Web 131**, Gates grün.
   · ✅ **UI-Redesign Etappe A: Designsystem + App-Rahmen (2026-07-07,
   Bryan-Konzept):** Fundament, das die 5 Schritt-Ansichten (Etappe B) nur noch
   konsumieren. **Designsystem** – globales Stylesheet `apps/web/src/fp.css`
   (in `main.tsx` importiert): `:root`-Farbrollen als CSS-Variablen
   (`--fp-primary/-dark/-accent/-muted/-soft/-background/-text`), Typografie-Vars
   (`--fp-font-display/-body`, Schriftdateien BEWUSST nicht eingebettet – Lizenz
   offen), vereinheitlichter Kartenstil `.fp-card` (+ `.fp-card-flach`
   flach, `.fp-card-aktiv` oranger Rand) mit hartem Schlagschatten OHNE Blur
   (7px 7px 0) + Innenschein, `.fp-button` (Press/Hover-Animation + `:active`
   scale), `.fp-schritt-neu` (einmalige Einblendung), `.fp-piktogramm-puls`,
   Responsive-Helfer `.fp-two-column`/`.fp-drei-karten` (@media 820px) + reduce-
   motion. **Hintergrund reinweiss** (index.html body + `--fp-background`);
   Off-White nur für Sekundärflächen. `theme.ts` **v2** – Rückwärtskompatibel
   (THEME/karte/pill/titel/schlagschatten/innerGlow behalten, zeigen auf die
   neuen Werte) + neu `FP_VAR` (CSS-Var-Strings) & `CSS` (Klassennamen-Konstanten).
   **App-Rahmen** `AppRahmen.tsx` (Header Logo/Projektname/Menü-Platzhalter ·
   Fortschrittsweg · Inhalt zentriert max-width 1400 · Footer Zurück/Weiter).
   **Fortschrittsweg** `Fortschrittsweg.tsx` (Kreis+Label+Linie, aktiv=orange /
   erledigt=grün+✓ / gesperrt=salbei, mobil scrollbar) auf getesteter Logik
   `fortschritt.ts` (`schrittZustand`, 6 neue Tests). **Piktogramm-System**
   `Piktogramm.tsx` – 25 Inline-SVGs + **Drop-in** (`<img /piktogramme/<name>.png>`
   → onError-Fallback aufs SVG; Ordner `public/piktogramme/` mit README). **Lade-
   zustände** `Ladezustand.tsx` (pulsierendes Piktogramm + 4 Presets stil/
   vorschlag/scan/dokumente – Etappe B verdrahtet). App.tsx: nur Rahmen-
   Präsentation ersetzt (weisser Grund, alter Header/Stepper/Footer → AppRahmen),
   Schritt-Logik/State unangetastet. **Web 79 Tests grün**, lint/typecheck/build
   sauber.
   · ✅ **UI-Redesign Etappe B: die 5 Ansichten (2026-07-07, Bryan-Konzept):**
   Schritt-Inhalte aus App.tsx in eigene Komponenten gezogen –
   `SchrittProjekt.tsx` («WAS MÖCHTEST DU PLANEN?», 3 Raumtyp-Karten mit
   Piktogramm + Auswahlzustand, darunter die 3 Wege Beispiel/Scan/Manuell;
   Raumtyp-Vorwahl steuert Scan-Raumtyp + filtert Beispiele) ·
   `SchrittStil.tsx` (bildzentriertes Bewerten inline statt Overlay,
   Fortschritt «n von m», Like/Dislike/Überspringen mit Piktogrammen,
   Stilprofil-Karte mit Kurzworten/Spider/Top-3-%-Balken via fp-two-column,
   «Dein Stilprofil wird genauer.» alle 5 Bewertungen) · `SchrittVorschlag.tsx`
   (Zustand A Auslöser inkl. Küche-Normprofil/Formwahl; Zustand B «DEIN
   RAUMVORSCHLAG IST BEREIT» mit 2D-Vorschau, Stilbegründung, Haupt-
   materialien, Variante/Seed, einfacher Normstatus; EINE orange Hauptaktion
   «Ansehen & anpassen») · `SchrittAnpassen.tsx` (fp-two-column: Viewer links,
   Elementkarte rechts mit Normstatus passt/knapp/anpassen als Text+Piktogramm,
   Tausch-Alternativen, Sperren; Hilfe-Karte ohne Auswahl) ·
   `SchrittAuswertung.tsx` («DEIN PROJEKT»-Zusammenfassung mit Kosten-Spanne/
   Gewerke-Zahl/Status + Dokument-Karten-Raster mit Piktogrammen, bestehende
   api.dokument-Downloads). Ladezustände (stil/vorschlag/scan/dokumente)
   verdrahtet. Logik/State/API unverändert in App.tsx. Hinweis: Etappe-B-Agent
   brach am Session-Limit ab – Splice-Reparatur (verwaistes </div>, TS-Narrowing
   Stil-Bild, Prettier) durch die Hauptsession. **Web 79 Tests grün**,
   lint/typecheck/build sauber.
   · ✅ **Stil-Schritt v2: Live-Profil pro Swipe, Swipe-Animation,
   Konvergenz-Stopp, Bildhöhe fix (2026-07-07, Bryan):** Swipe-Bild auf
   `min(46vh,420px)` begrenzt (kein Scrollen) · Stil-Analyse steht jetzt IMMER
   neben dem Bild (fp-two-column immer aktiv; Neutralzustand «Bewerte Bilder,
   dein Profil entsteht live.») und aktualisiert LIVE nach jeder Bewertung
   (neuer Prop `onZwischenProfil` → `api.styleProfile`, nur Profil-State, kein
   Schrittwechsel/Ladezustand; Balken re-animieren via `fp-schritt-neu`) ·
   Swipe-Animation (Like gleitet rechts + oranger Akzent, Dislike links +
   dunkel, ~220 ms, reduce-motion respektiert, Überspringen ohne Animation) ·
   Konvergenz-Stopp: neues getestetes Modul `stilkonvergenz.ts`
   (`istStabil(verlauf, minBewertungen=8, delta=0.06, fenster=2)`) stoppt das
   Bewerten sobald das Profil stabil ist («Weiter mit diesem Profil» / «Weiter
   verfeinern»), statt alle 30 Bilder zu erzwingen. Kleine, dokumentierte
   Abweichung: finales `onProfil` springt nun automatisch zu Schritt 3
   (bestätigtes Profil → «weiter»). **Web 86 Tests grün** (79 + 7 neue),
   lint/typecheck/build sauber.
   · ✅ **2D-Viewer v2: Wandstärke, Objektsymbole, Ebenen, Messen, Drag&Rotate,
   Produkt-Panel (2026-07-07, Bryan):** Der 2D-Grundriss zeigt jetzt echte
   **Objektsymbole** (Architekten-Draufsicht) statt nur beschrifteter Boxen –
   neues reines Modul `symbole2d.ts`: je funktionsTyp eine Signatur (WC
   Schüssel+Spülkasten, Lavabo-Becken, Dusche Quadrat+Diagonale+Abfluss,
   Badewanne, Sofa Sitz/Rücken/Armlehnen, Ess-/Couchtisch, Bett Kissen+Decke,
   Regal/Sideboard/TV Tiefenlinien, Kochfeld 4 Kreise, Spüle Becken+Armatur,
   Kühlschrank Türlinie, Leuchten Kreis+Strahlen, Pflanze, Teppich gestrichelt,
   Schränke, …) – **alle 31 Katalog-funktionsTypen abgedeckt** (Test), Fallback =
   bisherige Box. Die Symbole nutzen die vorhandene Footprint-Transformation
   (Position/Yaw/bbox über `rotateY`+`toScreen`, deckungsgleich mit `footprint()`)
   und die **Ampel-/Materialfarbe** als Strichfarbe. **Wände mit echter
   `thickness`** als gefüllte Polygone (`wallQuad`, Fallback 0.1 m); Türen mit
   Aufschlag-Viertelkreis + Fenster als Doppellinie bleiben. **Ebenen-Leiste**
   (Beschriftung/Boxen/Masse/Ampel, Default alles an ausser Boxen).
   **Messwerkzeug** «📏 Messen» (zwei Klicks → Linie + Distanz in m, Snap auf
   Wand-Ecken < 15 cm, Escape/Moduswechsel löscht). **Direkte Interaktion**:
   gewähltes Objekt per Pointer-Drag verschieben (5-cm-Raster, bestehende
   `verschiebeNach`-Constraints) + **Rotations-Griff** (Drag rastet 15°,
   Doppelklick +90° via neues `rotiereNach`); Live-Ampel läuft wie beim Keyboard
   weiter. **Detail-Panel (Schritt 4)** erweitert: funktionsTyp, Prioritätsklassen-
   Badge, Materialfarbe-Punkt + Masse; Tausch-Alternativen als kleine Produkt-
   karten (Name + Farbpunkt + Masse) statt Select. Schritt 3 (Vorschau) bleibt
   read-only (`interaktiv=false`): Symbole/Wandstärke automatisch, keine
   Editier-Interaktion. Neue reine, getestete Geometrie in `plan2d.ts`
   (`wallQuad`, `distanz`, `wandEcken`, `naechsteEcke`, `yawAusZeiger`, `rasten`).
   App.tsx nur minimal angefasst (Props + `rotiereNach`); Keyboard-Steuerung
   unangetastet. **Web 101 Tests grün** (86 + 15 neue), lint/typecheck/build
   sauber. Bewusst weggelassen: typübergreifender Tausch (wie schon dokumentiert),
   Symbole als Fill (bewusst nur Strichkontur = Architektenlook, Ampel bleibt als
   Tint-Füllung + Rahmen lesbar).
   **Als Nächstes:** Presets optional kuratieren · ⚠️ 90 PNG (~180 MB) blähen
   Repo + Space-Deploy – ggf. Bildgrösse reduzieren/auslagern ·
   Schritt 5 E2E gegen R1 auf Colab (braucht AR-App-Aufnahmen) ·
   Bryans Piktogramme. Alt-Punkte unverändert offen: circulation
   auf `hard` hochstufen (Hot-Path-Performance, mit Bryan abstimmen); Küche
   post-POC: mehr Slot-Breiten (30/45/90), triangle-aware Slot-Optimierung.
2. **M2 Scan-Spike weiterführen:** Metrik-Kern + Ecken-Antippen-Pfad stehen &
   sind getestet (2026-06-14). **Offen – Bryan:** R1-Restmasse (Raumhöhe,
   Türbreite, Objektmasse) + Neuaufnahme nach Guideline + R2/R3; dann
   `spike_eval.ipynb` einmal auf **Colab (T4)** laufen lassen (GPU-Schritte gehen
   hier nicht). **Offen – Code:** P1 automatischer Layout-Fit (GPU) + P4
   Spiegel/Glas-Maskierung; danach Gate-Entscheid → Learning ins Brain.
3. Goldens bewusst aktualisieren: `uv run python scripts/update_goldens.py`
   (aus `services/engines/`), nur zusammen mit Interpreter-Änderung committen.

## Bewusste Abweichungen / Engineering-Entscheide

| Entscheid | Grund | Wo dokumentiert |
|---|---|---|
| Eigener Code proprietär (kein LICENSE-File) | Entscheid Bryan 2026-06-11 | README, CLAUDE.md |
| `circulation` v0 **soft** statt hard (Norm-Regelsatz nennt hard) | Norm-Regelsatz lässt unter «Offene Fragen» hard/soft explizit offen; soft informiert ohne die Solver-Invariante zu brechen (Solver ist noch nicht verkehrsweg-aware). Hochstufung auf hard = bewusster Folgeschritt mit Solver-Support | rules/basis.json, rules-README, Learning |
| `circulation`-Marge grob/konservativ (0.05-m-Raster, bbox-Blocker, Türmund-Pessimismus) | v0-Freiraumanalyse: ganzzahlig (paritätssicher), Manhattan-Distanztransform, achsparallele Bounding-Box je bodenstehendem Objekt; Türbreite cappt den Bottleneck. Tuning (Euklid, feiner, türbewusst) post-POC | interpreter.py/.ts (Docstring), Learning |
| Kollision prüft vertikale Überlappung (Höhenintervalle) | Spiegel ÜBER Lavabo ist keine Kollision – nötig für P2-Wandobjekte | Interpreter beidseitig, Learning im Brain |
| Editor: Drag&Drop nur im 2D-Grundriss (3D bleibt Pfeiltasten) | 2D hat eine eindeutige Screen→Welt-Umkehrung (toWorld); 3D-Drag bräuchte Raycasting – später | Viewer2D, plan2d.ts |
| «austauschen» bietet nur gleichen Funktionstyp + gleiche normProfileVariante | hält Plan/Küchenzeile konsistent; typübergreifender Tausch (z.B. Dusche→Badewanne) wäre eine eigene Re-Solve-Logik – post-POC | App.tsx (alternativen) |
| `door-swing` v0 als Rechteck (Breite×Radius) statt Viertelkreis | identische, einfache Geometrie in TS & Python; konservative Näherung | Code-Kommentar + Fixtures |
| M5: Bett-Regel «Zugang ≥1 Längsseite» nicht umgesetzt → Wohnzimmer-Fokus | Mit den aktuellen Regel-Typen (clearance/object-distance/host-binding) nicht ausdrückbar; Schlafen-Spezifika (Bett, beidseitiger Zugang) auf später verschoben statt Interpreter zu ändern (Paritäts-Gesetz) | STATUS, wohnen.json |
| M5: Esstisch inkl. Stühlen als EIN Footprint | POC-Vereinfachung – Stuhl-Einzelplatzierung wäre eigene Solver-Stufe; Footprint deckt Tisch + ausgezogene Stühle ab, clearance-Regel zusätzlich ≥1.0 m | catalog/wohnen.json (Item-Beschreibung) |
| M5: relationalRules-Distanzen wohnen als Zentrum-zu-Zentrum kalibriert (z.B. `near:sofa:1.3` statt 0.45) | Der Solver-Relationsfilter misst Zentrumsabstand; bei grossen Ankern (Sofa 2.1×0.95) wäre der ergonomische Kantenabstand 0.40–0.45 m als Zentrumswert kollidierend. Die ergonomische Norm bleibt als **soft** object-distance-Regel (Kantenmass 0.40 m) erhalten | catalog/wohnen.json, rules/wohnen.json |
| M6-A: Grossraum-Sample mit echter `wall.kind:"offen"`-Kante mitten im Raum (statt nur Zonen-Polygone) | Code verträgt innenliegende Segmente problemlos (kein Hüllen-Closure-Validator; Solver/Interpreter filtern auf `kind=="massiv"`). Die offene Kante modelliert die reale offene Zonengrenze explizit; `zone_room` clippt sie auf die Zonenkante und erhält `kind:"offen"`. Die synthetische `virtuell`-Erzeugung greift nur, wenn KEINE Hüllenwand die Zonenkante deckt (separat getestet) | grossraum-sample, zonen.py, test_zonen.py |
| M6-A: GS↔Spüle-«maxDist»-Regel NICHT als `object-distance` umgesetzt | Der Regel-Interpreter kennt bei `object-distance` nur `minDist` (kein maxDist). «Geschirrspüler direkt neben Spüle» ist Baugruppen-/Slot-Logik → kommt in Phase B; Interpreter wird (Paritäts-Gesetz) nicht erweitert. Nähe bleibt v0 über `relationalRules:["near:spuele:0.9"]` am Katalog-Item | rules/kueche.json, catalog/kueche.json, STATUS |
| M6-A: clearance je Küchen-Haupttyp (spuele/kochfeld/geschirrspueler/unterschrank) statt einer Sammelregel | `appliesTo` matcht auf `funktionsTyp`; eine Regel pro Typ ist die mit den bestehenden Regel-Typen ausdrückbare Form des «Gang vor Zeile ≥ 1.0 m». Echte Zeilen-/Gang-Geometrie (circulation) kommt mit Phase B | rules/kueche.json |
| M6-B: Ecke bei L/U → **Eckschrank** (Politur 2026-06-14, behebt den früheren Totraum) | grid×grid-Eckquadrat am Wand-Stoss wird aus den Schenkel-Slots reserviert, ein Eckschrank (Karussell, ch55/eu60) gesetzt – VOR den Füllstücken, damit sie ihm ausweichen. Additiv (nur wenn zulässig), Invariante bleibt 0 ❌. L = 1 Ecke, U = 2 | kueche.py (`_eck_zonen`/`_platziere_eckschraenke`), catalog/kueche.json, test_kueche.py |
| M6-B: Fenster blockieren Unterschränke NICHT, nur die Hängeschrank-Ebene meidet Fenster | Brüstungsfenster (sill ≥ 0.9 m) erlauben darunter eine Arbeitsfläche/Unterschrank; nur Hängeschränke dürfen nicht vor ein Fenster. Türen blockieren dagegen die ganze Zeile (Nutzlänge = türfreies Teilstück) | kueche.py (`_fuelle_haengeschraenke`, `_freies_teilstueck_intervall`) |
| M6-B: Hängeschrank-Heuristik = Ebene über allen Unterschränken ausser Kochfeld | Über dem Kochfeld hängt der Dunstabzug; sonst wird jede freie Wandposition mit Hängeschrank belegt (vertikal getrennt von den Korpussen → keine Kollision dank Höhenintervall-Prüfung des Interpreters). Einfach + deckt den Stauraum-Score | kueche.py (`_fuelle_haengeschraenke`) |
| M6-B: GS-«direkt neben Spüle» als Slot-Nachbarschaft (nicht als Regel) | Der Interpreter kennt kein `maxDist` bei object-distance (M6-A-Entscheid); die Baugruppe setzt den GS deterministisch in den Nachbarslot der Spüle. Damit ist die Forderung konstruktiv erfüllt, ohne den Interpreter zu ändern | kueche.py (`_platziere_geschirrspueler`) |
| M6-B (Review-Fix): P1-Geräte sind Pflicht – fehlt Spüle/GS/Kochfeld/Kühlschrank → 422 NO_FEASIBLE_PLACEMENT (nur Dunstabzug best-effort, lueftung-connection ist soft) | Vorher entstand still ein Rumpf-Plan ohne Kühlschrank (constraintReport 0 ❌, aber fachlich unvollständig) – ehrliches Scheitern statt stiller Degradation | kueche.py (solve_kueche) |
| M6-B (Review-Fix): Solver-Vorfilter toleriert Berührung (Überlappung ≤ 0.05 cm = halbe Rundungsquante) | Exakt anliegende Korpusse (Küchenzeile!) erzeugen Float-Krümel-Überlappungen ~1e-16; der Vorfilter war strenger als das Interpreter-Urteil (0.1-cm-Rundung) und verwarf gültige Slots – deshalb fehlte der Kühlschrank | solver.py (_schnell_unzulaessig, _BERUEHRUNGS_EPS) |
| M6-B: `formwahl`-Score nutzt für Ergonomie weiterhin einen Proxy (echtes Dreieck erst NACH der Platzierung) | Formwahl läuft VOR der Platzierung → das echte Arbeitsdreieck ist dort unbekannt; der Proxy (kompakte I-Zeile, L/U-Bonus) ist richtungsrichtig. Das **gemessene** Dreieck füllt seit 2026-06-14 `softScore.ergonomie` des fertigen Plans (AMK-Trapez-Score, server-berechnet) – kein Eingriff in Interpreter/Schema/Goldens | kueche.py (`formwahl` Proxy · `arbeitsdreieck` Messung) |
| M6-B: /solve-Response um `room` (effektiver Raum) erweitert | Response ist kein Schema-Vertrag (Plan-Schema bleibt unberührt). Der Grossraum-Fall braucht den abgeleiteten Teilraum für Viewer + Live-Ampel; additiv am pydantic-Response-Modell | api.py (`/solve`), App.tsx (`planRoom`) |

## Offene Fragen an Bryan

- AR-Vorschau (Stretch) bestätigen → `vault/50_Umsetzung/AR-Vorschau-Konzept.md`.
- Erste Katalog-Quelle für echte Items/Preise (POC-Fallback: Sample-Daten).
- Spike-Testräume R1–R3 aufnehmen (sobald Eval-Notebook steht).
