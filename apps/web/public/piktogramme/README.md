# Piktogramme (Drop-in-Ordner)

Hier legt Bryan seine **echten Piktogramme** als PNG ab. Die Komponente
`src/Piktogramm.tsx` lädt zuerst `/piktogramme/<name>.png`; fehlt die Datei,
fällt sie automatisch auf ein eingebautes Inline-SVG zurück. **Kein Code-Umbau
nötig** – Datei hochladen genügt, der Name muss exakt zum Registry-Namen passen.

## Dateikonvention

- Dateiname: `<name>.png` (klein geschrieben, exakt wie unten).
- Quadratisch, transparenter Hintergrund empfohlen.
- Stil (CI): gerundete Linien, konstante Strichstärke, wenig Details,
  dunkelgrün (aktiv orange) – passend zum Inline-SVG-Platzhalter.

## Erwartete Namen

| Kategorie   | Namen |
|-------------|-------|
| Raumtypen   | `bad`, `kueche`, `wohnen` |
| Projektstart| `projekt`, `kamera`, `scan`, `manuell` |
| Stil        | `stil`, `like`, `dislike`, `stilprofil` |
| Vorschlag   | `vorschlag`, `varianten` |
| Anpassen    | `moebel`, `material`, `farbe`, `norm` |
| Auswertung  | `kosten`, `zeitplan`, `gewerke`, `dokument` |
| Aktionen    | `export`, `teilen`, `speichern`, `hilfe` |

Weitere Namen brauchen zusätzlich einen Eintrag im Registry
(`PiktogrammName` + `PFADE`) in `src/Piktogramm.tsx`.
