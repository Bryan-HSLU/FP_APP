/** 3D-Viewer (M3, bewusst minimal): Raumhülle + Plan als Box-Platzhalter.
 *
 * Box-Platzhalter mit Auto-Upgrade (Schema-Spezifikation): Items ohne glTF
 * rendern als massstäbliche Box aus den Katalog-Massen, CI-eingefärbt nach
 * Prioritätsklasse. Auswahl per Klick; Bewegen/Rotieren macht App.tsx.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Shape } from "three";
import type { KatalogItem, Placement, Room } from "./api";

const FARBEN: Record<string, string> = {
  P1: "#1f4d3a", // CI-Dunkelgrün
  P2: "#5b8a72",
  P3: "#a3b9aa",
};
const FARBE_GEWAEHLT = "#c96f2e"; // CI-Orange
const FARBE_GESPERRT = "#7a7a7a";

function Boden({ room }: { room: Room }) {
  const shape = new Shape();
  const poly = room.shell.floor.polygon;
  const start = poly[0];
  if (!start) return null;
  shape.moveTo(start[0], start[1]);
  for (const p of poly.slice(1)) shape.lineTo(p[0], p[1]);
  shape.closePath();
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color="#e8e2d6" side={2} />
    </mesh>
  );
}

function Waende({ room }: { room: Room }) {
  return (
    <>
      {room.shell.walls.map((w) => {
        const dx = w.end[0] - w.start[0];
        const dz = w.end[1] - w.start[1];
        const laenge = Math.hypot(dx, dz);
        const wand = w as typeof w & { height?: number; thickness?: number };
        const hoehe = wand.height ?? 2.4;
        const dicke = wand.thickness ?? 0.1;
        return (
          <mesh
            key={w.id}
            position={[(w.start[0] + w.end[0]) / 2, hoehe / 2, (w.start[1] + w.end[1]) / 2]}
            rotation={[0, -Math.atan2(dz, dx), 0]}
          >
            <boxGeometry args={[laenge, hoehe, dicke]} />
            <meshStandardMaterial
              color={w.kind === "massiv" ? "#d8d2c4" : "#eeeeee"}
              transparent
              opacity={0.45}
            />
          </mesh>
        );
      })}
    </>
  );
}

function PlacementBox({
  placement,
  item,
  gewaehlt,
  onClick,
}: {
  placement: Placement;
  item: KatalogItem;
  gewaehlt: boolean;
  onClick: () => void;
}) {
  const { w, d, h } = item.masse;
  const y = (placement.mountHeight ?? 0) + h / 2;
  const farbe = gewaehlt
    ? FARBE_GEWAEHLT
    : placement.locked
      ? FARBE_GESPERRT
      : (FARBEN[item.priorityClass] ?? "#888888");
  return (
    <mesh
      position={[placement.pose.pos[0], y, placement.pose.pos[1]]}
      rotation={[0, (-placement.pose.yawDeg * Math.PI) / 180, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={farbe} />
    </mesh>
  );
}

export function Viewer3D({
  room,
  placements,
  catalog,
  gewaehltId,
  onSelect,
}: {
  room: Room;
  placements: Placement[];
  catalog: KatalogItem[];
  gewaehltId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const poly = room.shell.floor.polygon;
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return (
    <Canvas
      camera={{ position: [cx + 3, 3.2, cz + 3], fov: 50 }}
      onPointerMissed={() => onSelect(null)}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 6, 3]} intensity={0.8} />
      <Boden room={room} />
      <Waende room={room} />
      {placements.map((p) => {
        const item = byId.get(p.catalogItemId);
        if (!item) return null;
        return (
          <PlacementBox
            key={p.id}
            placement={p}
            item={item}
            gewaehlt={p.id === gewaehltId}
            onClick={() => onSelect(p.id)}
          />
        );
      })}
      <OrbitControls target={[cx, 0.8, cz]} maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  );
}
