# @fp/web – Frontend (Viewer / UI / Swipe)

React + Vite + three.js (react-three-fiber). Enthält ab M3 den 3D-Viewer/
Editor mit Live-Regel-Feedback (TS-Interpreter aus `@fp/shared`) sowie ab M4
die Stil-UI (Swipe/Preset + Smart Spider).

Fachliche Vorgaben: Brain → `vault/50_Umsetzung/Viewer-Editor-UX-Detailkonzept.md`
und `UI-UX-Gesamtkonzept.md`.

- `pnpm dev` → http://localhost:5173 (im LAN erreichbar, `/api` → FastAPI :8000)
- Stand M0: Smoke-Szene (drehender Würfel) beweist nur die three.js-Pipeline.
