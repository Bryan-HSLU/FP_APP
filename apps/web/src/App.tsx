import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh } from "three";

/** M0-Smoke-Szene: beweist nur, dass die three.js/r3f-Pipeline läuft.
 *  Wird ab M3 durch den echten Viewer (Raum + Plan) ersetzt. */
function DrehWuerfel() {
  const ref = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta;
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[1, 1, 1]} />
      {/* CI-Dunkelgrün (Corporate Identity, POC-Bauumfang) */}
      <meshStandardMaterial color="#1f4d3a" />
    </mesh>
  );
}

export function App() {
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#faf7f0" }}>
      <header style={{ position: "absolute", zIndex: 1, padding: 16, fontFamily: "sans-serif" }}>
        <strong>Future Planning</strong> – POC (M0)
      </header>
      <Canvas camera={{ position: [2, 2, 3] }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 2]} />
        <DrehWuerfel />
      </Canvas>
    </div>
  );
}
