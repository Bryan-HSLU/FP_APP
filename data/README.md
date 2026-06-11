# data/ – Stammdaten als Dateien (keine DB im POC)

Versionierte JSON-Files mit stabilen UUIDs, CRB-mapping-fähig (BKP/eBKP/NPK).
Alle Files werden in der CI gegen die Schemas aus `packages/shared/schemas/`
validiert (`pnpm schema-check`). Quelle/Provenance ist Pflicht bei Preisen.
Fachliche Vorgaben: Brain → `vault/50_Umsetzung/Daten-und-Referenzgrundlagen-Auswertung.md`.
