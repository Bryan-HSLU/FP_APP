import { createRoot } from "react-dom/client";
import { App } from "./App";
// Globales Stylesheet (CSS-Variablen, .fp-card, Animationen, Media-Queries).
import "./fp.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root fehlt in index.html");
createRoot(root).render(<App />);
