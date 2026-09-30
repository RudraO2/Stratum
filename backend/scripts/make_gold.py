"""Write the gold facts in stratum/metrics/gold.yaml from the sample corpus generator's own source data.

The gold set has to be independent of what Stratum extracts, or the exact-match figure measures nothing. The
sample documents were *written* from the constants in make_sample_corpus.py, so those constants are the
ground truth: what a person reading the page would copy out. For the one deliberate misprint (the scanned
Coal Directory's 2016-17 All India total, printed 675.87) the gold value is the arithmetically correct 657.87 —
so that cell is a genuine miss, and the point of the metric beside it is that a check flagged it.

    python scripts/make_gold.py        # rewrites the `facts:` block, leaves questions and trials alone
"""

from __future__ import annotations

import re
from pathlib import Path

import make_sample_corpus as corpus

GOLD = Path(__file__).resolve().parents[1] / "stratum" / "metrics" / "gold.yaml"
SUBS = corpus.SUBS


def row(entity: str, metric: str, period: str, value: float, source: str, note: str = "") -> str:
    tail = f", note: {note}" if note else ""
    return f'  - {{entity: {entity}, metric: {metric}, period: {period}, value: {round(value, 2)}, source: "{source}"{tail}}}'


def facts() -> list[str]:
    out: list[str] = []
    stats = "sample-provisional-coal-statistics-2023-24.pdf"
    for period, values in corpus.PROD.items():
        for code, value in zip(SUBS, values):
            out.append(row(code, "coal_production", period, value, f"{stats} Table 3.1"))
        out.append(row("CIL", "coal_production", period, sum(values), f"{stats} Table 3.1 (Total CIL)"))
    for period, values in corpus.OFFTAKE.items():
        for code, value in zip(SUBS, values):
            out.append(row(code, "coal_offtake", period, value, f"{stats} Table 4.1"))
        out.append(row("CIL", "coal_offtake", period, sum(values), f"{stats} Table 4.1 (Total CIL)"))

    report = "sample-cil-annual-report-2023-24-excerpt.pdf"
    for code, value in zip(SUBS, corpus.TARGET_24):
        out.append(row(code, "production_target", "FY2023-24", value, f"{report} target table"))
    out.append(row("CIL", "production_target", "FY2023-24", sum(corpus.TARGET_24), f"{report} target table (CIL)"))

    for code, a, b in (("CIL", 703.20, 773.81), ("SCCL", 67.14, 70.02), ("CAPTIVE", 122.85, 154.00), ("ALL_INDIA", 893.19, 997.83)):
        out.append(row(code, "coal_production", "FY2022-23", a, f"{stats} Table 3.2"))
        out.append(row(code, "coal_production", "FY2023-24", b, f"{stats} Table 3.2"))

    years = ["FY2014-15", "FY2015-16", "FY2016-17", "FY2017-18", "FY2018-19"]
    cil = [494.24, 538.75, 554.14, 567.37, 606.89]
    sccl = [52.54, 60.38, 61.34, 62.01, 64.40]
    others = [62.40, 40.10, 42.39, 46.02, 57.43]
    scan = "sample-scanned-coal-directory-2018-19-p42.pdf (image-only scan)"
    for i, year in enumerate(years):
        out.append(row("CIL", "coal_production", year, cil[i], scan))
        out.append(row("SCCL", "coal_production", year, sccl[i], scan))
        out.append(row("CAPTIVE", "coal_production", year, others[i], scan))
        total = cil[i] + sccl[i] + others[i]
        note = "printed 675.87 in the source (misprint); the correct total is 657.87" if year == "FY2016-17" else ""
        out.append(row("ALL_INDIA", "coal_production", year, total, scan, note))

    # The spreadsheet's three earlier years, in lakh tonnes, rebuilt exactly as the generator wrote them.
    totals = {"FY2019-20": 602.14, "FY2020-21": 596.22, "FY2021-22": 622.63}
    share = [0.0822, 0.0461, 0.1110, 0.1807, 0.0957, 0.2548, 0.2294, 0.0001]
    sheet = "sample-subsidiary-production-2019-24.xlsx"
    for period, total in totals.items():
        values = [round(total * s, 2) for s in share]
        values[6] = round(total - sum(values[:6]) - values[7], 2)
        lakh = [round(v * 10, 1) for v in values]
        for code, cell in zip(SUBS, lakh):
            out.append(row(code, "coal_production", period, cell / 10, f"{sheet} (cell {cell} lakh tonnes)"))
        out.append(row("CIL", "coal_production", period, round(sum(lakh), 1) / 10, f"{sheet} (CIL Total row)"))
    return out


def main() -> None:
    text = GOLD.read_text(encoding="utf-8")
    block = "facts:\n" + "\n".join(facts()) + "\n"
    pattern = re.compile(r"^facts:.*?(?=^questions:)", re.S | re.M)
    if not pattern.search(text):
        raise SystemExit("gold.yaml has no facts: block followed by questions:")
    GOLD.write_text(pattern.sub(lambda _: block + "\n", text, count=1), encoding="utf-8")
    print(f"wrote {len(facts())} gold facts to {GOLD}")


if __name__ == "__main__":
    main()
