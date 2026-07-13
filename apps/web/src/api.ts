/** API-Client zum lokalen Engines-Dienst (Vite-Proxy: /api → FastAPI :8000). */
import type { CatalogItemInput, RoomInput } from "@fp/shared/rules";
import type { FarbSlug } from "./farben";
import type { FlaechenKonzept } from "./oberflaechen";

export interface Placement {
  id: string;
  catalogItemId: string;
  pose: { pos: [number, number]; yawDeg: number };
  gewerk: string;
  locked: boolean;
  source: string;
  mountHeight?: number;
  /** Gewählte Farbvariante (KI oder Nutzer), Welle 3. Fehlt = Default-Optik. */
  farbe?: FarbSlug;
}

export interface Plan {
  id: string;
  roomRef: string;
  version: number;
  status: string;
  placements: Placement[];
  constraintReport: unknown;
  meta: { seed: number; normProfile: string; solverVersion: string };
}

export interface KatalogItem extends CatalogItemInput {
  name: string;
  priorityClass: "P1" | "P2" | "P3";
  /** Optionale 3D-Bausatz-Variante für den Viewer (Katalog-Feld modell3d). */
  modell3d?: string;
  /** Wählbare Farbvarianten (Welle 2); erste = Default-Optik. Grundlage für den
   *  UI-Farbpicker und die KI-Farbwahl. */
  farbVarianten?: FarbSlug[];
  /** Stil-Achsen-Ausprägungen des Items (für Stil-Match/Kurator). */
  achsenTags?: Record<string, number>;
  /** Preis-Stammdaten (für Kostenanzeige & LV). Provenance liegt im Schema. */
  preis?: {
    value: number;
    currency: "CHF";
    stand?: string;
    quelle?: string;
    bandbreitePct?: number;
  };
}

export interface Room extends RoomInput {
  id: string;
  name: string;
}

/** Scene-Dressing-Objekt (rein visuelle Deko-Ebene, getrennt vom Plan).
 *  Vertrag: packages/shared/schemas/dressing-item.schema.json. NICHT solver-/
 *  normrelevant – erscheint nie in placements/constraintReport/LV. */
export interface DressingItem {
  id: string;
  schemaVersion: string;
  name: string;
  roomTypes: string[];
  /** B leicht kollisionsrelevant · C an Wand/Möbel · D Mikro-Deko auf Oberfläche. */
  klasse: "B" | "C" | "D";
  funktionsTyp: string;
  /** funktionsTypen aus dem Plan ODER die Schlüsselworte "wand"/"ecke". */
  anchorTypes: string[];
  platzierung: "auf_oberflaeche" | "an_wand" | "freie_ecke" | "an_moebel" | "an_decke";
  masse: { w: number; d: number; h: number };
  achsenTags: Record<string, number>;
  attributTags: string[];
  assetStatus: "placeholder" | "modeled";
  /** Dateiname (ohne Endung) unter public/assets/dressing/<gltfRef>.glb. */
  gltfRef?: string;
  modell3d?: string;
}

export interface KV {
  raumName: string;
  mengen: { bodenflaeche_m2: number; wandflaeche_m2: number; objekte: number };
  positionen: {
    bezeichnung: string;
    gewerk: string;
    menge: number;
    einheit: string;
    einzelpreis_chf: number;
    total_chf: number;
  }[];
  summe_chf: number;
  bandbreitePct: number;
  von_chf: number;
  bis_chf: number;
  nextSteps: string[];
  hinweis: string;
}

/** Optionen für /solve – Küche braucht normProfile/form/zoneId, sonst Kurator. */
export interface SolveOpts {
  kurator?: KuratorAntwort;
  stilprofilRef?: string;
  stilprofil?: unknown | null;
  normProfile?: string;
  form?: string;
  zoneId?: string;
  /** Flächen-Wünsche des Kurators (Call C); der Server reicht sie unverändert
   *  in der Antwort zurück (der Client rendert daraus die Optik). */
  flaechen?: FlaechenKonzept | null;
  /** Farbwahl je Item (Welle 3): itemId→Slug → placement.farbe im Plan. */
  farben?: Record<string, FarbSlug> | null;
  /** K-Varianten (Welle 5): true → Server erzeugt K=3 Varianten und liefert die
   *  beste (+ varianteInfo). Nur Nicht-Küche. Default false. */
  varianten?: boolean;
}

/** Auswahl-Spur der K-Varianten (Welle 5), additiv in der /solve-Response-Hülle.
 *  Rein informativ – der `plan` ist bereits die gewählte beste Variante. */
export interface VarianteInfo {
  /** Index der gewählten Variante in `varianten`. */
  gewaehlt: number;
  anzahl: number;
  varianten: {
    index: number;
    seed: number;
    /** Anzahl platzierter Items (Überlebensrate). */
    platziert: number;
    /** Anzahl «knappe» harte Regeln (weniger = mehr Norm-Luft). */
    knapp: number;
    /** Weiche Relations-/Stil-Zufriedenheit (höher = besser). */
    relationScore: number;
  }[];
}

export class ApiFehler extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(pfad: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${pfad}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiFehler(body.code ?? "UNBEKANNT", body.message ?? res.statusText);
  }
  return (await res.json()) as T;
}

export interface KuratorAntwort {
  auswahl: string[];
  relationaleAbsichten: { itemId: string; relation: string }[];
  /** Flächen-Konzept (Boden-/Wand-Material je Wand). Fehlt bei Teil-Fallback. */
  flaechen?: FlaechenKonzept | null;
  /** Design-Leitidee aus Call A (roter Faden), optional. */
  konzept?: string | null;
  /** KI-Farbwahl je Item (itemId→Slug), Welle 3. Fehlt/leer = Default-Optik. */
  farben?: Record<string, FarbSlug> | null;
  begruendung?: string;
}

/** Gemessenes AMK-Arbeitsdreieck eines Küchenplans (server-berechnet, M6-Politur). */
export interface Arbeitsdreieck {
  /** Die drei Seitenlängen Spüle–Kochfeld–Kühlschrank (m). */
  seiten_m: number[];
  /** Summe der drei Seiten (m); AMK-effizient bei ~4–8 m. */
  summe_m: number;
  /** Ergonomie-Score in [0,1] (= constraintReport.softScore.ergonomie). */
  score: number;
  bewertung: "effizient" | "akzeptabel" | "beengt" | "weitläufig";
}

/** Eine Küchenform-Empfehlung (Formwahl, M6). */
export interface KuechenForm {
  form: "i" | "l" | "u" | "galley" | "insel";
  score: number;
  begruendung: string;
  anchorWallIds: string[];
  nutzlaenge_m: number;
}

export const api = {
  rooms: () => call<Room[]>("/samples/rooms"),
  /** Scan-Bundle (vorberechnetes layout.txt, optional .zip mit poses.json) → Raummodell.
   *  FormData statt JSON – daher eigener fetch (nicht der json-`call`-Helfer). */
  async scan(
    bundle: File,
    roomType: string,
    name: string,
  ): Promise<{ room: Room; warnungen: string[] }> {
    const fd = new FormData();
    fd.append("bundle", bundle);
    fd.append("roomType", roomType);
    fd.append("name", name);
    const res = await fetch("/api/scan", { method: "POST", body: fd });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      throw new ApiFehler(body.code ?? "SCAN", body.message ?? res.statusText);
    }
    return (await res.json()) as { room: Room; warnungen: string[] };
  },
  images: (roomType: string) => call<import("./Stil").BildItem[]>(`/images/${roomType}`),
  taxonomy: () => call<{ achsen: import("./Stil").Achse[] }>("/taxonomy"),
  styleProfile: (roomType: string, likes: string[], dislikes: string[], presetId: string | null) =>
    call<import("./Stil").Stilprofil>("/style/profile", {
      method: "POST",
      body: JSON.stringify({ roomType, likes, dislikes, presetId }),
    }),
  curate: (room: Room, stilprofil: unknown, seed: number) =>
    call<{ kurator: KuratorAntwort; port: string }>("/curate", {
      method: "POST",
      body: JSON.stringify({ room, stilprofil, seed }),
    }),
  catalog: (roomType: string) => call<KatalogItem[]>(`/catalog/${roomType}`),
  /** Scene-Dressing-Stammdaten je Raumtyp (rein visuelle Deko-Ebene, read-only). */
  dressing: (roomType: string) => call<DressingItem[]>(`/dressing/${roomType}`),
  rules: (roomType: string) => call<unknown[]>(`/rules/${roomType}`),
  /** Top-3 Küchenformen (Formwahl) für einen Küchen- oder Grossraum. */
  kuecheFormen: (room: Room, stilprofil: unknown | null, normProfile: string, zoneId?: string) =>
    call<{ formen: KuechenForm[] }>("/kueche/formen", {
      method: "POST",
      body: JSON.stringify({ room, styleProfile: stilprofil ?? undefined, normProfile, zoneId }),
    }),
  solve: (room: Room, seed: number, opts: SolveOpts = {}) =>
    call<{
      plan: Plan;
      room: Room;
      hinweis?: string;
      arbeitsdreieck?: Arbeitsdreieck;
      flaechen?: FlaechenKonzept | null;
      varianteInfo?: VarianteInfo;
    }>("/solve", {
      method: "POST",
      body: JSON.stringify({
        room,
        seed,
        auswahl: opts.kurator?.auswahl,
        relationaleAbsichten: opts.kurator?.relationaleAbsichten ?? [],
        stilprofilRef: opts.stilprofilRef,
        stilprofil: opts.stilprofil ?? undefined,
        normProfile: opts.normProfile,
        form: opts.form,
        zoneId: opts.zoneId,
        flaechen: opts.flaechen ?? undefined,
        farben: opts.farben ?? undefined,
        varianten: opts.varianten ?? undefined,
      }),
    }),
  /** Manuelle Flächen-Wahl (Welle 3) gegen die Norm prüfen + korrigieren lassen.
   *  Quelle bleibt Python (kein TS-Nachbau der Regeln → kein Drift). */
  pruefeFlaechen: (room: Room, flaechen: FlaechenKonzept) =>
    call<{ verstoesse: string[]; korrigiert: FlaechenKonzept }>("/flaechen/pruefen", {
      method: "POST",
      body: JSON.stringify({ room, flaechen }),
    }),
  evaluate: (room: Room, plan: Plan) =>
    call<KV>("/evaluate", { method: "POST", body: JSON.stringify({ room, plan }) }),
  /** Dokument vom Export-Endpunkt herunterladen (Blob → Browser-Download). */
  async dokument(pfad: string, dateiname: string, room: Room, plan: Plan): Promise<void> {
    const res = await fetch(`/api/export/${pfad}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, plan }),
    });
    if (!res.ok) throw new ApiFehler("EXPORT", res.statusText);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = dateiname;
    a.click();
    URL.revokeObjectURL(url);
  },
};
