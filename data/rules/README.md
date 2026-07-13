# rules/ – Norm-Regelsatz (deklarativ, Daten statt Code)
Regeln gemäss Schema `regel` (Brain → `vault/50_Umsetzung/Norm-Regelsatz-v0.md`):
Basis-Rahmen (alle Räume) + je Raumtyp ein eigener Satz. ⚠️ Werte v0 sind
Richtwerte («status: zu-verifizieren») – vor Produktreife gegen SIA 500 /
DIN 18022/68935 verifizieren. Normprofile CH/EU als Overrides.

## `flaechen.json` – Flächen-/Materialnormen (EIGENES Format, getrennt)
`flaechen.json` ist **bewusst kein** Geometrie-Regelsatz und **nicht** Teil des
TS/Python-Paritätstests. Es kontrolliert den KI-Flächen-Call (Kurator Call C):
welches Boden-/Wandmaterial in welchem Raumtyp/Nassbereich zulässig ist.
Nur die Python-Seite (`kurator.pruefe_flaechen`) liest es – Prüfung nach dem
LLM-Output, dann Repair-Retry, sonst deterministische `korrigiere_flaechen`.
Deklaratives Format: `{ id, roomType, gilt: "boden"|"wand-nass"|"wand-alle",
anforderung, minHoeheM?, erlaubteMaterialien: [slugs], severity, quelle,
status, hinweis }`. Werte v0 = Richtwerte («zu-verifizieren», SIA 271 /
DIN 18534 u.a.).
