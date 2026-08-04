/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */

export type Uuid = string;
export type Semver = string;

/**
 * Scene-Dressing-Objekt (rein visuelle Deko-Ebene, getrennt vom Plan). NICHT solver-/normrelevant: erscheint nie in plan.placements, constraintReport oder LV. Der Client platziert es deterministisch an Ankern, die aus dem bestehenden Plan abgeleitet werden. Box/Primitiv-Platzhalter mit Auto-Upgrade: ohne gltfRef rendert der Viewer prozedurale Primitive aus masse; sobald gltfRef gesetzt und assetStatus=modeled ist, ersetzt das echte glTF den Platzhalter.
 */
export interface DressingItem {
  id: Uuid;
  schemaVersion: Semver;
  name: string;
  /**
   * @minItems 1
   */
  roomTypes: [
    "bad" | "kueche" | "wohnen" | "schlafen" | "essen" | "flur" | "sonstig",
    ...("bad" | "kueche" | "wohnen" | "schlafen" | "essen" | "flur" | "sonstig")[],
  ];
  /**
   * Objektklasse (Scene-Dressing-Konzept): B leicht kollisionsrelevant (Bodenobjekt, einfache Kollisionsprüfung + Türkorridor) · C visuelle Mid-Objects (an Wand/Möbel gehängt) · D Deko-Cluster (Mikro-Objekte auf Oberflächen). Klasse A bleibt im Katalog/Solver.
   */
  klasse: "B" | "C" | "D";
  /**
   * Funktionaler Typ des Deko-Objekts – wählt auch den prozeduralen 3D-Bausatz (dressing3d).
   */
  funktionsTyp: string;
  /**
   * Erlaubte Anker: funktionsTypen aus dem Plan (z.B. lavabo, badmoebel, wc) ODER die Schlüsselworte 'wand' bzw. 'ecke'. Ohne passenden Anker im Raum wird das Objekt nicht platziert.
   *
   * @minItems 1
   */
  anchorTypes: [string, ...string[]];
  /**
   * Ankerart: auf_oberflaeche = auf der Oberkante eines Möbels · an_wand = an einer Raumwand · freie_ecke = in einer freien Raumecke (Boden) · an_moebel = neben/an einem Möbel (Boden) · an_decke = an der Decke über einem Möbel-Anker hängend (Oberkante an Deckenhöhe, masse.h = Hängelänge inkl. Schirm).
   */
  platzierung: "auf_oberflaeche" | "an_wand" | "freie_ecke" | "an_moebel" | "an_decke";
  masse: {
    w: number;
    d: number;
    h: number;
  };
  /**
   * Stil-Achsen-Ausprägungen (gleiche Achsen wie Katalog/Stilprofil) für den Stil-Match (stilNaehe). Steuert die stilabhängige Varianten-/Materialwahl.
   */
  achsenTags: {
    [k: string]: number;
  };
  attributTags: string[];
  assetStatus: "placeholder" | "modeled";
  /**
   * Dateiname (ohne Endung) eines echten glTF-Binary unter apps/web/public/assets/dressing/<gltfRef>.glb. Nur wirksam bei assetStatus=modeled; sonst rendert der prozedurale Platzhalter.
   */
  gltfRef?: string;
  /**
   * Optionale prozedurale Bausatz-Variante (analog Katalog modell3d). Fehlt sie, greift der Standard-Bausatz des funktionsTyp.
   */
  modell3d?: string;
}
