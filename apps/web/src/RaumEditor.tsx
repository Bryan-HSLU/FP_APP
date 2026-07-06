/** Manueller Raum-Editor (dritte Erstellungsvariante, Brain: Raum-Editor-Manuell).
 *
 *  Formulargetriebene Eingabe von Form, Massen, Öffnungen und Anschlüssen mit
 *  SVG-Live-Vorschau (Draufsicht x/z). Ergebnis = schema-valides Raummodell,
 *  das per `onFertig` in den bestehenden Klickpfad (wie Scan/Sample) geht.
 *
 *  Reine Bau-Logik liegt in raumbau.ts (getestet); diese Datei ist nur UI.
 *  Die toScreen-Mathematik wird aus plan2d wiederverwendet (Solver-Konvention).
 */
import { useMemo, useRef, useState } from "react";
import type { Vec2 } from "@fp/shared/rules";
import { computeTransform, toScreen, toWorld } from "./plan2d.ts";
import {
  anschlussKuerzel,
  baueRaummodell,
  fehlendeAnschluesse,
  grundrissPunkte,
  OEFFNUNG_DEFAULT,
  pruefeOeffnung,
  RAUMHOEHE_DEFAULT,
  wandLaenge,
  type Anschlusstyp,
  type FixpunktSpec,
  type Grundform,
  type LFormParams,
  type OeffnungsSpec,
  type Raummodell,
  type RaumTyp,
} from "./raumbau";

const SIZE = 460;
const PAD = 56;

const FARBE_TUER = "#c96f2e";
const FARBE_FENSTER = "#2e6fc9";
const FARBE_WAND = "#1f4d3a";
const FARBE_FIX = "#8a2ec9";

const ANSCHLUSS_TYPEN: Anschlusstyp[] = ["wasser", "abwasser", "elektro", "starkstrom", "lueftung"];

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
    width: 980,
    maxWidth: "94vw",
    maxHeight: "92vh",
    overflowY: "auto" as const,
    display: "grid",
    gridTemplateColumns: `${SIZE}px minmax(0, 1fr)`,
    gap: 20,
    fontFamily: "system-ui, sans-serif",
  },
  knopf: {
    background: "#c96f2e",
    color: "white",
    border: "none",
    borderRadius: 6,
    padding: "6px 12px",
    cursor: "pointer",
  },
  feld: { width: 70 },
  zeile: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap" as const,
    marginBottom: 6,
  },
} as const;

/** Aktives Werkzeug: bestimmt, was ein Klick auf eine Wand erzeugt. */
type Werkzeug =
  | { art: "keins" }
  | { art: "tuer" }
  | { art: "fenster" }
  | { art: "fix"; typ: Anschlusstyp };

interface Wand {
  start: Vec2;
  end: Vec2;
  laenge: number;
}

/** Projektion eines Welt-Punkts auf das Wand-Segment → {offset ab Start, Abstand}. */
function projiziere(punkt: Vec2, wand: Wand): { offset: number; dist: number } {
  const dx = wand.end[0] - wand.start[0];
  const dz = wand.end[1] - wand.start[1];
  const len2 = dx * dx + dz * dz || 1;
  let t = ((punkt[0] - wand.start[0]) * dx + (punkt[1] - wand.start[1]) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = wand.start[0] + dx * t;
  const pz = wand.start[1] + dz * t;
  return { offset: t * wand.laenge, dist: Math.hypot(punkt[0] - px, punkt[1] - pz) };
}

/** Nächste Wand zu einem Welt-Klick (oder null, wenn zu weit weg). */
function naechsteWand(punkt: Vec2, waende: Wand[]): { index: number; offset: number } | null {
  // for-Schleife statt forEach: TS kann Closure-Zuweisungen nicht narrowen.
  let best: { index: number; offset: number; dist: number } | null = null;
  for (let index = 0; index < waende.length; index++) {
    const w = waende[index];
    if (!w) continue;
    const { offset, dist } = projiziere(punkt, w);
    if (best === null || dist < best.dist) best = { index, offset, dist };
  }
  return best !== null && best.dist < 0.5 ? { index: best.index, offset: best.offset } : null;
}

export function RaumEditor({
  onFertig,
  onAbbruch,
}: {
  onFertig: (room: Raummodell) => void;
  onAbbruch: () => void;
}) {
  const [name, setName] = useState("Mein Raum");
  const [roomType, setRoomType] = useState<RaumTyp>("bad");
  const [form, setForm] = useState<Grundform>("rechteck");
  const [breite, setBreite] = useState(3);
  const [tiefe, setTiefe] = useState(2.5);
  const [ausschnittBreite, setAusschnittBreite] = useState(1);
  const [ausschnittTiefe, setAusschnittTiefe] = useState(1);
  const [raumhoehe, setRaumhoehe] = useState(RAUMHOEHE_DEFAULT);
  const [oeffnungen, setOeffnungen] = useState<OeffnungsSpec[]>([]);
  const [fixpunkte, setFixpunkte] = useState<FixpunktSpec[]>([]);
  const [werkzeug, setWerkzeug] = useState<Werkzeug>({ art: "keins" });
  const svgRef = useRef<SVGSVGElement>(null);

  const params: LFormParams = { breite, tiefe, ausschnittBreite, ausschnittTiefe };

  // Formfehler blocken «Fertig» und die Vorschau-Interaktion.
  const formFehler = useMemo<string | null>(() => {
    if (breite <= 0 || tiefe <= 0) return "Breite und Tiefe müssen > 0 sein.";
    if (form === "l-form") {
      if (ausschnittBreite <= 0 || ausschnittTiefe <= 0) return "Ausschnitt-Masse müssen > 0 sein.";
      if (ausschnittBreite >= breite || ausschnittTiefe >= tiefe)
        return "Ausschnitt muss kleiner als der Raum sein.";
    }
    return null;
  }, [breite, tiefe, form, ausschnittBreite, ausschnittTiefe]);

  const punkte = useMemo<Vec2[]>(
    () => (formFehler ? [] : grundrissPunkte(form, params)),
    [form, formFehler, breite, tiefe, ausschnittBreite, ausschnittTiefe],
  );

  const waende = useMemo<Wand[]>(
    () =>
      punkte.map((start, i) => {
        // Modulo schliesst den Umlauf; ?? start nur für den strikten Indexzugriff.
        const end = punkte[(i + 1) % punkte.length] ?? start;
        return { start, end, laenge: wandLaenge(start, end) };
      }),
    [punkte],
  );

  const transform = useMemo(
    () => (punkte.length >= 3 ? computeTransform(punkte, SIZE, PAD) : null),
    [punkte],
  );

  // Fehlende Pflicht-Anschlüsse (Solver-Hinweis für Bad/Küche).
  const fehlt = fehlendeAnschluesse(
    roomType,
    fixpunkte.map((f) => f.type),
  );

  // Ungültige Öffnungen (ragen über die Wand hinaus) → blocken «Fertig».
  const oeffnungsFehler = oeffnungen.some((o) => {
    const w = waende[o.wandIndex];
    return w ? pruefeOeffnung(o, w.laenge) !== null : true;
  });

  const svgKlick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (werkzeug.art === "keins" || !transform || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) * SIZE) / rect.width;
    const sy = ((e.clientY - rect.top) * SIZE) / rect.height;
    const welt = toWorld([sx, sy], transform);
    const treffer = naechsteWand(welt, waende);
    if (!treffer) return;
    const wand = waende[treffer.index];
    if (!wand) return;

    if (werkzeug.art === "tuer" || werkzeug.art === "fenster") {
      const def = werkzeug.art === "tuer" ? OEFFNUNG_DEFAULT.door : OEFFNUNG_DEFAULT.window;
      // Öffnung um den Klick zentrieren und in die Wand einpassen.
      const offset = Math.max(0, Math.min(wand.laenge - def.width, treffer.offset - def.width / 2));
      setOeffnungen((prev) => [
        ...prev,
        {
          wandIndex: treffer.index,
          type: werkzeug.art === "tuer" ? "door" : "window",
          offset: Math.round(offset * 100) / 100,
          width: def.width,
          height: def.height,
          sill: def.sill,
        },
      ]);
    } else {
      setFixpunkte((prev) => [
        ...prev,
        {
          wandIndex: treffer.index,
          type: werkzeug.typ,
          offset: Math.round(treffer.offset * 100) / 100,
          heightFromFloor: 0.3,
        },
      ]);
    }
  };

  const fertig = () => {
    if (formFehler || oeffnungsFehler) return;
    onFertig(baueRaummodell({ name, roomType, form, params, raumhoehe, oeffnungen, fixpunkte }));
  };

  // --- Vorschau-Elemente ---------------------------------------------------
  const punktAufWandScreen = (wand: Wand, offset: number): Vec2 => {
    const t = wand.laenge ? offset / wand.laenge : 0;
    return [
      wand.start[0] + (wand.end[0] - wand.start[0]) * t,
      wand.start[1] + (wand.end[1] - wand.start[1]) * t,
    ];
  };

  return (
    <div style={stil.overlay} onClick={onAbbruch}>
      <div style={stil.karte} onClick={(e) => e.stopPropagation()}>
        {/* Linke Spalte: SVG-Vorschau */}
        <div>
          <h3 style={{ marginTop: 0, color: FARBE_WAND }}>Vorschau (Draufsicht)</h3>
          <svg
            ref={svgRef}
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            onClick={svgKlick}
            style={{
              background: "#faf7f0",
              borderRadius: 8,
              border: "1px solid #ddd",
              cursor: werkzeug.art === "keins" ? "default" : "crosshair",
              maxWidth: "100%",
            }}
          >
            {transform && punkte.length >= 3 && (
              <>
                {/* Bodenfläche */}
                <polygon
                  points={punkte.map((p) => toScreen(p, transform).join(",")).join(" ")}
                  fill="#ffffff"
                  stroke="none"
                />
                {/* Wände + Längen-Beschriftung + Wand-Index */}
                {waende.map((w, i) => {
                  const [ax, ay] = toScreen(w.start, transform);
                  const [bx, by] = toScreen(w.end, transform);
                  const mx = (ax + bx) / 2;
                  const my = (ay + by) / 2;
                  return (
                    <g key={`w${i}`}>
                      <line x1={ax} y1={ay} x2={bx} y2={by} stroke={FARBE_WAND} strokeWidth={3} />
                      <text x={mx} y={my - 4} fontSize={11} textAnchor="middle" fill="#555">
                        W{i} · {w.laenge.toFixed(2)} m
                      </text>
                    </g>
                  );
                })}
                {/* Öffnungen als farbige Segmente auf der Wand */}
                {oeffnungen.map((o, i) => {
                  const w = waende[o.wandIndex];
                  if (!w) return null;
                  const ungueltig = pruefeOeffnung(o, w.laenge) !== null;
                  const [ax, ay] = toScreen(punktAufWandScreen(w, o.offset), transform);
                  const [bx, by] = toScreen(
                    punktAufWandScreen(w, Math.min(o.offset + o.width, w.laenge)),
                    transform,
                  );
                  return (
                    <line
                      key={`o${i}`}
                      x1={ax}
                      y1={ay}
                      x2={bx}
                      y2={by}
                      stroke={
                        ungueltig ? "#c0392b" : o.type === "door" ? FARBE_TUER : FARBE_FENSTER
                      }
                      strokeWidth={7}
                      strokeLinecap="round"
                    />
                  );
                })}
                {/* Fixpunkte als Punkte mit Kürzel */}
                {fixpunkte.map((f, i) => {
                  const w = waende[f.wandIndex];
                  if (!w) return null;
                  const [px, py] = toScreen(punktAufWandScreen(w, f.offset), transform);
                  return (
                    <g key={`f${i}`}>
                      <circle cx={px} cy={py} r={9} fill={FARBE_FIX} />
                      <text
                        x={px}
                        y={py + 4}
                        fontSize={11}
                        textAnchor="middle"
                        fill="white"
                        fontWeight="bold"
                      >
                        {anschlussKuerzel(f.type)}
                      </text>
                    </g>
                  );
                })}
              </>
            )}
            {formFehler && (
              <text x={SIZE / 2} y={SIZE / 2} fontSize={13} textAnchor="middle" fill="#c0392b">
                {formFehler}
              </text>
            )}
          </svg>
          <p style={{ fontSize: 12, color: "#555", marginBottom: 0 }}>
            Werkzeug wählen, dann auf eine Wand klicken. Tür = orange, Fenster = blau, Anschluss =
            violetter Punkt (W/A/E/S/L).
          </p>
        </div>

        {/* Rechte Spalte: Eingaben */}
        <div>
          <h3 style={{ marginTop: 0, color: FARBE_WAND }}>✏️ Raum selbst erstellen</h3>

          <div style={stil.zeile}>
            <label>
              Name{" "}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: 160 }}
              />
            </label>
            <label>
              Typ{" "}
              <select value={roomType} onChange={(e) => setRoomType(e.target.value as RaumTyp)}>
                <option value="bad">Bad</option>
                <option value="wohnen">Wohnen</option>
                <option value="kueche">Küche</option>
              </select>
            </label>
          </div>

          <div style={stil.zeile}>
            <label>
              Form{" "}
              <select value={form} onChange={(e) => setForm(e.target.value as Grundform)}>
                <option value="rechteck">Rechteck</option>
                <option value="l-form">L-Form</option>
              </select>
            </label>
            <label>
              Breite (m){" "}
              <input
                type="number"
                step={0.1}
                min={0.1}
                value={breite}
                onChange={(e) => setBreite(Number(e.target.value))}
                style={stil.feld}
              />
            </label>
            <label>
              Tiefe (m){" "}
              <input
                type="number"
                step={0.1}
                min={0.1}
                value={tiefe}
                onChange={(e) => setTiefe(Number(e.target.value))}
                style={stil.feld}
              />
            </label>
            <label>
              Höhe (m){" "}
              <input
                type="number"
                step={0.1}
                min={0.1}
                value={raumhoehe}
                onChange={(e) => setRaumhoehe(Number(e.target.value))}
                style={stil.feld}
              />
            </label>
          </div>

          {form === "l-form" && (
            <div style={stil.zeile}>
              <span style={{ fontSize: 12, color: "#555" }}>Ausschnitt (Ecke max x / max z):</span>
              <label>
                Breite{" "}
                <input
                  type="number"
                  step={0.1}
                  min={0.1}
                  value={ausschnittBreite}
                  onChange={(e) => setAusschnittBreite(Number(e.target.value))}
                  style={stil.feld}
                />
              </label>
              <label>
                Tiefe{" "}
                <input
                  type="number"
                  step={0.1}
                  min={0.1}
                  value={ausschnittTiefe}
                  onChange={(e) => setAusschnittTiefe(Number(e.target.value))}
                  style={stil.feld}
                />
              </label>
            </div>
          )}

          {/* Werkzeugleiste */}
          <div style={{ ...stil.zeile, marginTop: 10 }}>
            <strong style={{ fontSize: 13 }}>Einzeichnen:</strong>
            {(
              [
                { art: "tuer", label: "🚪 Tür", farbe: FARBE_TUER },
                { art: "fenster", label: "🪟 Fenster", farbe: FARBE_FENSTER },
              ] as const
            ).map((wz) => (
              <button
                key={wz.art}
                onClick={() => setWerkzeug({ art: wz.art })}
                style={{
                  ...stil.knopf,
                  background: werkzeug.art === wz.art ? wz.farbe : "#a3b9aa",
                }}
              >
                {wz.label}
              </button>
            ))}
          </div>
          <div style={stil.zeile}>
            <strong style={{ fontSize: 13 }}>Anschluss:</strong>
            {ANSCHLUSS_TYPEN.map((typ) => (
              <button
                key={typ}
                onClick={() => setWerkzeug({ art: "fix", typ })}
                style={{
                  ...stil.knopf,
                  fontSize: 12,
                  padding: "4px 8px",
                  background:
                    werkzeug.art === "fix" && werkzeug.typ === typ ? FARBE_FIX : "#a3b9aa",
                }}
              >
                {typ}
              </button>
            ))}
            <button
              onClick={() => setWerkzeug({ art: "keins" })}
              style={{ ...stil.knopf, fontSize: 12, padding: "4px 8px", background: "#8a8a8a" }}
            >
              ✋ nur ansehen
            </button>
          </div>

          {fehlt.length > 0 && (
            <p style={{ fontSize: 12, color: "#c96f2e", margin: "4px 0" }}>
              ⚠ Solver braucht {fehlt.join(" + ")} – bitte als Anschluss setzen.
            </p>
          )}

          {/* Öffnungs-Liste */}
          {oeffnungen.length > 0 && (
            <section>
              <h4 style={{ marginBottom: 4 }}>Öffnungen</h4>
              {oeffnungen.map((o, i) => {
                const w = waende[o.wandIndex];
                const fehler = w ? pruefeOeffnung(o, w.laenge) : "Wand fehlt";
                const setze = (patch: Partial<OeffnungsSpec>) =>
                  setOeffnungen((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} style={{ ...stil.zeile, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, width: 90 }}>
                      {o.type === "door" ? "🚪 Tür" : "🪟 Fenster"} W{o.wandIndex}
                    </span>
                    <label style={{ fontSize: 12 }}>
                      Off.{" "}
                      <input
                        type="number"
                        step={0.05}
                        value={o.offset}
                        onChange={(e) => setze({ offset: Number(e.target.value) })}
                        style={{ width: 60 }}
                      />
                    </label>
                    <label style={{ fontSize: 12 }}>
                      Br.{" "}
                      <input
                        type="number"
                        step={0.05}
                        value={o.width}
                        onChange={(e) => setze({ width: Number(e.target.value) })}
                        style={{ width: 60 }}
                      />
                    </label>
                    {fehler && <span style={{ color: "#c0392b", fontSize: 11 }}>{fehler}</span>}
                    <button
                      onClick={() => setOeffnungen((prev) => prev.filter((_, j) => j !== i))}
                      style={{ ...stil.knopf, background: "#8a8a8a", padding: "2px 8px" }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </section>
          )}

          {/* Fixpunkt-Liste */}
          {fixpunkte.length > 0 && (
            <section>
              <h4 style={{ marginBottom: 4 }}>Anschlüsse</h4>
              {fixpunkte.map((f, i) => {
                const setze = (patch: Partial<FixpunktSpec>) =>
                  setFixpunkte((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} style={{ ...stil.zeile, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, width: 90 }}>
                      {f.type} W{f.wandIndex}
                    </span>
                    <label style={{ fontSize: 12 }}>
                      Off.{" "}
                      <input
                        type="number"
                        step={0.05}
                        value={f.offset}
                        onChange={(e) => setze({ offset: Number(e.target.value) })}
                        style={{ width: 60 }}
                      />
                    </label>
                    <label style={{ fontSize: 12 }}>
                      Höhe{" "}
                      <input
                        type="number"
                        step={0.05}
                        value={f.heightFromFloor}
                        onChange={(e) => setze({ heightFromFloor: Number(e.target.value) })}
                        style={{ width: 60 }}
                      />
                    </label>
                    <button
                      onClick={() => setFixpunkte((prev) => prev.filter((_, j) => j !== i))}
                      style={{ ...stil.knopf, background: "#8a8a8a", padding: "2px 8px" }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </section>
          )}

          <div style={{ ...stil.zeile, marginTop: 14 }}>
            <button
              onClick={fertig}
              disabled={!!formFehler || oeffnungsFehler}
              style={{
                ...stil.knopf,
                background: formFehler || oeffnungsFehler ? "#c9b8a8" : "#1f4d3a",
              }}
            >
              ✓ Raum erstellen
            </button>
            <button onClick={onAbbruch} style={{ ...stil.knopf, background: "#8a8a8a" }}>
              Abbrechen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
