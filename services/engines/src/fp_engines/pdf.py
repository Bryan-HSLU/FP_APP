"""KV-PDF (Kostenschätzung) – ReportLab, CI-Look (Dunkelgrün/Orange/Off-White).

ReportLab statt WeasyPrint: reines Python ohne System-Libs (pango/cairo) →
läuft identisch auf Bryans Windows-Maschine und in der CI.
"""

from datetime import date
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

# Corporate Identity (POC-Bauumfang): Dunkelgrün / Orange / Off-White
CI_GRUEN = colors.HexColor("#1f4d3a")
CI_ORANGE = colors.HexColor("#c96f2e")
CI_OFFWHITE = colors.HexColor("#faf7f0")

_TITEL = ParagraphStyle("titel", fontSize=18, textColor=CI_GRUEN, spaceAfter=2 * mm)
_SUB = ParagraphStyle("sub", fontSize=10, textColor=colors.grey, spaceAfter=6 * mm)
_TEXT = ParagraphStyle("text", fontSize=9, spaceAfter=2 * mm)
_WARN = ParagraphStyle("warn", fontSize=9, textColor=CI_ORANGE, spaceBefore=4 * mm)


def kv_pdf(kv: dict[str, Any]) -> bytes:
    """KV-Datenstruktur (auswertung.evaluate_plan) → PDF-Bytes."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        title="Kostenschätzung – Future Planning",
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    story: list[Any] = [
        Paragraph("Future Planning – Kostenschätzung (KV)", _TITEL),
        Paragraph(
            f"{kv['raumName']} · Stand {date.today().isoformat()} · "
            f"Bodenfläche {kv['mengen']['bodenflaeche_m2']} m² · "
            f"Wandfläche {kv['mengen']['wandflaeche_m2']} m²",
            _SUB,
        ),
    ]

    daten = [["Position", "Gewerk", "Menge", "Einzelpreis", "Total"]]
    for p in kv["positionen"]:
        daten.append(
            [
                p["bezeichnung"],
                p["gewerk"],
                f"{p['menge']} {p['einheit']}",
                f"CHF {p['einzelpreis_chf']:,.0f}",
                f"CHF {p['total_chf']:,.0f}",
            ]
        )
    daten.append(["", "", "", "Summe", f"CHF {kv['summe_chf']:,.0f}"])
    daten.append(
        [
            "",
            "",
            "",
            f"Bandbreite ±{kv['bandbreitePct']}%",
            f"CHF {kv['von_chf']:,.0f} – {kv['bis_chf']:,.0f}",
        ]
    )

    tabelle = Table(daten, colWidths=[60 * mm, 28 * mm, 22 * mm, 32 * mm, 32 * mm])
    tabelle.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), CI_GRUEN),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ROWBACKGROUNDS", (0, 1), (-1, -3), [colors.white, CI_OFFWHITE]),
                ("LINEABOVE", (0, -2), (-1, -2), 0.75, CI_GRUEN),
                ("FONTNAME", (3, -2), (-1, -1), "Helvetica-Bold"),
                ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
            ]
        )
    )
    story.append(tabelle)
    story.append(Spacer(1, 6 * mm))

    if kv["nextSteps"]:
        story.append(Paragraph("<b>Next Steps / vor Ort prüfen:</b>", _TEXT))
        for zeile in kv["nextSteps"]:
            story.append(Paragraph(f"• {zeile}", _TEXT))

    story.append(Paragraph(f"⚠ {kv['hinweis']}", _WARN))
    doc.build(story)
    return buf.getvalue()


def lv_pdf(lv: dict[str, Any]) -> bytes:
    """Leistungsverzeichnis als PDF: Positionen je Gewerk, mit Schätzpreisen."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        title="Leistungsverzeichnis – Future Planning",
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    story: list[Any] = [
        Paragraph("Future Planning – Leistungsverzeichnis (vereinfacht)", _TITEL),
        Paragraph(f"{lv['raumName']} · Stand {date.today().isoformat()}", _SUB),
    ]
    for gewerk, positionen in lv["gewerke"].items():
        story.append(Paragraph(f"<b>Gewerk: {gewerk}</b>", _TEXT))
        daten = [["Pos.", "Leistung", "Menge", "EP (CHF)", "Total (CHF)"]]
        for p in positionen:
            daten.append(
                [
                    p["posNr"],
                    Paragraph(p["text"], _TEXT),
                    f"{p['menge']} {p['einheit']}",
                    f"{p['einheitspreis']['value']:,.0f}",
                    f"{p['total_chf']:,.0f}",
                ]
            )
        t = Table(daten, colWidths=[16 * mm, 84 * mm, 26 * mm, 24 * mm, 24 * mm])
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), CI_GRUEN),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        story.append(t)
        story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(f"<b>Summe: CHF {lv['summe_chf']:,.0f}</b>", _TEXT))
    story.append(Paragraph(f"⚠ {lv['hinweis']}", _WARN))
    doc.build(story)
    return buf.getvalue()


def bauzeit_pdf(bz: dict[str, Any]) -> bytes:
    """Bauzeitenplan als einfaches Text-Gantt (relative Arbeitstage)."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        title="Bauzeitenplan – Future Planning",
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    story: list[Any] = [
        Paragraph("Future Planning – Bauzeitenplan", _TITEL),
        Paragraph(
            f"{bz['raumName']} · Gesamtdauer ca. {bz['gesamtdauer_arbeitstage']} Arbeitstage "
            f"(Bandbreite {bz['von_tage']}–{bz['bis_tage']})",
            _SUB,
        ),
    ]
    daten = [["Phase", "Gewerke", "Start (AT)", "Dauer (AT)", "Trocknung (AT)"]]
    for z in bz["zeilen"]:
        daten.append(
            [
                z["name"],
                ", ".join(z["gewerke"]),
                f"{z['start_tag']}",
                f"{z['dauer_tage']}",
                f"{z['trocknung_tage']}" if z["trocknung_tage"] else "–",
            ]
        )
    t = Table(daten, colWidths=[56 * mm, 50 * mm, 22 * mm, 22 * mm, 26 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), CI_GRUEN),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CI_OFFWHITE]),
                ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
            ]
        )
    )
    story.append(t)
    story.append(Paragraph(f"⚠ {bz['hinweis']}", _WARN))
    doc.build(story)
    return buf.getvalue()


def offertanfrage_pdf(lv: dict[str, Any], bz: dict[str, Any]) -> bytes:
    """Offertanfrage-Paket: je Gewerk LV OHNE Preise + Zeitfenster + Rückgabeblatt.

    Bewusst ohne Schätzpreise (LV-Bauzeit-Detailkonzept §4, konservativ):
    nur Mengen – der Handwerker trägt seine Preise im Rückgabeblatt ein.
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        title="Offertanfrage – Future Planning",
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    fenster = {
        g: (z["start_tag"], z["start_tag"] + z["dauer_tage"])
        for z in bz["zeilen"]
        for g in z["gewerke"]
    }
    story: list[Any] = [
        Paragraph("Future Planning – Offertanfrage-Paket", _TITEL),
        Paragraph(f"{lv['raumName']} · Stand {date.today().isoformat()}", _SUB),
    ]
    for gewerk, positionen in lv["gewerke"].items():
        story.append(Paragraph(f"<b>Offertanfrage Gewerk: {gewerk}</b>", _TEXT))
        if gewerk in fenster:
            von, bis = fenster[gewerk]
            story.append(
                Paragraph(
                    f"Vorgesehenes Zeitfenster: Arbeitstag {von:g}–{bis:g} (relativ zum Baustart)",
                    _TEXT,
                )
            )
        daten = [["Pos.", "Leistung", "Menge", "Ihr EP (CHF)", "Ihr Total (CHF)"]]
        for p in positionen:
            daten.append(
                [p["posNr"], Paragraph(p["text"], _TEXT), f"{p['menge']} {p['einheit']}", "", ""]
            )
        t = Table(daten, colWidths=[16 * mm, 84 * mm, 26 * mm, 24 * mm, 24 * mm])
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), CI_ORANGE),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("GRID", (3, 1), (-1, -1), 0.5, colors.grey),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        story.append(t)
        story.append(Spacer(1, 6 * mm))
    story.append(
        Paragraph(
            "Rückgabe: Bitte Einheits- und Totalpreise je Position eintragen und das "
            "Blatt zurücksenden. Mengen sind aus der digitalen Planung abgeleitet "
            "(vereinfachte Positionen, NPK-mapping-fähig).",
            _TEXT,
        )
    )
    doc.build(story)
    return buf.getvalue()
