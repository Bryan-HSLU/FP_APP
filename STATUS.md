# STATUS – wo stehen wir?

> **Übergabe-Dokument zwischen Arbeits-Sessions.** Jede Session (Mensch oder
> KI) aktualisiert dieses File nach jedem abgeschlossenen Schritt: Was ist
> fertig, was ist in Arbeit, was ist als Nächstes dran, welche bewussten
> Abweichungen gibt es. Meilenstein-Definitionen: Brain →
> `vault/50_Umsetzung/Bauplan-Meilensteine.md`.

**Stand: 2026-06-14**

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
    abstimmen, ob/wann hard. Details: Brain `Circulation-Hochstufung-auf-hard`.

- **Küchen-Politur (2026-06-14, Eckschrank statt Totraum):** Die Innenecke(n)
  bei L/U bekommen einen **Eckschrank (Karussell)** – L = 1 Ecke, U = 2, je
  ch55/eu60. Das grid×grid-Eckquadrat am Wand-Stoss wird aus den Schenkel-Slots
  reserviert (die beiden überlappenden Erstslots waren ohnehin Totraum), der
  Eckschrank wird **vor den Füllstücken** gesetzt, damit diese ihm ausweichen.
  Additiv abgesichert (nur wenn normkonform), Invariante bleibt 0 ❌.
  Test `test_eckschrank_fuellt_l_u_ecke` (kueche + grossraum × L/U × ch/eu).
  **180 pytest + 23 vitest + 8 apps/web-vitest grün.**

## Nächste Schritte (für die nächste Session)

1. **M7 Scan-Integration (+AR):** Raumerfassung an den Klickpfad anbinden
   (Scan → Raummodell → Solver). M3-Polituren: **2D-Grundriss + circulation
   + Drag&Drop + «austauschen» + Tür-Korridor + Metrik-Fix erledigt** – die
   M3-Editor-Polituren sind komplett, die circulation-Metrik urteilt jetzt
   sinnvoll. Verbleibender circulation-Folgeschritt: **circulation auf `hard`
   hochstufen** – Hürde ist nur noch die Hot-Path-Performance (Optionen +
   Empfehlung im Brain: `Circulation-Hochstufung-auf-hard`). Küchen-Politur:
   **Eckschrank erledigt (2026-06-14)**; offen: **Arbeitsdreieck als echter
   Score** (Optionen im Brain: `Arbeitsdreieck-Score-Optionen`), mehr
   Slot-Breiten (30/45/90) post-POC.
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
| `circulation` v0 **soft** statt hard (Norm-Regelsatz nennt hard) | Norm-Regelsatz lässt unter «Offene Fragen» hard/soft explizit offen; soft informiert ohne die Solver-Invariante zu brechen. Hochstufung = bewusster Folgeschritt, Hürde ist die Performance | rules/basis.json, rules-README, Brain `Circulation-Hochstufung-auf-hard` |
| `circulation`-Marge weiterhin v0-genähert (0.05-m-Raster, bbox-Blocker, Manhattan-Distanz) | Ganzzahlig = paritätssicher; achsparallele Bounding-Box je bodenstehendem Objekt. Der **Türmund-Pessimismus ist behoben** (Anker ~minWidth/2 im Korridor-Inneren, 2026-06-14). Verbleibendes Tuning (Euklid/Chamfer statt Manhattan, Wände als echte Hindernis-Zellen, echte Footprints statt bbox) ist post-POC und war für sinnvolle Urteile NICHT nötig | interpreter.py/.ts (Docstring), Learning-Circulation-Metrik-Fragilitaet |
| Kollision prüft vertikale Überlappung (Höhenintervalle) | Spiegel ÜBER Lavabo ist keine Kollision – nötig für P2-Wandobjekte | Interpreter beidseitig, Learning im Brain |
| Editor: Drag&Drop nur im 2D-Grundriss (3D bleibt Pfeiltasten) | 2D hat eine eindeutige Screen→Welt-Umkehrung (toWorld); 3D-Drag bräuchte Raycasting – später | Viewer2D, plan2d.ts |
| «austauschen» bietet nur gleichen Funktionstyp + gleiche normProfileVariante | hält Plan/Küchenzeile konsistent; typübergreifender Tausch (z.B. Dusche→Badewanne) wäre eine eigene Re-Solve-Logik – post-POC | App.tsx (alternativen) |
| `door-swing` v0 als Rechteck (Breite×Radius) statt Viertelkreis | identische, einfache Geometrie in TS & Python; konservative Näherung | Code-Kommentar + Fixtures |
| M5: Bett-Regel «Zugang ≥1 Längsseite» nicht umgesetzt → Wohnzimmer-Fokus | Mit den aktuellen Regel-Typen (clearance/object-distance/host-binding) nicht ausdrückbar; Schlafen-Spezifika auf später verschoben statt Interpreter zu ändern (Paritäts-Gesetz) | STATUS, wohnen.json |
| M5: Esstisch inkl. Stühlen als EIN Footprint | POC-Vereinfachung – Stuhl-Einzelplatzierung wäre eigene Solver-Stufe; Footprint deckt Tisch + ausgezogene Stühle ab, clearance-Regel zusätzlich ≥1.0 m | catalog/wohnen.json (Item-Beschreibung) |
| M5: relationalRules-Distanzen wohnen als Zentrum-zu-Zentrum kalibriert (z.B. `near:sofa:1.3` statt 0.45) | Der Solver-Relationsfilter misst Zentrumsabstand; bei grossen Ankern (Sofa 2.1×0.95) wäre der ergonomische Kantenabstand 0.40–0.45 m als Zentrumswert kollidierend. Die ergonomische Norm bleibt als **soft** object-distance-Regel (Kantenmass 0.40 m) erhalten | catalog/wohnen.json, rules/wohnen.json |
| M6-A: Grossraum-Sample mit echter `wall.kind:"offen"`-Kante mitten im Raum | Code verträgt innenliegende Segmente problemlos (kein Hüllen-Closure-Validator; Solver/Interpreter filtern auf `kind=="massiv"`). Die offene Kante modelliert die reale offene Zonengrenze explizit; `zone_room` clippt sie auf die Zonenkante und erhält `kind:"offen"` | grossraum-sample, zonen.py, test_zonen.py |
| M6-A: GS↔Spüle-«maxDist»-Regel NICHT als `object-distance` umgesetzt | Der Regel-Interpreter kennt bei `object-distance` nur `minDist` (kein maxDist). «Geschirrspüler direkt neben Spüle» ist Baugruppen-/Slot-Logik; Interpreter wird (Paritäts-Gesetz) nicht erweitert | rules/kueche.json, catalog/kueche.json, STATUS |
| M6-A: clearance je Küchen-Haupttyp statt einer Sammelregel | `appliesTo` matcht auf `funktionsTyp`; eine Regel pro Typ ist die mit den bestehenden Regel-Typen ausdrückbare Form des «Gang vor Zeile ≥ 1.0 m» | rules/kueche.json |
| M6-B: Ecke bei L/U → **Eckschrank** (Politur 2026-06-14, behebt den früheren Totraum) | grid×grid-Eckquadrat am Wand-Stoss wird aus den Schenkel-Slots reserviert, ein Eckschrank (Karussell, ch55/eu60) gesetzt – VOR den Füllstücken, damit sie ihm ausweichen. Additiv (nur wenn zulässig), Invariante bleibt 0 ❌. L = 1 Ecke, U = 2 | kueche.py (`_eck_zonen`/`_platziere_eckschraenke`), catalog/kueche.json, test_kueche.py |
| M6-B: Fenster blockieren Unterschränke NICHT, nur die Hängeschrank-Ebene meidet Fenster | Brüstungsfenster (sill ≥ 0.9 m) erlauben darunter eine Arbeitsfläche/Unterschrank; nur Hängeschränke dürfen nicht vor ein Fenster. Türen blockieren dagegen die ganze Zeile | kueche.py (`_fuelle_haengeschraenke`, `_freies_teilstueck_intervall`) |
| M6-B: Hängeschrank-Heuristik = Ebene über allen Unterschränken ausser Kochfeld | Über dem Kochfeld hängt der Dunstabzug; sonst wird jede freie Wandposition mit Hängeschrank belegt (vertikal getrennt → keine Kollision dank Höhenintervall-Prüfung) | kueche.py (`_fuelle_haengeschraenke`) |
| M6-B: GS-«direkt neben Spüle» als Slot-Nachbarschaft (nicht als Regel) | Der Interpreter kennt kein `maxDist` bei object-distance; die Baugruppe setzt den GS deterministisch in den Nachbarslot der Spüle – konstruktiv erfüllt, ohne den Interpreter zu ändern | kueche.py (`_platziere_geschirrspueler`) |
| M6-B (Review-Fix): P1-Geräte sind Pflicht – fehlt Spüle/GS/Kochfeld/Kühlschrank → 422 NO_FEASIBLE_PLACEMENT (nur Dunstabzug best-effort) | Vorher entstand still ein Rumpf-Plan ohne Kühlschrank (0 ❌, aber fachlich unvollständig) – ehrliches Scheitern statt stiller Degradation | kueche.py (solve_kueche) |
| M6-B (Review-Fix): Solver-Vorfilter toleriert Berührung (Überlappung ≤ 0.05 cm) | Exakt anliegende Korpusse (Küchenzeile!) erzeugen Float-Krümel-Überlappungen ~1e-16; der Vorfilter war strenger als das Interpreter-Urteil (0.1-cm-Rundung) und verwarf gültige Slots | solver.py (_schnell_unzulaessig, _BERUEHRUNGS_EPS) |
| M6-B: Ergonomie/Arbeitsdreieck nur als einfacher Proxy im Formwahl-Score | v0: kompaktere I-Zeile besser, L/U/Galley pauschaler Bonus. Ein echtes Mass ist nicht trivial, weil die Formwahl VOR der Platzierung läuft – Optionen samt Empfehlung stehen im Brain | kueche.py (`formwahl`), Brain `Arbeitsdreieck-Score-Optionen` |
| M6-B: /solve-Response um `room` (effektiver Raum) erweitert | Response ist kein Schema-Vertrag (Plan-Schema bleibt unberührt). Der Grossraum-Fall braucht den abgeleiteten Teilraum für Viewer + Live-Ampel | api.py (`/solve`), App.tsx (`planRoom`) |

## Performance – gemessene Ist-Werte (Stand 2026-06-14)

Ziel-Budgets stehen im Brain (`Engineering-Grundlagen-POC` §6); hier die
tatsächlich gemessenen Werte, damit man Regressionen erkennt:

| Was | Ist | Bemerkung |
|---|---|---|
| `/solve` Bad · Wohnen | < 0.2 s | inkl. Kurator-Auswahl |
| `/solve` Küche (Baugruppe) | ~0.1–0.2 s | ch und eu vergleichbar |
| `circulation`-Auswertung | **~0.3–0.4 s** | 0.05-Raster, reines Python – **der teure Posten** |
| Engine-Suite (`pytest`) | ~12–15 s (180 Tests) | inkl. je 1 circulation-Auswertung pro Solve |
| `packages/shared` vitest | < 1 s (23 Tests) | Parität + Schemas |
| `apps/web` vitest | < 1 s (8 Tests) | Geometrie + Render-Smoke |

> **Wichtig:** `circulation` läuft **nur einmal je Plan** (finaler Report), nicht
> in der Solver-Kandidatenschleife – dort filtert `nur_hart=True` sie heraus.
> Diese Trennung ist der Grund, warum die Suite schnell bleibt. Siehe Brain:
> `Circulation-Hochstufung-auf-hard`.

## Offene Fragen an Bryan

**Neu / aktuell (entstanden 2026-06-13/14):**
- **circulation auf `hard` hochstufen?** Metrik ist inzwischen vertrauenswürdig;
  einzige Hürde ist die Hot-Path-Performance. Optionen + Empfehlung (vorerst
  soft lassen) im Brain: `Circulation-Hochstufung-auf-hard`.
- **Arbeitsdreieck – Option A oder B?** A = echtes Mass nach dem Solven
  (empfohlen), B = form-bewusste Heuristik in der Formwahl. Analyse im Brain:
  `Arbeitsdreieck-Score-Optionen`.
- **2D-Grundriss als Default-Ansicht ok?** Der Viewer ist auf 2D vorbelegt
  (3D ist einen Klick entfernt), weil 2D die normgerechte Beurteilung
  erlaubt – jederzeit umdrehbar (eine Zeile in `App.tsx`).

**Weiterhin offen (älter):**
- Mini-Eval mit **echtem LLM** messen (`FP_KURATOR_URL` setzen) + Mensch-Rating;
  aktuell ist der Baseline-Kurator aktiv.
- Echte Bad-/Wohn-/Küchen-**Fotos taggen** (ersetzen die SVG-Platzhalter).
- **R1 neu aufnehmen** nach der Aufnahme-Guideline + Restmasse (Raumhöhe,
  Türbreite, Objektmasse) → dann Colab-Lauf des Scan-Spikes.
- AR-Vorschau (Stretch) bestätigen → `vault/50_Umsetzung/AR-Vorschau-Konzept.md`.
- Erste Katalog-Quelle für echte Items/Preise (POC-Fallback: Sample-Daten).
