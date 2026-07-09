# Echte Deko-Modelle (Scene-Dressing) hier ablegen

Dieser Ordner nimmt **echte 3D-Modelle** für die Scene-Dressing-Ebene auf
(Handtücher, Seifenspender, Pflanze …). Solange hier nichts liegt, rendert der
Viewer **prozedurale Platzhalter** (Box/Zylinder/Kugel aus `src/dressing3d.tsx`).
Sobald ein Modell hier liegt **und** der Datensatz darauf zeigt, ersetzt es den
Platzhalter automatisch – ohne Code-Änderung.

Fachliche Vorgabe: `../../../../../FP_Kopf/vault/50_Umsetzung/Scene-Dressing-Konzept.md`
(Ästhetik-Leitlinie: «frisch gebaut, nicht bewohnt»).

## Format & Konvention (verbindlich)

| Punkt | Vorgabe |
|---|---|
| **Format** | glTF **Binary** `.glb` (alles in einer Datei, inkl. Texturen) |
| **Achsen** | **y-up**, rechtshändig (three.js-Standard) |
| **Einheit** | **Meter** (1 Einheit = 1 m) |
| **Ursprung** | **Mitte-unten**: horizontal zentriert, Unterkante bei y=0 |
| **Ausrichtung** | **Front zeigt +z** (Betrachterseite) |
| **Grösse** | passend zur `masse` (w×d×h) des Objekts in `data/dressing/<raumtyp>.json` |
| **Dateiname** | exakt `<gltfRef>.glb` (siehe unten) |
| **Gewicht** | klein halten (Draco/meshopt ok, wenige tausend Dreiecke reichen) |

> Wird das Modell nicht Mitte-unten exportiert, «schwebt» oder versinkt es –
> der Viewer versetzt das Modell um −h/2, erwartet also die Unterkante bei y=0.

## So aktivierst du ein echtes Modell (3 Schritte)

1. Modell als `.glb` nach obiger Konvention exportieren.
2. Datei hier ablegen: `apps/web/public/assets/dressing/<gltfRef>.glb`.
   Der Viewer lädt sie zur Laufzeit von `/assets/dressing/<gltfRef>.glb`.
3. Im Datensatz `data/dressing/<raumtyp>.json` beim Objekt setzen:
   ```json
   "assetStatus": "modeled",
   "gltfRef": "<gltfRef>"
   ```
   `<gltfRef>` ist ein frei wählbarer, dateinamens-tauglicher Schlüssel
   (z.B. `handtuchstapel-leinen`) und muss dem Dateinamen entsprechen.

Ohne `assetStatus:"modeled"` **oder** ohne passende Datei bleibt der prozedurale
Platzhalter aktiv. Kein Modell = kein Fehler.

## Git / Grösse

Kleine `.glb` (wenige 100 KB) dürfen eingecheckt werden. Grössere Assets nicht
direkt committen – bitte vorher mit Bryan klären (Git-LFS oder Download-Script,
analog `LICENSES.md`-Regeln im Repo-`CLAUDE.md`).
