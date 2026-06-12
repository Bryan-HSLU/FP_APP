/** API-Client zum lokalen Engines-Dienst (Vite-Proxy: /api → FastAPI :8000). */
import type { CatalogItemInput, RoomInput } from "@fp/shared/rules";

export interface Placement {
  id: string;
  catalogItemId: string;
  pose: { pos: [number, number]; yawDeg: number };
  gewerk: string;
  locked: boolean;
  source: string;
  mountHeight?: number;
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
}

export interface Room extends RoomInput {
  id: string;
  name: string;
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
  begruendung?: string;
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
  rules: (roomType: string) => call<unknown[]>(`/rules/${roomType}`),
  /** Top-3 Küchenformen (Formwahl) für einen Küchen- oder Grossraum. */
  kuecheFormen: (room: Room, stilprofil: unknown | null, normProfile: string, zoneId?: string) =>
    call<{ formen: KuechenForm[] }>("/kueche/formen", {
      method: "POST",
      body: JSON.stringify({ room, styleProfile: stilprofil ?? undefined, normProfile, zoneId }),
    }),
  solve: (room: Room, seed: number, opts: SolveOpts = {}) =>
    call<{ plan: Plan; room: Room; hinweis?: string }>("/solve", {
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
      }),
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
