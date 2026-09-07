# AGENTS.md – Arbeitsanweisung für Coding-Agenten in `FP_APP`

> Für **Codex Cloud** und jeden anderen Agenten, der **nur dieses eine Repo**
> sieht. Claude-Sessions mit beiden Repos folgen zusätzlich
> [`CLAUDE.md`](CLAUDE.md) – bei Widerspruch gilt `CLAUDE.md`.
>
> Lies diese Datei **vollständig**, bevor du eine Zeile änderst.

---

## 0. Was dieses Repo ist

`FP_APP` ist der **lauffähige POC** der App **«Future Planning»**: Sie zeigt
Bauherrschaften ihre zukünftigen Räume, bevor sie gebaut sind. Kernkette:

```
Raum (Beispiel · Scan · manueller Editor)
  → Stil-Swipe (8 Stilachsen)
  → Kurator (KI wählt Möbel, 3 LLM-Calls, mit deterministischer Baseline)
  → Solver (platziert normkonform, garantiert 0 ❌)
  → Viewer 2D-Grundriss + 3D
  → Auswertung (Mengen, Kosten, Gewerke, Dokumente)
```

**Monorepo:**

| Pfad | Inhalt |
|---|---|
| `apps/web` | React + Vite + TypeScript, three.js/react-three-fiber (Viewer 2D/3D, Wizard-UI) |
| `services/engines` | Python 3.12 / FastAPI (Solver, Kurator, Küche, Scan-Adapter, Exporte) |
| `services/scan-worker` | eigenes uv-Projekt (Scan-Geometrie, GPU-Teile laufen nur auf Colab) |
| `packages/shared` | **JSON-Schemas = Verträge** + Codegen (TS-Typen & pydantic) + Regel-Interpreter (TS) + goldene Fixtures |
| `data/` | Stammdaten als JSON – `rules/`, `catalog/`, `images/`, `dressing/`, `positions/`, `sequence/`, `prompts/`, `taxonomy/`, `kurator/`. **Keine Datenbank.** |
| `notebooks/` | Scan-Eval (Colab) |

---

## 1. Ein-Repo-Realität: die fachliche Source of Truth fehlt dir

Das Schwester-Repo **`Bryan-HSLU/FP_Kopf`** («Brain», Obsidian-Vault) enthält
Konzepte, ADRs und Learnings und ist die **fachliche Source of Truth**. In
Codex Cloud hast du **keinen Zugriff darauf**. Daraus folgt verbindlich:

1. **Bestehende Architektur zuerst verstehen** – lies den umliegenden Code und
   die Docstrings. Dieses Repo ist reich kommentiert: das *Warum* steht meist
   direkt über der Konstante oder Funktion. Wenn ein Kommentar eine Entscheidung
   begründet, ist das ein Brain-Entscheid – **respektiere ihn**.
2. **Nichts stillschweigend widersprechen.** Findest du eine bestehende
   fachliche Festlegung schlecht, setze sie **nicht** einfach anders um.
3. **Neue Architektur-/Fachentscheidungen explizit kennzeichnen.** Brauchst du
   eine, dann triff die kleinstmögliche, dokumentiere sie im Code-Kommentar und
   liste sie am Ende deiner Zusammenfassung unter einer Überschrift
   `## Neue Entscheidungen (Review durch Bryan nötig)` – mit Kontext, Optionen,
   gewählter Variante und Grund. Bryan trägt sie danach als ADR ins Brain nach.
4. **Wissen zurückspielen.** Du kannst nicht ins Brain schreiben. Liefere darum
   am Ende einen Block `## Fürs Brain (Learning-Notiz)`: 5–15 Zeilen, was
   funktioniert hat, was nicht, welche Abweichung warum. **Kein Code-Dump** –
   Erkenntnisse.
5. **Im Zweifel fragen statt annehmen.** Lieber ein sauber abgegrenzter
   Teilstand plus offene Frage als eine erratene Festlegung.

Der geltende fachliche Rahmen, soweit du ihn für Katalog-/Viewer-Arbeit
brauchst, steht in §5 dieser Datei – das ist der Auszug aus dem Brain.

---

## 2. Pflichtlektüre vor der ersten Änderung

1. Diese Datei.
2. [`CLAUDE.md`](CLAUDE.md) – besonders **§10 Verifikation** (exakte Befehle)
   und **§11 Bekannte Stolpersteine** (spart dir Stunden).
3. [`STATUS.md`](STATUS.md) – wo das Projekt steht, was bewusst offen ist,
   welche Abweichungen bereits entschieden sind. Die Tabelle **«Bewusste
   Abweichungen / Engineering-Entscheide»** ist eine Liste von Dingen, die du
   **nicht** «aufräumen» darfst.
4. Das `README.md` des Pakets, das du anfasst.

---

## 3. Unantastbare Invarianten

Diese Regeln sind der Grund, warum der POC beweisbar funktioniert. Sie zu
brechen ist nie Teil eines Tasks – wenn dein Task sie zu brechen scheint,
**halte an und frag**.

| # | Invariante | Konkret |
|---|---|---|
| ⭐1 | **Paritäts-Gesetz** | `packages/shared/src/rules/interpreter.ts` und `services/engines/src/fp_engines/rules/interpreter.py` sind 1:1-Spiegel. Wer einen ändert, ändert **beide** + die goldenen Fixtures in `packages/shared/fixtures/rule-parity/` im **selben Commit**. Goldens: `uv run python scripts/update_goldens.py` (aus `services/engines/`), danach `pnpm exec prettier --write "fixtures/rule-parity/expected/*.json"` (aus `packages/shared/`). |
| ⭐2 | **Solver-Invariante** | Jeder gelieferte Plan hat **0 ❌** im `constraintReport`. Lieber ehrlich `NoFeasiblePlacement` (HTTP 422) als ein Plan, der Regeln verletzt. |
| 3 | **bbox-Treue** | Kein 3D-Bauteil und kein 2D-Symbol ragt aus der Katalog-bbox `w×d×h`. Getestet über die komplette Registry × 5 Grössen (`moebel3d.test.ts`, `symbole2d.test.ts`). Die Norm-Ampel urteilt über die bbox – ein überstehendes Teil würde eine falsche Sicherheit vorspiegeln. |
| 4 | **Die Ampel dominiert die Farbe** | Material-/Farbwahl wirkt **nur** bei Ampel-Status `ok`. `knapp`/`verletzt`/`gesperrt` behalten ihre Statusfarben – in 2D **und** 3D. |
| 5 | **Determinismus** | Gleicher Input + gleicher `seed` ⇒ byte-gleicher Plan. Keine `random`-Aufrufe ohne Seed, keine Zeit-/Umgebungsabhängigkeit, stabile Sortierungen (bei Gleichstand nach `id`). |
| 6 | **Schemas sind Verträge** | Änderungen in `packages/shared/schemas/` nur **additiv** (neue optionale Felder = minor). Pflichtfeld/Bedeutung ändern = major + Migrationsnotiz + explizite Rückfrage. Nach jeder Schema-Änderung `pnpm codegen` (nie die generierten Dateien von Hand editieren). |
| 7 | **Regeln sind Daten** | Normregeln leben in `data/rules/*.json`, nicht im Code. Neue Norm-Anforderung ⇒ Regel-JSON, nicht `if` im Solver. |
| 8 | **Prompt-Token-Budget** | Der Kurator läuft am Groq-Free-Tier (12 000 TPM). Alles, was die Kandidatenliste verlängert (neue Katalog-Items!), wächst in den Prompt. Der Test `test_plan_mit_repair_bleibt_im_minutenbudget` ist die Grenze – er muss grün bleiben. |
| 9 | **Koordinaten** | y-up, rechtshändig, **Meter**; Grundriss in der x/z-Ebene; Rotation = Yaw in Grad; Front = lokal **+z**, Rückseite −z, Ursprung = bbox-Mitte. IDs sind UUIDv4, Referenzen nur per ID. |

---

## 4. Verifikation – so beweist du «grün»

Die CI (`.github/workflows/ci.yml`) fährt **Lint → Typecheck → Tests →
Schema-Check**. Lokal exakt so:

```bash
# JS/TS – aus dem Repo-Root
pnpm -r --if-present lint
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm schema-check

# Python – aus services/engines/
uv run ruff check .
uv run pytest -q

# mypy – aus dem Repo-Root (der --config-file ist nötig!)
uv --project services/engines run mypy \
   --config-file services/engines/pyproject.toml services/engines/src
```

Richtwerte (Stand 2026-08): ~434 Python-, ~223 `apps/web`-, ~23
`packages/shared`-Tests. Fährst du **weniger** Tests als vorher, hast du etwas
kaputt gemacht.

**Ehrlichkeitspflicht:** Läuft ein Gate in deiner Umgebung nicht (kein
Netz, fehlendes `uv`, kein Browser), schreib das **explizit** in die
Zusammenfassung – nenne den Befehl und den Fehler. Nie «alle Tests grün»
behaupten, wenn du sie nicht gefahren hast. Ein ehrlich gemeldetes,
nicht gefahrenes Gate ist in Ordnung; eine falsche Grün-Meldung nicht.

---

## 5. Fachlicher Rahmen (Auszug aus dem Brain – gilt hier als Vorgabe)

- **Stilmodell:** keine benannten Stile, sondern **8 Stilachsen** mit Werten
  −1…+1 (`data/taxonomy/stilachsen.json`): `temperatur`, `materialitaet`,
  `helligkeit`, `opulenz`, `epoche`, `kontur`, `farbigkeit`, `raumgefuehl`.
  Jedes Katalog-Item trägt **alle 8** in `achsenTags`; der Kurator bildet über
  Cosinus-Nähe den Stil-Score.
- **Prioritätsklassen:** `P1` Pflicht/Anschluss · `P2` Funktion · `P3`
  Ergänzung. Steuert die Platzierungs-Konkurrenz im Solver.
- **Objekt-Ebenen (ADR-0014):** `objektEbene: haupt` = raumprägend (Sofa,
  Esstisch, WC) · `ergaenzung` = hängt über `ankerTyp` an einem Haupt-Objekt
  (Stuhl **zum** Esstisch) und darf über `maxAnzahl` mehrfach vorkommen ·
  **Deko** ist keine Katalog-Ebene, sondern der separate Dressing-Layer
  (`data/dressing/*.json`, rein visuell, verändert den Plan **nicht**).
- **Raumtypen-Reihenfolge:** Bad → Wohnen → Küche.
- **Der Kurator ist geerdet:** Die KI darf nur aus der vorgefilterten
  Kandidatenliste wählen; jede Antwort läuft durch harte Validierung
  (`_validiere_ebenen`: Auswahl ⊆ Kandidaten, P1-Pflicht, Anker, `maxAnzahl`,
  Platz-Budget). Scheitert sie, greift Trimmen bzw. die deterministische
  Baseline. **Jede neue KI-Freiheit braucht eine neue deterministische
  Kontrolle** – das ist die eiserne Regel des Kurator-Konzepts.
- **Preise** sind Sample-Schätzungen mit Provenance (`preis.quelle`,
  `preis.stand`, `preis.bandbreitePct`) – erfinde keine Herstellerpreise und
  keine Marken-/Modellnamen realer Hersteller.

---

## 6. Katalog- und Möbel-Pipeline (der häufigste Task-Typ)

Ein Möbel existiert an **mehreren** Stellen. Fasst du eine an, prüfe alle:

| Ebene | Datei | Regel |
|---|---|---|
| Stammdaten | `data/catalog/{bad,wohnen,kueche}.json` (flache JSON-Arrays) | Muss gegen `packages/shared/schemas/katalog-item.schema.json` validieren (`pnpm schema-check`). |
| 2D-Grundriss-Symbol | `apps/web/src/symbole2d.ts` (`BAUER`-Registry) | Draufsicht-Signatur in lokalen Metern; **jeder** `funktionsTyp` im Katalog braucht eines (Test erzwingt das). Auflösung: `modell3d` → `funktionsTyp` → Box-Fallback. |
| 3D-Bausatz | `apps/web/src/moebel3d.tsx` (`bauteile`, `bausatzSchluessel`) | Primitive `box`/`rundbox`/`zylinder`/`kugel`/`lathe`/`torus`, Material-Rollen `koerper`/`hell`/`dunkel`/`glas`/`chrom`; alle Masse als **Anteile** von w/d/h. |
| Geteilte Proportionen | `apps/web/src/moebelProportionen.ts` | Wenn 2D und 3D dasselbe Möbel zeigen, kommen die Anteile **von hier** – sonst driften Grundriss und 3D auseinander (genau so entstand der L-Sofa-Bug). |
| Material-/Farbton | `MATERIAL_FARBE` in `moebel3d.tsx` | Neuer `funktionsTyp` ⇒ Eintrag, sonst fällt er auf Salbei zurück. |
| Farbvarianten | `farbSlug`-Enum im Katalog-Schema + `FARBSLUG_HEX` in `apps/web/src/farben.ts` | Slug-Enum und Client-Hex müssen deckungsgleich sein. Reihenfolge: erste Variante = Default-Optik. |
| Deko/Dressing | `data/dressing/*.json` + `apps/web/src/dressing3d-kits.ts` | Eigene Ebene mit `klasse`/`anchorTypes`/`platzierung`; verändert `placements`/`constraintReport` **nicht**. |
| Mengen je Raum | `data/kurator/anzahl-leitplanken.json` | Korridore für Instanzzahlen je Raumtyp/Fläche. |

**Neues Katalog-Item – Checkliste:**

1. `id`: **echte zufällige UUIDv4** (die Muster-Präfixe `aaaaaaaa-`/`bbbbbbbb-`/
   `cccccccc-` sind Altbestand und werden **nicht** fortgeschrieben).
2. Pflichtfelder: `schemaVersion` `"0.1.0"`, `name` (Deutsch, konkret, mit
   Material + Mass wo sinnvoll), `kategorie`, `funktionsTyp`, `roomTypes`,
   `gewerk`, `masse` (realistische Meter), `assetStatus`, `priorityClass`,
   `achsenTags` (**alle 8 Achsen**), `attributTags`, `anschluesse`,
   `relationalRules`, `preis`.
3. Optional, aber meist sinnvoll: `objektEbene`, `ankerTyp`, `maxAnzahl`,
   `mount` (+`mountHeightRange` bei `wand`), `modell3d`, `farbVarianten`
   (≤ 6, materialgerecht), `normProfileVariante` (Küche: `ch55`/`eu60`).
4. `relationalRules`-Grammatik (vollständig, siehe Docstring in
   `services/engines/src/fp_engines/relationen.py`): `near:<typ>:<maxDist>`,
   `against-wall`, `corner`, `facing:<typ>`, `opposite:<typ>`, `group:<id>`,
   `pair-with:<itemId>`. Distanzen sind **Zentrum-zu-Zentrum** – bei grossen
   Ankern (Sofa 2.1 × 0.95) ist der ergonomische Kantenabstand als
   Zentrumswert kollidierend; das ist eine dokumentierte Falle.
5. Bevorzugt Varianten **bestehender** `funktionsTyp`en – die brauchen keinen
   neuen 2D/3D-Code. Ein wirklich neuer `funktionsTyp` zieht Symbol, Bausatz,
   `MATERIAL_FARBE` und ggf. Regeln nach sich.
6. Prüfen, ob `data/rules/<raumtyp>.json` für den `funktionsTyp` greift
   (`appliesTo` matcht auf `funktionsTyp`) – sonst ist das Möbel normfrei.
7. Nach dem Ausbau: Kurator-Budget-Test fahren (Invariante 8).

---

## 7. Scope- und Arbeitsdisziplin

- **Keine Änderungen ausserhalb des Tasks.** Kein Format-Sweep, keine
  Umbenennungen, keine Dependency-Upgrades, kein «bei der Gelegenheit».
- **Generierte Dateien nie von Hand:** `packages/shared/src/generated/`,
  `services/engines/src/fp_engines/generated/` entstehen aus `pnpm codegen`.
- **Keine neuen Dependencies** ohne Rückfrage. Der Viewer baut Möbel bewusst
  aus Primitiven statt aus externen Assets (offline-/CSP-fest).
- **Keine Binärdateien** (Bilder, Modelle, Builds) ohne Auftrag – der
  HF-Space-Deploy hat eine 10-MB-Grenze pro Datei, und das Repo trägt schon
  ~20 MB Fotos.
- **Keine Secrets** in Code, Tests oder Logs. Der Kurator-Key kommt aus der
  Umgebung (`FP_KURATOR_API_KEY`); `/kurator/status` gibt ihn nie aus.
- **Kein Test deaktivieren, überspringen oder aufweichen**, um grün zu werden.
  Ein Test, der dir im Weg steht, beschreibt fast immer eine Invariante.
- **Klein und reversibel**, thematisch getrennte Commits.

---

## 8. Sprache, Commits, Abgabe

- **Doku, Commits, UI-Texte, PR-Beschreibung: Deutsch.** Code-Bezeichner dürfen
  englisch sein; im Bestand sind sie überwiegend deutsch – **folge der Datei,
  die du anfasst**.
- Commit-Stil wie im Repo: `Bereich: was und warum`, z.B.
  `Katalog: 15 neue Moebel + Vorfilter prueft Passung in den Raum`.
  Commit-**Titel** ASCII (Umlaute im Body sind ok).
- **Abgabe in Codex Cloud:** Ergebnis als **Branch + PR** ist hier ausdrücklich
  in Ordnung (Abweichung von `CLAUDE.md` §9, die «direkt nach `main`» sagt –
  das gilt für Sessions mit Push-Recht). **Niemals direkt auf `main` pushen**,
  niemals fremde Branches umschreiben (kein force-push).
- **`STATUS.md` nachführen** ist Pflicht: ein Abschnitt mit Datum, was gebaut
  wurde, welche Zahlen gemessen wurden, was bewusst offen bleibt.

**Deine Abschluss-Zusammenfassung enthält immer:**

```
## Was geändert wurde        (Dateien + kurzer Grund je Gruppe)
## Wie verifiziert           (gefahrene Befehle + Ergebnis; nicht gefahrene ehrlich benannt)
## Bewusste Abweichungen     (was du anders gemacht hast als naheliegend, und warum)
## Neue Entscheidungen       (Review durch Bryan nötig – nur wenn zutreffend)
## Fürs Brain                (Learning-Notiz, 5–15 Zeilen, keine Code-Dumps)
## Offen / nicht gemacht     (was du bewusst gelassen hast)
```

---

## 9. Wenn du unsicher bist

Liefere den Teil, der sicher richtig ist, vollständig ab – und schreib den
unsicheren Teil als konkrete Frage mit **Optionen und Empfehlung** hin. Ein
sauber abgegrenzter Teilstand plus eine gute Frage ist deutlich mehr wert als
eine erratene fachliche Festlegung, die niemand mehr findet.
