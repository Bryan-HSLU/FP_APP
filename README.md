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

## Deploy – zwei Eingänge, ein Backend

| URL | Frontend | `/api/*` |
|---|---|---|
| `bryan-hslu-fp-poc.hf.space` | HF Space (Docker, `space.py`) | derselbe Space |
| `fp-poc-seven.vercel.app` | Vercel (statisch) | Rewrite → HF Space (`vercel.json`) |

- Jeder Push auf `main` deployt beide: `deploy-space.yml` pusht in den Space
  (schreibt `BUILD_SHA`), `deploy-vercel.yml` wartet, bis `/api/health` diesen
  Stand meldet, und deployt erst dann das Frontend – kein Versatz zwischen
  neuem Frontend und altem Backend. Andere Branches bekommen eine Vercel-Preview
  (spricht mit dem Produktions-Backend).
- Nötige GitHub-Secrets: `HF_TOKEN` sowie `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID` (ohne sie wird der Vercel-Deploy übersprungen).
  `VERCEL_TOKEN` = persönlicher Token (Account Settings → Tokens, Scope «Full
  Account»); ein Team-/Projekt-Token scheitert mit «User not found».
- Schläft der Space (Gratis-Tier, 48 h), zeigt das Vercel-Frontend «Server wird
  geweckt» und wiederholt die Anfrage (`apps/web/src/backend.ts`).
- Warum so und nicht anders (Varianten, Limits, Risiken): Brain →
  `vault/30_Entscheidungen/ADR-0015-vercel-zweiter-frontend-eingang.md`.

## Bau-Fahrplan

Meilensteine M0–M7 mit Definition of Done: Brain →
`vault/50_Umsetzung/Bauplan-Meilensteine.md`. Aktueller Stand: [`STATUS.md`](STATUS.md).

## Lizenz

© Future Planning – alle Rechte vorbehalten (proprietär, Repo privat).
Lizenzen der genutzten Open-Source-Bausteine: [`LICENSES.md`](LICENSES.md).
