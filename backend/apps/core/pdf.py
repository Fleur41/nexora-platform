"""One-page business documents (invoices, receipts) as PDF, in the same style as report exports.

Callers describe the document; this module only lays it out. Text is escaped here, so names,
descriptions and notes typed by users can never inject reportlab markup.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from decimal import Decimal
from xml.sax.saxutils import escape


def money(value: Decimal | str | int, currency: str) -> str:
    return f"{currency} {Decimal(str(value)):,.2f}"


@dataclass
class Party:
    """A labelled block of lines, e.g. "Bill to" + name, unit, lease."""

    label: str
    lines: list[str]


@dataclass
class Document:
    organization: object  # Organization: letterhead and author
    kind: str  # "INVOICE", "RECEIPT"
    number: str
    left: Party
    right: Party
    columns: tuple[str, str] = ("Description", "Amount")
    rows: list[tuple[str, str]] = field(default_factory=list)
    # (label, amount, emphasised?) under the rows, e.g. total, paid, amount due.
    totals: list[tuple[str, str, bool]] = field(default_factory=list)
    # A large word across the top, e.g. "VOID" or "REVERSED".
    stamp: str = ""
    stamp_note: str = ""
    sections: list[tuple[str, list[str]]] = field(default_factory=list)  # (heading, paragraphs)
    footer: str = ""


def render(doc: Document) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    navy = colors.HexColor("#0B2545")
    muted = colors.HexColor("#5B6475")
    line = colors.HexColor("#E3E7EE")
    red = colors.HexColor("#B42318")
    styles = getSampleStyleSheet()
    normal = ParagraphStyle("n", parent=styles["Normal"], fontSize=9, leading=12)
    right = ParagraphStyle("r", parent=normal, alignment=2)
    small = ParagraphStyle("sm", parent=normal, textColor=muted, fontSize=8, leading=10)
    small_right = ParagraphStyle("smr", parent=small, alignment=2)
    org_name = ParagraphStyle("o", parent=normal, fontSize=13, leading=16, textColor=navy)
    kind = ParagraphStyle("k", parent=right, fontSize=20, leading=24, textColor=navy)
    h2 = ParagraphStyle("h2", parent=normal, fontSize=10, textColor=navy, spaceBefore=10)
    stamp = ParagraphStyle("st", parent=normal, fontSize=14, leading=18, textColor=red)

    org = doc.organization
    width = A4[0] - 36 * mm
    e = escape

    contact = [x for x in (org.address, " · ".join(x for x in (org.phone, org.email) if x)) if x]
    header = Table(
        [
            [
                [Paragraph(f"<b>{e(org.legal_name or org.name)}</b>", org_name)]
                + [Paragraph(e(c), small) for c in contact],
                [Paragraph(f"<b>{e(doc.kind)}</b>", kind), Paragraph(e(doc.number), right)],
            ]
        ],
        colWidths=[width * 0.6, width * 0.4],
    )
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, 0), 0.75, line),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story = [header, Spacer(1, 8)]
    if doc.stamp:
        story.append(Paragraph(f"<b>{e(doc.stamp)}</b>", stamp))
        if doc.stamp_note:
            story.append(Paragraph(e(doc.stamp_note), normal))
        story.append(Spacer(1, 6))

    def party(p: Party, align_right=False):
        label, body = (small_right, right) if align_right else (small, normal)
        return [Paragraph(e(p.label.upper()), label)] + [
            Paragraph(f"<b>{e(x)}</b>" if i == 0 else e(x), body) for i, x in enumerate(p.lines)
        ]

    parties = Table(
        [[party(doc.left), party(doc.right, align_right=True)]], colWidths=[width / 2] * 2
    )
    parties.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
            ]
        )
    )
    story.append(parties)

    head = [
        Paragraph(f"<font color='white'><b>{e(doc.columns[0])}</b></font>", normal),
        Paragraph(f"<font color='white'><b>{e(doc.columns[1])}</b></font>", right),
    ]
    body = [[Paragraph(e(d), normal), Paragraph(e(a), right)] for d, a in doc.rows]
    foot = [
        [
            Paragraph(f"<b>{e(label)}</b>" if strong else e(label), right),
            Paragraph(f"<b>{e(amount)}</b>" if strong else e(amount), right),
        ]
        for label, amount, strong in doc.totals
    ]
    table = Table([head, *body, *foot], colWidths=[width * 0.72, width * 0.28], repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), navy),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, len(body)), 0.25, line),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if foot:
        first_total = len(body) + 1
        style += [("LINEABOVE", (0, first_total), (-1, first_total), 0.75, navy)]
        for i, (_, _, strong) in enumerate(doc.totals):
            if strong:
                row = first_total + i
                style.append(("BACKGROUND", (0, row), (-1, row), colors.HexColor("#F5F7FA")))
    table.setStyle(TableStyle(style))
    story.append(table)

    for heading, paragraphs in doc.sections:
        story.append(Paragraph(f"<b>{e(heading)}</b>", h2))
        story += [Paragraph(e(p).replace("\n", "<br/>"), normal) for p in paragraphs]

    def footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(muted)
        canvas.drawString(18 * mm, 10 * mm, doc.footer)
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, "Nexora")
        canvas.restoreState()

    buf = io.BytesIO()
    SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=18 * mm,
        title=f"{doc.kind.title()} {doc.number}",
        author=org.legal_name or org.name,
    ).build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


def pdf_response(content: bytes, filename: str):
    """A private PDF download: never cached by browsers or proxies."""
    from django.http import HttpResponse

    response = HttpResponse(content, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Cache-Control"] = "private, no-store"
    return response
