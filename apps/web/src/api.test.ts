/** Weck-Verhalten des API-Clients (s. backend.ts): fetch ist gemockt, die Zeit
 *  simuliert – ein «3-Minuten-Aufwachen» läuft in Millisekunden. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_WECKDAUER_MS, type BackendStatus } from "./backend";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (status = 200) =>
  new Response("<html>Space startet…</html>", {
    status,
    headers: { "content-type": "text/html" },
  });

type Antwort = Response | Error;

/** fetch-Mock: je URL eine Schlange von Antworten; die letzte wiederholt sich. */
function mockFetch(schlangen: Record<string, (() => Antwort)[]>) {
  const aufrufe: string[] = [];
  const fn = vi.fn((url: string) => {
    aufrufe.push(url);
    const schlange = schlangen[url];
    if (!schlange || schlange.length === 0) throw new Error(`kein Mock für ${url}`);
    const naechste = (schlange.length > 1 ? schlange.shift() : schlange[0]) as () => Antwort;
    const a = naechste();
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  });
  vi.stubGlobal("fetch", fn);
  return aufrufe;
}

async function ladeApi() {
  // Frisches Modul je Test: Weck-Zustand und Beobachter sind Modul-Zustand.
  vi.resetModules();
  const mod = await import("./api");
  const ereignisse: BackendStatus[] = [];
  mod.beobachteBackend((s) => ereignisse.push(s));
  return { ...mod, ereignisse };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("api – Backend wecken", () => {
  it("normale JSON-Antwort: kein Wecken, genau ein Aufruf", async () => {
    const aufrufe = mockFetch({ "/api/samples/rooms": [() => json([{ id: "r1" }])] });
    const { api, ereignisse } = await ladeApi();
    await expect(api.rooms()).resolves.toEqual([{ id: "r1" }]);
    expect(aufrufe).toEqual(["/api/samples/rooms"]);
    expect(ereignisse).toEqual([]);
  });

  it("HTML-Ladeseite (Status 200): weckt, wiederholt EINMAL und liefert das Ergebnis", async () => {
    const aufrufe = mockFetch({
      "/api/samples/rooms": [() => html(), () => json([{ id: "r1" }])],
      "/api/health": [() => html(), () => json({ status: "ok" })],
    });
    const { api, ereignisse } = await ladeApi();
    const antwort = api.rooms();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(antwort).resolves.toEqual([{ id: "r1" }]);
    expect(ereignisse).toEqual(["wacht", "bereit"]);
    expect(aufrufe.filter((u) => u === "/api/samples/rooms")).toHaveLength(2);
  });

  it("JSON-Fehler-Envelope ist eine echte Antwort: Fehler durchreichen, nicht wecken", async () => {
    const aufrufe = mockFetch({
      "/api/samples/rooms": [() => json({ code: "NO_FEASIBLE_PLACEMENT", message: "zu eng" }, 422)],
    });
    const { api, ereignisse } = await ladeApi();
    await expect(api.rooms()).rejects.toMatchObject({
      code: "NO_FEASIBLE_PLACEMENT",
      message: "zu eng",
    });
    expect(aufrufe).toHaveLength(1);
    expect(ereignisse).toEqual([]);
  });

  it("Server bleibt weg: verständlicher Fehler statt SyntaxError", async () => {
    mockFetch({ "/api/samples/rooms": [() => html()], "/api/health": [() => html()] });
    const { api, ereignisse, NICHT_ERREICHBAR } = await ladeApi();
    const antwort = api.rooms();
    const erwartung = expect(antwort).rejects.toMatchObject({ code: NICHT_ERREICHBAR });
    await vi.advanceTimersByTimeAsync(MAX_WECKDAUER_MS + 10_000);
    await erwartung;
    expect(ereignisse).toEqual(["wacht", "nicht-erreichbar"]);
  });

  it("gleichzeitige Aufrufe teilen EINEN Weckvorgang", async () => {
    const aufrufe = mockFetch({
      "/api/samples/rooms": [() => html(), () => json([])],
      "/api/taxonomy": [() => html(), () => json({ achsen: [] })],
      "/api/health": [() => html(), () => json({ status: "ok" })],
    });
    const { api, ereignisse } = await ladeApi();
    const beide = Promise.all([api.rooms(), api.taxonomy()]);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(beide).resolves.toEqual([[], { achsen: [] }]);
    // Ein Weckvorgang = zwei Pings (html, dann ok) – nicht vier.
    expect(aufrufe.filter((u) => u === "/api/health")).toHaveLength(2);
    expect(ereignisse).toEqual(["wacht", "bereit"]);
  });

  it("Netzfehler wird wie ein schlafendes Backend behandelt", async () => {
    mockFetch({
      "/api/samples/rooms": [() => new TypeError("Failed to fetch"), () => json([{ id: "r1" }])],
      "/api/health": [() => json({ status: "ok" })],
    });
    const { api } = await ladeApi();
    const antwort = api.rooms();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(antwort).resolves.toEqual([{ id: "r1" }]);
  });

  it("wach, aber weiterhin keine JSON-Antwort: Fehler nennt den HTTP-Status", async () => {
    mockFetch({
      "/api/samples/rooms": [
        () => new Response("zu gross", { status: 413, headers: { "content-type": "text/plain" } }),
      ],
      "/api/health": [() => json({ status: "ok" })],
    });
    const { api } = await ladeApi();
    const antwort = api.rooms();
    const erwartung = expect(antwort).rejects.toMatchObject({
      code: "UNERWARTETE_ANTWORT",
      message: expect.stringContaining("HTTP 413"),
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await erwartung;
  });
});
