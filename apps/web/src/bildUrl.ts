/** Baut die URL zu einem Swipe-/Preset-Foto.
 *
 * Die Bilder werden nicht mehr über das Python-Backend (`/api/bilder/...`)
 * ausgeliefert, sondern als statische Dateien direkt aus dem Frontend-Build
 * unter `/bilder/...` (siehe `fpBilder()`-Plugin in vite.config.ts) – Grund:
 * CDN-Auslieferung, der Vercel-Proxy leitet nur `/api/*` ans Backend weiter.
 */

/** `bildRef` kann Unterordner enthalten (z. B. "bad/Bild Nasszelle (1).jpg");
 *  jedes Pfadsegment wird einzeln kodiert, der Schrägstrich bleibt Trenner. */
export function bildUrl(bildRef: string): string {
  return "/bilder/" + bildRef.split("/").map(encodeURIComponent).join("/");
}
