import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { KatalogItem, Placement, Room } from "./api";
import { Viewer2D } from "./Viewer2D.tsx";

// Minimaler 3.0×2.4-Raum mit einer Tür – nur die von Viewer2D gelesenen Felder.
const room = {
  shell: {
    walls: [
      { id: "w1", start: [0, 0], end: [3, 0], kind: "massiv", openings: ["d1"] },
      { id: "w2", start: [3, 0], end: [3, 2.4], kind: "massiv", openings: [] },
      { id: "w3", start: [3, 2.4], end: [0, 2.4], kind: "massiv", openings: [] },
      { id: "w4", start: [0, 2.4], end: [0, 0], kind: "massiv", openings: [] },
    ],
    floor: {
      polygon: [
        [0, 0],
        [3, 0],
        [3, 2.4],
        [0, 2.4],
      ],
    },
  },
  openings: [{ id: "d1", type: "door", hostWall: "w1", offset: 1.9, width: 0.8 }],
} as unknown as Room;

const catalog = [
  {
    id: "c1",
    funktionsTyp: "wc",
    masse: { w: 0.4, d: 0.6, h: 0.4 },
    mount: "boden",
    priorityClass: "P1",
  },
] as unknown as KatalogItem[];

const placements: Placement[] = [
  {
    id: "p1",
    catalogItemId: "c1",
    pose: { pos: [1.5, 1.2], yawDeg: 0 },
    gewerk: "sanitaer",
    locked: false,
    source: "solver",
  },
];

describe("Viewer2D (Render-Smoke)", () => {
  it("rendert Hülle, Wände, Footprint, Label und die Norm-Status-Farbe", () => {
    const html = renderToStaticMarkup(
      <Viewer2D
        room={room}
        placements={placements}
        catalog={catalog}
        gewaehltId={null}
        statusById={new Map([["p1", "verletzt"]])}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("<line"); // Wände
    expect(html).toContain("<polygon"); // Boden + Footprint
    expect(html).toContain("wc"); // Label des Objekts
    expect(html).toContain("#c0392b"); // «verletzt»-Farbe angewendet
  });

  it("ohne Plan keine Footprints, aber die Hülle steht", () => {
    const html = renderToStaticMarkup(
      <Viewer2D
        room={room}
        placements={[]}
        catalog={catalog}
        gewaehltId={null}
        statusById={new Map()}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("<polygon"); // Bodenfläche
    expect(html).not.toContain("wc");
  });
});
