/** 3D-Bausteine der Raumhülle: Türen, Fenster, Wände-mit-Löchern + prozedurale
 * Boden-/Wandtexturen (three/r3f). Die reine Geometrie kommt aus `raum3d.ts`,
 * die Stil→Oberfläche-Ableitung aus `oberflaechen.ts` – hier wird nur gerendert.
 *
 * Texturen werden als **prozedurale CanvasTexture** erzeugt (kein externes Asset,
 * keine neue Dependency – gleiche Linie wie die Primitiv-Möbel in `moebel3d.tsx`).
 * In Tests (Node, kein `document`) liefern die Textur-Helfer `null`; die Materialien
 * fallen dann auf die Grundfarbe zurück.
 */
import { useMemo } from "react";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import type { BodenSpez, FlaechenLook, WandZonen } from "./oberflaechen";
import { clipZone, oeffnungsPose, wandSegmente, type WandOeffnung, type WandRef } from "./raum3d";

// Holz-/Metalltöne für Tür & Fenster – bewusst fixe, warme bzw. neutrale Töne
// (die Öffnungen sollen unabhängig vom Stilprofil immer «real» wirken).
const HOLZ = "#a9784f";
const HOLZ_DUNKEL = "#7c5636";
const GRIFF = "#3a3a3a";
const FENSTER_RAHMEN = "#e6e6e8";
const GLAS = "#aecbe0";

/** Türblatt (~20° offen) in Zarge mit Griff. Lokalraum: x∈[-b/2,b/2], y∈[0,hoehe]. */
export function Tuer3D({ breite, hoehe, dicke }: { breite: number; hoehe: number; dicke: number }) {
  const rahmen = Math.min(0.06, breite * 0.12);
  const tiefe = dicke + 0.02; // minimal dicker als die Wand → sichtbar im Loch
  const innerB = breite - 2 * rahmen - 0.01;
  const innerH = hoehe - rahmen;
  const hingeX = -breite / 2 + rahmen;
  return (
    <group>
      {/* Zarge: links, rechts, oben */}
      <mesh position={[-breite / 2 + rahmen / 2, hoehe / 2, 0]}>
        <boxGeometry args={[rahmen, hoehe, tiefe]} />
        <meshStandardMaterial color={HOLZ_DUNKEL} />
      </mesh>
      <mesh position={[breite / 2 - rahmen / 2, hoehe / 2, 0]}>
        <boxGeometry args={[rahmen, hoehe, tiefe]} />
        <meshStandardMaterial color={HOLZ_DUNKEL} />
      </mesh>
      <mesh position={[0, hoehe - rahmen / 2, 0]}>
        <boxGeometry args={[breite, rahmen, tiefe]} />
        <meshStandardMaterial color={HOLZ_DUNKEL} />
      </mesh>
      {/* Türblatt an der linken Kante aufgehängt und ~20° geöffnet */}
      <group position={[hingeX, 0, 0]} rotation={[0, -0.35, 0]}>
        <mesh position={[innerB / 2, innerH / 2, 0]}>
          <boxGeometry args={[innerB, innerH, tiefe * 0.5]} />
          <meshStandardMaterial color={HOLZ} />
        </mesh>
        {/* Griff nahe der freien Kante */}
        <mesh position={[innerB - 0.06, innerH * 0.48, tiefe * 0.4]}>
          <boxGeometry args={[0.04, 0.04, 0.08]} />
          <meshStandardMaterial color={GRIFF} />
        </mesh>
      </group>
    </group>
  );
}

/** Fenster: Rahmen + getönte Glasfläche + Mittelsprosse. Lokalraum y∈[0,hoehe]. */
export function Fenster3D({
  breite,
  hoehe,
  dicke,
}: {
  breite: number;
  hoehe: number;
  dicke: number;
}) {
  const rahmen = Math.min(0.06, breite * 0.1);
  const tiefe = dicke + 0.02;
  const innerB = breite - 2 * rahmen;
  const innerH = hoehe - 2 * rahmen;
  return (
    <group>
      {/* Rahmen umlaufend */}
      <mesh position={[-breite / 2 + rahmen / 2, hoehe / 2, 0]}>
        <boxGeometry args={[rahmen, hoehe, tiefe]} />
        <meshStandardMaterial color={FENSTER_RAHMEN} />
      </mesh>
      <mesh position={[breite / 2 - rahmen / 2, hoehe / 2, 0]}>
        <boxGeometry args={[rahmen, hoehe, tiefe]} />
        <meshStandardMaterial color={FENSTER_RAHMEN} />
      </mesh>
      <mesh position={[0, hoehe - rahmen / 2, 0]}>
        <boxGeometry args={[breite, rahmen, tiefe]} />
        <meshStandardMaterial color={FENSTER_RAHMEN} />
      </mesh>
      <mesh position={[0, rahmen / 2, 0]}>
        <boxGeometry args={[breite, rahmen, tiefe]} />
        <meshStandardMaterial color={FENSTER_RAHMEN} />
      </mesh>
      {/* Mittelsprosse (vertikal) */}
      <mesh position={[0, hoehe / 2, 0]}>
        <boxGeometry args={[rahmen * 0.6, innerH, tiefe * 0.6]} />
        <meshStandardMaterial color={FENSTER_RAHMEN} />
      </mesh>
      {/* Glas */}
      <mesh position={[0, hoehe / 2, 0]}>
        <boxGeometry args={[innerB, innerH, tiefe * 0.2]} />
        <meshStandardMaterial color={GLAS} transparent opacity={0.25} />
      </mesh>
    </group>
  );
}

/** Ein Wand-Quader (Segment) im Wand-Lokalraum als eigenes Mesh – kapselt die
 *  optionale Fliesentextur samt segment-spezifischer Wiederholung (useMemo). */
function WandSegment({
  position,
  size,
  farbe,
  opacity,
  textur,
  tileMasse,
}: {
  position: [number, number, number];
  size: [number, number, number];
  farbe: string;
  opacity: number;
  textur: CanvasTexture | null;
  tileMasse: number;
}) {
  const [w, h] = size;
  const map = useMemo(() => {
    if (!textur) return null;
    // boxGeometry-UVs sind 0..1 pro Fläche → Wiederholung ergibt sich aus
    // Segmentgrösse / Fliesenmass. Klon je Segment, damit repeat pro Mesh gilt.
    const t = textur.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, w / tileMasse), Math.max(1, h / tileMasse));
    return t;
  }, [textur, w, h, tileMasse]);
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={map ? "#ffffff" : farbe}
        map={map ?? undefined}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

/**
 * Eine Wand als Menge massiver Segment-Quader (Türen/Fenster bleiben als Löcher
 * frei) plus die eingesetzten Tür-/Fensterobjekte an ihrer Weltpose.
 *
 * Zwei Höhenzonen ({@link WandZonen}): unten [0, zone.hoeheM] im Material der
 * Zone (etwas opaker, damit das Muster lesbar ist), darüber/dahinter der
 * Basis-Look. So bilden sich Bad-Fliesensockel (halbhoch), Sockelleisten
 * (sockel) und raumhohe Akzentwände (voll = Zone deckt die ganze Höhe) mit
 * derselben Logik ab. Bewusst per Höhen-Clip statt echtem CSG-Zonenschnitt:
 * robust, dependency-frei, Löcher bleiben korrekt.
 */
export function WandMitOeffnungen({
  wand,
  oeffnungen,
  basis,
  zone,
}: {
  wand: WandRef & { height?: number; thickness?: number; kind?: string };
  oeffnungen: WandOeffnung[];
} & WandZonen) {
  const dx = wand.end[0] - wand.start[0];
  const dz = wand.end[1] - wand.start[1];
  const laenge = Math.hypot(dx, dz);
  const hoehe = wand.height ?? 2.4;
  const dicke = wand.thickness ?? 0.1;
  const yaw = Math.atan2(dz, dx);
  const mid: [number, number, number] = [
    (wand.start[0] + wand.end[0]) / 2,
    0,
    (wand.start[1] + wand.end[1]) / 2,
  ];
  const alle = wandSegmente(laenge, hoehe, oeffnungen);
  const zoneH = zone ? Math.min(zone.hoeheM, hoehe) : 0;
  const unten = zoneH > 0 ? clipZone(alle, 0, zoneH) : [];
  const oben = zoneH > 0 ? clipZone(alle, zoneH, hoehe) : alle;
  // Texturen je Look memoisieren (Wände unterscheiden sich jetzt pro Wand).
  const basisTex = useMemo(
    () => flaechenTextur(basis),
    [basis.muster, basis.farbe, basis.fugenfarbe],
  );
  const zoneTex = useMemo(
    () => (zone ? flaechenTextur(zone.look) : null),
    [zone?.look.muster, zone?.look.farbe, zone?.look.fugenfarbe],
  );

  const segMesh = (
    q: { x: number; y: number; w: number; h: number },
    i: number,
    look: FlaechenLook,
    opacity: number,
    textur: CanvasTexture | null,
  ) => (
    <WandSegment
      key={`s${textur ? "f" : "u"}-${i}`}
      position={[q.x - laenge / 2, q.y, 0]}
      size={[q.w, q.h, dicke]}
      farbe={look.farbe}
      opacity={opacity}
      textur={textur}
      tileMasse={look.masse_m}
    />
  );

  return (
    <group>
      {/* Wand-Segmente im Wand-Lokalraum (gedreht wie die frühere Wand-Box). */}
      <group position={mid} rotation={[0, -yaw, 0]}>
        {oben.map((q, i) => segMesh(q, i, basis, 0.5, basisTex))}
        {zone && unten.map((q, i) => segMesh(q, i, zone.look, 0.75, zoneTex))}
      </group>
      {/* Tür-/Fensterobjekte an ihrer Weltpose (identische Gruppe, keine Vorrotation). */}
      {oeffnungen.map((o, i) => {
        const { mitte, yawRad } = oeffnungsPose(wand, o);
        const istTuer = o.type === "door";
        return (
          <group
            key={`o-${i}`}
            position={[mitte[0], istTuer ? 0 : o.sill, mitte[1]]}
            rotation={[0, -yawRad, 0]}
          >
            {istTuer ? (
              <Tuer3D breite={o.width} hoehe={o.height} dicke={dicke} />
            ) : (
              <Fenster3D breite={o.width} hoehe={o.height} dicke={dicke} />
            )}
          </group>
        );
      })}
    </group>
  );
}

// ── Prozedurale Texturen (offscreen canvas) ────────────────────────────────
// Guard: ohne DOM (Tests) → null, Material nutzt dann die Grundfarbe.

function neueCanvas(
  size = 256,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return { canvas, ctx };
}

function alsTextur(canvas: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Zeichnet ein kachelbares Muster in `ctx` (0…s). Gemeinsame Basis für Boden-
 * und Wandtexturen, damit alle Looks aus demselben Generator kommen. Rückgabe
 * `false` = uni (kein Muster → Aufrufer liefert `null`, Material nutzt die Farbe).
 */
function zeichneMuster(
  ctx: CanvasRenderingContext2D,
  muster: FlaechenLook["muster"],
  farbe: string,
  fugenfarbe: string,
  s: number,
): boolean {
  if (muster === "uni") return false;
  ctx.fillStyle = farbe;
  ctx.fillRect(0, 0, s, s);
  if (muster === "parkett" || muster === "holz") {
    // Dielen/Lamellen: durchgehende Fuge unten + versetzte Stossfuge → tileable.
    const g = Math.max(2, s * 0.02);
    ctx.fillStyle = fugenfarbe;
    ctx.fillRect(0, s - g, s, g); // Längsfuge (Dielenkante)
    ctx.fillRect(s * 0.5 - g / 2, 0, g, s); // Stossfuge
    ctx.strokeStyle = fugenfarbe; // dezente Maserung
    ctx.globalAlpha = 0.12;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (s / 4) * i);
      ctx.lineTo(s, (s / 4) * i);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    // fliesen / stein: Fugenraster (rechts + unten → beim Kacheln durchgehend).
    const g = Math.max(2, s * 0.04);
    ctx.fillStyle = fugenfarbe;
    ctx.fillRect(s - g, 0, g, s);
    ctx.fillRect(0, s - g, s, g);
  }
  return true;
}

/**
 * Bodentextur je Muster. `repeat` wird gesetzt (Fläche/Mass): shapeGeometry-UVs
 * liegen in Metern, daher repeat = 1/masse → eine Kachel je `masse_m`.
 */
export function bodenTextur(spez: BodenSpez): CanvasTexture | null {
  const c = neueCanvas(256);
  if (!c) return null;
  if (!zeichneMuster(c.ctx, spez.muster, spez.grundfarbe, spez.fugenfarbe, 256)) return null;
  const tex = alsTextur(c.canvas);
  const rep = 1 / Math.max(0.05, spez.masse_m);
  tex.repeat.set(rep, rep);
  return tex;
}

/**
 * Wand-/Zonentextur aus einem {@link FlaechenLook}. Kein `repeat` – die
 * Wiederholung setzt {@link WandSegment} je Segment aus `tileMasse`.
 */
export function flaechenTextur(look: FlaechenLook): CanvasTexture | null {
  const c = neueCanvas(256);
  if (!c) return null;
  if (!zeichneMuster(c.ctx, look.muster, look.farbe, look.fugenfarbe, 256)) return null;
  return alsTextur(c.canvas);
}
