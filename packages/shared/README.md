# @fp/shared – die Verträge (Single Source of Truth)

Hier leben die **JSON-Schemas** der Vertrags-Artefakte (Brain →
`vault/20_Architektur/Domaenenmodell-Schema-Spezifikation.md`), die daraus
**generierten TS-Typen**, der **TS-Regel-Interpreter** (Live-Feedback im
Viewer) und die **goldenen Fixtures** für den Regel-Paritätstest.

```text
schemas/        # JSON Schema draft 2020-12 – DIE Quelle, von Hand gepflegt
src/generated/  # TS-Typen aus den Schemas – NIE von Hand ändern (pnpm codegen)
src/rules/      # deklarativer Regel-Interpreter (TS) – Spiegel von fp_engines/rules
fixtures/       # goldene Testfälle: Input (Raum+Plan+Regeln) + erwartete Urteile
tests/          # vitest: Fixture-Validierung + Interpreter gegen Fixtures
```

**Eisernes Gesetz:** TS- und Python-Interpreter müssen auf den Fixtures
**identisch urteilen** (Paritätstest, beidseitig in CI). Wer Regeln/Interpreter
ändert, ändert beide Seiten + Fixtures im selben Commit.

- Schema-Änderung: additiv = minor, Bedeutung/Pflicht = major + Migrationsnotiz
  (`schemaVersion` im Artefakt).
- `pnpm codegen` erzeugt TS-Typen (hier) und pydantic-Modelle (in
  `services/engines/src/fp_engines/generated/`).
- `pnpm schema-check` validiert alle `data/`-Stammdaten gegen die Schemas.
