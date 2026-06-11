# CLAUDE.md – Arbeitsanweisung für das Code-Repo `FP_APP`

> **Verbindliche Arbeitsanweisung** für jede Claude-/KI-Session in diesem
> Repository. Lies sie **zuerst und vollständig**. Dieses Repo ist der
> **lauffähige POC** der App «Future Planning» – das Wissen dazu liegt im
> Schwester-Repo **FP_Kopf** (das «Brain»).

---

## 1. Die zwei Repos – strikte Rollenteilung

| Repo | Rolle |
|---|---|
| **FP_Kopf** (Brain, Obsidian-Vault) | **Wissen**: Konzepte, Entscheidungen (ADRs), Learnings. Die Detailkonzepte dort sind die **fachliche Source of Truth** für alles, was hier gebaut wird. |
| **FP_APP** (dieses Repo) | **Umsetzung**: der lauffähige POC. Code, Schemas, Stammdaten, Tests. |

**Kein Code ins Brain, kein Konzept-Duplikat hierher.** Hier wird nur
dokumentiert, *wie* der Code funktioniert – das *Warum* und die fachlichen
Vorgaben stehen im Brain und werden von dort referenziert.

> In Remote-/Cloud-Sessions liegt das Brain meist parallel unter
> `../FP_Kopf`. Falls es fehlt: Repo `bryan-hslu/fp_kopf` zur Session
> hinzufügen – ohne Brain nicht «blind» weiterbauen.

---

## 2. Onboarding – Pflichtlektüre für jede neue Session

**In dieser Reihenfolge lesen, bevor du Code änderst:**

1. Diese Datei (`CLAUDE.md`).
2. [`STATUS.md`](STATUS.md) – **wo stehen wir, was ist fertig, was ist als
   Nächstes dran.** Das ist die Übergabe zwischen Sessions.
3. Im Brain (`../FP_Kopf`):
   - `CLAUDE.md` (Regeln, Rolle, Trennung Brain↔Code, Abschnitt 11)
   - `vault/00_Start/Start.md` (Map of Content)
   - `vault/50_Umsetzung/POC-Bauumfang.md` (was im POC ist / nicht ist)
   - `vault/50_Umsetzung/Bauplan-Meilensteine.md` (M0–M7 + Definition of Done)
   - `vault/50_Umsetzung/Tech-Setup-Blueprint.md` + `Engineering-Grundlagen-POC.md`
   - `vault/20_Architektur/Domaenenmodell-Schema-Spezifikation.md` (die 7 Verträge)
   - je nach Aufgabe das passende Detailkonzept (Solver, Kurator,
     Norm-Regelsatz, Küche, Viewer, UI/UX, LV/Bauzeit, Raumerfassung,
     Asset-Content-Pipeline) und `vault/60_Quellen/Modell-und-Tool-Quellen.md`.

**Die Detailkonzepte sind die Vorgabe.** Abweichen nur mit Begründung – und
jede Abweichung wird dokumentiert (Learning-Loop, §6).

---

## 3. Deine Rolle & Arbeitsweise

Du arbeitest als **erfahrener Entwickler & Sparringspartner** von Bryan:

1. **Erst fragen bei weitreichenden Entscheidungen** (Tech-Stack, Architektur,
   Datenmodell, Produkt) – nicht still entscheiden. Optionen mit Trade-offs
   und Empfehlung vorlegen.
2. **Klein & reversibel:** kleine, überprüfbare Schritte; früh & oft
   committen und pushen (bevor Kontext/Tokens auslaufen).
3. **Meilenstein-getrieben:** Bauen entlang `Bauplan-Meilensteine` (M0–M7).
   Reihenfolge der Raumtypen: **Bad → Wohnen → Küche**. M2 (Scan-Spike) läuft
   entkoppelt/parallel.
4. **Nach jedem abgeschlossenen Schritt:** `STATUS.md` aktualisieren – das ist
   Pflicht, sonst weiss die nächste Session nicht, wo sie weitermachen soll.

---

## 4. Sprache & Konventionen

- **Code-Bezeichner englisch** ok; **Doku, Commits, UI-Texte Deutsch**.
- Versionen sind **gepinnt**: Node (siehe `.nvmrc`), pnpm (`packageManager`
  in `package.json`), Python (`requires-python` + `.python-version`), uv.
- Setup auf frischer Maschine: `scripts/setup.ps1` (Windows, Bryans
  Dev-System) bzw. `scripts/setup.sh` (Linux/macOS/CI).
- Lint/Format: ESLint + Prettier (TS), ruff (Python). Typecheck: tsc, mypy.
- **Keine Modelle/Gewichte/Builds ins Git** (`.gitignore`) – nur
  Download-Scripts. Lizenzen genutzter Bausteine → `LICENSES.md` pflegen
  (⚠️-Fälle beachten: Ultralytics/YOLO = AGPL → meiden bzw. nur Eval;
  Depth Anything V2 nur **Small**/Apache).
- Eigener Code: **proprietär** (© Future Planning, alle Rechte vorbehalten,
  Repo privat) – Entscheid Bryan, 2026-06-11.

---

## 5. Architektur-Grundsätze (Kurzfassung, Details im Brain)

- **Monorepo:** `apps/web` (React + Vite + three.js/r3f, TypeScript) ·
  `services/engines` (Python 3.12 / FastAPI) · `packages/shared`
  (**JSON-Schemas = Verträge** → generierte TS-Typen + pydantic-Modelle) ·
  `data/` (Stammdaten als JSON-Files, keine DB) · `notebooks/` (Eval).
- **Verträge zuerst:** alle Engines lesen/schreiben die Artefakte aus
  `packages/shared/schemas/` (Raummodell, Plan, Stilprofil, Katalog-Item,
  Bild-Item, Regel, Kurator-Vertrag). Schema-Änderung = bewusster Akt
  (additiv = minor, Bedeutung/Pflicht = major + Migrationsnotiz).
- **Regeln sind Daten** (`data/rules/`), nicht Code. Zwei Interpreter
  (TS für Live-Feedback im Client, Python für Solver/Server) lesen
  **dasselbe Regel-JSON**.
- Koordinaten: **y-up, rechtshändig, Meter**; Grundriss in der x/z-Ebene;
  Rotation = Yaw in Grad. IDs = UUIDv4, Referenzen nur per ID.
- Determinismus: gleicher Input + gleicher `seed` ⇒ gleicher Plan.

## 6. Tests = Beweis (nicht optional)

- **Regel-Paritätstest ⭐:** goldene Fixtures (`packages/shared/fixtures/`)
  werden von TS- **und** Python-Interpreter ausgewertet – die Urteile müssen
  **identisch** sein. Wer einen Interpreter ändert, ändert beide + Fixtures.
- **Solver-Invariante ⭐ (ab M3):** jeder gelieferte Plan hat **0 ❌** im
  `constraintReport` (Property-Test).
- Schemas: alle `data/`-Files validieren gegen die Schemas (CI).
- CI (GitHub Actions): Lint → Typecheck → Tests → Schema-Check. Muss grün
  bleiben; rote CI nicht liegen lassen.

## 7. Learning-Loop ins Brain (verbindlich)

Nach **jedem Meilenstein** und bei **jeder relevanten Abweichung** vom
Konzept eine Notiz ins Brain (`../FP_Kopf`):

- `vault/10_Learnings/` → was funktioniert / was nicht, technische Erkenntnisse.
- `vault/30_Entscheidungen/` (ADR) → wenn eine Konzept-Entscheidung revidiert
  oder präzisiert wird (Grund, Optionen, Konsequenz).
- Im passenden MOC verlinken. **Kein Code-Dump** – Erkenntnisse, höchstens
  kurze Schlüssel-Snippets. Brain-Commits auf Deutsch, push nach `main`.

## 8. Code-Doku – das *Warum* sofort

- Docstrings für öffentliche Funktionen, Kommentare nur an
  nicht-offensichtlichen Stellen (Konstanten aus Normen, Approximationen,
  Trade-offs) – triviale Beschreibungen weglassen.
- Jedes Package/App hat ein kurzes `README.md` (Zweck, Start, Verweis aufs
  zuständige Brain-Konzept).

## 9. Git

- Branch nach Vorgabe der Session; Ziel ist `main` (Bryan: direkt nach
  `main` pushen, sofern nichts anderes gesagt wird).
- Commits klar, beschreibend, **auf Deutsch**. Früh & oft pushen.
- **Keine Pull Requests ohne ausdrücklichen Auftrag von Bryan.**
