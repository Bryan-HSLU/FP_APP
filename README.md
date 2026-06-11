# FP_APP – Future Planning POC

Der lauffähige **Proof of Concept** der App **«Future Planning»**
(*Meet. Match. Build.*): Eine App, die Bauherrschaften und Bewohnern ihre
zukünftigen Räume zeigt, bevor sie Realität werden – vom Stil-Swipe über
Raum-Scan und normkonforme 3D-Planung bis zu Kosten, Gewerken und Dokumenten.

> **Fachliche Source of Truth ist das Schwester-Repo
> [FP_Kopf](https://github.com/Bryan-HSLU/FP_Kopf)** (das «Brain»,
> Obsidian-Vault): Konzepte, Entscheidungen (ADRs), Learnings.
> Dieses Repo enthält nur die Umsetzung.
> **KI-Sessions:** zuerst [`CLAUDE.md`](CLAUDE.md) lesen, dann
> [`STATUS.md`](STATUS.md) – dort steht, was fertig ist und wo es weitergeht.

## Was der POC ist

Eine **lokale Web-App** (kein App-Store, keine Cloud): React-Frontend +
lokaler Python/FastAPI-Dienst, Stammdaten als JSON-Files. Am Handy nutzbar
über den Browser im lokalen Netz. Details: Brain →
`vault/50_Umsetzung/POC-Bauumfang.md`.

## Monorepo-Struktur

```text
FP_APP/
├── apps/
│   └── web/              # React + Vite + three.js (r3f) – Viewer/UI/Swipe
├── services/
│   └── engines/          # Python 3.12 / FastAPI: Raum · Stil · Solver · Auswertung · Kurator-Adapter
├── packages/
│   └── shared/           # VERTRÄGE: JSON-Schemas + TS-Typen + TS-Regel-Interpreter + goldene Fixtures
├── data/                 # Stammdaten als Dateien (keine DB)
│   ├── catalog/          # Möbel-Items (JSON + glTF-Refs)
│   ├── images/           # Bild-Katalog + Achsen-Tags
│   ├── prices/           # Kennwerte/Einheitspreise + Provenance
│   ├── rules/            # Norm-Regelsatz (deklarativ)
│   ├── positions/        # LV-Positionskatalog
│   ├── sequence/         # Bauzeit-Abfolge (DAG)
│   ├── taxonomy/         # Stilachsen & Attribut-Vokabular
│   ├── prompts/          # Kurator-Prompts
│   └── projects/         # lokale Projektdaten (nicht versioniert)
├── notebooks/            # Eval-Harness (Scan-Spike, Colab)
├── scripts/              # setup.ps1 (Windows) / setup.sh (Linux/macOS/CI)
└── .github/workflows/    # CI: Lint · Typecheck · Tests · Schema-Check
```

## Setup («eine Stunde sauber starten»)

Voraussetzungen: [Node LTS](https://nodejs.org) (Version: `.nvmrc`),
[pnpm](https://pnpm.io), [uv](https://docs.astral.sh/uv/) (holt Python 3.12
selbst).

```powershell
# Windows
.\scripts\setup.ps1
```

```bash
# Linux / macOS / CI
./scripts/setup.sh
```

Danach:

```bash
pnpm dev          # Frontend (apps/web) auf http://localhost:5173
pnpm api          # FastAPI-Dienst auf http://localhost:8000
pnpm test         # alle Tests (TS + Python), inkl. Regel-Paritätstest
pnpm lint         # ESLint/Prettier + ruff
```

## Bau-Fahrplan

Meilensteine M0–M7 mit Definition of Done: Brain →
`vault/50_Umsetzung/Bauplan-Meilensteine.md`. Aktueller Stand: [`STATUS.md`](STATUS.md).

## Lizenz

© Future Planning – alle Rechte vorbehalten (proprietär, Repo privat).
Lizenzen der genutzten Open-Source-Bausteine: [`LICENSES.md`](LICENSES.md).
