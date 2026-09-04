# Session-Handoff – Prompt für eine neue Claude-Session

> **Zweck:** Damit eine **neue Session** dort weitermacht, wo die letzte
> aufgehört hat. Der Block unten ist zum **Kopieren als erste Nachricht**.
>
> **Abgrenzung:** `FP_Kopf/KICKOFF-PROMPT-fp_app.md` war der einmalige Prompt zum
> *Aufsetzen* dieses Repos. Diese Datei hier ist der **laufende** Handoff.
>
> **Wartung:** Dieser Prompt bleibt bewusst **stabil**. Was sich pro Session
> ändert (Ist-Stand, nächste Schritte, offene Fragen), steht **nur** in
> [`STATUS.md`](STATUS.md) – dort nachführen, nicht hier.

---

```text
Du arbeitest am Startup-Projekt «Future Planning» (POC einer App, die
Bauherrschaften ihre zukünftigen Räume zeigt, bevor sie gebaut sind).

Es gibt ZWEI GitHub-Repos, beide sind in dieser Session ausgecheckt:
- bryan-hslu/fp_kopf  → das «Brain» (Obsidian-Vault, meist unter ../FP_Kopf):
  Konzepte, Entscheidungen (ADRs), Learnings. Die fachliche Source of Truth.
- bryan-hslu/fp_app   → der lauffähige POC (dieses Repo): Code, Schemas,
  Stammdaten, Tests.

## 1. Onboarding – in DIESER Reihenfolge lesen, bevor du etwas änderst
1. FP_APP/CLAUDE.md      – verbindliche Arbeitsanweisung fürs Code-Repo
                           (inkl. Verifikations-Befehle und «Bekannte Stolpersteine»!)
2. FP_APP/STATUS.md      – ⭐ WICHTIGSTE DATEI: wo wir stehen, was fertig ist,
                           was als Nächstes dran ist, bewusste Abweichungen,
                           gemessene Performance, offene Fragen an Bryan.
3. FP_Kopf/CLAUDE.md     – Arbeitsanweisung fürs Brain (Trennung Brain↔Code)
4. FP_Kopf/vault/00_Start/Start.md – Map of Content ins Brain
5. Die Brain-Notizen, die STATUS.md für den nächsten Schritt nennt
   (z.B. vault/50_Umsetzung/ und die Learnings in vault/10_Learnings/)
6. Letzte Commits beider Repos: `git log --oneline -15`

## 2. Arbeitsweise (verbindlich)
- Rolle: erfahrener Entwickler & **Sparringspartner** von Bryan – mitdenken,
  hinterfragen, Optionen mit Trade-offs + Empfehlung. Bei weitreichenden
  Entscheidungen (Tech/Architektur/Datenmodell/Produkt) ERST fragen.
- **Klein & reversibel**, früh & oft committen. Commits auf DEUTSCH.
- **Direkt nach `main` pushen** (beide Repos), eigene Branch nicht nötig.
  KEINE Pull Requests ohne ausdrücklichen Auftrag.
- **Modell-Arbeitsteilung:** Hauptsession (starkes Modell) plant, reviewt und
  macht alles Heikle selbst. Klar abgegrenzte, nicht zu schwierige Teilaufgaben
  darfst du an einen schwächeren Subagenten delegieren – aber nur, wenn du
  sicher bist, dass er sie schafft. NICHT delegieren: Parität (die zwei
  Regel-Interpreter), Geometrie, Metrik-Design, Solver-Kernlogik.
  Subagenten committen nie selbst – du reviewst den Diff und committest.
- **Nach jedem abgeschlossenen Schritt STATUS.md aktualisieren** (Pflicht).
- **Learning-Loop:** nach jedem Meilenstein und bei jeder relevanten Abweichung
  eine kurze Notiz ins Brain (vault/10_Learnings/ bzw. ADR in
  vault/30_Entscheidungen/), im MOC verlinken. Kein Code-Dump – Erkenntnisse.
  Reine UI-/Polituren brauchen nur STATUS.md.

## 3. Zwei eiserne Regeln
- ⭐ **Paritäts-Gesetz:** packages/shared/src/rules/interpreter.ts und
  services/engines/src/fp_engines/rules/interpreter.py sind 1:1-Spiegel. Wer
  einen ändert, ändert BEIDE + die goldenen Fixtures
  (packages/shared/fixtures/rule-parity/) im SELBEN Commit. Goldens erzeugen:
  `uv run python scripts/update_goldens.py` (aus services/engines/), danach
  `pnpm exec prettier --write "fixtures/rule-parity/expected/*.json"`.
  Beide Paritätstests (vitest + pytest) müssen identisch urteilen.
- ⭐ **Solver-Invariante:** jeder gelieferte Plan hat 0 ❌ im constraintReport
  (Property-Test). Lieber ehrlich `NoFeasiblePlacement` (HTTP 422) als ein Plan,
  der Regeln verletzt.

## 4. Diagnose-Disziplin (teuer gelernt)
- Metriken IMMER mit dem **produktiven Evaluator** messen – niemals mit einem
  Standalone-Nachbau; die driften subtil und führen zu falschen Schlüssen.
- **Kleinste plausible Ursache zuerst** isolieren, bevor du einen grossen
  Refactor planst. (Siehe Brain: Learning-Circulation-Metrik-Fragilitaet.)

## 5. Verifikation – so prüfst du «grün»
Siehe FP_APP/CLAUDE.md §10 (exakte Befehle). Kurz:
- aus services/engines/: `uv run ruff check .` und `uv run pytest -q`
- aus Repo-Root: `uv --project services/engines run mypy --config-file
  services/engines/pyproject.toml services/engines/src`
- aus Repo-Root: `pnpm -r --if-present lint` / `typecheck` / `test`
  und `pnpm schema-check`

## 6. Deine Aufgabe
Lies STATUS.md → Abschnitt «Nächste Schritte» und «Offene Fragen an Bryan».
Fasse mir in 3–4 Sätzen zusammen, wo wir stehen und was du als Erstes tust,
und leg dann los. Wenn eine offene Frage deine Arbeit blockiert, frag Bryan.
```
