/** Weck-Logik für das Engines-Backend (reine Logik, ohne fetch/Timer).
 *
 *  Hintergrund: Wird das Frontend getrennt vom Backend ausgeliefert (Vercel-
 *  Rewrite `/api/*` → Hugging-Face-Space), ist die App sofort da, das Backend
 *  aber nicht zwingend: ein Gratis-Space schläft nach 48 h ohne Besuch und
 *  liefert beim Aufwachen eine HTML-Ladeseite – mit Status 200. Auch Proxy-
 *  Fehlerseiten sind HTML. Ohne diese Erkennung parst `res.json()` das HTML und
 *  der Nutzer sieht einen rohen `SyntaxError`. Liefert der Space Frontend UND
 *  API selbst aus, wachen beide gemeinsam auf – dort greift das hier nie.
 */

export type BackendStatus = "unbekannt" | "wacht" | "bereit" | "nicht-erreichbar";

/** Abstände zwischen Health-Pings: erst rasch (kurzer Neustart), dann gleichmässig. */
export const PING_ABSTAENDE_MS = [2000, 3000, 5000];
export const PING_ABSTAND_DAUER_MS = 5000;
/** Höchstens so lange wird auf das Aufwachen gewartet. Der Kaltstart eines
 *  Gratis-Space ist nicht gemessen; 3 min decken einen Container-Start
 *  grosszügig ab, ohne den Nutzer unbegrenzt hinzuhalten. */
export const MAX_WECKDAUER_MS = 180_000;

function contentType(res: Response): string {
  return (res.headers.get("content-type") ?? "").toLowerCase();
}

/** Antwort mit JSON-Body – unsere API antwortet immer so, auch im Fehlerfall. */
export function istJsonAntwort(res: Response): boolean {
  return contentType(res).includes("application/json");
}

/** Kam die Antwort wirklich von unserem Backend (und nicht von einer
 *  Ladeseite/Proxy-Fehlerseite bzw. gar nicht)? `binaer` für Downloads
 *  (PDF/DXF/glTF): dort zählt eine erfolgreiche Nicht-HTML-Antwort. */
export function istBackendAntwort(res: Response, binaer = false): boolean {
  if (istJsonAntwort(res)) return true;
  return binaer && res.ok && !contentType(res).includes("text/html");
}

export interface WeckUmgebung {
  /** true = Backend antwortet mit gültigem Health-JSON. */
  ping: () => Promise<boolean>;
  schlafe: (ms: number) => Promise<void>;
  jetzt: () => number;
}

/** Pingt, bis das Backend antwortet (true) oder `maxMs` verstrichen wären (false). */
export async function warteAufBackend(
  u: WeckUmgebung,
  maxMs: number = MAX_WECKDAUER_MS,
): Promise<boolean> {
  const start = u.jetzt();
  for (let versuch = 0; ; versuch++) {
    if (await u.ping()) return true;
    const abstand = PING_ABSTAENDE_MS[versuch] ?? PING_ABSTAND_DAUER_MS;
    if (u.jetzt() - start + abstand > maxMs) return false;
    await u.schlafe(abstand);
  }
}
