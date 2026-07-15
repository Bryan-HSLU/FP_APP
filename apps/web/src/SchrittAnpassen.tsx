/** Schritt 4 «Anpassen» (UI-Redesign Etappe B, Bryan-Konzept).
 *
 *  Zwei Spalten: links der Viewer (2D/3D-Umschalter kommt aus App.tsx als
 *  `viewer`-Node), rechts die Elementkarte des gewählten Möbels mit Massen,
 *  Materialfarbe, Normstatus und den bestehenden Aktionen (Austauschen,
 *  Sperren). Ohne Auswahl eine Hilfe-Karte + globale Aktionen. Keyboard-
 *  Steuerung und Live-Ampel bleiben in App.tsx – hier nur Darstellung.
 */
import type { ReactNode } from "react";
import type { ConstraintReport } from "@fp/shared/rules";
import type { KatalogItem } from "./api";
import { farbHex } from "./farben";
import { materialFarbe } from "./moebel3d";
import {
  BODEN_SLUGS,
  MATERIAL_LABEL,
  materialSwatch,
  WAND_SLUGS,
  type FlaechenKonzept,
  type MaterialSlug,
  type OberflaechenSpez,
  type OberflaechenVarianten,
  type OberflaechenWahl,
} from "./oberflaechen";
import { ObjektInfoPanel } from "./ObjektInfoPanel";
import { Piktogramm } from "./Piktogramm";
import type { Stilprofil } from "./Stil";
import { CSS, FP_VAR, THEME, titel } from "./theme";
import type { FlaechenWahl } from "./Viewer3D";
import { BEREICH_LABEL, wandEintrag, type WandBereich, type WandInfo } from "./wandauswahl";

export interface SchrittAnpassenProps {
  viewer: ReactNode;
  gewaehltesItem: KatalogItem | null;
  elementStatus?: "verletzt" | "knapp";
  gesperrt: boolean;
  alternativen: KatalogItem[];
  /** Stilprofil für den Stil-Näheindikator der Wechsel-Alternativen (optional). */
  stilprofil?: Stilprofil | null;
  onTausch: (neueId: string) => void;
  onSperren: () => void;
  onWuerfeln: () => void;
  report: ConstraintReport | null;
  begruendung: string;
  /** Gewählte Oberfläche (Boden/Wand) im 3D – zeigt die Oberflächen-Karte. */
  flaeche?: FlaechenWahl | null;
  /** Angebotene Boden-/Wandvarianten des aktuellen Raumtyps. */
  oberflaechenVarianten?: OberflaechenVarianten | null;
  /** Aktuelle Variantenwahl (leer = stilabgeleitete Optik). */
  oberflaechenWahl?: OberflaechenWahl;
  /** Effektive (ggf. überschriebene) Oberflächen-Spez zur Anzeige. */
  aktuelleSpez?: OberflaechenSpez | null;
  onFlaecheVariante?: (art: FlaechenWahl, id: string) => void;
  /** Farbvarianten des gewählten Möbels (Welle 3) – Swatch-Reihe im Picker. */
  farbVarianten?: string[];
  /** Aktive Farbvariante (MANUELL > KI > Default) zur Markierung. */
  farbAktiv?: string;
  /** Farbwahl setzen (Slug) – manuelle Wahl gewinnt über die KI. */
  onFarbe?: (slug: string) => void;
  /** Effektives (ggf. manuell überschriebenes) Flächen-Konzept zur Markierung. */
  flaechenKonzept?: FlaechenKonzept | null;
  /** Manuelle Material-Wahl je Fläche (Welle 3/C) – Boden ODER Wand; bei Wand
   *  optional wandIndex (null = «Alle Wände») + Bereich. Der Server prüft die
   *  Wahl hart gegen die Norm (POST /flaechen/pruefen). */
  onFlaechenMaterial?: (
    art: FlaechenWahl,
    slug: MaterialSlug,
    wandIndex?: number | null,
    bereich?: WandBereich,
  ) => void;
  /** Wand-Zeilen (Länge · Öffnungen · Anschlüsse) fürs Einzelwand-Panel (Welle C). */
  wandInfos?: WandInfo[];
  /** Gewählte Einzelwand (null = «Alle Wände») – im 2D-Plan hervorgehoben. */
  gewaehlteWand?: number | null;
  onWandWahl?: (wandIndex: number | null) => void;
  /** Flächen-Karte ohne 3D-Klick öffnen («Boden/Wände anpassen», Welle C). */
  onFlaecheWaehlen?: (f: FlaechenWahl | null) => void;
}

/** Swatch-Reihe der Farbvarianten eines Objekts (Welle 3). Nur die Varianten des
 *  Katalog-Items; aktive markiert; Klick setzt den manuellen Override. */
function FarbPicker({
  varianten,
  aktiv,
  onWahl,
}: {
  varianten: string[];
  aktiv?: string;
  onWahl: (slug: string) => void;
}) {
  if (varianten.length < 1) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontSize: 12.5, margin: "0 0 6px", color: THEME.gruen }}>Farbe</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {varianten.map((slug) => {
          const an = slug === aktiv;
          return (
            <button
              key={slug}
              type="button"
              title={slug}
              aria-label={`Farbe ${slug}`}
              aria-pressed={an}
              onClick={() => onWahl(slug)}
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                cursor: "pointer",
                background: farbHex(slug),
                border: `2px solid ${an ? THEME.orange : THEME.salbei}`,
                boxShadow: an ? `0 0 0 2px ${THEME.offwhite}` : "none",
                flexShrink: 0,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Material-Swatch-Reihe (geerdete Slugs) für Boden bzw. Wände. Manuelle Wahl
 *  überschreibt die Kurator-/Stil-Optik; die harte Norm prüft serverseitig. */
function MaterialPicker({
  flaeche,
  aktiv,
  onWahl,
}: {
  flaeche: FlaechenWahl;
  aktiv?: string;
  onWahl: (art: FlaechenWahl, slug: MaterialSlug) => void;
}) {
  const slugs = flaeche === "boden" ? BODEN_SLUGS : WAND_SLUGS;
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 12.5, margin: "0 0 6px", color: THEME.gruen }}>
        Material (überschreibt Vorschlag, normgeprüft):
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {slugs.map((slug) => {
          const an = slug === aktiv;
          return (
            <button
              key={slug}
              type="button"
              title={MATERIAL_LABEL[slug]}
              aria-pressed={an}
              onClick={() => onWahl(flaeche, slug)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 8px",
                cursor: "pointer",
                borderRadius: 999,
                background: an ? THEME.offwhite : "#fff",
                border: `1px solid ${an ? THEME.orange : THEME.salbei}`,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  flexShrink: 0,
                  background: materialSwatch(slug),
                  border: `1px solid ${THEME.salbei}`,
                }}
              />
              <span style={{ fontSize: 11.5, color: THEME.gruen }}>{MATERIAL_LABEL[slug]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const MUSTER_LABEL: Record<string, string> = {
  uni: "Uni",
  fliesen: "Fliesen",
  parkett: "Parkett",
  stein: "Stein",
};

/** Wand-Liste des Flächen-Panels (Welle C): «Alle Wände»-Schnellwahl + je Wand
 *  eine Zeile mit Länge, Öffnungen und Anschlüssen (Daten aus dem Raummodell).
 *  Anzeige 1-basiert («Wand 1…N»), intern bleibt der 0-basierte wandIndex des
 *  Kurator-Vertrags. Die gewählte Wand wird im 2D-Plan hervorgehoben. */
function WandListe({
  wandInfos,
  gewaehlteWand,
  onWandWahl,
}: {
  wandInfos: WandInfo[];
  gewaehlteWand: number | null;
  onWandWahl: (wandIndex: number | null) => void;
}) {
  const zeile = (aktiv: boolean) => ({
    display: "block" as const,
    width: "100%",
    textAlign: "left" as const,
    padding: "6px 9px",
    borderRadius: 8,
    cursor: "pointer",
    background: aktiv ? THEME.offwhite : "#fff",
    border: `1px solid ${aktiv ? THEME.orange : THEME.salbei}`,
  });
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 12.5, margin: "0 0 6px", color: THEME.gruen }}>Gilt für:</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <button
          type="button"
          aria-pressed={gewaehlteWand === null}
          onClick={() => onWandWahl(null)}
          style={zeile(gewaehlteWand === null)}
        >
          <span style={{ fontSize: 12.5, fontWeight: 600, color: THEME.gruen }}>Alle Wände</span>
        </button>
        {wandInfos.map((w) => {
          const aktiv = gewaehlteWand === w.index;
          const details = [
            `${w.laengeM.toFixed(2)} m`,
            w.oeffnungen.length ? w.oeffnungen.join(", ") : "keine Öffnung",
            ...(w.anschluesse.length ? [`Anschlüsse: ${w.anschluesse.join(", ")}`] : []),
          ].join(" · ");
          return (
            <button
              key={w.index}
              type="button"
              aria-pressed={aktiv}
              onClick={() => onWandWahl(w.index)}
              style={zeile(aktiv)}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600, color: THEME.gruen }}>
                Wand {w.index + 1}
                {w.offen ? " (offen)" : ""}
              </span>
              <span style={{ display: "block", fontSize: 11.5, color: THEME.salbei }}>
                {details}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Bereich-Chips (voll/halbhoch/sockel) für die gewählte Einzelwand. Ohne
 *  Material an dieser Wand deaktiviert – der Bereich braucht ein Material. */
function BereichWahl({
  aktiv,
  deaktiviert,
  onWahl,
}: {
  aktiv: WandBereich;
  deaktiviert: boolean;
  onWahl: (b: WandBereich) => void;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ fontSize: 12.5, margin: "0 0 6px", color: THEME.gruen }}>Bereich:</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(Object.keys(BEREICH_LABEL) as WandBereich[]).map((b) => {
          const an = aktiv === b;
          return (
            <button
              key={b}
              type="button"
              aria-pressed={an}
              disabled={deaktiviert}
              title={deaktiviert ? "Zuerst ein Material wählen" : BEREICH_LABEL[b]}
              onClick={() => onWahl(b)}
              style={{
                padding: "5px 12px",
                borderRadius: 999,
                cursor: deaktiviert ? "default" : "pointer",
                opacity: deaktiviert ? 0.5 : 1,
                background: an ? THEME.offwhite : "#fff",
                border: `1px solid ${an ? THEME.orange : THEME.salbei}`,
                fontSize: 11.5,
                color: THEME.gruen,
              }}
            >
              {BEREICH_LABEL[b]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Elementkarte-Ersatz für eine gewählte Oberfläche (Boden/Wand). Zeigt das
 *  aktuelle Muster/Farbe und bietet die vordefinierten Varianten zur Auswahl –
 *  rein visuell, überschreibt lokal die stilabgeleitete Optik. Für Wände kommt
 *  die Einzelwand-Auswahl (Welle C) dazu: Material + Bereich je Wand ODER
 *  «Alle Wände»; die Wahl läuft serverseitig durch die Norm-Prüfung. */
function OberflaecheKarte({
  flaeche,
  varianten,
  wahl,
  spez,
  onVariante,
  flaechenKonzept,
  onFlaechenMaterial,
  wandInfos,
  gewaehlteWand = null,
  onWandWahl,
}: {
  flaeche: FlaechenWahl;
  varianten: OberflaechenVarianten;
  wahl: OberflaechenWahl | undefined;
  spez: OberflaechenSpez | null | undefined;
  onVariante: (art: FlaechenWahl, id: string) => void;
  flaechenKonzept?: FlaechenKonzept | null;
  onFlaechenMaterial?: (
    art: FlaechenWahl,
    slug: MaterialSlug,
    wandIndex?: number | null,
    bereich?: WandBereich,
  ) => void;
  wandInfos?: WandInfo[];
  gewaehlteWand?: number | null;
  onWandWahl?: (wandIndex: number | null) => void;
}) {
  const istBoden = flaeche === "boden";
  const liste = istBoden ? varianten.boden : varianten.wand;
  // Aktive Wand-Werte: Einzelwand → deren Eintrag; «Alle Wände» → nur markieren,
  // wenn wirklich alle Wände dasselbe Material tragen (sonst keine Markierung).
  const einzel = !istBoden && gewaehlteWand !== null ? gewaehlteWand : null;
  const einzelEintrag = einzel !== null ? wandEintrag(flaechenKonzept, einzel) : null;
  const waende = flaechenKonzept?.waende ?? [];
  const alleGleich =
    waende.length > 0 &&
    waende.length === (wandInfos?.length ?? waende.length) &&
    waende.every((w) => w.material === waende[0]?.material)
      ? waende[0]?.material
      : undefined;
  const materialAktiv = istBoden
    ? flaechenKonzept?.boden?.material
    : einzel !== null
      ? einzelEintrag?.material
      : alleGleich;
  const bereichAktiv: WandBereich = einzelEintrag?.bereich ?? "voll";
  const aktuelleId = istBoden ? wahl?.boden : wahl?.wand;
  const aktSpez = istBoden ? spez?.boden : spez?.wand;
  const aktFarbe = aktSpez
    ? "grundfarbe" in aktSpez
      ? aktSpez.grundfarbe
      : aktSpez.farbe
    : THEME.salbei;
  const aktMuster = aktSpez ? (MUSTER_LABEL[aktSpez.muster] ?? aktSpez.muster) : "–";
  return (
    <div className={`${CSS.card} ${CSS.cardAktiv}`} style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <Piktogramm name="material" groesse={44} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ ...titel, margin: 0, fontSize: 16 }}>Oberfläche</h3>
          <span style={{ fontSize: 12, color: THEME.salbei }}>
            {istBoden ? "Boden" : einzel !== null ? `Wand ${einzel + 1}` : "Wände"}
          </span>
        </div>
      </div>

      <div
        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12 }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            background: aktFarbe,
            border: `1px solid ${THEME.salbei}`,
          }}
        />
        <span style={{ color: THEME.salbei }}>Aktuell</span>
        <span style={{ marginLeft: "auto", color: THEME.gruen }}>{aktMuster}</span>
      </div>

      <p style={{ fontSize: 12.5, margin: "0 0 6px", color: THEME.gruen }}>
        Varianten ({liste.length}):
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {liste.map((v) => {
          const farbe = "grundfarbe" in v.spez ? v.spez.grundfarbe : v.spez.farbe;
          const aktiv = aktuelleId === v.id;
          return (
            <button
              key={v.id}
              type="button"
              className={CSS.card}
              onClick={() => onVariante(flaeche, v.id)}
              aria-pressed={aktiv}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 10px",
                cursor: "pointer",
                textAlign: "left",
                background: aktiv ? THEME.offwhite : "#fff",
                border: `1px solid ${aktiv ? THEME.orange : THEME.salbei}`,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  flexShrink: 0,
                  background: farbe,
                  border: `1px solid ${THEME.salbei}`,
                }}
              />
              <span style={{ fontSize: 12.5, color: THEME.gruen, minWidth: 0, flex: 1 }}>
                {v.label}
              </span>
              {aktiv && <span style={{ fontSize: 11, color: THEME.orange }}>aktiv</span>}
            </button>
          );
        })}
      </div>
      {!istBoden && wandInfos && wandInfos.length > 0 && onWandWahl && (
        <WandListe wandInfos={wandInfos} gewaehlteWand={gewaehlteWand} onWandWahl={onWandWahl} />
      )}
      {onFlaechenMaterial && (
        <MaterialPicker
          flaeche={flaeche}
          aktiv={materialAktiv}
          onWahl={(art, slug) =>
            onFlaechenMaterial(
              art,
              slug,
              istBoden ? undefined : einzel,
              istBoden ? undefined : bereichAktiv,
            )
          }
        />
      )}
      {!istBoden && einzel !== null && onFlaechenMaterial && (
        <BereichWahl
          aktiv={bereichAktiv}
          deaktiviert={!einzelEintrag?.material}
          onWahl={(b) =>
            einzelEintrag?.material && onFlaechenMaterial("wand", einzelEintrag.material, einzel, b)
          }
        />
      )}

      <p style={{ fontSize: 11.5, color: THEME.salbei, marginTop: 12, marginBottom: 0 }}>
        Material{" "}
        {istBoden
          ? ""
          : einzel !== null
            ? `gilt nur für Wand ${einzel + 1}, `
            : "gilt für alle Wände, "}
        überschreibt den Vorschlag und wird hart gegen die Norm geprüft – Korrekturen werden als
        «normkonform angepasst» ausgewiesen · Varianten oben sind rein visuell.
      </p>
    </div>
  );
}

const STATUS_TEXT = {
  passt: { text: "passt", farbe: THEME.gruen, aktiv: false },
  knapp: { text: "knapp", farbe: FP_VAR.accent, aktiv: true },
  anpassen: { text: "anpassen", farbe: "#c0392b", aktiv: true },
} as const;

/** Prioritätsklassen-Erklärung (Tooltip auf dem Badge). */
const PRIO_TEXT: Record<string, string> = {
  P1: "P1 – Pflichtobjekt",
  P2: "P2 – wichtig",
  P3: "P3 – optional",
};

export function SchrittAnpassen({
  viewer,
  gewaehltesItem,
  elementStatus,
  gesperrt,
  alternativen,
  stilprofil,
  onTausch,
  onSperren,
  onWuerfeln,
  report,
  begruendung,
  flaeche,
  oberflaechenVarianten,
  oberflaechenWahl,
  aktuelleSpez,
  onFlaecheVariante,
  farbVarianten,
  farbAktiv,
  onFarbe,
  flaechenKonzept,
  onFlaechenMaterial,
  wandInfos,
  gewaehlteWand,
  onWandWahl,
  onFlaecheWaehlen,
}: SchrittAnpassenProps) {
  const statusKey =
    elementStatus === "verletzt" ? "anpassen" : elementStatus === "knapp" ? "knapp" : "passt";
  const st = STATUS_TEXT[statusKey];

  return (
    <div
      className={`${CSS.twoColumn} ${CSS.schrittNeu}`}
      style={{ padding: 16, alignItems: "start" }}
    >
      {/* ---------- Viewer (feste Höhe kommt aus App) ---------- */}
      <div style={{ minWidth: 0 }}>{viewer}</div>

      {/* ---------- Panel rechts ---------- */}
      <aside key={flaeche ?? gewaehltesItem?.id ?? "leer"} style={{ minWidth: 0 }}>
        {flaeche && oberflaechenVarianten && onFlaecheVariante ? (
          <OberflaecheKarte
            flaeche={flaeche}
            varianten={oberflaechenVarianten}
            wahl={oberflaechenWahl}
            spez={aktuelleSpez}
            onVariante={onFlaecheVariante}
            flaechenKonzept={flaechenKonzept}
            onFlaechenMaterial={onFlaechenMaterial}
            wandInfos={wandInfos}
            gewaehlteWand={gewaehlteWand}
            onWandWahl={onWandWahl}
          />
        ) : gewaehltesItem ? (
          <div className={`${CSS.card} ${CSS.cardAktiv}`} style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <Piktogramm name="moebel" groesse={44} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3 style={{ ...titel, margin: 0, fontSize: 16 }}>{gewaehltesItem.name}</h3>
                <span style={{ fontSize: 12, color: THEME.salbei }}>
                  {gewaehltesItem.funktionsTyp}
                </span>
              </div>
              <span
                title={PRIO_TEXT[gewaehltesItem.priorityClass]}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#fff",
                  background: THEME.gruen,
                  borderRadius: 999,
                  padding: "2px 9px",
                  whiteSpace: "nowrap",
                }}
              >
                {gewaehltesItem.priorityClass}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  background: materialFarbe(gewaehltesItem.funktionsTyp),
                  border: `1px solid ${THEME.salbei}`,
                }}
              />
              <span style={{ color: THEME.salbei }}>Material</span>
              <span style={{ marginLeft: "auto", color: THEME.gruen }}>
                {gewaehltesItem.masse.w} × {gewaehltesItem.masse.d} × {gewaehltesItem.masse.h} m
              </span>
            </div>

            {/* Farb-Picker: nur die Farbvarianten dieses Objekts (Welle 3) */}
            {farbVarianten && farbVarianten.length > 0 && onFarbe && (
              <FarbPicker varianten={farbVarianten} aktiv={farbAktiv} onWahl={onFarbe} />
            )}

            {/* Normstatus des Elements */}
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
              <Piktogramm name="norm" aktiv={st.aktiv} groesse={32} />
              <span style={{ color: st.farbe, fontWeight: 600 }}>{st.text}</span>
            </div>

            {/* Kosten + Wechsel-Alternativen (Thumbnail, Preis, Massen, Stil-Match) */}
            <div style={{ marginBottom: 12 }}>
              <ObjektInfoPanel
                item={gewaehltesItem}
                alternativen={alternativen}
                stilprofil={stilprofil}
                onTausch={onTausch}
              />
            </div>
            <button
              type="button"
              className={CSS.button}
              onClick={onSperren}
              style={{
                width: "100%",
                borderRadius: 999,
                padding: "9px 14px",
                cursor: "pointer",
                border: `1px solid ${THEME.gruen}`,
                background: gesperrt ? THEME.gruen : "#fff",
                color: gesperrt ? "#fff" : THEME.gruen,
                display: "inline-flex",
                gap: 8,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Piktogramm
                name={gesperrt ? "norm" : "material"}
                aktiv={false}
                groesse={27}
                style={gesperrt ? { filter: "brightness(0) invert(1)" } : undefined}
              />
              {gesperrt ? "Entsperren" : "Sperren"}
            </button>

            <p style={{ fontSize: 11.5, color: THEME.salbei, marginTop: 12, marginBottom: 0 }}>
              Verschieben: ziehen (2D) oder Pfeiltasten · «r» = drehen · Klick daneben = abwählen.
            </p>
          </div>
        ) : (
          <>
            <div className={CSS.soft} style={{ padding: 16, marginBottom: 12 }}>
              <h3 style={{ ...titel, marginTop: 0, fontSize: 15 }}>Anpassen</h3>
              <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                Tippe ein Möbel im Plan an, um es zu verschieben, zu drehen, auszutauschen oder zu
                sperren. Passt alles, geht es weiter zur Auswertung.
              </p>
            </div>

            <button
              type="button"
              className={CSS.button}
              onClick={onWuerfeln}
              style={{
                width: "100%",
                borderRadius: 999,
                padding: "10px 14px",
                cursor: "pointer",
                border: `1px solid ${THEME.gruen}`,
                background: "#fff",
                color: THEME.gruen,
                display: "inline-flex",
                gap: 8,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Piktogramm name="varianten" groesse={29} /> Andere Variante würfeln
            </button>

            {/* Flächen ohne 3D-Klick anpassen (Welle C): öffnet die Oberflächen-
                Karte mit Wand-Liste bzw. Boden-Material direkt aus dem Panel. */}
            {onFlaecheWaehlen && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {(
                  [
                    ["boden", "Boden anpassen"],
                    ["wand", "Wände anpassen"],
                  ] as const
                ).map(([art, label]) => (
                  <button
                    key={art}
                    type="button"
                    className={CSS.button}
                    onClick={() => onFlaecheWaehlen(art)}
                    style={{
                      flex: 1,
                      borderRadius: 999,
                      padding: "8px 12px",
                      cursor: "pointer",
                      border: `1px solid ${THEME.gruen}`,
                      background: "#fff",
                      color: THEME.gruen,
                      fontSize: 12.5,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {begruendung && (
              <div className={CSS.soft} style={{ padding: 12, marginTop: 12 }}>
                <p style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>{begruendung}</p>
              </div>
            )}
          </>
        )}

        {/* Live-Ampel (kompakt) – immer sichtbar, Logik unverändert. */}
        {report && (
          <div className={CSS.soft} style={{ padding: 12, marginTop: 12 }}>
            <h4 style={{ ...titel, marginTop: 0, fontSize: 13 }}>
              Normprüfung {report.hard.ok ? "✓" : "⚠"}
            </h4>
            <p style={{ fontSize: 12, margin: "0 0 6px", color: THEME.salbei }}>
              {report.hard.summary.erfuellt} ok · {report.hard.summary.knapp} knapp ·{" "}
              {report.hard.summary.verletzt} verletzt
            </p>
            <ul style={{ listStyle: "none", padding: 0, fontSize: 12, margin: 0 }}>
              {report.results.map((r) => (
                <li key={r.ruleId} style={{ marginBottom: 2 }}>
                  {r.status === "ok"
                    ? "✅"
                    : r.status === "knapp"
                      ? "⚠️"
                      : r.status === "verletzt"
                        ? "❌"
                        : "➖"}{" "}
                  <code>{r.ruleId}</code>
                  {r.margin_cm !== null && ` · ${r.margin_cm} cm`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
