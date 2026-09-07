# AGENTS.md – Arbeitsanweisung für Coding-Agenten in `FP_APP`

> Gilt für **jeden** Task in diesem Repo – Codex Cloud und jeden anderen Agenten,
> der **nur dieses eine Repo** sieht. Claude-Sessions mit beiden Repos folgen
> zusätzlich [`CLAUDE.md`](CLAUDE.md); bei Widerspruch gilt `CLAUDE.md`.
>
> Lies diese Datei **vollständig**, bevor du eine Zeile änderst.

---

## 0. Was dieses Repo ist

`FP_APP` ist der **lauffähige POC** der App **«Future Planning»**: Sie zeigt
Bauherrschaften ihre zukünftigen Räume, bevor sie gebaut sind. Kernkette:

```
Raum (Beispielraum · Scan · manueller Editor)
  → Stil-Swipe (8 Stilachsen)
  → Kurator (KI wählt Möbel; 3 LLM-Calls, mit deterministischer Baseline)
  → Solver (platziert normkonform, garantiert 0 ❌)
  → Viewer: 2D-Grundriss + 3D mit Live-Norm-Ampel
  → Auswertung (Mengen, Kosten, Gewerke, Dokumente)
```

**Monorepo:**

| Pfad | Inhalt |
|---|---|
| `apps/web` | React + Vite + TypeScript, three.js/react-three-fiber – Wizard-UI, Viewer 2D/3D, Live-Ampel |
| `services/engines` | Python 3.12 / FastAPI – Solver, Kurator, Küche, Zonen, Scan-Adapter, Auswertung & Exporte |
| `services/scan-worker` | eigenes uv-Projekt – Scan-Geometrie (GPU-Teile laufen nur auf Colab) |
| `packages/shared` | **JSON-Schemas = Verträge**, Codegen (TS-Typen + pydantic), Regel-Interpreter (TS), goldene Fixtures |
| `data/` | Stammdaten als JSON: `rules/`, `catalog/`, `images/`, `dressing/`, `positions/`, `sequence/`, `prompts/`, `taxonomy/`, `kurator/`. **Keine Datenbank.** |
| `notebooks/` | Scan-Eval (Colab) |

Fast jeder Ordner hat ein `README.md` – lies das des Bereichs, den du anfasst.

---

## 1. Ein-Repo-Realität: die fachliche Source of Truth fehlt dir

Das Schwester-Repo **`Bryan-HSLU/FP_Kopf`** («Brain», Obsidian-Vault) enthält
Konzepte, ADRs und Learnings und ist die **fachliche Source of Truth**. In
Codex Cloud hast du **keinen Zugriff darauf**. Daraus folgt verbindlich:

1. **Bestehende Architektur zuerst verstehen** – lies den umliegenden Code und
   die Docstrings. Dieses Repo ist bewusst reich kommentiert: das *Warum* steht
   meist direkt über der Konstante oder Funktion. Begründet ein Kommentar eine
   Entscheidung, ist das ein Brain-Entscheid – **respektiere ihn**.
2. **Nichts stillschweigend widersprechen.** Findest du eine bestehende
   fachliche Festlegung schlecht, setze sie **nicht** einfach anders um.
3. **Neue Architektur-/Fachentscheidungen explizit kennzeichnen.** Brauchst du
   eine, triff die kleinstmögliche, begründe sie im Code-Kommentar und liste sie
   am Ende deiner Zusammenfassung unter `## Neue Entscheidungen (Review durch
   Bryan nötig)` – Kontext, Optionen, gewählte Variante, Grund. Bryan trägt sie
   danach als ADR ins Brain nach.
4. **Wissen zurückspielen.** Du kannst nicht ins Brain schreiben. Liefere darum
   am Ende einen Block `## Fürs Brain (Learning-Notiz)`: 5–15 Zeilen – was
   funktioniert hat, was nicht, welche Abweichung warum. **Kein Code-Dump.**
5. **Im Zweifel fragen statt annehmen.** Ein sauber abgegrenzter Teilstand plus
   eine gute Frage ist mehr wert als eine erratene fachliche Festlegung.

Was du vom Brain für die Arbeit brauchst, steht als Auszug in §6.

---

## 2. Pflichtlektüre vor der ersten Änderung

1. Diese Datei.
2. [`CLAUDE.md`](CLAUDE.md) – besonders **§10 Verifikation** (exakte Befehle)
   und **§11 Bekannte Stolpersteine**.
3. [`STATUS.md`](STATUS.md) – Stand, offene Punkte und die Tabelle **«Bewusste
   Abweichungen / Engineering-Entscheide»**: eine Liste von Dingen, die absichtlich
   so sind und die du **nicht** «aufräumen» darfst.
4. Das `README.md` des Pakets/Ordners, den du anfasst, und §7 dieser Datei zum
   passenden Gebiet.

---

## 3. Unantastbare Invarianten

Diese Regeln sind der Grund, warum der POC beweisbar funktioniert. Sie zu
brechen ist nie Teil eines Tasks – scheint dein Task es zu verlangen, **halte
an und frag**.

| # | Invariante | Konkret |
|---|---|---|
| ⭐1 | **Paritäts-Gesetz** | `packages/shared/src/rules/interpreter.ts` und `services/engines/src/fp_engines/rules/interpreter.py` sind 1:1-Spiegel. Wer einen ändert, ändert **beide** + die goldenen Fixtures in `packages/shared/fixtures/rule-parity/` im **selben Commit**. Goldens: `uv run python scripts/update_goldens.py` (aus `services/engines/`), danach `pnpm exec prettier --write "fixtures/rule-parity/expected/*.json"` (aus `packages/shared/`). |
| ⭐2 | **Solver-Invariante** | Jeder gelieferte Plan hat **0 ❌** im `constraintReport`. Lieber ehrlich `NoFeasiblePlacement` (HTTP 422) als ein Plan, der Regeln verletzt. |
| 3 | **Determinismus** | Gleicher Input + gleicher `seed` ⇒ byte-gleicher Plan. Kein ungeseedetes `random`, keine Zeit-/Umgebungsabhängigkeit, stabile Sortierungen (bei Gleichstand nach `id`). |
| 4 | **Schemas sind Verträge** | Änderungen in `packages/shared/schemas/` nur **additiv** (neues optionales Feld = minor). Pflichtfeld oder Bedeutung ändern = major + Migrationsnotiz + Rückfrage. Nach jeder Schema-Änderung `pnpm codegen`; generierte Dateien **nie** von Hand editieren. |
| 5 | **Regeln sind Daten** | Normregeln leben in `data/rules/*.json`, nicht im Code. Neue Norm-Anforderung ⇒ Regel-JSON, nicht `if` im Solver. |
| 6 | **bbox-Treue** | Kein 3D-Bauteil und kein 2D-Symbol ragt aus der Katalog-bbox `w×d×h`. Die Norm-Ampel urteilt über die bbox – ein überstehendes Teil spiegelt falsche Sicherheit vor. |
| 7 | **Die Ampel dominiert** | Material-/Farbwahl wirkt **nur** bei Status `ok`; `knapp`/`verletzt`/`gesperrt` behalten ihre Statusfarben – in 2D **und** 3D. |
| 8 | **Prompt-Token-Budget** | Der Kurator läuft am Groq-Free-Tier (12 000 TPM). Alles, was Prompts verlängert, zählt. `test_plan_mit_repair_bleibt_im_minutenbudget` ist die Grenze und muss grün bleiben. |
| 9 | **Koordinaten** | y-up, rechtshändig, **Meter**; Grundriss in der x/z-Ebene; Rotation = Yaw in Grad; Front = lokal **+z**, Rückseite −z, Ursprung = bbox-Mitte. IDs sind UUIDv4, Referenzen nur per ID. |
| 10 | **Ehrliche Degradation** | Fällt etwas aus (LLM, Scan, Anschluss), gibt es einen **sichtbaren Marker** statt stiller Notlösung. Eine tote LLM-Anbindung blieb hier einmal wochenlang unbemerkt, weil der Fallback still war. |

---

## 4. Arbeitsablauf für jeden Task

1. **Verstehen.** Task lesen, betroffenes Gebiet in §7 nachschlagen, den
   vorhandenen Code und seine Tests lesen. Suche nach einem bestehenden Muster,
   das dein Problem schon löst – dieses Repo hat für fast alles eines.
2. **Kleinsten Schnitt wählen.** Was löst den Task mit der geringsten Reichweite?
   Ein Datenfile schlägt eine Codeänderung; eine additive Ergänzung schlägt einen
   Umbau; ein Post-Processing-Schritt schlägt einen Eingriff in Interpreter oder
   Schema (genau so wurden `softScore.ergonomie` und die Begehbarkeits-Prüfung
   gebaut, ohne das Paritäts-Gesetz anzufassen).
3. **Bauen** – klein, thematisch getrennt, mit Docstring/Kommentar für das *Warum*
   an jeder nicht offensichtlichen Stelle.
4. **Tests mitliefern.** Jede neue Fähigkeit bekommt einen Test; jede reparierte
   Fehlerklasse einen Regressionstest. Reproduziere einen Fehler erst, bevor du
   ihn fixst.
5. **Verifizieren** nach §5 – vollständig, und ehrlich berichten.
6. **`STATUS.md` nachführen** (Pflicht): Datum, was gebaut wurde, gemessene
   Zahlen, was bewusst offen bleibt.
7. **Zusammenfassen** nach dem Raster in §9.

**Diagnose-Disziplin** (teuer gelernt): Miss immer mit dem **produktiven
Evaluator**, nie mit einem Standalone-Nachbau – die driften subtil und führen zu
falschen Schlüssen. Und isoliere die **kleinste plausible Ursache zuerst**, bevor
du einen grossen Refactor planst; ein vermeintlich fragiles Metrik-Design war am
Ende ein einzelner falsch gesetzter Anker.

---

## 5. Verifikation – so beweist du «grün»

Die CI (`.github/workflows/ci.yml`) fährt **Lint → Typecheck → Tests →
Schema-Check**. Lokal exakt so:

```bash
# JS/TS – aus dem Repo-Root
pnpm -r --if-present lint
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm schema-check

# Python – aus services/engines/
uv run ruff check .
uv run pytest -q

# mypy – aus dem Repo-Root (der --config-file ist nötig!)
uv --project services/engines run mypy \
   --config-file services/engines/pyproject.toml services/engines/src
```

Richtwerte (Stand 2026-08): ~434 Python-, ~223 `apps/web`-, ~23
`packages/shared`-Tests. Fährst du **weniger** Tests als vorher, hast du etwas
kaputt gemacht.

**Ehrlichkeitspflicht:** Läuft ein Gate in deiner Umgebung nicht (kein Netz,
fehlendes `uv`/`pnpm`), schreib das **explizit** in die Zusammenfassung – Befehl
und Fehler. Nie «alle Tests grün» behaupten, wenn du sie nicht gefahren hast. Ein
ehrlich gemeldetes, nicht gefahrenes Gate ist in Ordnung; eine falsche
Grün-Meldung nicht.

**Nie** einen Test deaktivieren, überspringen, aufweichen oder eine Assertion
lockern, um grün zu werden. Ein Test, der dir im Weg steht, beschreibt fast immer
eine Invariante.

---

## 6. Fachlicher Rahmen (Auszug aus dem Brain – gilt hier als Vorgabe)

- **Stilmodell:** keine benannten Stile, sondern **8 Stilachsen** mit Werten
  −1…+1 (`data/taxonomy/stilachsen.json`): `temperatur`, `materialitaet`,
  `helligkeit`, `opulenz`, `epoche`, `kontur`, `farbigkeit`, `raumgefuehl`.
  Katalog-Items und Bilder tragen **alle 8** in `achsenTags`; die Nähe wird über
  Cosinus gebildet.
- **Prioritätsklassen:** `P1` Pflicht/Anschluss · `P2` Funktion · `P3` Ergänzung –
  steuert die Platzierungs-Konkurrenz im Solver.
- **Objekt-Ebenen (ADR-0014):** `objektEbene: haupt` = raumprägend (Sofa,
  Esstisch, WC) · `ergaenzung` = hängt über `ankerTyp` an einem Haupt-Objekt
  (Stuhl **zum** Esstisch) und darf über `maxAnzahl` mehrfach vorkommen ·
  **Deko** ist keine Katalog-Ebene, sondern der separate Dressing-Layer.
- **«KI wählt, Solver platziert».** Die KI trifft Auswahl- und
  Gestaltungsentscheide, die Geometrie/Normen macht deterministischer Code.
- **Der Kurator ist geerdet.** Die KI darf nur aus der vorgefilterten
  Kandidatenliste wählen; jede Antwort läuft durch harte Validierung. Scheitert
  sie, greifen Trimmen bzw. die deterministische Baseline. **Jede neue
  KI-Freiheit braucht eine neue deterministische Kontrolle** – eiserne Regel.
- **Norm-Richtwerte** sind teils «zu-verifizieren» gekennzeichnet. Erfinde keine
  Normzahlen; übernimm sie aus `data/rules/` oder markiere sie als offen.
- **Preise** sind Sample-Schätzungen mit Provenance (`preis.quelle`, `.stand`,
  `.bandbreitePct`) – keine echten Hersteller-/Modellnamen erfinden.
- **Raumtypen-Reihenfolge:** Bad → Wohnen → Küche. Meilensteine M0–M6 sind
  durchgestochen, M2 (Scan-Spike) und M7 (Scan-Integration) laufen noch.

---

## 7. Gebietsführer – was wo lebt und wo die Fallen sind

**Regeln & Interpreter** (`data/rules/*.json`, `packages/shared/src/rules/`,
`services/engines/src/fp_engines/rules/`)
Regeltypen (Enum im Regel-Schema): `collision`, `wall-distance`,
`object-distance`, `clearance`, `door-swing`, `keep-clear`, `host-binding`,
`connection`, `circulation`, `relation`; `appliesTo` matcht auf `funktionsTyp`. Der
Interpreter kennt bei `object-distance` **kein** `maxDist` – «direkt neben X»
ist Baugruppen-Logik, keine Regel. Änderungen hier fallen unter Invariante ⭐1.

**Solver** (`solver.py`, `relationen.py`, `varianten.py`, `zonen.py`)
Feasibility-first: Kandidaten erzeugen → harter Filter → Platzierung P1→P2→P3.
`_zulaessig(..., nur_hart=True)` wertet im Hot-Path **absichtlich** nur harte
Regeln (die teure `circulation`-Analyse bleibt draussen) – nicht «aufräumen».
Weiche Wünsche (Anordnungs-Grammatik, Stil) wirken über Ranking, nie als
Ausschluss. `varianten.py` erzeugt K deterministische Sub-Seeds.

**Küche** (`kueche.py`)
Eigener Domänen-Solver: Formwahl (I/Galley/L/U/Insel) → lineare Baugruppe auf
Raster `ch55`/`eu60` → Arbeitsdreieck als gemessener Score **nach** der
Platzierung. Grossräume werden über `zone_room()` auf einen eigenständigen
Teilraum projiziert, den Solver und Interpreter unverändert verarbeiten.

**Kurator / LLM** (`kurator.py`, `baseline.py`, `data/prompts/`, `data/kurator/`)
Drei Calls: A Auswahl+Konzept+Farben, B Anordnung, C Flächen (B und C parallel).
Dem Modell werden **kurze Handles `#N` statt UUIDs** gezeigt (Modelle tippen
lange opake IDs falsch ab) und Platzwerte **vorgerechnet** (multiplizieren über
viele Zeilen können sie nicht). Angezeigte Kandidaten sind je Slot gedeckelt –
ein weiteres, stilistisch ähnliches Item erreicht das Modell nie. Jeder Fallback
setzt einen sichtbaren `CURATOR_*`-Marker. Achte auf Invariante 8.

**Viewer 2D** (`Viewer2D.tsx`, `plan2d.ts`, `symbole2d.ts`, `layer2d.ts`,
`flaechen2d.ts`)
Architekten-Draufsicht; Geometrie kommt aus `footprint()` in `@fp/shared/rules` –
**keine zweite Rotationsmathematik** einführen. Symbole sind reine
Strichkonturen in lokalen Metern innerhalb der bbox. Hier wird editiert
(Drag/Rotate, Messen, Layer); die Live-Ampel rechnet sofort mit.

**Viewer 3D** (`Viewer3D.tsx`, `moebel3d.tsx`, `raum3d.ts(x)`, `oberflaechen.ts`,
`dressing3d*.ts(x)`, `viewer3d-logik.ts`)
Möbel sind Kompositionen aus Primitiven (`box`/`rundbox`/`zylinder`/`kugel`/
`lathe`/`torus`) mit Material-Rollen (`koerper`/`hell`/`dunkel`/`glas`/`chrom`),
alle Masse als **Anteile** von w/d/h. 3D ist **Ansicht und Begehung** – bearbeitet
wird im 2D. Oberflächen werden stilabgeleitet berechnet, ohne Schema-Eingriff.
Proportionen, die 2D **und** 3D betreffen, stehen einmal in
`moebelProportionen.ts` – sonst driften Grundriss und 3D auseinander.

**Stammdaten** (`data/`)
Alle Files validieren gegen die Schemas (`pnpm schema-check`). Ein Möbel existiert
an mehreren Stellen: Katalog-Item → 2D-Symbol → 3D-Bausatz → geteilte
Proportionen → `MATERIAL_FARBE` → Farbslug-Enum + `FARBSLUG_HEX`. Fasst du eine
Ebene an, prüfe alle. Neue IDs sind **echte zufällige UUIDv4** (die Muster-Präfixe
`aaaaaaaa-`/`bbbbbbbb-`/`cccccccc-` sind Altbestand und werden nicht
fortgeschrieben). Ein neuer `funktionsTyp` zieht Symbol, Bausatz, Materialfarbe
und den Regel-Abgleich nach sich – Varianten bestehender Typen sind billiger.
`relationalRules`-Grammatik (siehe Docstring in `relationen.py`):
`near:<typ>:<maxDist>`, `against-wall`, `corner`, `facing:<typ>`,
`opposite:<typ>`, `group:<id>`, `pair-with:<itemId>`; Distanzen sind
**Zentrum-zu-Zentrum** – eine klassische Falle.

**API & Exporte** (`api.py`, `auswertung.py`, `lv.py`, `bauzeit.py`, `pdf.py`,
`dxf.py`, `gltf.py`)
FastAPI mit Fehler-Envelope und sprechenden Codes (`NO_FEASIBLE_PLACEMENT`,
`SCAN_INVALID`, …). Endpunkte u.a. `/solve`, `/validate`, `/curate`, `/evaluate`,
`/kueche/formen`, `/flaechen/pruefen`, `/scan`, `/style/profile`, `/export/*`.
Response-Modelle sind **kein** Schema-Vertrag – additive Felder dort sind
erlaubt, im Plan-/Raum-Schema nicht. LV und Bauzeitenplan sind **Daten**
(`data/positions/`, `data/sequence/`), nicht Code.

**Scan** (`fp_engines/scan/`, `services/scan-worker/`, `notebooks/`)
Kette: AR-Aufnahme → known-pose Fusion → SpatialLM → `layout.txt` → Adapter →
schema-valides Raummodell. z-up→y-up **ohne Spiegelung**, deterministische
uuid5-IDs, offene Hülle = ehrlicher Fehler. GPU-Schritte laufen nur auf Colab –
baue nichts, was hier eine GPU voraussetzt. Die Modell-Lizenzen sind **NC**.

**UI-Rahmen** (`App.tsx`, `Schritt*.tsx`, `AppRahmen.tsx`, `fp.css`, `theme.ts`,
`Piktogramm.tsx`)
Fünf-Schritte-Wizard: Projekt → Stil → Vorschlag → Anpassen → Auswertung. Farben,
Abstände und Kartenstil kommen aus den CI-Tokens in `fp.css`/`theme.ts` – keine
neuen Hexwerte im Komponentencode. Texte Deutsch, eine responsive UI für Handy
und Desktop.

**Deploy** (`Dockerfile`, `space.py`, `.github/workflows/deploy-space.yml`)
Ein Origin: `/api` → Engines, `/` → gebautes Frontend. Der HF-Space hat eine
10-MB-Grenze pro Datei; grosse Binärdateien blockieren den Build.

---

## 8. Scope- und Arbeitsdisziplin

- **Keine Änderungen ausserhalb des Tasks.** Kein Format-Sweep, keine
  Umbenennungen, keine Dependency-Upgrades, kein «bei der Gelegenheit».
- **Generierte Dateien nie von Hand:** `packages/shared/src/generated/`,
  `services/engines/src/fp_engines/generated/` entstehen aus `pnpm codegen`.
- **Keine neuen Dependencies** ohne Rückfrage. Der Viewer baut bewusst aus
  Primitiven statt aus externen Assets (offline-/CSP-fest).
- **Keine Binärdateien** (Bilder, Modelle, Builds) ohne Auftrag; Modelle/Gewichte
  gehören grundsätzlich nicht ins Git.
- **Keine Secrets** in Code, Tests oder Logs. Keys kommen aus der Umgebung.
- **Client-Imports:** `apps/web` importiert Regel-Code **nur** aus
  `@fp/shared/rules`, nie aus `@fp/shared` – sonst bricht der Browser-Build.
- **Klein und reversibel**, thematisch getrennte Commits.

---

## 9. Sprache, Commits, Abgabe

- **Doku, Commits, UI-Texte und PR-Beschreibung: Deutsch.** Code-Bezeichner
  dürfen englisch sein; im Bestand sind sie überwiegend deutsch – **folge der
  Datei, die du anfasst**.
- Commit-Stil wie im Repo: `Bereich: was und warum`, z.B.
  `Katalog: 15 neue Moebel + Vorfilter prueft Passung in den Raum`.
  Commit-**Titel** ASCII (Umlaute im Body sind in Ordnung).
- **Abgabe in Codex Cloud:** Ergebnis als **Branch + PR** ist hier ausdrücklich in
  Ordnung (Abweichung von `CLAUDE.md` §9 «direkt nach `main`», die für Sessions
  mit Push-Recht gilt). **Niemals direkt auf `main` pushen**, keine fremden
  Branches umschreiben, kein force-push.

**Deine Abschluss-Zusammenfassung enthält immer:**

```
## Was geändert wurde        (Dateien + kurzer Grund je Gruppe)
## Wie verifiziert           (gefahrene Befehle + Ergebnis; nicht gefahrene ehrlich benannt)
## Bewusste Abweichungen     (was du anders gemacht hast als naheliegend, und warum)
## Neue Entscheidungen       (Review durch Bryan nötig – nur wenn zutreffend)
## Fürs Brain                (Learning-Notiz, 5–15 Zeilen, keine Code-Dumps)
## Offen / nicht gemacht     (was du bewusst gelassen hast)
```

---

## 10. Wenn du unsicher bist

Liefere den Teil, der sicher richtig ist, vollständig ab – und schreib den
unsicheren Teil als konkrete Frage mit **Optionen und Empfehlung** hin. Ein
sauber abgegrenzter Teilstand plus eine gute Frage ist deutlich mehr wert als
eine erratene fachliche Festlegung, die niemand mehr findet.
