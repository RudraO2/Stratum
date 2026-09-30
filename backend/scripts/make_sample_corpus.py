"""Generate Stratum's SAMPLE demo corpus (corpus/sample/).

Every file is stamped "SAMPLE — synthetic document for demonstration; figures
approximate published data". Replace with real CMPDI / Ministry of Coal
documents for any claim beyond a demo. The corpus exercises every path:

  sample-provisional-coal-statistics-2023-24.pdf   digital PDF, subsidiary tables + narrative (final figures)
  sample-cil-annual-report-2023-24-excerpt.pdf     target vs achievement, narrative on growth drivers
  sample-pib-press-release-april-2024.pdf          provisional CIL figure (773.6) vs final (773.8) → discrepancy
  sample-ls-usq-2150-29-07-2024.pdf                past PQ reply, SECL FY24 186.9 (provisional) → past-reply mismatch warning
  sample-rs-usq-1187-05-12-2024.pdf                past PQ reply on import substitution (narrative, RAG)
  sample-ls-usq-3021-10-03-2025.pdf                past PQ reply on mine safety (narrative, RAG)
  sample-scanned-coal-directory-2018-19-p42.pdf    image-only scan, 5-year table, one misprinted total → review queue
  sample-subsidiary-production-2019-24.xlsx        lakh tonnes → unit conversion to MT
"""

from __future__ import annotations

import io
import random
from pathlib import Path

from PIL import Image, ImageFilter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = Path(__file__).resolve().parents[2] / "corpus" / "sample"
STAMP = "SAMPLE — synthetic document for demonstration; figures approximate published data."

SUBS = ["ECL", "BCCL", "CCL", "NCL", "WCL", "SECL", "MCL", "NEC"]
PROD = {  # million tonnes
    "FY2022-23": [36.97, 36.50, 76.10, 131.30, 62.00, 167.00, 193.30, 0.03],
    "FY2023-24": [47.60, 40.50, 86.10, 136.20, 69.10, 187.00, 207.10, 0.20],
}
OFFTAKE = {
    "FY2022-23": [38.00, 35.40, 76.80, 128.40, 63.50, 162.90, 189.60, 0.10],
    "FY2023-24": [46.00, 38.30, 85.20, 132.60, 66.40, 178.40, 206.40, 0.20],
}
TARGET_24 = [48.00, 40.00, 88.00, 136.00, 70.00, 190.00, 207.50, 0.50]

styles = getSampleStyleSheet()
BODY = ParagraphStyle("body", parent=styles["BodyText"], fontSize=10.5, leading=14)
H1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=15)
H2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12)
SMALL = ParagraphStyle("small", parent=styles["BodyText"], fontSize=7.5, textColor=colors.HexColor("#8a5a00"))
CENTER = ParagraphStyle("center", parent=BODY, alignment=1)
CENTER_B = ParagraphStyle("centerb", parent=CENTER, fontName="Helvetica-Bold")


def grid(data, widths=None):
    t = Table(data, colWidths=widths, hAlign="CENTER")
    t.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8e8e8")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ]
        )
    )
    return t


def build(name: str, story: list) -> None:
    path = OUT / name
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=1.6 * cm, bottomMargin=1.6 * cm)
    doc.build([Paragraph(STAMP, SMALL), Spacer(1, 6), *story])


def sub_table(values: dict, periods: list[str], growth: bool = True, total_label: str = "Total CIL"):
    head = ["Subsidiary", *[p.replace("FY", "") for p in periods]] + (["Growth (%)"] if growth else [])
    rows = [head]
    for i, s in enumerate(SUBS):
        row = [s, *[f"{values[p][i]:.2f}" for p in periods]]
        if growth:
            a, b = values[periods[0]][i], values[periods[-1]][i]
            row.append(f"{(b - a) / a * 100:.2f}" if a else "-")
        rows.append(row)
    totals = [sum(values[p]) for p in periods]
    row = [total_label, *[f"{t:.2f}" for t in totals]]
    if growth:
        row.append(f"{(totals[-1] - totals[0]) / totals[0] * 100:.2f}")
    rows.append(row)
    return grid(rows)


def provisional_statistics():
    story = [
        Paragraph("Provisional Coal Statistics 2023-24", H1),
        Paragraph("Ministry of Coal — Coal Controller's Organisation (sample excerpt)", BODY),
        Spacer(1, 10),
        Paragraph("Chapter 3: Production", H2),
        Paragraph(
            "All India raw coal production during 2023-24 reached 997.83 million tonnes, compared with 893.19 million tonnes in 2022-23, a growth of 11.71 per cent. "
            "Coal India Limited contributed 773.81 million tonnes. The increase was driven by higher output from the large opencast mines of SECL and MCL, "
            "faster clearances for mine expansion, improved evacuation through first mile connectivity projects, and higher mechanisation with surface miners.",
            BODY,
        ),
        Spacer(1, 8),
        Paragraph("Table 3.1: Subsidiary-wise raw coal production of CIL (in Million Tonnes)", BODY),
        Spacer(1, 4),
        sub_table(PROD, ["FY2022-23", "FY2023-24"]),
        Spacer(1, 10),
        Paragraph("Table 3.2: Company-wise raw coal production, All India (in Million Tonnes)", BODY),
        Spacer(1, 4),
        grid([["Company", "2022-23", "2023-24"], ["CIL", "703.20", "773.81"], ["SCCL", "67.14", "70.02"], ["Captive/Others", "122.85", "154.00"], ["All India", "893.19", "997.83"]]),
        Spacer(1, 12),
        Paragraph("Chapter 4: Offtake", H2),
        Paragraph(
            "Raw coal offtake by CIL during 2023-24 was 753.50 million tonnes against 694.70 million tonnes in 2022-23. Supply to the power sector accounted for about 80 per cent of the offtake. "
            "Coal stocks at pitheads remained comfortable through the year owing to improved rake availability.",
            BODY,
        ),
        Spacer(1, 8),
        Paragraph("Table 4.1: Subsidiary-wise raw coal offtake of CIL (in Million Tonnes)", BODY),
        Spacer(1, 4),
        sub_table(OFFTAKE, ["FY2022-23", "FY2023-24"]),
    ]
    build("sample-provisional-coal-statistics-2023-24.pdf", story)


def annual_report():
    rows = [["Subsidiary", "Target 2023-24", "Actual 2023-24", "Achievement (%)"]]
    for i, s in enumerate(SUBS):
        t, a = TARGET_24[i], PROD["FY2023-24"][i]
        rows.append([s, f"{t:.2f}", f"{a:.2f}", f"{a / t * 100:.2f}"])
    rows.append(["CIL", f"{sum(TARGET_24):.2f}", f"{sum(PROD['FY2023-24']):.2f}", f"{sum(PROD['FY2023-24']) / sum(TARGET_24) * 100:.2f}"])
    story = [
        Paragraph("Coal India Limited — Annual Report 2023-24 (sample excerpt)", H1),
        Paragraph("Directors' Report", H2),
        Paragraph(
            "Your Company achieved coal production of 773.81 million tonnes in 2023-24 against the annual target of 780 million tonnes, the highest ever. "
            "MCL and SECL together contributed more than half of the total. ECL recorded the highest growth among subsidiaries at over 28 per cent, "
            "driven by the ramp-up of the Rajmahal expansion. NEC's production remained constrained by pending forest clearances.",
            BODY,
        ),
        Spacer(1, 8),
        Paragraph("Production target and achievement, 2023-24 (figures in Million Tonnes)", BODY),
        Spacer(1, 4),
        grid(rows),
        Spacer(1, 10),
        Paragraph("Safety", H2),
        Paragraph(
            "The Company continued its focus on zero-harm mining. Safety audits by multidisciplinary teams, proximity warning devices on heavy earth-moving machinery, "
            "and real-time gas monitoring in underground mines were extended. Fatality rate per million tonnes of coal produced declined compared with the previous year.",
            BODY,
        ),
        Paragraph("Mine closure", H2),
        Paragraph(
            "Progressive and final mine closure plans are implemented under the guidelines of the Ministry of Coal. Reclaimed land is being developed as eco-parks, "
            "water bodies and plantations; 1,610 hectares were brought under biological reclamation during the year.",
            BODY,
        ),
    ]
    build("sample-cil-annual-report-2023-24-excerpt.pdf", story)


def press_release():
    story = [
        Paragraph("Press Information Bureau — Ministry of Coal (sample)", H2),
        Paragraph("Coal India registers record production of 773.6 million tonnes in FY 2023-24 (provisional)", H1),
        Paragraph(
            "New Delhi, 1 April 2024. Coal India Limited closed financial year 2023-24 with a provisional production of 773.6 million tonnes, "
            "a growth of about 10 per cent over the previous year. Offtake stood at 753.5 million tonnes (provisional). "
            "The Ministry attributed the growth to faster statutory clearances, digital monitoring of mines and the commissioning of new first mile connectivity projects.",
            BODY,
        ),
        Spacer(1, 8),
        Paragraph("Provisional production, FY 2023-24 (Million Tonnes)", BODY),
        grid([["Company", "2023-24 (Prov.)"], ["CIL", "773.60"], ["SECL", "186.90"], ["MCL", "206.90"]]),
    ]
    build("sample-pib-press-release-april-2024.pdf", story)


def pq_header(house: str, number: str, date: str, subject: str) -> list:
    return [
        Paragraph("GOVERNMENT OF INDIA", CENTER_B),
        Paragraph("MINISTRY OF COAL", CENTER_B),
        Paragraph(house, CENTER_B),
        Paragraph(f"UNSTARRED QUESTION NO. {number}", CENTER_B),
        Paragraph(f"TO BE ANSWERED ON {date}", CENTER_B),
        Spacer(1, 4),
        Paragraph(subject, CENTER_B),
        Spacer(1, 8),
    ]


def pq_production():
    subs_24 = PROD["FY2023-24"][:]
    subs_24[5] = 186.90  # SECL, as given provisionally to Parliament
    rows = [["Subsidiary", "2022-23", "2023-24 (Prov.)"]] + [[s, f"{PROD['FY2022-23'][i]:.2f}", f"{subs_24[i]:.2f}"] for i, s in enumerate(SUBS)]
    rows.append(["Total CIL", f"{sum(PROD['FY2022-23']):.2f}", f"{sum(subs_24):.2f}"])
    story = pq_header("LOK SABHA", "2150", "29.07.2024", "COAL PRODUCTION BY CIL") + [
        Paragraph("2150. SHRI RAMESH KUMAR:", BODY),
        Paragraph("Will the Minister of COAL be pleased to state:", BODY),
        Paragraph("(a) the subsidiary-wise coal production of Coal India Limited during the last two years;", BODY),
        Paragraph("(b) whether the production target for 2023-24 has been achieved; and", BODY),
        Paragraph("(c) the steps taken to enhance production?", BODY),
        Spacer(1, 8),
        Paragraph("ANSWER", CENTER_B),
        Paragraph("THE MINISTER OF COAL AND MINES (SHRI G. KISHAN REDDY)", CENTER_B),
        Spacer(1, 6),
        Paragraph("(a): The subsidiary-wise coal production of CIL during the last two years is given at Annexure-I.", BODY),
        Paragraph("(b): CIL produced 773.20 million tonnes (provisional) in 2023-24 against the target of 780 million tonnes, an achievement of about 99 per cent.", BODY),
        Paragraph(
            "(c): Steps taken include expediting environment and forest clearances, capacity expansion of existing mines, opening of new mines, "
            "deployment of mass production technologies, first mile connectivity projects, and regular monitoring through the Project Monitoring Unit.",
            BODY,
        ),
        Spacer(1, 10),
        Paragraph("ANNEXURE-I", CENTER_B),
        Paragraph("Subsidiary-wise coal production of CIL (in Million Tonnes)", CENTER),
        Spacer(1, 4),
        grid(rows),
    ]
    build("sample-ls-usq-2150-29-07-2024.pdf", story)


def pq_imports():
    story = pq_header("RAJYA SABHA", "1187", "05.12.2024", "REDUCTION IN COAL IMPORTS") + [
        Paragraph("1187. SMT. ANITA SHARMA:", BODY),
        Paragraph("Will the Minister of COAL be pleased to state:", BODY),
        Paragraph("(a) the steps taken by the Government to reduce import of coal; and", BODY),
        Paragraph("(b) the status of the inter-ministerial committee on import substitution?", BODY),
        Spacer(1, 8),
        Paragraph("ANSWER", CENTER_B),
        Paragraph("THE MINISTER OF COAL AND MINES (SHRI G. KISHAN REDDY)", CENTER_B),
        Spacer(1, 6),
        Paragraph(
            "(a): To reduce substitutable coal imports the Government has taken steps including auction of commercial coal blocks, allowing captive mines to sell up to 50 per cent of production, "
            "single window clearance, enhancing domestic production of coking coal under Mission Coking Coal, and improving coal washing capacity. "
            "Thermal power plants designed on domestic coal have been advised to minimise blending with imported coal.",
            BODY,
        ),
        Paragraph(
            "(b): An Inter-Ministerial Committee was constituted to identify items that can be substituted by domestic coal. The committee meets regularly and a portal tracks import substitution by consumers.",
            BODY,
        ),
    ]
    build("sample-rs-usq-1187-05-12-2024.pdf", story)


def pq_safety():
    story = pq_header("LOK SABHA", "3021", "10.03.2025", "SAFETY IN COAL MINES") + [
        Paragraph("3021. SHRI SURESH PATEL:", BODY),
        Paragraph("Will the Minister of COAL be pleased to state:", BODY),
        Paragraph("(a) the measures taken for the safety of workers in coal mines; and", BODY),
        Paragraph("(b) whether any technology has been deployed for early warning of hazards?", BODY),
        Spacer(1, 8),
        Paragraph("ANSWER", CENTER_B),
        Paragraph("THE MINISTER OF COAL AND MINES (SHRI G. KISHAN REDDY)", CENTER_B),
        Spacer(1, 6),
        Paragraph(
            "(a): Safety measures include risk-assessment based Safety Management Plans for every mine, safety audits by multidisciplinary teams, "
            "training of workers at vocational training centres, provision of personal protective equipment, and regular inspections by the Directorate General of Mines Safety.",
            BODY,
        ),
        Paragraph(
            "(b): Yes, Sir. Proximity warning systems on dumpers, real-time environmental monitoring for methane and carbon monoxide in underground mines, "
            "slope stability radar in large opencast mines and a mine-level safety dashboard have been deployed.",
            BODY,
        ),
    ]
    build("sample-ls-usq-3021-10-03-2025.pdf", story)


def scanned_directory():
    """A digital page, rasterised with skew, blur and noise, saved as an image-only PDF."""
    years = ["2014-15", "2015-16", "2016-17", "2017-18", "2018-19"]
    cil = [494.24, 538.75, 554.14, 567.37, 606.89]
    sccl = [52.54, 60.38, 61.34, 62.01, 64.40]
    others = [62.40, 40.10, 42.39, 46.02, 57.43]
    total = [a + b + c for a, b, c in zip(cil, sccl, others)]
    total[2] = 675.87  # misprint in the source: should be 657.87 — the total check must catch it
    tmp = io.BytesIO()
    doc = SimpleDocTemplate(tmp, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm)
    doc.build(
        [
            Paragraph(STAMP, SMALL),
            Paragraph("COAL DIRECTORY OF INDIA 2018-19", H1),
            Paragraph("Coal Controller's Organisation, Kolkata — page 42", BODY),
            Spacer(1, 10),
            Paragraph("Table 4.2: Company-wise production of raw coal during last five years (Million Tonnes)", BODY),
            Spacer(1, 6),
            grid([["Company", *years], ["CIL", *[f"{v:.2f}" for v in cil]], ["SCCL", *[f"{v:.2f}" for v in sccl]], ["Others", *[f"{v:.2f}" for v in others]], ["All India", *[f"{v:.2f}" for v in total]]]),
            Spacer(1, 10),
            Paragraph("Production in 2018-19 was the highest ever recorded, with CIL crossing 600 million tonnes for the first time.", BODY),
        ]
    )
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(tmp.getvalue())
    page = pdf[0].render(scale=2.2).to_pil().convert("L")
    rng = random.Random(7)
    page = page.rotate(0.6, expand=True, fillcolor=255).filter(ImageFilter.GaussianBlur(0.7))
    pixels = page.load()
    w, h = page.size
    for _ in range(int(w * h * 0.004)):
        x, y = rng.randrange(w), rng.randrange(h)
        pixels[x, y] = rng.choice((0, 60, 200))
    tint = Image.merge("RGB", (page, page.point(lambda v: int(v * 0.97)), page.point(lambda v: int(v * 0.9))))
    tint.save(OUT / "sample-scanned-coal-directory-2018-19-p42.pdf", "PDF", resolution=200)


def spreadsheet():
    import pandas as pd

    cil = {"FY2019-20": 602.14, "FY2020-21": 596.22, "FY2021-22": 622.63, "FY2022-23": 703.20, "FY2023-24": 773.81}
    share = [0.0822, 0.0461, 0.1110, 0.1807, 0.0957, 0.2548, 0.2294, 0.0001]
    data = {}
    for period, total in cil.items():
        if period in PROD:
            data[period] = PROD[period]
        else:
            vals = [round(total * s, 2) for s in share]
            vals[6] = round(total - sum(vals[:6]) - vals[7], 2)
            data[period] = vals
    frame = pd.DataFrame({"Subsidiary": SUBS + ["CIL Total"]})
    for period, vals in data.items():
        lakh = [round(v * 10, 1) for v in vals]
        frame[period.replace("FY", "")] = lakh + [round(sum(lakh), 1)]
    with pd.ExcelWriter(OUT / "sample-subsidiary-production-2019-24.xlsx") as writer:
        title = pd.DataFrame([["Subsidiary-wise raw coal production of CIL (in Lakh Tonnes) — " + STAMP]])
        title.to_excel(writer, sheet_name="Production", index=False, header=False)
        frame.to_excel(writer, sheet_name="Production", index=False, startrow=2)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    provisional_statistics()
    annual_report()
    press_release()
    pq_production()
    pq_imports()
    pq_safety()
    scanned_directory()
    spreadsheet()
    for f in sorted(OUT.iterdir()):
        print(f"{f.stat().st_size:>8}  {f.name}")
