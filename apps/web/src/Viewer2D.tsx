/** 2D-Grundriss-Ansicht v2: Plan von oben als SVG.
 *
 *  Macht Pläne normgerecht beurteilbar. Gegenüber v1 neu:
 *  - **Objektsymbole** (Architekten-Draufsicht) statt nur beschrifteter Boxen
 *    (`symbole2d`), gefärbt nach Norm-Ampel bzw. Materialfarbe.
 *  - **Wände mit echter Wandstärke** (gefüllte Polygone, `wallQuad`).
 *  - **Ebenen-Umschalter** (Beschriftung/Boxen/Masse/Ampel).
 *  - **Messwerkzeug** (zwei Klicks → Distanz, Snap auf Wand-Ecken).
 *  - **Direkte Interaktion**: gewähltes Objekt per Drag verschieben (5-cm-Raster)
 *    und über einen Rotations-Griff in 15°-Schritten drehen.
 *
 *  Footprint-Geometrie kommt aus `plan2d` (= `footprint()` von @fp/shared/rules),
 *  also exakt deckungsgleich mit Solver, Interpreter, Symbolen und 3D-Viewer.
 *  `interaktiv=false` (z.B. Schritt 3, Vorschau) rendert reine Anzeige ohne
 *  Werkzeugleiste und ohne Editier-Interaktion.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MouseEvent,
  type PointerEvent,
  type SetStateAction,
} from "react";
import { frontDir, type Vec2 } from "@fp/shared/rules";
import type { KatalogItem, Placement, Room } from "./api";
import { materialFarbe } from "./moebel3d";
import {
  computeTransform,
  distanz,
  footprintPoints,
  innwardNormal,
  naechsteEcke,
  rasten,
  toScreen,
  toWorld,
  wallQuad,
  wandEcken,
  yawAusZeiger,
} from "./plan2d.ts";
import { symbolScreenPrims } from "./symbole2d.ts";
import { THEME } from "./theme";

const SIZE = 1000;
const PAD = 48;
const WANDDICKE_FALLBACK = 0.1; // m, falls die Wand keine thickness trägt
const SNAP_ECKE = 0.15; // m, Snapping-Radius Messwerkzeug

const FARBE_VERLETZT = "#c0392b";
const FARBE_KNAPP = "#e67e22";
const FARBE_GESPERRT = "#7a7a7a";
const FARBE_GEWAEHLT = THEME.orange;
const FARBE_NEUTRAL = "#2c2c28";

type Status = "verletzt" | "knapp";

interface Ebenen {
  beschriftung: boolean;
  boxen: boolean;
  masse: boolean;
  ampel: boolean;
}

/** Strichfarbe eines Symbols: Materialfarbe, von der Ampel überstimmt. */
function strichfarbe(
  item: KatalogItem,
  placement: Placement,
  status: Status | undefined,
  ampelAn: boolean,
): string {
  if (ampelAn) {
    if (status === "verletzt") return FARBE_VERLETZT;
    if (status === "knapp") return FARBE_KNAPP;
    if (placement.locked) return FARBE_GESPERRT;
  }
  return materialFarbe(item.funktionsTyp);
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
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke={THEME.offwhite} strokeWidth={7} />
        <polyline
          points={schwenkPunkte(a, opening.width, n, u, t)}
          fill="none"
          stroke="#9aa6a0"
          strokeWidth={1.5}
        />
      </g>
    );
  }
  // Fenster: Lücke + dünne Doppellinie (Brüstung).
  const n = innwardNormal(wall.start, wall.end, room.shell.floor.polygon);
  const off = 4;
  return (
    <g>
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke={THEME.offwhite} strokeWidth={7} />
      <line
        x1={ax + n[0] * off}
        y1={ay + n[1] * off}
        x2={bx + n[0] * off}
        y2={by + n[1] * off}
        stroke="#6f8aa0"
        strokeWidth={2}
      />
      <line
        x1={ax - n[0] * off}
        y1={ay - n[1] * off}
        x2={bx - n[0] * off}
        y2={by - n[1] * off}
        stroke="#6f8aa0"
        strokeWidth={2}
      />
    </g>
  );
}

/** Symbol eines Placements in Bildschirm-Koordinaten (oder null → Box-Fallback). */
function ObjektSymbol({
  prims,
  farbe,
}: {
  prims: ReturnType<typeof symbolScreenPrims>;
  farbe: string;
}) {
  if (!prims) return null;
  return (
    <g fill="none" stroke={farbe} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round">
      {prims.map((p, i) => {
        const dash = p.dash ? "5 4" : undefined;
        if (p.kind === "circle") {
          return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} strokeDasharray={dash} />;
        }
        if (p.kind === "line") {
          return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} strokeDasharray={dash} />;
        }
        return <polygon key={i} points={p.points} strokeDasharray={dash} />;
      })}
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
  onRotate,
  interaktiv = false,
}: {
  room: Room;
  placements: Placement[];
  catalog: KatalogItem[];
  gewaehltId: string | null;
  statusById: Map<string, Status>;
  onSelect: (id: string | null) => void;
  /** Item per Drag verschieben (absolute Welt-Position). Fehlt → kein Drag. */
  onMove?: (id: string, world: [number, number]) => void;
  /** Item per Rotations-Griff drehen (absoluter Yaw in Grad). Fehlt → kein Griff. */
  onRotate?: (id: string, yawDeg: number) => void;
  /** Werkzeugleiste + Editier-Interaktion (Drag/Rotate/Messen). Default: aus. */
  interaktiv?: boolean;
}) {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const floor = room.shell.floor.polygon as Vec2[];
  const t = computeTransform(floor, SIZE, PAD);
  const floorPts = floor.map((p) => toScreen(p, t).join(",")).join(" ");

  const svgRef = useRef<SVGSVGElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [rotId, setRotId] = useState<string | null>(null);
  const bewegtRef = useRef(false);

  const [messModus, setMessModus] = useState(false);
  const [messPunkte, setMessPunkte] = useState<Vec2[]>([]);
  const [ebenen, setEbenen] = useState<Ebenen>({
    beschriftung: true,
    boxen: false,
    masse: true,
    ampel: true,
  });

  // Messwerkzeug/Interaktion enden bei Escape (und beim Verlassen von interaktiv).
  useEffect(() => {
    if (!interaktiv) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMessModus(false);
        setMessPunkte([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interaktiv]);

  // Pointer-Event (Bildschirm) → Welt (x,z): via SVG-CTM in viewBox-Einheiten,
  // dann toWorld. So stimmt das Mapping unabhängig von der gerenderten Grösse.
  const pointerWelt = (e: { clientX: number; clientY: number }): Vec2 | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const lokal = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return toWorld([lokal.x, lokal.y], t);
  };

  const ecken = wandEcken(room.shell.walls);

  const svgClick = (e: MouseEvent) => {
    if (messModus) {
      const w = pointerWelt(e);
      if (!w) return;
      const p = naechsteEcke(w, ecken, SNAP_ECKE);
      setMessPunkte((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
      return;
    }
    if (bewegtRef.current) {
      bewegtRef.current = false; // Klick nach Drag/Rotate: nicht abwählen.
      return;
    }
    onSelect(null);
  };

  const pointerMove = (e: PointerEvent) => {
    if (rotId && onRotate) {
      const w = pointerWelt(e);
      const p = placements.find((pl) => pl.id === rotId);
      if (w && p) {
        bewegtRef.current = true;
        onRotate(rotId, yawAusZeiger(p.pose.pos as Vec2, w, 15));
      }
      return;
    }
    if (dragId && onMove) {
      const w = pointerWelt(e);
      if (w) {
        bewegtRef.current = true;
        onMove(dragId, [rasten(w[0]), rasten(w[1])]);
      }
    }
  };

  const pointerUp = (e: PointerEvent) => {
    if (!dragId && !rotId) return;
    svgRef.current?.releasePointerCapture(e.pointerId);
    setDragId(null);
    setRotId(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {interaktiv && (
        <Werkzeugleiste
          ebenen={ebenen}
          setEbenen={setEbenen}
          messModus={messModus}
          onMessen={() => {
            setMessModus((m) => !m);
            setMessPunkte([]);
          }}
        />
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width="100%"
          height="100%"
          style={{
            background: THEME.offwhite,
            display: "block",
            touchAction: "none",
            cursor: messModus ? "crosshair" : "default",
          }}
          onClick={svgClick}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          role="img"
          aria-label="2D-Grundriss"
        >
          <polygon points={floorPts} fill="#efe9dc" stroke="none" />

          {/* Wände als gefüllte Polygone mit echter Wandstärke */}
          {room.shell.walls.map((w) => {
            const massiv = w.kind === "massiv";
            const dicke = (w as { thickness?: number }).thickness ?? WANDDICKE_FALLBACK;
            const pts = wallQuad(w.start as Vec2, w.end as Vec2, dicke)
              .map((p) => toScreen(p, t).join(","))
              .join(" ");
            return (
              <polygon
                key={w.id}
                points={pts}
                fill={massiv ? "#3a3a33" : "#c8c2b3"}
                stroke={massiv ? "#2c2c28" : "#b9b3a4"}
                strokeWidth={0.5}
                fillOpacity={massiv ? 1 : 0.6}
              />
            );
          })}

          {room.openings.map((o) => (
            <Oeffnung key={o.id} opening={o} room={room} t={t} />
          ))}

          {/* Wandlängen-Beschriftung (Ebene «Masse») */}
          {ebenen.masse &&
            room.shell.walls.map((w) => {
              const laenge = distanz(w.start as Vec2, w.end as Vec2);
              if (laenge < 0.2) return null;
              const mid: Vec2 = [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2];
              const n = innwardNormal(w.start as Vec2, w.end as Vec2, floor);
              const [mx, my] = toScreen([mid[0] + n[0] * 0.14, mid[1] + n[1] * 0.14], t);
              return (
                <text
                  key={`m-${w.id}`}
                  x={mx}
                  y={my}
                  fontSize={12}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={THEME.gruen}
                  stroke={THEME.offwhite}
                  strokeWidth={3}
                  paintOrder="stroke"
                  style={{ pointerEvents: "none" }}
                >
                  {laenge.toFixed(2)} m
                </text>
              );
            })}

          {/* Placements: Statusfüllung, Symbol/Box, Rahmen, Beschriftung */}
          <g style={{ pointerEvents: messModus ? "none" : "auto" }}>
            {placements.map((p) => {
              const item = byId.get(p.catalogItemId);
              if (!item) return null;
              const gewaehlt = p.id === gewaehltId;
              const wandobjekt = item.mount === "wand";
              const status = statusById.get(p.id);
              const [lx, ly] = toScreen(p.pose.pos as Vec2, t);
              const fp = footprintPoints(
                p.pose.pos as Vec2,
                item.masse.w,
                item.masse.d,
                p.pose.yawDeg,
                t,
              );
              const tint =
                ebenen.ampel && status === "verletzt"
                  ? FARBE_VERLETZT
                  : ebenen.ampel && status === "knapp"
                    ? FARBE_KNAPP
                    : "none";
              const zeigeRahmen = gewaehlt || ebenen.boxen;
              const prims = symbolScreenPrims(
                item.funktionsTyp,
                p.pose.pos as Vec2,
                item.masse.w,
                item.masse.d,
                p.pose.yawDeg,
                t,
              );
              return (
                <g
                  key={p.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!bewegtRef.current) onSelect(p.id);
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect(p.id);
                    if (!interaktiv || p.locked || !onMove) return;
                    bewegtRef.current = false;
                    svgRef.current?.setPointerCapture(e.pointerId);
                    setDragId(p.id);
                  }}
                  style={{ cursor: interaktiv && !p.locked ? "grab" : "pointer" }}
                >
                  {/* Statusfüllung (Ampel) – auch ohne Boxen-Ebene sichtbar */}
                  <polygon
                    points={fp}
                    fill={tint}
                    fillOpacity={tint === "none" ? 0 : 0.18}
                    stroke={zeigeRahmen ? (gewaehlt ? FARBE_GEWAEHLT : FARBE_NEUTRAL) : "none"}
                    strokeWidth={gewaehlt ? 3 : 1.2}
                    strokeDasharray={wandobjekt && zeigeRahmen ? "5 4" : undefined}
                  />
                  {prims ? (
                    <ObjektSymbol
                      prims={prims}
                      farbe={strichfarbe(item, p, status, ebenen.ampel)}
                    />
                  ) : (
                    // Fallback: bisherige beschriftete Box
                    <polygon
                      points={fp}
                      fill={strichfarbe(item, p, status, ebenen.ampel)}
                      fillOpacity={wandobjekt ? 0.4 : 0.75}
                      stroke="none"
                    />
                  )}
                  {ebenen.beschriftung && (
                    <text
                      x={lx}
                      y={ly}
                      fontSize={11}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={THEME.gruen}
                      stroke={THEME.offwhite}
                      strokeWidth={2.6}
                      paintOrder="stroke"
                      style={{ pointerEvents: "none" }}
                    >
                      {item.funktionsTyp}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* Rotations-Griff am gewählten Objekt */}
          {interaktiv && onRotate && !messModus && (
            <RotationsGriff
              placements={placements}
              byId={byId}
              gewaehltId={gewaehltId}
              t={t}
              onRotate={onRotate}
              onDown={(id, e) => {
                bewegtRef.current = false;
                svgRef.current?.setPointerCapture(e.pointerId);
                setRotId(id);
              }}
            />
          )}

          {/* Messwerkzeug-Overlay */}
          {messModus && <MessOverlay punkte={messPunkte} t={t} />}

          {ebenen.ampel && <Legende />}
        </svg>
      </div>
    </div>
  );
}

/** Rotations-Griff (kleiner Kreis vor dem Objekt): Drag = 15°-Raster,
 *  Doppelklick = +90°. Nutzt `frontDir` für die Griff-Position. */
function RotationsGriff({
  placements,
  byId,
  gewaehltId,
  t,
  onRotate,
  onDown,
}: {
  placements: Placement[];
  byId: Map<string, KatalogItem>;
  gewaehltId: string | null;
  t: ReturnType<typeof computeTransform>;
  onRotate: (id: string, yawDeg: number) => void;
  onDown: (id: string, e: PointerEvent) => void;
}) {
  const p = placements.find((pl) => pl.id === gewaehltId);
  if (!p || p.locked) return null;
  const item = byId.get(p.catalogItemId);
  if (!item) return null;
  const center = p.pose.pos as Vec2;
  const fd = frontDir(p.pose.yawDeg);
  const abstand = item.masse.d / 2 + 0.2; // Meter vor die Front
  const griffWelt: Vec2 = [center[0] + fd[0] * abstand, center[1] + fd[1] * abstand];
  const [cx, cy] = toScreen(center, t);
  const [gx, gy] = toScreen(griffWelt, t);
  return (
    <g style={{ cursor: "grab" }}>
      <line x1={cx} y1={cy} x2={gx} y2={gy} stroke={FARBE_GEWAEHLT} strokeWidth={1.5} />
      <circle
        cx={gx}
        cy={gy}
        r={8}
        fill={THEME.weiss}
        stroke={FARBE_GEWAEHLT}
        strokeWidth={2.5}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDown(p.id, e);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onRotate(p.id, (p.pose.yawDeg + 90) % 360);
        }}
      >
        <title>Drehen (ziehen = 15°, Doppelklick = +90°)</title>
      </circle>
    </g>
  );
}

function MessOverlay({ punkte, t }: { punkte: Vec2[]; t: ReturnType<typeof computeTransform> }) {
  const screen = punkte.map((p) => toScreen(p, t));
  const [a, b] = punkte;
  const [sa, sb] = screen;
  return (
    <g style={{ pointerEvents: "none" }}>
      {sa && sb && a && b && (
        <>
          <line
            x1={sa[0]}
            y1={sa[1]}
            x2={sb[0]}
            y2={sb[1]}
            stroke={FARBE_GEWAEHLT}
            strokeWidth={2}
          />
          <text
            x={(sa[0] + sb[0]) / 2}
            y={(sa[1] + sb[1]) / 2 - 8}
            fontSize={14}
            fontWeight={600}
            textAnchor="middle"
            fill={THEME.gruen}
            stroke={THEME.weiss}
            strokeWidth={3.2}
            paintOrder="stroke"
          >
            {distanz(a, b).toFixed(2)} m
          </text>
        </>
      )}
      {screen.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={4}
          fill={FARBE_GEWAEHLT}
          stroke={THEME.weiss}
          strokeWidth={1.5}
        />
      ))}
    </g>
  );
}

function Werkzeugleiste({
  ebenen,
  setEbenen,
  messModus,
  onMessen,
}: {
  ebenen: Ebenen;
  setEbenen: Dispatch<SetStateAction<Ebenen>>;
  messModus: boolean;
  onMessen: () => void;
}) {
  const toggles: [keyof Ebenen, string][] = [
    ["beschriftung", "Beschriftung"],
    ["boxen", "Boxen"],
    ["masse", "Masse"],
    ["ampel", "Ampel"],
  ];
  const knopf = (aktiv: boolean): CSSProperties => ({
    borderRadius: 999,
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
    border: `1px solid ${aktiv ? THEME.gruen : THEME.salbei}`,
    background: aktiv ? THEME.gruen : "#fff",
    color: aktiv ? "#fff" : THEME.salbei,
  });
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        padding: "0 0 8px",
        alignItems: "center",
      }}
    >
      {toggles.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setEbenen((e) => ({ ...e, [key]: !e[key] }))}
          style={knopf(ebenen[key])}
          aria-pressed={ebenen[key]}
        >
          {label}
        </button>
      ))}
      <span
        style={{ width: 1, height: 20, background: THEME.salbei, opacity: 0.4, margin: "0 2px" }}
      />
      <button
        type="button"
        onClick={onMessen}
        style={{
          ...knopf(messModus),
          border: `1px solid ${messModus ? THEME.orange : THEME.salbei}`,
          background: messModus ? THEME.orange : "#fff",
          color: messModus ? "#fff" : THEME.salbei,
        }}
        aria-pressed={messModus}
      >
        📏 Messen
      </button>
    </div>
  );
}

function Legende() {
  const rows: [string, string][] = [
    [THEME.gruen, "P1 / ok"],
    [FARBE_KNAPP, "knapp"],
    [FARBE_VERLETZT, "verletzt"],
    [FARBE_GESPERRT, "gesperrt"],
  ];
  return (
    <g
      transform={`translate(${PAD}, ${SIZE - PAD - rows.length * 22})`}
      style={{ pointerEvents: "none" }}
    >
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
