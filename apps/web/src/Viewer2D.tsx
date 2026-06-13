/** 2D-Grundriss-Ansicht (M3-Politur): Plan von oben als SVG.
 *
 *  Macht Pläne normgerecht beurteilbar – Footprints sind nach der **Norm-Ampel**
 *  eingefärbt (verletzt/knapp/ok), Türschwenk und Öffnungen sichtbar. Footprint-
 *  Geometrie kommt aus `plan2d` (= footprint() von @fp/shared/rules), also exakt
 *  deckungsgleich mit Solver, Interpreter und 3D-Viewer.
 */
import { useRef, useState } from "react";
import type { Vec2 } from "@fp/shared/rules";
import type { KatalogItem, Placement, Room } from "./api";
import { computeTransform, footprintPoints, innwardNormal, toScreen, toWorld } from "./plan2d.ts";

const SIZE = 1000;
const PAD = 48;

const FARBEN: Record<string, string> = { P1: "#1f4d3a", P2: "#5b8a72", P3: "#a3b9aa" };
const FARBE_VERLETZT = "#c0392b";
const FARBE_KNAPP = "#e67e22";
const FARBE_GESPERRT = "#7a7a7a";
const FARBE_GEWAEHLT = "#c96f2e";

type Status = "verletzt" | "knapp";

function fuellfarbe(item: KatalogItem, placement: Placement, status: Status | undefined): string {
  if (status === "verletzt") return FARBE_VERLETZT;
  if (status === "knapp") return FARBE_KNAPP;
  if (placement.locked) return FARBE_GESPERRT;
  return FARBEN[item.priorityClass] ?? "#888888";
}

/** Türschwenk als robuste Polylinie (Viertelkreis von der Wand ins Innere). */
function schwenkPunkte(
  a: Vec2,
  breite: number,
  n: Vec2,
  u: Vec2,
  t: ReturnType<typeof computeTransform>,
): string {
  const dir = Math.sign(u[0] * n[1] - u[1] * n[0]) || 1; // Drehsinn u → n (Welt)
  const schritte = 8;
  const pts: string[] = [];
  for (let k = 0; k <= schritte; k++) {
    const w = (dir * (Math.PI / 2) * k) / schritte;
    const c = Math.cos(w);
    const s = Math.sin(w);
    // u um w drehen, mit Türbreite skaliert, an A angesetzt
    const wx = a[0] + (u[0] * c - u[1] * s) * breite;
    const wz = a[1] + (u[0] * s + u[1] * c) * breite;
    const [sx, sy] = toScreen([wx, wz], t);
    pts.push(`${sx.toFixed(1)},${sy.toFixed(1)}`);
  }
  return pts.join(" ");
}

function Oeffnung({
  opening,
  room,
  t,
}: {
  opening: Room["openings"][number];
  room: Room;
  t: ReturnType<typeof computeTransform>;
}) {
  const wall = room.shell.walls.find((w) => w.id === opening.hostWall);
  if (!wall) return null;
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const len = Math.hypot(dx, dz) || 1;
  const u: Vec2 = [dx / len, dz / len];
  const a: Vec2 = [wall.start[0] + u[0] * opening.offset, wall.start[1] + u[1] * opening.offset];
  const b: Vec2 = [a[0] + u[0] * opening.width, a[1] + u[1] * opening.width];
  const [ax, ay] = toScreen(a, t);
  const [bx, by] = toScreen(b, t);
  if (opening.type === "door") {
    const n = innwardNormal(wall.start, wall.end, room.shell.floor.polygon);
    return (
      <g>
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#faf7f0" strokeWidth={6} />
        <polyline
          points={schwenkPunkte(a, opening.width, n, u, t)}
          fill="none"
          stroke="#9aa6a0"
          strokeWidth={1.5}
        />
      </g>
    );
  }
  // Fenster: Lücke + dünne Parallele (Brüstung).
  const n = innwardNormal(wall.start, wall.end, room.shell.floor.polygon);
  const off = 4;
  return (
    <g>
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#faf7f0" strokeWidth={6} />
      <line
        x1={ax + n[0] * off}
        y1={ay + n[1] * off}
        x2={bx + n[0] * off}
        y2={by + n[1] * off}
        stroke="#6f8aa0"
        strokeWidth={2}
      />
    </g>
  );
}

export function Viewer2D({
  room,
  placements,
  catalog,
  gewaehltId,
  statusById,
  onSelect,
  onMove,
}: {
  room: Room;
  placements: Placement[];
  catalog: KatalogItem[];
  gewaehltId: string | null;
  statusById: Map<string, Status>;
  onSelect: (id: string | null) => void;
  /** Item per Drag verschieben (absolute Welt-Position). Fehlt → kein Drag. */
  onMove?: (id: string, world: [number, number]) => void;
}) {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const floor = room.shell.floor.polygon as Vec2[];
  const t = computeTransform(floor, SIZE, PAD);
  const floorPts = floor.map((p) => toScreen(p, t).join(",")).join(" ");

  const svgRef = useRef<SVGSVGElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Pointer-Event (Bildschirm) → Welt (x,z): via SVG-CTM in viewBox-Einheiten,
  // dann toWorld. So stimmt das Mapping unabhängig von der gerenderten Grösse.
  const pointerWelt = (e: { clientX: number; clientY: number }): Vec2 | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const lokal = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return toWorld([lokal.x, lokal.y], t);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width="100%"
      height="100%"
      style={{ background: "#faf7f0", display: "block", touchAction: "none" }}
      onClick={() => onSelect(null)}
      onPointerMove={(e) => {
        if (!dragId || !onMove) return;
        const w = pointerWelt(e);
        if (w) onMove(dragId, [w[0], w[1]]);
      }}
      onPointerUp={(e) => {
        if (!dragId) return;
        svgRef.current?.releasePointerCapture(e.pointerId);
        setDragId(null);
      }}
      role="img"
      aria-label="2D-Grundriss"
    >
      <polygon points={floorPts} fill="#efe9dc" stroke="none" />
      {room.shell.walls.map((w) => {
        const [x1, y1] = toScreen(w.start as Vec2, t);
        const [x2, y2] = toScreen(w.end as Vec2, t);
        const massiv = w.kind === "massiv";
        return (
          <line
            key={w.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={massiv ? "#3a3a33" : "#b9b3a4"}
            strokeWidth={massiv ? 5 : 2}
            strokeDasharray={massiv ? undefined : "8 6"}
            strokeLinecap="round"
          />
        );
      })}
      {room.openings.map((o) => (
        <Oeffnung key={o.id} opening={o} room={room} t={t} />
      ))}
      {placements.map((p) => {
        const item = byId.get(p.catalogItemId);
        if (!item) return null;
        const gewaehlt = p.id === gewaehltId;
        const wandobjekt = item.mount === "wand";
        const [lx, ly] = toScreen(p.pose.pos as Vec2, t);
        return (
          <g
            key={p.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(p.id);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(p.id);
              if (p.locked || !onMove) return;
              svgRef.current?.setPointerCapture(e.pointerId);
              setDragId(p.id);
            }}
            style={{ cursor: p.locked ? "pointer" : "grab" }}
          >
            <polygon
              points={footprintPoints(
                p.pose.pos as Vec2,
                item.masse.w,
                item.masse.d,
                p.pose.yawDeg,
                t,
              )}
              fill={fuellfarbe(item, p, statusById.get(p.id))}
              fillOpacity={wandobjekt ? 0.5 : 0.92}
              stroke={gewaehlt ? FARBE_GEWAEHLT : "#2c2c28"}
              strokeWidth={gewaehlt ? 4 : 1.5}
              strokeDasharray={wandobjekt ? "5 4" : undefined}
            />
            <text
              x={lx}
              y={ly}
              fontSize={13}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#fff"
              style={{ pointerEvents: "none" }}
            >
              {item.funktionsTyp}
            </text>
          </g>
        );
      })}
      <Legende />
    </svg>
  );
}

function Legende() {
  const rows: [string, string][] = [
    ["#1f4d3a", "P1 / ok"],
    ["#e67e22", "knapp"],
    ["#c0392b", "verletzt"],
    ["#7a7a7a", "gesperrt"],
  ];
  return (
    <g transform={`translate(${PAD}, ${SIZE - PAD - rows.length * 22})`}>
      {rows.map(([farbe, text], i) => (
        <g key={text} transform={`translate(0, ${i * 22})`}>
          <rect width={16} height={16} fill={farbe} rx={3} />
          <text x={22} y={13} fontSize={13} fill="#3a3a33">
            {text}
          </text>
        </g>
      ))}
    </g>
  );
}
