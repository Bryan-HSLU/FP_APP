/** Stil-UI (M4): Weg A Swipen · Weg B Preset per Bild-Klick · Smart Spider.
 *
 *  Reine Achsen statt benannter Stile (ADR-0006); Bilder sind raumtyp-gebunden
 *  und kommen aus data/images/ (SVG-Platzhalter, bis Bryan echte Fotos taggt).
 */
import { useEffect, useState } from "react";

export interface BildItem {
  id: string;
  bildRef: string;
  achsenTags: Record<string, number>;
  palette: string[];
  istPreset: boolean;
}

export interface Achse {
  id: string;
  negativPol: string;
  positivPol: string;
}

export interface Stilprofil {
  id: string;
  styleVector: Record<string, number>;
  derivedRequirements: string[];
  palette: string[];
  meta: { method: string; likes: number; dislikes: number; sampleSufficient: boolean };
}

/** Radar über die Stilachsen: Wert −1…+1 → Radius 0…1 (0.5 = neutral). */
export function SmartSpider({
  vektor,
  achsen,
}: {
  vektor: Record<string, number>;
  achsen: Achse[];
}) {
  const n = achsen.length;
  const cx = 110;
  const cy = 110;
  const r = 80;
  const punkt = (i: number, wert: number): string => {
    const winkel = (2 * Math.PI * i) / n - Math.PI / 2;
    const radius = r * (0.5 + wert / 2);
    return `${cx + radius * Math.cos(winkel)},${cy + radius * Math.sin(winkel)}`;
  };
  return (
    <svg width={220} height={220} role="img" aria-label="Stilprofil-Radar">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={cx} cy={cy} r={r * f} fill="none" stroke="#ddd" />
      ))}
      <polygon
        points={achsen.map((a, i) => punkt(i, vektor[a.id] ?? 0)).join(" ")}
        fill="#1f4d3a55"
        stroke="#1f4d3a"
        strokeWidth={2}
      />
      {achsen.map((a, i) => {
        const winkel = (2 * Math.PI * i) / n - Math.PI / 2;
        const lx = cx + (r + 16) * Math.cos(winkel);
        const ly = cy + (r + 16) * Math.sin(winkel);
        return (
          <text key={a.id} x={lx} y={ly} fontSize={9} textAnchor="middle" fill="#444">
            {(vektor[a.id] ?? 0) >= 0 ? a.positivPol : a.negativPol}
          </text>
        );
      })}
    </svg>
  );
}

const stil = {
  overlay: {
    position: "fixed" as const,
    inset: 0,
    background: "#000000aa",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  karte: {
    background: "white",
    borderRadius: 12,
    padding: 20,
    width: 460,
    maxWidth: "92vw",
    textAlign: "center" as const,
  },
  knopf: {
    border: "none",
    borderRadius: 8,
    padding: "10px 22px",
    fontSize: 18,
    cursor: "pointer",
    color: "white",
  },
};

/** Swipe-Dialog: Bild für Bild liken/ablehnen; Presets als Abkürzung. */
export function StilSwipe({
  bilder,
  onFertig,
  onAbbruch,
}: {
  bilder: BildItem[];
  onFertig: (likes: string[], dislikes: string[], presetId: string | null) => void;
  onAbbruch: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [likes, setLikes] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);
  const presets = bilder.filter((b) => b.istPreset);
  const bild = bilder[index];

  const bewerte = (gefaellt: boolean) => {
    if (!bild) return;
    if (gefaellt) setLikes([...likes, bild.id]);
    else setDislikes([...dislikes, bild.id]);
    if (index + 1 >= bilder.length) {
      onFertig(
        gefaellt ? [...likes, bild.id] : likes,
        gefaellt ? dislikes : [...dislikes, bild.id],
        null,
      );
    } else {
      setIndex(index + 1);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") bewerte(true);
      if (e.key === "ArrowLeft") bewerte(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  if (!bild) return null;
  return (
    <div style={stil.overlay} onClick={onAbbruch}>
      <div style={stil.karte} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, color: "#1f4d3a" }}>
          Was gefällt dir? ({index + 1}/{bilder.length})
        </h3>
        <img
          src={`/api/bilder/${bild.bildRef}`}
          alt="Stil-Beispiel"
          style={{ width: "100%", borderRadius: 8 }}
        />
        <div style={{ display: "flex", gap: 16, justifyContent: "center", margin: "14px 0" }}>
          <button style={{ ...stil.knopf, background: "#8a8a8a" }} onClick={() => bewerte(false)}>
            👎 eher nicht
          </button>
          <button style={{ ...stil.knopf, background: "#1f4d3a" }} onClick={() => bewerte(true)}>
            👍 gefällt mir
          </button>
        </div>
        {presets.length > 0 && index === 0 && (
          <p style={{ fontSize: 12 }}>
            Abkürzung – Preset wählen:{" "}
            {presets.map((p) => (
              <button
                key={p.id}
                style={{
                  ...stil.knopf,
                  background: "#c96f2e",
                  fontSize: 12,
                  padding: "4px 10px",
                  margin: 2,
                }}
                onClick={() => onFertig([], [], p.id)}
              >
                {p.bildRef.split("-").slice(2).join(" ").replace(".svg", "")}
              </button>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
