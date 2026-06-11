# fp-engines – Python-Engines (lokaler FastAPI-Dienst)

Raum-, Stil-, Solver- und Auswertungs-Engine plus Kurator-Adapter, erreichbar
über wenige grobe Endpunkte (Brain → `vault/50_Umsetzung/Engineering-Grundlagen-POC.md` §1).

- Start: `pnpm api` (Repo-Root) oder `uv run fastapi dev src/fp_engines/api.py`
- Tests: `uv run pytest` · Lint: `uv run ruff check .` · Typen: `uv run mypy src`
- Verträge: pydantic-Modelle werden aus `packages/shared/schemas/` generiert
  (`pnpm codegen`), nie von Hand gepflegt.
- Der Regel-Interpreter (`fp_engines/rules/`) liest dasselbe deklarative
  Regel-JSON (`data/rules/`) wie der TS-Interpreter in `@fp/shared` –
  Paritätstest über die goldenen Fixtures ist Pflicht.
