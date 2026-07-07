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

## Zuordnung von Bryans Original-Dateien (Stand 2026-07-07, Batch 2)

**Alle 25 Registry-Namen sind belegt.** Die App-Kopien (`<name>.png`) sind auf
256 px verkleinert (Originale sind 1–2 MB gross – zu schwer fürs Laden);
Bryans nummerierte Originale bleiben unverändert liegen.

- **Batch 2 (explizite Namen, massgeblich):** `11_bad`→bad · `12_kueche`→kueche
  · `13_wohnen`→wohnen · `14_projekt`→projekt · `15_kamera`→kamera ·
  `16_scan`→scan · `17_manuel`→manuell · `18_stil`→stil · `19_like`→like ·
  `20_dislike`→dislike · `22_vorschlag`→vorschlag · `23_varianten`→varianten ·
  `25_material`→material · `26_farbe`→farbe · `27_norm`→norm ·
  `28_kosten`→kosten · `29_zeitplan`→zeitplan · `30_gewerke`→gewerke ·
  `31_dokument`→dokument · `32_export`→export · `33_teilen`→teilen ·
  `34_speichern`→speichern · `35_hilfe`→hilfe.
- **Aus Batch 1 (Nr. 21/24 fehlen in Batch 2):** `02_stilprofil_stern`→
  stilprofil · `16_einbauten_möbel`→moebel.
- ⚠️ Die Nummern von Batch 1 und Batch 2 **kollidieren** (z. B. `14_Scan` vs.
  `14_projekt`) – massgeblich sind allein die Registry-Kopien; die Nummern der
  Originale haben keine Bedeutung mehr.
- **Unbenutzte Batch-1-Motive** (frei für künftige Registry-Namen):
  `01_smartphone_geste` · `03_zeit_uhr_sanduhr` · `04_austausch_personen` ·
  `05_planung_warnung` · `06_materialmuster` · `07_3d_ansicht` ·
  `08_bild_material_tags` · `09_raum_smartphone_stilprofil` ·
  `10_messwerkzeuge` · `11_werkzeuge` · `12_kosten_geld` · `13_verknüpfung` ·
  `14_Scan` · `15_Dateien_in_ordner_speichern` · `17_Pläne_dokumente` ·
  `18_in_cloud_laden` · `19_gebäude` · `20_raum`.
