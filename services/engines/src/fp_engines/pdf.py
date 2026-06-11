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
        buf, pagesize=A4, title="Kostenschätzung – Future Planning",
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
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
        ["", "", "", f"Bandbreite ±{kv['bandbreitePct']}%",
         f"CHF {kv['von_chf']:,.0f} – {kv['bis_chf']:,.0f}"]
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
