/** Scan-Korrektur-Modus (M7, Scan-Fahrplan Schritt 6, Brain: ADR-0003).
 *
 *  Gescannte Räume haben ~8.5 cm Ungenauigkeit (kein LiDAR). Gegenmittel:
 *  nutzergeführte Korrektur – Ecken antippen/ziehen mit Snapping (rasten
 *  rechtwinklig ein). Zusätzlich setzt der Nutzer Anschlüsse (der Scan erkennt
 *  keine → fixpoints leer) und bestätigt/entfernt erkannte Objekte
 *  (needsReview). Ergebnis = geometryConfirmed-Raummodell für den Klickpfad.
 *
 *  Reine Geometrie liegt in korrektur.ts (getestet); diese Datei ist nur UI und
 *  folgt dem Muster von RaumEditor.tsx (SVG-Draufsicht, plan2d-Transform, CI).
 */
import { useMemo, useRef, useState } from "react";
import type { Vec2 } from "@fp/shared/rules";
import type { Room } from "./api";
import { computeTransform, footprintPoints, toScreen, toWorld } from "./plan2d.ts";
import {
  ecken,
  kettePolygon,
  nachbarPunkte,
  snappe,
  verschiebeEcke,
  wendeAn,
  type KWand,
  type ObjektEntscheidung,
  type ScanFixpunkt,
  type ScanOeffnung,
  type ScanRaum,
} from "./korrektur";
import {
  anschlussKuerzel,
  fehlendeAnschluesse,
  FIXPUNKT_HOEHE_DEFAULT,
  OEFFNUNG_DEFAULT,
  pruefeOeffnung,
  wandLaenge,
  type Anschlusstyp,
  type RaumTyp,
} from "./raumbau";
import { karte as ciKarte, pill, THEME, titel } from "./theme";

const SIZE = 460;
const PAD = 56;

const FARBE_TUER = THEME.orange;
const FARBE_FENSTER = THEME.blau;
const FARBE_WAND = THEME.gruen;
const FARBE_FIX = "#8a2ec9";
const FARBE_REVIEW = THEME.orange;
const FARBE_OK = "#5b8a72";

const ANSCHLUSS_TYPEN: Anschlusstyp[] = ["wasser", "abwasser", "elektro", "starkstrom", "lueftung"];
const RAUMTYPEN: RaumTyp[] = ["bad", "wohnen", "kueche"];

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
    ...ciKarte,
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
  knopf: pill,
  zeile: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap" as const,
    marginBottom: 6,
  },
} as const;

/** Aktives Werkzeug: bestimmt, was ein Klick auf eine Wand erzeugt. Ecken lassen
 *  sich unabhängig davon immer ziehen. */
type Werkzeug =
  | { art: "keins" }
  | { art: "tuer" }
  | { art: "fenster" }
  | { art: "fix"; typ: Anschlusstyp };

interface WandMitLaenge extends KWand {
  laenge: number;
}

/** Projektion eines Welt-Punkts auf ein Wand-Segment → {offset ab Start, Abstand}. */
function projiziere(punkt: Vec2, wand: WandMitLaenge): { offset: number; dist: number } {
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
function naechsteWand(
  punkt: Vec2,
  waende: WandMitLaenge[],
): { wand: WandMitLaenge; offset: number } | null {
  let best: { wand: WandMitLaenge; offset: number; dist: number } | null = null;
  for (const w of waende) {
    const { offset, dist } = projiziere(punkt, w);
    if (best === null || dist < best.dist) best = { wand: w, offset, dist };
  }
  return best !== null && best.dist < 0.5 ? { wand: best.wand, offset: best.offset } : null;
}

export function ScanKorrektur({
  room,
  warnungen,
  onFertig,
  onAbbruch,
}: {
  room: Room;
  warnungen: string[];
  onFertig: (room: Room) => void;
  onAbbruch: () => void;
}) {
  // Der App-`Room`-Typ ist strukturell minimal; zur Laufzeit liegt das volle
  // Scan-Raummodell vor. Cast an der Grenze; korrektur.ts arbeitet rich-typisiert.
  const scan = useMemo(() => room as unknown as ScanRaum, [room]);

  const [walls, setWalls] = useState<KWand[]>(() =>
    scan.shell.walls.map((w) => ({ id: w.id, start: w.start, end: w.end })),
  );
  const [openings, setOpenings] = useState<ScanOeffnung[]>(() =>
    scan.openings.map((o) => ({ ...o })),
  );
  const [fixpunkte, setFixpunkte] = useState<ScanFixpunkt[]>(() =>
    scan.fixpoints.map((f) => ({ ...f })),
  );
  const [entscheidungen, setEntscheidungen] = useState<Record<string, ObjektEntscheidung>>({});
  const [werkzeug, setWerkzeug] = useState<Werkzeug>({ art: "keins" });
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const roomType = scan.roomType;
  const istBekannterTyp = (RAUMTYPEN as string[]).includes(roomType);

  // Transform EINMALIG aus den Anfangs-Ecken – stabile Screen-Abbildung beim
  // Ziehen (sonst „läuft" die Ansicht dem gezogenen Punkt hinterher).
  const transform = useMemo(() => {
    const punkte = ecken(
      scan.shell.walls.map((w) => ({ id: w.id, start: w.start, end: w.end })),
    ).map((e) => e.position);
    return punkte.length >= 3 ? computeTransform(punkte, SIZE, PAD) : null;
  }, [scan]);

  const eckenAlle = useMemo(() => ecken(walls), [walls]);
  const waende = useMemo<WandMitLaenge[]>(
    () => walls.map((w) => ({ ...w, laenge: wandLaenge(w.start, w.end) })),
    [walls],
  );
  const kette = useMemo(() => kettePolygon(walls), [walls]);

  // Fehlende Pflicht-Anschlüsse (Solver-Hinweis für Bad/Küche).
  const fehlt = istBekannterTyp
    ? fehlendeAnschluesse(
        roomType as RaumTyp,
        fixpunkte.map((f) => f.type as Anschlusstyp),
      )
    : [];

  const laengeVonWand = (id: string): number | null => {
    const w = waende.find((x) => x.id === id);
    return w ? w.laenge : null;
  };

  const oeffnungsFehlerText = (o: ScanOeffnung): string | null => {
    const laenge = laengeVonWand(o.hostWall);
    if (laenge === null) return "Wand fehlt";
    return pruefeOeffnung(
      {
        wandIndex: 0,
        type: o.type,
        offset: o.offset,
        width: o.width,
        height: o.height,
        sill: o.sill,
      },
      laenge,
    );
  };

  const oeffnungsFehler = openings.some((o) => oeffnungsFehlerText(o) !== null);
  const uebernehmenGesperrt = oeffnungsFehler || !kette.ok;

  const weltAusEvent = (e: { clientX: number; clientY: number }): Vec2 | null => {
    if (!transform || !svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) * SIZE) / rect.width;
    const sy = ((e.clientY - rect.top) * SIZE) / rect.height;
    return toWorld([sx, sy], transform);
  };

  // --- Ecken ziehen (Pointer = Maus UND Touch/„antippen") -------------------
  const eckePointerDown = (i: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDragIndex(i);
  };
  const eckePointerMove = (i: number) => (e: React.PointerEvent) => {
    if (dragIndex !== i) return;
    const welt = weltAusEvent(e);
    if (!welt) return;
    setWalls((prev) => {
      const es = ecken(prev);
      const ecke = es[i];
      if (!ecke) return prev;
      const ziel = snappe(welt, nachbarPunkte(ecke, prev));
      return verschiebeEcke(prev, ecke, ziel);
    });
  };
  const eckePointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    setDragIndex(null);
  };

  // --- Werkzeug-Klick auf eine Wand: Öffnung / Anschluss hinzufügen ---------
  const svgKlick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (werkzeug.art === "keins") return;
    const welt = weltAusEvent(e);
    if (!welt) return;
    const treffer = naechsteWand(welt, waende);
    if (!treffer) return;
    const { wand, offset } = treffer;

    if (werkzeug.art === "tuer" || werkzeug.art === "fenster") {
      const def = werkzeug.art === "tuer" ? OEFFNUNG_DEFAULT.door : OEFFNUNG_DEFAULT.window;
      const laenge = wandLaenge(wand.start, wand.end);
      const off = Math.max(0, Math.min(laenge - def.width, offset - def.width / 2));
      setOpenings((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: werkzeug.art === "tuer" ? "door" : "window",
          hostWall: wand.id,
          offset: Math.round(off * 100) / 100,
          width: def.width,
          height: def.height,
          sill: def.sill,
        },
      ]);
    } else {
      // Anschluss: absolute Position auf der aktuellen Wandachse (offset ab Start).
      const laenge = wandLaenge(wand.start, wand.end) || 1;
      const t = Math.max(0, Math.min(1, offset / laenge));
      const position: Vec2 = [
        Math.round((wand.start[0] + (wand.end[0] - wand.start[0]) * t) * 100) / 100,
        Math.round((wand.start[1] + (wand.end[1] - wand.start[1]) * t) * 100) / 100,
      ];
      setFixpunkte((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: werkzeug.typ,
          position,
          wall: wand.id,
          heightFromFloor: FIXPUNKT_HOEHE_DEFAULT,
          mount: "wand",
          origin: "manuell",
          zone: null,
        },
      ]);
    }
  };

  const setzeEntscheidung = (id: string, e: ObjektEntscheidung) =>
    setEntscheidungen((prev) => ({ ...prev, [id]: e }));

  const uebernehmen = () => {
    if (uebernehmenGesperrt) return;
    const neu = wendeAn(scan, walls, openings, fixpunkte, entscheidungen);
    onFertig(neu as unknown as Room);
  };

  return (
    <div style={stil.overlay} onClick={onAbbruch}>
      <div style={stil.karte} onClick={(e) => e.stopPropagation()}>
        {/* Linke Spalte: SVG-Draufsicht */}
        <div>
          <h3 style={{ ...titel, marginTop: 0, fontSize: 16 }}>📐 Scan korrigieren</h3>
          <svg
            ref={svgRef}
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            onClick={svgKlick}
            style={{
              background: THEME.offwhite,
              borderRadius: 8,
              border: "1px solid #ddd",
              cursor: werkzeug.art === "keins" ? "default" : "crosshair",
              maxWidth: "100%",
              touchAction: "none",
            }}
          >
            {transform && (
              <>
                {/* Bodenfläche (nur wenn geschlossen) */}
                {kette.ok && kette.polygon.length >= 3 && (
                  <polygon
                    points={kette.polygon.map((p) => toScreen(p, transform).join(",")).join(" ")}
                    fill="#ffffff"
                    stroke="none"
                  />
                )}
                {/* Scan-Objekte als gestrichelte, um yawDeg rotierte bbox-Rechtecke */}
                {scan.objects.map((o) => {
                  const ent = entscheidungen[o.id];
                  if (ent === "entfernt") return null;
                  const bestaetigt = ent === "bestaetigt";
                  const [lx, ly] = toScreen(o.pose.pos, transform);
                  return (
                    <g key={`obj-${o.id}`}>
                      <polygon
                        points={footprintPoints(
                          o.pose.pos,
                          o.geometry.bbox.w,
                          o.geometry.bbox.d,
                          o.pose.yawDeg,
                          transform,
                        )}
                        fill="none"
                        stroke={bestaetigt ? FARBE_OK : FARBE_REVIEW}
                        strokeWidth={2}
                        strokeDasharray="5 4"
                      />
                      <text x={lx} y={ly} fontSize={10} textAnchor="middle" fill="#555">
                        {o.label}
                      </text>
                    </g>
                  );
                })}
                {/* Wände + Längen-Beschriftung */}
                {waende.map((w) => {
                  const [ax, ay] = toScreen(w.start, transform);
                  const [bx, by] = toScreen(w.end, transform);
                  return (
                    <g key={`w-${w.id}`}>
                      <line x1={ax} y1={ay} x2={bx} y2={by} stroke={FARBE_WAND} strokeWidth={3} />
                      <text
                        x={(ax + bx) / 2}
                        y={(ay + by) / 2 - 4}
                        fontSize={11}
                        textAnchor="middle"
                        fill="#555"
                      >
                        {w.laenge.toFixed(2)} m
                      </text>
                    </g>
                  );
                })}
                {/* Öffnungen als farbige Segmente auf der Wand */}
                {openings.map((o) => {
                  const w = waende.find((x) => x.id === o.hostWall);
                  if (!w) return null;
                  const ungueltig = oeffnungsFehlerText(o) !== null;
                  const t0 = w.laenge ? o.offset / w.laenge : 0;
                  const t1 = w.laenge ? Math.min(o.offset + o.width, w.laenge) / w.laenge : 0;
                  const p0: Vec2 = [
                    w.start[0] + (w.end[0] - w.start[0]) * t0,
                    w.start[1] + (w.end[1] - w.start[1]) * t0,
                  ];
                  const p1: Vec2 = [
                    w.start[0] + (w.end[0] - w.start[0]) * t1,
                    w.start[1] + (w.end[1] - w.start[1]) * t1,
                  ];
                  const [ax, ay] = toScreen(p0, transform);
                  const [bx, by] = toScreen(p1, transform);
                  return (
                    <line
                      key={`o-${o.id}`}
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
                {/* Fixpunkte als violette Punkte mit Kürzel */}
                {fixpunkte.map((f) => {
                  const [px, py] = toScreen(f.position, transform);
                  return (
                    <g key={`f-${f.id}`}>
                      <circle cx={px} cy={py} r={9} fill={FARBE_FIX} />
                      <text
                        x={px}
                        y={py + 4}
                        fontSize={11}
                        textAnchor="middle"
                        fill="white"
                        fontWeight="bold"
                      >
                        {anschlussKuerzel(f.type as Anschlusstyp) ?? "?"}
                      </text>
                    </g>
                  );
                })}
                {/* Ecken als ziehbare Griffe (immer aktiv, auch per Touch) */}
                {eckenAlle.map((ecke, i) => {
                  const [cx, cy] = toScreen(ecke.position, transform);
                  return (
                    <circle
                      key={`ecke-${i}`}
                      cx={cx}
                      cy={cy}
                      r={7}
                      fill="#ffffff"
                      stroke={FARBE_WAND}
                      strokeWidth={2}
                      style={{ cursor: dragIndex === i ? "grabbing" : "grab" }}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={eckePointerDown(i)}
                      onPointerMove={eckePointerMove(i)}
                      onPointerUp={eckePointerUp}
                    />
                  );
                })}
              </>
            )}
            {!kette.ok && (
              <text x={SIZE / 2} y={SIZE - 12} fontSize={12} textAnchor="middle" fill="#c0392b">
                Hülle offen – Ecken so ziehen, dass die Wände wieder schliessen.
              </text>
            )}
          </svg>
          <p style={{ fontSize: 12, color: "#555", marginBottom: 0 }}>
            Ecken ziehen (rasten rechtwinklig ein), Öffnungen prüfen, Anschlüsse setzen, erkannte
            Objekte bestätigen.
          </p>
        </div>

        {/* Rechte Spalte: Werkzeuge + Hinweise + Listen */}
        <div>
          {/* Werkzeugleiste */}
          <div style={{ ...stil.zeile }}>
            <button
              onClick={() => setWerkzeug({ art: "keins" })}
              style={{
                ...stil.knopf,
                background: werkzeug.art === "keins" ? THEME.gruen : "#a3b9aa",
              }}
            >
              ✋ ansehen
            </button>
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
          </div>

          {/* Hinweis-Panel: Scan-Warnungen + fehlende Pflicht-Anschlüsse */}
          {(warnungen.length > 0 || fehlt.length > 0) && (
            <section style={{ marginBottom: 8 }}>
              {warnungen.map((w, i) => (
                <p key={`warn-${i}`} style={{ fontSize: 12, color: THEME.orange, margin: "2px 0" }}>
                  ⚠ {w}
                </p>
              ))}
              {fehlt.length > 0 && (
                <p style={{ fontSize: 12, color: THEME.orange, margin: "2px 0" }}>
                  ⚠ Solver braucht {fehlt.join(" + ")} – bitte als Anschluss setzen.
                </p>
              )}
            </section>
          )}

          {/* Öffnungs-Liste */}
          {openings.length > 0 && (
            <section>
              <h4 style={{ marginBottom: 4 }}>Öffnungen</h4>
              {openings.map((o) => {
                const fehler = oeffnungsFehlerText(o);
                const setze = (patch: Partial<ScanOeffnung>) =>
                  setOpenings((prev) => prev.map((x) => (x.id === o.id ? { ...x, ...patch } : x)));
                return (
                  <div key={o.id} style={{ ...stil.zeile, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, width: 70 }}>
                      {o.type === "door" ? "🚪 Tür" : "🪟 Fenster"}
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
                      onClick={() => setOpenings((prev) => prev.filter((x) => x.id !== o.id))}
                      style={{ ...stil.knopf, background: "#8a8a8a", padding: "2px 8px" }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </section>
          )}

          {/* Anschluss-Liste */}
          {fixpunkte.length > 0 && (
            <section>
              <h4 style={{ marginBottom: 4 }}>Anschlüsse</h4>
              {fixpunkte.map((f) => {
                const setze = (patch: Partial<ScanFixpunkt>) =>
                  setFixpunkte((prev) => prev.map((x) => (x.id === f.id ? { ...x, ...patch } : x)));
                return (
                  <div key={f.id} style={{ ...stil.zeile, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, width: 90 }}>{f.type}</span>
                    <label style={{ fontSize: 12 }}>
                      Höhe{" "}
                      <input
                        type="number"
                        step={0.05}
                        value={f.heightFromFloor ?? FIXPUNKT_HOEHE_DEFAULT}
                        onChange={(e) => setze({ heightFromFloor: Number(e.target.value) })}
                        style={{ width: 60 }}
                      />
                    </label>
                    <button
                      onClick={() => setFixpunkte((prev) => prev.filter((x) => x.id !== f.id))}
                      style={{ ...stil.knopf, background: "#8a8a8a", padding: "2px 8px" }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </section>
          )}

          {/* Objekt-Liste: bestätigen / entfernen */}
          {scan.objects.length > 0 && (
            <section>
              <h4 style={{ marginBottom: 4 }}>Erkannte Objekte</h4>
              {scan.objects.map((o) => {
                const ent = entscheidungen[o.id];
                const bg =
                  ent === "bestaetigt" ? "#e5f0e9" : ent === "entfernt" ? "#eee" : "#fdf0e4";
                return (
                  <div
                    key={o.id}
                    style={{
                      ...stil.zeile,
                      marginBottom: 2,
                      background: bg,
                      padding: "2px 4px",
                      borderRadius: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        width: 150,
                        textDecoration: ent === "entfernt" ? "line-through" : "none",
                      }}
                    >
                      {o.label} · {o.geometry.bbox.w.toFixed(2)}×{o.geometry.bbox.d.toFixed(2)} m
                    </span>
                    <button
                      onClick={() => setzeEntscheidung(o.id, "bestaetigt")}
                      style={{
                        ...stil.knopf,
                        fontSize: 12,
                        padding: "2px 8px",
                        background: ent === "bestaetigt" ? FARBE_OK : "#a3b9aa",
                      }}
                    >
                      ✓ bestätigen
                    </button>
                    <button
                      onClick={() => setzeEntscheidung(o.id, "entfernt")}
                      style={{
                        ...stil.knopf,
                        fontSize: 12,
                        padding: "2px 8px",
                        background: ent === "entfernt" ? "#c0392b" : "#8a8a8a",
                      }}
                    >
                      ✕ entfernen
                    </button>
                  </div>
                );
              })}
            </section>
          )}

          {/* Footer */}
          <div style={{ ...stil.zeile, marginTop: 14 }}>
            <button
              onClick={uebernehmen}
              disabled={uebernehmenGesperrt}
              style={{ ...stil.knopf, background: uebernehmenGesperrt ? "#c9b8a8" : THEME.gruen }}
              title={
                uebernehmenGesperrt
                  ? oeffnungsFehler
                    ? "Öffnungs-Fehler beheben"
                    : "Hülle noch offen"
                  : undefined
              }
            >
              ✓ Übernehmen
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
