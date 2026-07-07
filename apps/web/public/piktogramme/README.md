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

## Zuordnung von Bryans Original-Dateien (2026-07-07)

Bryans nummerierte Uploads bleiben als Originale liegen; die App lädt die
**Kopien mit Registry-Namen** (Zuordnung nach Motiv):

| Original | Registry-Name |
|---|---|
| `01_smartphone_geste` | `kamera` |
| `02_stilprofil_stern` | `stilprofil` |
| `03_zeit_uhr_sanduhr` | `zeitplan` |
| `04_austausch_personen` | `gewerke` |
| `05_planung_warnung` | `norm` |
| `06_materialmuster` | `material` |
| `08_bild_material_tags` | `stil` |
| `09_raum_smartphone_stilprofil` | `vorschlag` |
| `10_messwerkzeuge` | `manuell` |
| `12_kosten_geld` | `kosten` |
| `13_verknüpfung` | `teilen` |
| `14_Scan` | `scan` |
| `15_Dateien_in_ordner_speichern` | `speichern` |
| `16_einbauten_möbel` | `moebel` |
| `17_Pläne_dokumente` | `dokument` |
| `18_in_cloud_laden` | `export` |
| `19_gebäude` | `projekt` |

**Noch nicht zugeordnet** (Bryan entscheidet): `07_3d_ansicht` ·
`11_werkzeuge` · `20_raum`. Noch ohne eigenes Bild (SVG-Platzhalter aktiv):
`bad` · `kueche` · `wohnen` · `like` · `dislike` · `varianten` · `farbe` ·
`hilfe`.
