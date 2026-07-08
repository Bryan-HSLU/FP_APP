/** Objekt-Info-Panel: erweiterte Infos zum gewählten Möbel + Wechsel-Alternativen.
 *
 *  Wird sowohl in der «Anpassen»-Ansicht (neben 2D **und** 3D-Viewer) genutzt.
 *  Zeigt Kosten des aktuellen Objekts und – als kleine Kacheln – die anderen
 *  Katalog-Items desselben `funktionsTyp` zum direkten Wechsel, je mit
 *  Thumbnail (2D-Symbol), Name, Preis, Massen (BxTxH) und einem Stil-Match.
 *
 *  Thumbnail-Austauschpunkt: Es gibt (noch) keine echten Produktfotos je
 *  Katalog-Item. Als Platzhalter rendert `SymbolThumb` das vorhandene
 *  2D-Objektsymbol (`symbole2d`). Sobald echte Assets vorliegen (Foto oder
 *  GLTF-Render), genügt es, hier statt `SymbolThumb` ein `<img>`/Render-Thumb
 *  einzuhängen – die restliche Kachel bleibt unverändert.
 */
import type { KatalogItem } from "./api";
import { toScreen, type PlanTransform } from "./plan2d";
import type { Stilprofil } from "./Stil";
import { symbolScreenPrims } from "./symbole2d";
import { CSS, THEME } from "./theme";

/**
 * Stil-Nähe eines Katalog-Items zum Stilprofil: Cosinus-Ähnlichkeit zwischen
 * dem Stilvektor (Achsen) und den `achsenTags` des Items über die gemeinsamen
 * Achsen. Ergebnis in [0,1] (Cosinus [−1,1] linear auf [0,1] abgebildet;
 * 1 = deckungsgleiche Ausrichtung). `null`, wenn es keine gemeinsame Achse gibt.
 * Bewusst leichtgewichtig und wiederverwendbar (auch ausserhalb dieser Datei).
 */
export function stilNaehe(
  styleVector: Record<string, number>,
  achsenTags: Record<string, number>,
): number | null {
  let dot = 0;
  let na = 0;
  let nb = 0;
  let gemeinsame = 0;
  for (const [achse, wa] of Object.entries(styleVector)) {
    const wb = achsenTags[achse];
    if (wb === undefined) continue;
    gemeinsame++;
    dot += wa * wb;
    na += wa * wa;
    nb += wb * wb;
  }
  if (gemeinsame === 0 || na === 0 || nb === 0) return null;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.max(0, Math.min(1, (cos + 1) / 2));
}

/** CHF-Preis eines Items formatiert (Schweizer Format, ohne Rappen). */
function preisText(item: KatalogItem): string {
  const p = item.preis;
  if (!p) return "–";
  try {
    return new Intl.NumberFormat("de-CH", {
      style: "currency",
      currency: p.currency,
      maximumFractionDigits: 0,
    }).format(p.value);
  } catch {
    return `${p.currency} ${Math.round(p.value)}`;
  }
}

/** Massen BxTxH (m) knapp formatiert. */
function masseText(item: KatalogItem): string {
  const { w, d, h } = item.masse;
  return `${w} × ${d} × ${h} m`;
}

/** Kleines 2D-Symbol des Items als Inline-SVG-Thumbnail (Platzhalter für ein
 *  späteres echtes Produktfoto/GLTF-Render – siehe Datei-Kopf). */
function SymbolThumb({ item, px = 40 }: { item: KatalogItem; px?: number }) {
  const { w, d } = item.masse;
  const maxDim = Math.max(w, d, 0.1);
  const pad = px * 0.16;
  const scale = (px - 2 * pad) / maxDim;
  // Symbol im lokalen System um [0,0] zentriert → Bildmitte; yaw 0.
  const t: PlanTransform = { scale, offsetX: px / 2, offsetY: px / 2 };
  const prims = symbolScreenPrims(item.funktionsTyp, [0, 0], w, d, 0, t);
  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${px} ${px}`}
      style={{ flexShrink: 0, borderRadius: 6, background: THEME.offwhite }}
      aria-hidden
    >
      {/* Bounding-Box als dezenter Rahmen, falls das Symbol schmal ist */}
      <rect
        x={toScreen([-w / 2, -d / 2], t)[0]}
        y={toScreen([-w / 2, -d / 2], t)[1]}
        width={w * scale}
        height={d * scale}
        fill="none"
        stroke={THEME.salbei}
        strokeWidth={0.6}
        opacity={0.5}
      />
      <g fill="none" stroke={THEME.gruen} strokeWidth={1.2} strokeLinejoin="round">
        {(prims ?? []).map((p, i) => {
          if (p.kind === "circle") return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} />;
          if (p.kind === "line") return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} />;
          return <polygon key={i} points={p.points} />;
        })}
      </g>
    </svg>
  );
}

/** Balken-Anzeige des Stil-Matches (0–100 %). */
function StilMatch({ wert }: { wert: number }) {
  const pct = Math.round(wert * 100);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title="Stil-Nähe">
      <span
        style={{
          width: 30,
          height: 5,
          borderRadius: 999,
          background: THEME.offwhite,
          overflow: "hidden",
          display: "inline-block",
        }}
      >
        <span
          style={{ display: "block", width: `${pct}%`, height: "100%", background: THEME.orange }}
        />
      </span>
      <span style={{ fontSize: 10.5, color: THEME.salbei }}>{pct}%</span>
    </span>
  );
}

export interface ObjektInfoPanelProps {
  item: KatalogItem;
  /** Andere Katalog-Items desselben Funktionstyps (Wechsel-Alternativen). */
  alternativen: KatalogItem[];
  /** Stilprofil für den Stil-Näheindikator (optional). */
  stilprofil?: Stilprofil | null;
  onTausch: (neueId: string) => void;
}

/** Wiederverwendbares Info-/Wechsel-Panel (2D und 3D/Anpassen teilen es sich). */
export function ObjektInfoPanel({
  item,
  alternativen,
  stilprofil,
  onTausch,
}: ObjektInfoPanelProps) {
  const naehe = (k: KatalogItem): number | null =>
    stilprofil ? stilNaehe(stilprofil.styleVector, k.achsenTags ?? {}) : null;

  return (
    <div>
      {/* Kosten des aktuellen Objekts */}
      <div
        className={CSS.soft}
        style={{
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 12.5, color: THEME.salbei }}>Kosten</span>
        <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: THEME.gruen }}>
          {preisText(item)}
        </span>
      </div>

      {alternativen.length > 0 && (
        <div>
          <p style={{ fontSize: 12.5, margin: "0 0 6px", color: THEME.gruen }}>
            Alternativen aus der Produktdatenbank ({alternativen.length}):
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {alternativen.map((a) => {
              const n = naehe(a);
              return (
                <button
                  key={a.id}
                  type="button"
                  className={CSS.card}
                  onClick={() => onTausch(a.id)}
                  title={`${a.name} – wechseln`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    cursor: "pointer",
                    textAlign: "left",
                    background: "#fff",
                    border: `1px solid ${THEME.salbei}`,
                  }}
                >
                  <SymbolThumb item={a} />
                  <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
                    <span
                      style={{
                        fontSize: 12.5,
                        color: THEME.gruen,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.name}
                    </span>
                    <span style={{ fontSize: 11, color: THEME.salbei }}>{masseText(a)}</span>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 2,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontSize: 11.5, color: THEME.gruen }}>{preisText(a)}</span>
                      {n !== null && <StilMatch wert={n} />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
