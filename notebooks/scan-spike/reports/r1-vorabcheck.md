# Mess-Report R1 (Bad) – Aufnahme-Vorabcheck, 2026-06-11

> Erster Befund zu den zwei R1-Videos (noch **ohne** GPU-Lauf/Ground-Truth –
> das ist der P5-Vorabcheck mit `capture_check.py` + Sichtung der Frames).
> Spike-Kriterien: Brain → `vault/50_Umsetzung/Scan-Validierungs-Spike.md`.

## Material

| Video | Auflösung | Dauer | Kamera |
|---|---|---|---|
| `r1-bad-normal.mov` | 1080×1920 (Hochformat) | 27.6 s | iPhone, Normal |
| `r1-bad-weitwinkel.mov` | 1080×1920 (Hochformat) | 15.2 s | iPhone, Weitwinkel |

## Messwerte (capture_check.py)

| Video | Schärfe Median (Laplacian) | P10 | unter Gate 60 | überbelichtet |
|---|---|---|---|---|
| normal | **4.8** | 1.0 | 100 % | 32.8 % |
| weitwinkel | **15.3** | 8.3 | 100 % | 31.6 % |

Zum Vergleich: brauchbare Innenraum-Frames liegen typisch bei > 100.

## Interpretation (wichtig: zwei Ursachen vermischt)

Der tiefe Laplacian-Wert misst **Textur UND Schärfe** zugleich:

1. **Texturlose weisse Wände/Decke dominieren** viele Frames (Nahaufnahmen) –
   selbst scharfe Frames liefern dann keine Features. Das ist exakt
   **Hypothese H2** des Spikes (texturlose Wände = harter Fall) und kein
   Aufnahmefehler.
2. **Echte Bewegungsunschärfe** ist in der Sichtung klar erkennbar (schnelle
   Schwenks), dazu ~1/3 (teil-)überbelichtete Frames (weisse Flächen + Licht).
3. **Spiegel mit Person** im Bild (H5/Privacy): gut für den Phantomgeometrie-
   Test, fürs Produkt aber Maskierungs-Pflicht.
4. Der **Weitwinkel** schneidet ~3× besser ab (mehr Kontext pro Frame, mehr
   Kanten im Bild) – Hinweis, dass Weitwinkel die bessere Standard-Optik für
   den Scan ist (gegen Verzeichnung kalibrieren).

## Konsequenz: Aufnahme-Guideline v1 (für R1-Wiederholung + R2/R3)

1. **Langsam schwenken** – Faustregel: für 90° Drehung ≥ 4 s; kurz stehen
   bleiben an jeder Ecke.
2. **Abstand halten:** möglichst die **gegenüberliegende Wand** im Bild haben,
   nicht 30 cm vor der Wand filmen – Kanten/Ecken sind die Features.
3. **Querformat + Weitwinkel** bevorzugen; jede Raumecke einmal **mit Boden-
   und Deckenlinie** im Bild.
4. **Licht an**, aber nicht direkt in Leuchten filmen (Überbelichtung).
5. Ein **Gegenstand bekannter Grösse** (z.B. A4-Blatt an der Wand) hilft als
   Massstab-Anker, solange keine AR-Posen exportiert werden.
6. Dauer pro Raum: **60–120 s** ein Durchgang reicht – Qualität vor Länge.

## Nächste Schritte

- [ ] Bryan: **Ground Truth messen** (`ground-truth/r1.json` ausfüllen –
      Wandlängen, Fläche, Objektmasse mit Laser/Massband).
- [ ] Bryan: R1 nach Guideline **neu aufnehmen** (beide Optiken, Querformat).
- [ ] `spike_eval.ipynb` in **Colab** (T4-GPU) auf altem UND neuem Material
      laufen lassen → Vergleich zeigt den Hebel der Aufnahme-Guideline.
- [ ] P1 (Layout-Fit) und P4 (Spiegel-Maskierung) im Notebook ausbauen.
