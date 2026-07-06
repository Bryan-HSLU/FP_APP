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
import { materialFarbe, Moebel3D } from "./moebel3d.tsx";
import { THEME } from "./theme";

// Norm-Ampel-Statusfarben (identisch zu Viewer2D) – die Ampel dominiert die
// Materialfarbe: nur bei Status «ok» wird die Möbel-Materialfarbe genutzt.
const FARBE_VERLETZT = "#c0392b";
const FARBE_KNAPP = "#e67e22";
const FARBE_GEWAEHLT = THEME.orange; // CI-Orange
const FARBE_GESPERRT = "#7a7a7a";

type Status = "verletzt" | "knapp";

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
  status,
  onClick,
}: {
  placement: Placement;
  item: KatalogItem;
  gewaehlt: boolean;
  status: Status | undefined;
  onClick: () => void;
}) {
  const { w, d, h } = item.masse;
  const y = (placement.mountHeight ?? 0) + h / 2;
  // Ampel MUSS dominieren: Auswahl-Orange und die Norm-Statusfarben
  // (verletzt/knapp/gesperrt) schlagen die Materialfarbe. NUR bei Status «ok»
  // (kein verletzt/knapp, nicht gesperrt) zeigt das Möbel seine Materialfarbe
  // statt der bisherigen P-Klassen-Farbe.
  const farbe = gewaehlt
    ? FARBE_GEWAEHLT
    : status === "verletzt"
      ? FARBE_VERLETZT
      : status === "knapp"
        ? FARBE_KNAPP
        : placement.locked
          ? FARBE_GESPERRT
          : materialFarbe(item.funktionsTyp);
  // Gruppe trägt Pose + Auswahl/Klick 1:1 wie zuvor die Box; die Primitives von
  // Moebel3D sitzen im lokalen bbox-Raum (Ursprung = Box-Mitte) innerhalb der Gruppe.
  return (
    <group
      position={[placement.pose.pos[0], y, placement.pose.pos[1]]}
      rotation={[0, (-placement.pose.yawDeg * Math.PI) / 180, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Moebel3D
        funktionsTyp={item.funktionsTyp}
        modell3d={item.modell3d}
        w={w}
        d={d}
        h={h}
        farbe={farbe}
      />
    </group>
  );
}

export function Viewer3D({
  room,
  placements,
  catalog,
  gewaehltId,
  statusById,
  onSelect,
}: {
  room: Room;
  placements: Placement[];
  catalog: KatalogItem[];
  gewaehltId: string | null;
  /** Pro-Placement-Norm-Ampel (verletzt/knapp) – wie in Viewer2D. */
  statusById: Map<string, Status>;
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
            status={statusById.get(p.id)}
            onClick={() => onSelect(p.id)}
          />
        );
      })}
      <OrbitControls target={[cx, 0.8, cz]} maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  );
}
