import { describe, expect, it } from "vitest";
import {
  istBackendAntwort,
  istJsonAntwort,
  MAX_WECKDAUER_MS,
  PING_ABSTAENDE_MS,
  warteAufBackend,
} from "./backend";

const mitTyp = (status: number, typ: string) =>
  new Response("x", { status, headers: { "content-type": typ } });

describe("istJsonAntwort", () => {
  it("erkennt JSON auch mit charset", () => {
    expect(istJsonAntwort(mitTyp(200, "application/json"))).toBe(true);
    expect(istJsonAntwort(mitTyp(200, "application/json; charset=utf-8"))).toBe(true);
    expect(istJsonAntwort(mitTyp(200, "text/html"))).toBe(false);
  });
});

describe("istBackendAntwort", () => {
  it("HTML mit Status 200 (Ladeseite eines schlafenden Space) ist KEINE Backend-Antwort", () => {
    expect(istBackendAntwort(mitTyp(200, "text/html; charset=utf-8"))).toBe(false);
  });

  it("Proxy-Fehlerseite ist keine Backend-Antwort", () => {
    expect(istBackendAntwort(mitTyp(502, "text/html"))).toBe(false);
  });

  it("JSON-Fehler-Envelope (z.B. 422) IST eine echte Backend-Antwort", () => {
    expect(istBackendAntwort(mitTyp(422, "application/json"))).toBe(true);
  });

  it("Downloads: erfolgreiche Nicht-HTML-Antwort zählt, HTML nicht", () => {
    expect(istBackendAntwort(mitTyp(200, "application/pdf"), true)).toBe(true);
    expect(istBackendAntwort(mitTyp(200, "text/html"), true)).toBe(false);
    expect(istBackendAntwort(mitTyp(200, "application/pdf"), false)).toBe(false);
  });
});

/** Simulierte Umgebung: Ping-Ergebnisse der Reihe nach, Schlaf rückt die Uhr vor. */
function umgebung(pings: boolean[]) {
  let t = 0;
  const geschlafen: number[] = [];
  let i = 0;
  return {
    geschlafen,
    u: {
      ping: () => Promise.resolve(pings[i++] ?? false),
      schlafe: (ms: number) => {
        geschlafen.push(ms);
        t += ms;
        return Promise.resolve();
      },
      jetzt: () => t,
    },
  };
}

describe("warteAufBackend", () => {
  it("sofort bereit → kein Warten", async () => {
    const { u, geschlafen } = umgebung([true]);
    expect(await warteAufBackend(u)).toBe(true);
    expect(geschlafen).toEqual([]);
  });

  it("wacht beim dritten Ping auf – erst kurze, dann längere Abstände", async () => {
    const { u, geschlafen } = umgebung([false, false, true]);
    expect(await warteAufBackend(u)).toBe(true);
    expect(geschlafen).toEqual([PING_ABSTAENDE_MS[0], PING_ABSTAENDE_MS[1]]);
  });

  it("gibt nach der Höchstdauer auf, ohne sie zu überschreiten", async () => {
    const { u, geschlafen } = umgebung([]);
    expect(await warteAufBackend(u)).toBe(false);
    const summe = geschlafen.reduce((a, b) => a + b, 0);
    expect(summe).toBeLessThanOrEqual(MAX_WECKDAUER_MS);
    expect(summe).toBeGreaterThan(MAX_WECKDAUER_MS - 10_000); // hat es ernsthaft versucht
  });
});
