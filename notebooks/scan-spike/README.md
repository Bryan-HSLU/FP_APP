# scan-spike/ – Eval-Harness für den Scan-Validierungs-Spike (M2)

Misst die riskanteste Annahme des Projekts: *masshaltiges, segmentiertes
Raummodell aus Phone-Video ohne LiDAR?* Vorgaben: Brain →
`vault/50_Umsetzung/Scan-Validierungs-Spike.md` (Hypothesen, Erfolgskriterien,
Gates) und `Scan-Eval-Notebook-Spezifikation.md`.

```text
spike_eval.ipynb     # Colab-Notebook (T4-GPU): P0–P5 → Metrik-Tabelle
capture_check.py     # lokaler Vorabcheck (Schärfe/Belichtung) VOR GPU-Einsatz
testdata/r1/         # Walkthrough-Videos R1 = Bad (harter Fall)
ground-truth/r1.json # Laser-/Massband-Referenz (Bryan ausfüllen)
reports/             # Mess-Reports je Raum/Lauf
```

## Ablauf je Testraum

1. Video(s) nach `testdata/<raum>/` legen, `capture_check.py` laufen lassen –
   bei rotem Befund **neu aufnehmen statt GPU verschwenden** (Guideline im
   Report `reports/r1-vorabcheck.md`).
2. Ground Truth messen → `ground-truth/<raum>.json`.
3. `spike_eval.ipynb` in Google Colab öffnen (Gratis-T4), `RAUM` setzen,
   alle Zellen laufen lassen → `reports/<raum>-metriken.json`.
4. Ergebnis (Tabelle + Go/Anpassen/Pivot) als **Learning ins Brain**.

## Regeln

- **Lizenz:** Depth Anything V2 nur **Small** (Apache) · Grounding DINO + SAM2
  (Apache) sind der Hauptpfad · **kein YOLO/Ultralytics (AGPL)** einbauen.
- **Keine Modelle/Gewichte ins Git** – das Notebook lädt sie zur Laufzeit.
- Testvideos sind **persönliche Aufnahmen** (privates Repo, interne Nutzung;
  im R1-Spiegel ist eine Person sichtbar – Produkt braucht Maskierung,
  ADR-0009).
- Der Spike ist **entkoppelt** (M2): blockiert M3–M6 nicht, sein Ergebnis
  steuert nur M7 (Scan-Integration).
