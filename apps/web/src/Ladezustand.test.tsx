import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Ladezustand } from "./Ladezustand";

describe("Ladezustand (Render-Smoke)", () => {
  it("zeigt das FP-Logo-Signet pulsierend + Preset-Texte + unbestimmten Balken", () => {
    const html = renderToStaticMarkup(<Ladezustand variante="vorschlag" />);
    expect(html).toContain("/FP-Logo-Signet.png");
    expect(html).toContain("fp-piktogramm-puls");
    expect(html).toContain("Vorschlag wird erstellt");
    expect(html).toContain("Wir erstellen eine passende Raumvariante.");
    expect(html).toContain("fp-fortschrittsbalken");
    expect(html).toContain("fp-fortschrittsbalken-unbestimmt");
  });

  it("mit bekanntem Fortschritt: bestimmter Balken (feste Breite, keine Unbestimmt-Klasse)", () => {
    const html = renderToStaticMarkup(<Ladezustand variante="scan" fortschritt={40} />);
    expect(html).toContain("width:40%");
    expect(html).not.toContain("fp-fortschrittsbalken-unbestimmt");
  });

  it("freie Variante über piktogramm/titel/text (kein Preset)", () => {
    const html = renderToStaticMarkup(
      <Ladezustand piktogramm="kosten" titel="Kosten werden berechnet" text="Einen Moment." />,
    );
    expect(html).toContain("Kosten werden berechnet");
    expect(html).toContain("Einen Moment.");
  });
});
