import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { KatalogItem } from "./api";
import { ObjektInfoPanel, stilNaehe } from "./ObjektInfoPanel";

describe("stilNaehe", () => {
  it("identische Ausrichtung → 1, gegensätzliche → 0", () => {
    expect(stilNaehe({ warm: 1, hell: 0.5 }, { warm: 1, hell: 0.5 })).toBeCloseTo(1, 6);
    expect(stilNaehe({ warm: 1 }, { warm: -1 })).toBeCloseTo(0, 6);
  });

  it("nur gemeinsame Achsen zählen; ohne Schnittmenge → null", () => {
    expect(stilNaehe({ warm: 1 }, { hell: 1 })).toBeNull();
    // orthogonal (kein gemeinsamer Beitrag) → 0.5 (Cosinus 0)
    expect(stilNaehe({ warm: 1, hell: 0 }, { warm: 0, hell: 1 })).toBeCloseTo(0.5, 6);
  });
});

const item = (id: string, name: string): KatalogItem =>
  ({
    id,
    name,
    funktionsTyp: "lavabo",
    masse: { w: 0.6, d: 0.5, h: 0.85 },
    priorityClass: "P2",
    achsenTags: { warm: 0.4 },
    preis: { value: 480, currency: "CHF" },
  }) as unknown as KatalogItem;

describe("ObjektInfoPanel (Render-Smoke)", () => {
  it("zeigt Kosten und Wechsel-Alternativen mit Symbol-Thumbnail", () => {
    const html = renderToStaticMarkup(
      <ObjektInfoPanel
        item={item("a", "Lavabo A")}
        alternativen={[item("b", "Lavabo B")]}
        stilprofil={{
          id: "s1",
          styleVector: { warm: 0.8 },
          derivedRequirements: [],
          palette: [],
          meta: { method: "swipe", likes: 1, dislikes: 0, sampleSufficient: true },
        }}
        onTausch={() => {}}
      />,
    );
    expect(html).toContain("Kosten");
    expect(html).toContain("Lavabo B"); // Alternative
    expect(html).toContain("<svg"); // Symbol-Thumbnail
    expect(html).toContain("%"); // Stil-Match-Anzeige
  });
});
