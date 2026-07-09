import { describe, expect, it } from "vitest";
import {
  bausatzSchluessel,
  bauteile,
  clampTeil,
  MATERIAL_FALLBACK,
  MATERIAL_FARBE,
  materialFarbe,
  mischen,
  passtInBbox,
  rolleFarbe,
  type Teil,
} from "./moebel3d.tsx";

// Registrierte 3D-Varianten (funktionsTyp trägt mehrere Bausätze).
const VARIANTEN = ["wc-wandhaengend", "lavabo-aufsatz", "lavabo-doppel", "sofa-l", "dusche-eck"];

// Alle im Katalog vorkommenden funktionsTypen (data/catalog/*.json).
const KATALOG_TYPEN = [
  "wc",
  "lavabo",
  "dusche",
  "badewanne",
  "spiegel",
  "schrank",
  "handtuchstange",
  "handtuchheizung",
  "badmoebel",
  "badteppich",
  "sofa",
  "esstisch",
  "couchtisch",
  "beistelltisch",
  "regal",
  "sideboard",
  "stehleuchte",
  "teppich",
  "pflanze",
  "wandbild",
  "wandleuchte",
  "tvmoebel",
  "deko",
  "unterschrank",
  "hochschrank",
  "haengeschrank",
  "spuele",
  "kochfeld",
  "kuehlschrank",
  "geschirrspueler",
  "dunstabzug",
  "eckschrank",
  "fuellstueck",
];

// Repräsentative Katalog-Grössen (Meter), inkl. extremer Seitenverhältnisse.
const MASSE: [number, number, number][] = [
  [0.37, 0.54, 0.4], // WC-kompakt
  [2.1, 0.9, 0.85], // Sofa
  [0.6, 0.6, 2.0], // Hochschrank
  [1.2, 0.05, 0.02], // flacher Teppich
  [0.9, 0.9, 0.9], // Würfel
];

describe("bauteile – bbox-Treue (Norm-Ampel)", () => {
  it("hält jeden Bausatz vollständig innerhalb der bbox w×d×h", () => {
    for (const typ of KATALOG_TYPEN) {
      for (const [w, d, h] of MASSE) {
        const teile = bauteile(typ, w, d, h);
        expect(teile.length, `${typ} liefert Bauteile`).toBeGreaterThan(0);
        expect(passtInBbox(teile, w, d, h), `${typ} bleibt in bbox`).toBe(true);
      }
    }
  });

  it("formt bekannte Typen aus mehreren Primitiven, nicht als nackte Box", () => {
    for (const typ of KATALOG_TYPEN) {
      expect(bauteile(typ, 1, 1, 1).length, `${typ} ist mehrteilig`).toBeGreaterThan(1);
    }
  });
});

describe("bauteile – Fallback", () => {
  it("gibt für unbekannte Typen genau die bisherige volle Box zurück", () => {
    const teile = bauteile("gibtsnicht", 0.8, 0.6, 1.2);
    expect(teile).toEqual([
      { form: "box", groesse: [0.8, 1.2, 0.6], pos: [0, 0, 0], rolle: "koerper" },
    ]);
  });
});

describe("bausatzSchluessel – Varianten-Fallback-Kette", () => {
  it("wählt eine registrierte Variante vor dem funktionsTyp", () => {
    expect(bausatzSchluessel("wc", "wc-wandhaengend")).toBe("wc-wandhaengend");
    expect(bausatzSchluessel("lavabo", "lavabo-doppel")).toBe("lavabo-doppel");
  });

  it("fällt bei unregistrierter oder fehlender Variante auf den funktionsTyp zurück", () => {
    expect(bausatzSchluessel("wc", "gibtsnicht")).toBe("wc");
    expect(bausatzSchluessel("wc", undefined)).toBe("wc");
    expect(bausatzSchluessel("wc")).toBe("wc");
  });
});

describe("Varianten-Bausätze – mehrteilig & bbox-treu", () => {
  it("liefert für jede Variante mehrteilige, bbox-treue Bausätze", () => {
    for (const variante of VARIANTEN) {
      for (const [w, d, h] of MASSE) {
        const teile = bauteile(variante, w, d, h);
        expect(teile.length, `${variante} ist mehrteilig`).toBeGreaterThan(1);
        expect(passtInBbox(teile, w, d, h), `${variante} bleibt in bbox`).toBe(true);
      }
    }
  });

  it("lässt den Standard-Bausatz unverändert, wenn kein modell3d gesetzt ist", () => {
    // wc ohne Variante = bisheriger wc-Bausatz (Schlüssel bleibt funktionsTyp).
    expect(bausatzSchluessel("wc")).toBe("wc");
    const standard = bauteile("wc", 0.4, 0.6, 0.42);
    const ueberVariante = bauteile(bausatzSchluessel("wc", undefined), 0.4, 0.6, 0.42);
    expect(ueberVariante).toEqual(standard);
    // Die Variante unterscheidet sich sichtbar vom Standard.
    expect(bauteile("wc-wandhaengend", 0.4, 0.6, 0.42)).not.toEqual(standard);
  });
});

describe("Neue Primitive – rundbox/lathe/torus (Volumetrie)", () => {
  it("erfasst rundbox/lathe/torus in passtInBbox (passende Teile liegen drin)", () => {
    const teile: Teil[] = [
      { form: "rundbox", groesse: [0.8, 0.4, 0.6], pos: [0, 0, 0], radius: 0.1, rolle: "koerper" },
      {
        form: "lathe",
        profil: [
          [0, -0.2],
          [0.25, 0],
          [0.28, 0.18],
        ],
        segmente: 24,
        pos: [0, 0, 0],
        rolle: "koerper",
      },
      { form: "torus", radius: 0.2, roehre: 0.03, achse: "y", pos: [0, 0, 0], rolle: "chrom" },
    ];
    expect(passtInBbox(teile, 1, 1, 1)).toBe(true);
  });

  it("erkennt Überstand neuer Formen und clampt sie zurück in die bbox", () => {
    const zuGross: Teil[] = [
      { form: "rundbox", groesse: [2, 2, 2], pos: [1, 1, 1], radius: 0.5, rolle: "koerper" },
      {
        form: "lathe",
        profil: [
          [0, -1],
          [0.9, 0],
          [0.9, 1],
        ],
        segmente: 24,
        pos: [0.5, 0.4, -0.6],
        rolle: "koerper",
      },
      {
        form: "torus",
        radius: 0.9,
        roehre: 0.2,
        achse: "x",
        pos: [0.7, -0.8, 0.5],
        rolle: "chrom",
      },
    ];
    for (const t of zuGross) {
      expect(passtInBbox([t], 0.6, 0.5, 0.9), "vorher ausserhalb").toBe(false);
      expect(passtInBbox([clampTeil(t, 0.6, 0.5, 0.9)], 0.6, 0.5, 0.9), "nach clamp drin").toBe(
        true,
      );
    }
  });
});

describe("Flagship-Bad-Modelle – Volumetrie & Chrom", () => {
  const formen = (typ: string) => new Set(bauteile(typ, 0.6, 0.5, 0.85).map((t) => t.form));
  const rollen = (typ: string) => new Set(bauteile(typ, 0.6, 0.5, 0.85).map((t) => t.rolle));

  it("WC nutzt gerundete Boxen und einen Chrom-Drücker (>=6 Teile)", () => {
    expect(bauteile("wc", 0.4, 0.6, 0.42).length).toBeGreaterThanOrEqual(6);
    expect(formen("wc").has("rundbox")).toBe(true);
    expect(rollen("wc").has("chrom")).toBe(true);
  });

  it("Lavabo nutzt Rotationskörper (lathe) + Torus-Bogen + Chrom-Armatur", () => {
    expect(formen("lavabo").has("lathe")).toBe(true);
    expect(formen("lavabo").has("torus")).toBe(true);
    expect(rollen("lavabo").has("chrom")).toBe(true);
  });

  it("Dusche hat echtes Glas, Chrom-Armaturen und einen Torus-Ablauf/Ring", () => {
    expect(rollen("dusche").has("glas")).toBe(true);
    expect(rollen("dusche").has("chrom")).toBe(true);
    expect(formen("dusche").has("torus")).toBe(true);
  });
});

describe("Flagship-Wohnen/Schlafen-Modelle – Volumetrie & Materialien", () => {
  const formen = (typ: string) => new Set(bauteile(typ, 1.2, 0.9, 0.85).map((t) => t.form));
  const rollen = (typ: string) => new Set(bauteile(typ, 1.2, 0.9, 0.85).map((t) => t.rolle));

  // Polster-/Korpus-Möbel: gerundete Kanten (rundbox) + genug Teile.
  const gerundet = [
    "sofa",
    "sessel",
    "sideboard",
    "kommode",
    "nachttisch",
    "kleiderschrank",
    "tvmoebel",
    "bett",
    "doppelbett",
    "kinderbett",
    "stuhl",
    "buerostuhl",
    "hocker",
    "schreibtisch",
  ];

  it("nutzt gerundete Boxen (rundbox) und ist klar mehrteilig (>=6 Teile)", () => {
    for (const typ of gerundet) {
      expect(formen(typ).has("rundbox"), `${typ} nutzt rundbox`).toBe(true);
      expect(bauteile(typ, 1.2, 0.9, 0.85).length, `${typ} >=6 Teile`).toBeGreaterThanOrEqual(6);
    }
  });

  it("verbaut Chrom für Gestelle/Griffe/Füsse bei Polster- und Korpus-Möbeln", () => {
    for (const typ of ["sofa", "sessel", "sideboard", "kommode", "nachttisch", "stuhl", "hocker"]) {
      expect(rollen(typ).has("chrom"), `${typ} nutzt chrom`).toBe(true);
    }
  });

  it("gibt dem TV-Möbel einen Glas-Screen und der Stehleuchte einen Rotationskörper", () => {
    expect(rollen("tvmoebel").has("glas"), "tvmoebel hat Glas-Screen").toBe(true);
    expect(formen("stehleuchte").has("lathe"), "stehleuchte hat Rotationskörper").toBe(true);
    expect(rollen("stehleuchte").has("glas"), "stehleuchte hat Glas-Diffusor").toBe(true);
  });

  it("modelliert die Deko als Rotationskörper-Gefäss mit Chrom-Rand", () => {
    expect(formen("deko").has("lathe"), "deko ist Rotationskörper").toBe(true);
    expect(formen("deko").has("torus"), "deko hat Chrom-Ring").toBe(true);
  });
});

describe("Flagship-Küche-Modelle – Volumetrie & Materialien", () => {
  const formen = (typ: string) => new Set(bauteile(typ, 0.6, 0.6, 0.85).map((t) => t.form));
  const rollen = (typ: string) => new Set(bauteile(typ, 0.6, 0.6, 0.85).map((t) => t.rolle));

  // Korpus-/Geräte-Bauer der Küche: gerundete Kanten (rundbox) + genug Teile.
  const gerundet = [
    "unterschrank",
    "hochschrank",
    "haengeschrank",
    "spuele",
    "kochfeld",
    "eckschrank",
    "fuellstueck",
    "kuehlschrank",
    "geschirrspueler",
    "backofen",
    "mikrowelle",
    "dunstabzug",
    "waschmaschine",
    "tumbler",
  ];

  it("nutzt gerundete Boxen (rundbox) und ist klar mehrteilig (>=4 Teile)", () => {
    for (const typ of gerundet) {
      expect(formen(typ).has("rundbox"), `${typ} nutzt rundbox`).toBe(true);
      expect(bauteile(typ, 0.6, 0.6, 0.85).length, `${typ} >=4 Teile`).toBeGreaterThanOrEqual(4);
    }
  });

  it("verbaut Chrom für Griffe/Armaturen an Schränken und Geräten", () => {
    for (const typ of [
      "unterschrank",
      "haengeschrank",
      "spuele",
      "kochfeld",
      "eckschrank",
      "kuehlschrank",
      "geschirrspueler",
      "backofen",
      "mikrowelle",
      "dunstabzug",
      "waschmaschine",
      "tumbler",
    ]) {
      expect(rollen(typ).has("chrom"), `${typ} nutzt chrom`).toBe(true);
    }
  });

  it("gibt Glas-Flächen an Kochfeld, Backofen, Mikrowelle und Waschgeräten", () => {
    for (const typ of ["kochfeld", "backofen", "mikrowelle", "waschmaschine", "tumbler"]) {
      expect(rollen(typ).has("glas"), `${typ} hat Glas`).toBe(true);
    }
  });

  it("modelliert Spüle und Waschgeräte mit Torus (Armatur-Bogen bzw. Bullauge-Ring)", () => {
    for (const typ of ["spuele", "waschmaschine", "tumbler"]) {
      expect(formen(typ).has("torus"), `${typ} nutzt torus`).toBe(true);
    }
  });

  it("bleibt für alle Küchen-Bauer vollständig in der bbox (auch extreme Masse)", () => {
    const masse: [number, number, number][] = [
      [0.6, 0.6, 0.85],
      [0.15, 0.6, 0.85], // schmales Füllstück
      [0.6, 0.6, 2.0], // Hochschrank/Kühlschrank
      [0.9, 0.9, 0.9],
    ];
    for (const typ of gerundet) {
      for (const [w, d, h] of masse) {
        expect(passtInBbox(bauteile(typ, w, d, h), w, d, h), `${typ} ${w}×${d}×${h} in bbox`).toBe(
          true,
        );
      }
    }
  });
});

describe("Farbableitung – Chrom-Rolle", () => {
  it("leitet Chrom als hellen Metallton aus der Basis-/Ampelfarbe ab", () => {
    // Aus der Ampelfarbe abgeleitet → Status dominiert weiter (kein Eigenwert).
    expect(rolleFarbe("chrom", "#000000")).not.toBe("#000000");
    expect(rolleFarbe("chrom", "#808080")).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("MATERIAL_FARBE – Möbel-Materialfarben", () => {
  it("liefert für jeden Katalog-Typ eine gültige Farbe (Map oder Salbei-Fallback)", () => {
    for (const typ of KATALOG_TYPEN) {
      const f = materialFarbe(typ);
      expect(f, `${typ} hat eine Farbe`).toMatch(/^#[0-9a-f]{6}$/i);
      // Nicht kartierte Typen müssen exakt auf Salbei zurückfallen.
      if (!(typ in MATERIAL_FARBE)) {
        expect(f, `${typ} fällt auf Salbei zurück`).toBe(MATERIAL_FALLBACK);
      }
    }
  });

  it("gibt für unbekannte Typen den Salbei-Fallback zurück", () => {
    expect(materialFarbe("gibtsnicht")).toBe(MATERIAL_FALLBACK);
  });
});

describe("Farbableitung – Ampel bleibt führend", () => {
  it("nutzt für den Hauptkörper exakt die übergebene Ampelfarbe", () => {
    expect(rolleFarbe("koerper", "#c96f2e")).toBe("#c96f2e");
  });

  it("leitet Akzente nur heller/dunkler ab und lässt Ungültiges unverändert", () => {
    expect(mischen("#808080", 1)).toBe("#ffffff");
    expect(mischen("#808080", -1)).toBe("#000000");
    expect(mischen("#808080", 0)).toBe("#808080");
    expect(mischen("keinhex", 0.5)).toBe("keinhex");
  });
});
