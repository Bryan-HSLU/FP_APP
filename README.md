# Future Planning - Algorithmus-POC (Modul 1-3)

Lokal lauffähiger Proof-of-Concept der Kern-Pipeline. Kein App-/Web-Gerüst,
keine Datenbank - nur die Algorithmen von Modul 1-3, datei-basiert über eine CLI.
Ziel: zeigen, dass die Idee technisch trägt.

```
M1 Swipe-Analyse   ->  6 parallele Stilvektoren        (style_profile.json)
M2 Raumerfassung   ->  echte Photogrammetrie -> Raummodell (room.json + room.gltf)
M3 Planung         ->  KI (Claude) erzeugt Directives -> OR-Tools Solver platziert
                       (directives.json -> scene.gltf + scene.json + layout.png)
```

Sichtbares Ergebnis: `out/layout.png` (möblierter Grundriss von oben) und
`out/room.gltf` / `out/scene.gltf` (in jedem GLTF-Viewer öffnen).

## Installation

```bash
pip install -e .            # Kern (M1-Vektoren, M3 KI+Solver, Visualisierung)
cp .env.example .env        # optional: ANTHROPIC_API_KEY eintragen
```

Optionale Extras:

```bash
pip install -e ".[style]"   # CLIP-Embeddings für M1 (torch, open_clip)
pip install -e ".[capture]" # Open3D/OpenCV für die reale Photogrammetrie
```

Für die **reale** Photogrammetrie (M2 mit Video) zusätzlich native Tools:

```bash
apt-get install -y ffmpeg colmap     # SfM
# OpenMVS-CLI (DensifyPointCloud etc.) separat bauen/installieren
```

## Schnellstart (offline, ohne API-Key / native Tools)

```bash
# Modul 1: Swipes -> Stilprofil
python -m fp m1 --swipes data/swipes.json

# Modul 2: synthetische Raumrekonstruktion (statt Video) -> Raummodell
python -m fp m2 --synthetic

# Modul 3: Stilprofil + Raum -> KI-Directives -> Solver -> Layout
python -m fp m3 --room out/room.json --no-llm

# Alles am Stück (M1 -> M2 synthetic -> M3)
python -m fp all --swipes data/swipes.json --synthetic --no-llm
```

`--no-llm` erzwingt die Offline-Heuristik. Mit gesetztem `ANTHROPIC_API_KEY`
(oder `--llm`) erzeugt **Claude** die Directives - das ist der vorgesehene
„KI im Grundriss-Prozess"-Pfad. Die Heuristik existiert nur, damit der Solver
auch ohne Key demonstrierbar ist.

## Reale Photogrammetrie (M2 mit Video)

```bash
# Raumvideo aufnehmen (langsam schwenken, Kanten/Textur im Bild halten)
python -m fp m2 --video data/videos/mein_raum.mp4 \
                --scale-ref 0.90    # reale Türbreite; öffnet Open3D-Picker zum Markieren
```

Pipeline: ffmpeg-Frames -> COLMAP SfM (Posen + Sparse) -> OpenMVS Dense ->
Maßstab-Kalibrierung -> Struktur (Boden/Decke/Wände) -> Öffnungen -> `room.json` + `room.gltf`.
Headless ohne Picker: zusätzlich `--measured <modell-einheiten>` angeben.

## Tests

```bash
pytest        # M1-Vektoren, M3-Solver-Invarianten, KI-Vertrag, M2-Rekonstruktion
```

## Struktur

```
fp/m1_style/    Swipe -> 6 Stilvektoren (CLIP optional)
fp/m2_capture/  Photogrammetrie: frames/colmap/openmvs/structure/openings/export
fp/m3_planning/ llm.py (Claude) -> solver.py (OR-Tools CP-SAT) -> viz.py (layout.png)
fp/schemas.py   Datenverträge (inkl. AI<->Solver "Directives")
data/           Möbelkatalog, Stil-Tags, Beispiel-Swipes
```

## Was der POC bewusst (noch) nicht macht

- Kein UI/Backend/DB - alles CLI + Dateien.
- Möbel sind maßstäbliche Platzhalter-Boxen (echte 3D-Modelle später).
- EPRecon (panoptische GPU-Rekonstruktion) ist als optionales Flag vorgesehen,
  nicht auf dem kritischen Pfad.
- Layout-Qualität ist funktional (kollisionsfrei, Öffnungen frei, Relationen
  erfüllt), aber gestalterisch noch nicht fein getunt.
