/** 3D-Rendering der Scene-Dressing-Ebene (rein visuelle Deko, getrennt vom Plan).
 *
 *  Konzept: FP_Kopf/vault/50_Umsetzung/Scene-Dressing-Konzept.md
 *
 *  Zwei Bausteine:
 *  - **Prozedurale Kits** (`DRESSING_BAUSAETZE`) im gleichen Box/Zylinder/Kugel-
 *    Muster wie {@link ./moebel3d.tsx} – Ursprung = bbox-Mitte, jedes Bauteil
 *    bleibt garantiert in der bbox (clampTeil). So braucht der Deko-Durchstich
 *    weder Assets noch Speicher.
 *  - **Auto-Upgrade auf echte glTF-Modelle:** trägt ein Deko-Objekt
 *    `assetStatus:"modeled"` + `gltfRef`, lädt {@link DressingObjekt3D} das Binary
 *    aus `/assets/dressing/<gltfRef>.glb` (Ursprung Mitte-unten) und ersetzt den
 *    Platzhalter – ohne Codeänderung. Upload-Konvention:
 *    `apps/web/public/assets/dressing/README.md`.
 *
 *  Deko ist **nicht auswählbar und nicht norm-relevant**: die Meshes haben kein
 *  Klick-Handling und deaktivieren das Raycasting, damit Auswahl/Ampel/Solver-
 *  Logik im Viewer völlig unberührt bleiben.
 */
import { RoundedBox, useGLTF } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import { Vector2 } from "three";
import type { DressingItem, KatalogItem, Plan, Room } from "./api";
import { sceneDressing, type DressingPlatzierung } from "./dressing";
import { dressingBauteile } from "./dressing3d-kits";
import { rolleFarbe, type Rolle, type Teil } from "./moebel3d.tsx";

// raycast=noop: Klicks gehen «durch» die Deko → Möbelauswahl/Deselektion bleiben.
const noRaycast = () => null;

/** Oberflächen-Physik je Rolle – spiegelt {@link ./moebel3d.tsx} (glas transparent,
 *  chrom poliert), damit Deko und Möbel denselben Material-Look tragen. */
function DressingMaterial({ rolle, farbwert }: { rolle: Rolle; farbwert: string }) {
  if (rolle === "glas") {
    return <meshStandardMaterial color={farbwert} transparent opacity={0.32} roughness={0.05} />;
  }
  if (rolle === "chrom") {
    return <meshStandardMaterial color={farbwert} metalness={0.6} roughness={0.14} />;
  }
  const roughness = rolle === "dunkel" ? 0.62 : rolle === "hell" ? 0.5 : 0.55;
  return <meshStandardMaterial color={farbwert} metalness={0.03} roughness={roughness} />;
}

/** Ein Bauteil als Mesh – Raycasting deaktiviert (Deko blockiert nie Auswahl).
 *  Deckt dieselben Primitive wie {@link ./moebel3d.tsx} ab (box/rundbox/zylinder/
 *  kugel/lathe/torus), damit die volumetrischen Deko-Kits vollständig rendern. */
function DressingTeilMesh({ teil, farbe }: { teil: Teil; farbe: string }) {
  const farbwert = rolleFarbe(teil.rolle, farbe);
  const material = <DressingMaterial rolle={teil.rolle} farbwert={farbwert} />;
  if (teil.form === "box") {
    return (
      <mesh position={teil.pos} raycast={noRaycast}>
        <boxGeometry args={teil.groesse} />
        {material}
      </mesh>
    );
  }
  if (teil.form === "rundbox") {
    const minHalb = Math.min(...teil.groesse) / 2;
    const radius = Math.max(0, Math.min(teil.radius, minHalb - 1e-4));
    if (radius < 1e-4) {
      return (
        <mesh position={teil.pos} raycast={noRaycast}>
          <boxGeometry args={teil.groesse} />
          {material}
        </mesh>
      );
    }
    return (
      <RoundedBox
        position={teil.pos}
        args={teil.groesse}
        radius={radius}
        smoothness={3}
        steps={1}
        raycast={noRaycast}
      >
        {material}
      </RoundedBox>
    );
  }
  if (teil.form === "zylinder") {
    return (
      <mesh position={teil.pos} raycast={noRaycast}>
        <cylinderGeometry args={[teil.rTop, teil.rBottom, teil.hoehe, 16]} />
        {material}
      </mesh>
    );
  }
  if (teil.form === "kugel") {
    return (
      <mesh position={teil.pos} raycast={noRaycast}>
        <sphereGeometry args={[teil.radius, 14, 10]} />
        {material}
      </mesh>
    );
  }
  if (teil.form === "lathe") {
    const punkte = teil.profil.map(([r, y]) => new Vector2(Math.max(0, r), y));
    return (
      <mesh position={teil.pos} raycast={noRaycast}>
        <latheGeometry args={[punkte, teil.segmente]} />
        {material}
      </mesh>
    );
  }
  const rot: [number, number, number] =
    teil.achse === "y" ? [Math.PI / 2, 0, 0] : teil.achse === "x" ? [0, Math.PI / 2, 0] : [0, 0, 0];
  return (
    <mesh position={teil.pos} rotation={rot} raycast={noRaycast}>
      <torusGeometry args={[teil.radius, teil.roehre, 16, 32]} />
      {material}
    </mesh>
  );
}

/** Prozedurale Deko (Platzhalter): Primitiv-Kit in der bbox der Deko-Masse. */
function DressingProzedural({ platz }: { platz: DressingPlatzierung }) {
  const { w, d, h } = platz.masse;
  const teile = dressingBauteile(platz.funktionsTyp, w, d, h);
  return (
    <>
      {teile.map((teil, i) => (
        <DressingTeilMesh key={i} teil={teil} farbe={platz.farbe} />
      ))}
    </>
  );
}

/** Echtes glTF-Modell (Auto-Upgrade). Ursprung Mitte-unten → um −h/2 versetzt,
 *  damit es wie das Primitiv-Kit um die bbox-Mitte platziert werden kann. */
function DressingGltf({ gltfRef, h }: { gltfRef: string; h: number }) {
  const { scene } = useGLTF(`/assets/dressing/${gltfRef}.glb`);
  const klon = useMemo(() => scene.clone(true), [scene]);
  return (
    <group position={[0, -h / 2, 0]}>
      <primitive object={klon} />
    </group>
  );
}

/** Ein Deko-Objekt an seiner Welt-Pose: echtes Modell falls vorhanden, sonst
 *  prozeduraler Platzhalter. Die Gruppe trägt Position (bbox-Mitte) und Yaw. */
function DressingObjekt3D({ platz }: { platz: DressingPlatzierung }) {
  const modelliert = platz.assetStatus === "modeled" && !!platz.gltfRef;
  return (
    <group position={platz.pos} rotation={[0, (-platz.yawDeg * Math.PI) / 180, 0]}>
      {modelliert && platz.gltfRef ? (
        <Suspense fallback={<DressingProzedural platz={platz} />}>
          <DressingGltf gltfRef={platz.gltfRef} h={platz.masse.h} />
        </Suspense>
      ) : (
        <DressingProzedural platz={platz} />
      )}
    </group>
  );
}

/**
 * Scene-Dressing-Ebene für den 3D-Viewer. Rechnet die Deko-Platzierungen
 * deterministisch aus (room, plan, catalog, styleProfile, seed) und rendert sie.
 * Der Plan wird nur GELESEN – die Ebene fliesst nie in placements/Report/LV.
 * `sichtbar=false` blendet sie komplett aus (Toggle «Deko»).
 */
export function DressingLayer3D({
  room,
  plan,
  catalog,
  styleProfile,
  dressingItems,
  sichtbar,
}: {
  room: Room;
  plan: Plan;
  catalog: KatalogItem[];
  styleProfile: { styleVector: Record<string, number> } | null;
  dressingItems: DressingItem[];
  sichtbar: boolean;
}) {
  const platzierungen = useMemo(
    () => sceneDressing(room, plan, catalog, styleProfile, dressingItems, plan.meta.seed),
    [room, plan, catalog, styleProfile, dressingItems],
  );
  if (!sichtbar) return null;
  return (
    <>
      {platzierungen.map((platz) => (
        <DressingObjekt3D key={platz.id} platz={platz} />
      ))}
    </>
  );
}
