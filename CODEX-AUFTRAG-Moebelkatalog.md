# Codex-Auftrag: Möbelkatalog analysieren, verbessern, vermehren

> **Zweck:** Fertiger Prompt zum Kopieren in **Codex Cloud** (Repo `FP_APP`).
> Die Spielregeln stehen in [`AGENTS.md`](AGENTS.md) und werden vom Agenten
> ohnehin gelesen – dieser Auftrag beschreibt nur das **Was**.
>
> **Empfehlung:** Der Auftrag ist in **vier Etappen** geschnitten. Gib sie
> nacheinander als eigene Codex-Tasks (je ein PR) – eine Etappe pro Task ist
> reviewbar, alles auf einmal wird ein Riesen-Diff. Etappe 1 ist die Basis für
> alle anderen und liefert die Befunde, mit denen du 2–4 priorisierst.

**Kurzweg:** Da diese Datei auf `main` liegt, genügt Codex auch der Einzeiler

```text
Lies AGENTS.md und dann CODEX-AUFTRAG-Moebelkatalog.md. Führe Etappe 1 aus –
nur diese Etappe, nicht die folgenden.
```

– so bleibt der Auftrag immer synchron mit dem Repo. Die vollen Texte unten
sind für den Fall, dass du den Prompt lieber selbstständig einfügst.

---

## Etappe 1 – Bestandsanalyse & Datenqualität

```text
Du arbeitest im Repo FP_APP (POC der App «Future Planning»). Lies zuerst
AGENTS.md vollständig, dann CLAUDE.md §10/§11 und STATUS.md.

ACHTUNG STATUS.md: Sie ist inhaltlich auf dem Stand 2026-07-15. Die Arbeiten
danach (bis 2026-08-04) sind dort NICHT dokumentiert – darunter genau das,
was dich betrifft: Farbwelt auf 33 Slugs, +28 neue Möbel, L-Sofa-Symbol,
Kurator v3.3. Ergänze dein Bild darum mit `git log --oneline -25` und lies
die Commit-Messages der Katalog-Commits; sie sind ausführlich.

AUFTRAG: Analysiere den Möbelkatalog und behebe die Datenqualitäts-Mängel.
Noch KEINE neuen Möbel, noch keine neue 3D-Geometrie – erst Befund und
saubere Basis.

TEIL A – Bestandsanalyse (Zahlen, keine Meinungen)
Erfasse für data/catalog/{bad,wohnen,kueche}.json:
1. Items je Raumtyp, je funktionsTyp, je priorityClass, je objektEbene.
2. Stil-Abdeckung: Wie sind die 8 achsenTags über die Items eines
   funktionsTyp verteilt? Konkret gesucht: funktionsTypen, deren Varianten
   stilistisch fast identisch sind (Cosinus-Nähe hoch) – die sind für den
   Kurator austauschbar und erzeugen «immer dasselbe Möbel».
   Und: Stil-Ecken, für die es in einem Slot GAR kein Angebot gibt
   (z.B. kühl/modern/minimal, oder opulent/klassisch).
3. Grössen-Spreizung je funktionsTyp (min/max w×d) – gibt es zu jedem
   Möbel eine kleine Variante für kleine Räume? Prüfe das gegen
   _passt_geometrisch in services/engines/src/fp_engines/kurator.py
   (Items, die in typischen Beispielräumen immer rausfliegen, sind tote
   Katalog-Zeilen).
4. Vollständigkeit je Item: leere attributTags, fehlende farbVarianten,
   fehlendes modell3d, Preis-Plausibilität je funktionsTyp, maxAnzahl/
   ankerTyp-Logik, relationalRules die auf nicht existierende funktionsTypen
   zeigen.
5. Viewer-Abdeckung: Welche funktionsTypen haben ein 2D-Symbol
   (apps/web/src/symbole2d.ts), welche einen eigenen 3D-Bausatz
   (apps/web/src/moebel3d.tsx), welche nur den generischen Typ-Standard?
   Welche fehlen in MATERIAL_FARBE?

Ausgangslage zur Kontrolle deiner Zahlen (Stand 2026-08, gemessen):
156 Items (bad 48 / wohnen 60 / kueche 48), 45 verschiedene funktionsTypen,
nur 8 Items mit eigener modell3d-Variante (5 Bausätze), 130 von 156 Items
mit LEEREM attributTags, alle Items assetStatus "placeholder",
33 farbSlugs im Enum. Weichen deine Zahlen ab, hat sich der Stand geändert –
dann gelten deine, nenne die Differenz.

TEIL B – Analyse wiederholbar machen
Schreibe services/engines/scripts/katalog_check.py (Muster: die vorhandenen
kurator_eval.py / kurator_diagnose.py in demselben Ordner): liest die drei
Kataloge, prüft die Punkte aus Teil A und gibt einen kompakten,
deterministischen Report auf stdout aus (Exit-Code != 0 nur bei echten
Fehlern, nicht bei Hinweisen). Ohne neue Dependencies. So kann jede spätere
Katalog-Änderung dieselbe Prüfung fahren.

TEIL C – Mängel beheben (Daten, kein neuer Code)
1. attributTags füllen: Konvention ist "gruppe:wert" (Kleinbuchstaben,
   z.B. material:eiche, farbe:beige, form:rund, funktion:stauraum). Orientiere
   dich an den Items, die schon welche haben, und an data/images/*.json.
   Mindestens Material und Farbwelt je Item, wo erkennbar.
2. Doppelte/austauschbare Varianten aus Teil A.2 stilistisch SPREIZEN:
   achsenTags so nachschärfen, dass zwei Varianten desselben funktionsTyp
   wirklich unterschiedliche Stilprofile bedienen. Ändere Werte nur dort, wo
   du es am Namen/Material begründen kannst, und nenne jede Änderung.
3. Preis-Ausreisser und fehlende Provenance korrigieren (preis.quelle,
   preis.stand, preis.bandbreitePct). Keine echten Hersteller/Modelle
   erfinden – Sample-Schätzungen bleiben als solche gekennzeichnet.
4. Fehlende MATERIAL_FARBE-Einträge ergänzen.

GRENZEN
- Keine Schema-Änderung in dieser Etappe.
- Keine neuen Items, keine neue Geometrie.
- achsenTags sind das Herz der Stil-Auswahl: dokumentiere jede Änderung in
  der Zusammenfassung, damit Bryan sie prüfen kann.

VERIFIKATION (AGENTS.md §5) und die Abschluss-Zusammenfassung nach dem dort
vorgegebenen Raster. Zusätzlich: Analyse-Ergebnis als Tabelle in der
PR-Beschreibung, und die Kernbefunde als Abschnitt in STATUS.md.
```

---

## Etappe 2 – 3D-Modelle verbessern & vermehren

```text
Repo FP_APP. Lies AGENTS.md, CLAUDE.md §11, STATUS.md und den Befund aus
Etappe 1 (PR/STATUS.md).

AUFTRAG: Die Möbel im 3D-Viewer sollen wie WÄHLBARE PRODUKTE wirken, nicht
wie ein Typ-Platzhalter in fünf Farben. Heute teilen sich fast alle Items
eines funktionsTyp EINEN Bausatz; nur 5 modell3d-Varianten existieren.

1. Vorhandene Bausätze in apps/web/src/moebel3d.tsx durchgehen und die
   schwächsten überarbeiten (zu schematisch, zu wenig Teile, falsche
   Proportionen, fehlende Material-Rollen). Priorität nach Sichtbarkeit:
   die raumprägenden Haupt-Objekte zuerst (Sofa, Esstisch, Bett, Sideboard,
   Küchenzeile-Korpusse, WC/Lavabo/Dusche).
   Nutze die vorhandenen Primitive box/rundbox/zylinder/kugel/lathe/torus und
   die Material-Rollen (koerper/hell/dunkel/glas/chrom). Keine neuen
   Dependencies, keine externen Assets.
2. Neue modell3d-Varianten für die funktionsTypen mit der grössten
   Stil-Spreizung – Ziel: pro häufigem funktionsTyp mindestens zwei klar
   unterscheidbare Silhouetten (z.B. Sofa gerade / L-Form / Bouclé-rund;
   Esstisch Rechteck-Holzbein / Säulenfuss-Stein; Regal offen / geschlossen;
   Dusche Eck / Walk-in; Lavabo Aufsatz / Doppel / Unterbau).
   Der Weg dafür ist im Docstring von bausatzSchluessel als «Neue Variante in
   3 Schritten» beschrieben – folge ihm.
3. Katalog-Items den neuen Varianten zuordnen (Feld modell3d), passend zu
   Name und achsenTags. Ein Item ohne modell3d fällt weiterhin sauber auf den
   Typ-Standard zurück – dieser Fallback muss erhalten bleiben.
4. Für jede neue Variante: Test in moebel3d.test.ts erweitern
   (bbox-Treue über alle Grössen, Mehrteiligkeit, Fallback-Kette).

UNANTASTBAR
- bbox-Treue: kein Bauteil ragt aus w×d×h (passtInBbox/clampTeil).
  Alle Masse als Anteile von w/d/h, nie absolute Meter.
- Die Norm-Ampel dominiert die Farbe: Material-/Farbwahl wirkt nur bei
  Status ok; knapp/verletzt/gesperrt behalten die Statusfarben.
- Front = +z, Rückseite = -z, Ursprung = bbox-Mitte.
- Proportionen, die 2D UND 3D betreffen, gehören nach
  apps/web/src/moebelProportionen.ts – nicht zweimal beschrieben.

Verifikation + Zusammenfassung nach AGENTS.md §5/§9. Nenne in der
Zusammenfassung, welche Möbel jetzt wie viele unterscheidbare Silhouetten
haben (vorher/nachher).
```

---

## Etappe 3 – 2D-Grundriss nachziehen

```text
Repo FP_APP. Lies AGENTS.md und apps/web/src/symbole2d.ts inkl. Kopf-Docstring.

AUFTRAG: Der 2D-Grundriss muss zeigen, was im 3D steht. Genau hier gab es
schon einen echten Bug: Das L-Sofa existierte als 3D-Variante, das 2D-Symbol
kannte modell3d gar nicht und zeichnete ein normales Sofa.

1. Für JEDE modell3d-Variante aus Etappe 2, die sich in der Draufsicht
   erkennbar unterscheidet, ein eigenes 2D-Symbol bauen. Symbole, die in der
   Draufsicht identisch wären, bewusst NICHT duplizieren – begründe das.
2. Prüfe systematisch 2D gegen 3D: gleiche Silhouette, gleiche Ausrichtung
   (Front +z), gleiche Anteile. Wo beide dasselbe Möbel beschreiben, müssen
   die Anteile aus moebelProportionen.ts kommen; ziehe weitere gemeinsame
   Konstanten dorthin, wenn du Doppelbeschreibungen findest.
3. Architekten-Look der Symbole schärfen, wo sie zu grob sind (Sitzteilung,
   Lehnen, Türlinien, Beckenformen, Kochzonen) – Strichkontur, keine Füllung;
   die Ampel-/Materialfarbe bleibt die Strichfarbe.
4. Tests erweitern: Katalog-Abdeckung (jeder funktionsTyp hat ein Symbol),
   bbox-Invariante über die komplette Registry × mehrere Grössen und unter
   Rotation, und ein Test je neuer Variante, dass modell3d das Symbol
   wirklich umschaltet.

UNANTASTBAR: Symbole liegen in lokalen Metern innerhalb der bbox; die
Projektion macht symbolScreenPrims über toScreen – keine zweite
Rotationsmathematik einführen.

Verifikation + Zusammenfassung nach AGENTS.md §5/§9.
```

---

## Etappe 4 – Katalog vermehren (mit Sinn statt Masse)

```text
Repo FP_APP. Lies AGENTS.md §6/§7 (Gebiet «Stammdaten») und den Befund aus Etappe 1.

AUFTRAG: Den Katalog gezielt erweitern – dort, wo Stil-Ecken oder
Raumgrössen heute nicht bedient werden.

WICHTIG, sonst ist die Arbeit wirkungslos: Der Kurator zeigt dem LLM pro Slot
nur die besten 5 (Haupt) bzw. 3 (Ergänzung) Kandidaten, gedeckelt auf 55
Zeilen gesamt (KANDIDATEN_* in kurator.py). Ein sechstes Sofa mit fast
gleichem Stilprofil erreicht das Modell NIE. Neue Items müssen darum eine
Lücke schliessen: ein Stilprofil, eine Grössenklasse oder eine Funktion, die
es im Slot noch nicht gibt.

1. Neue Items je Raumtyp nach den Lücken aus Etappe 1:
   - Stil-Lücken (z.B. konsequent minimal/kühl, oder warm/klassisch/opulent).
   - Grössen-Lücken: zu jedem Haupt-Objekt eine kompakte Variante für kleine
     Räume (Gäste-WC 1.56 m², kleine Küche) und eine grosszügige.
   - Funktions-Lücken, die ohne neuen funktionsTyp auskommen.
   Bevorzuge Varianten BESTEHENDER funktionsTypen (kein neuer 2D/3D-Code).
   Brauchst du doch einen neuen funktionsTyp, dann komplett: Symbol,
   3D-Bausatz, MATERIAL_FARBE, Regel-Abgleich in data/rules/<raumtyp>.json.
2. Ergänzungs-Ebene ausbauen (ADR-0014): sinnvolle ergaenzung-Items mit
   ankerTyp und maxAnzahl – das ist der Hebel für belebte Räume ohne
   Solver-Änderung. Halte data/kurator/anzahl-leitplanken.json konsistent.
3. Deko/Dressing (data/dressing/*.json + apps/web/src/dressing3d-kits.ts)
   sparsam ergänzen, Leitbild bleibt «frisch gebaut, nicht bewohnt».
   Diese Ebene ist rein visuell und darf placements/constraintReport nicht
   verändern – der bestehende Regressionstest muss grün bleiben.
4. NACH dem Ausbau messen und berichten:
   - uv run pytest tests/test_kurator.py -q  (insbesondere
     test_plan_mit_repair_bleibt_im_minutenbudget – das Groq-Free-Tier-Budget
     von 12 000 TPM ist die harte Grenze; mehr Katalog = längerer Prompt)
   - uv run python scripts/kurator_diagnose.py  (Baseline-Plausibilität)
   - uv run python scripts/katalog_check.py  (aus Etappe 1)
   Wenn das Prompt-Budget kippt: NICHT den Test lockern, sondern die
   Kandidaten-Anzeige sauber begrenzen und das in der Zusammenfassung als
   Entscheidung kennzeichnen.
5. Solver-Invariante beweisen: die Property-Tests über bad/wohnen/kueche ×
   Seeds müssen 0 ❌ liefern. Neue Items dürfen keinen Raum unlösbar machen.

Verifikation + Zusammenfassung nach AGENTS.md §5/§9, plus: Tabelle
«Slot → Stilprofile vorher/nachher» und die neue Item-Zahl je Raumtyp.
```

---

## Reihenfolge und Abhängigkeiten

| Etappe | Baut auf | Liefert |
|---|---|---|
| 1 Analyse & Datenqualität | – | Befundtabelle, `katalog_check.py`, saubere `attributTags`/`achsenTags` |
| 2 3D-Modelle | 1 (Stil-Spreizung) | neue `modell3d`-Bausätze, überarbeitete Volumetrie |
| 3 2D-Symbole | 2 (Varianten) | Grundriss deckungsgleich mit 3D |
| 4 Vermehrung | 1–3 | neue Items in die echten Lücken, Budget gemessen |

Etappe 2 und 3 lassen sich zusammenlegen, wenn du einen grösseren PR
akzeptierst – sie hängen inhaltlich eng zusammen (dieselben Proportionen).
Etappe 4 zuerst zu fahren wäre der teuerste Fehler: ohne den Befund aus
Etappe 1 entstehen genau die austauschbaren Varianten, die das Problem sind.
