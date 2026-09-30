"""The 'LLM maps, code extracts' path on tables shaped like the real ones — rules only, no model, no database."""

from stratum.facts import mapper, validate
from stratum.facts.extract import extract
from stratum.ingest.cues import Cell, Table
from stratum.ingest.doc_meta import classify, parse_pq_header


def make_table(rows, caption="", context=""):
    cells = [Cell(row=r, col=c, text=text, is_header=(r == 0)) for r, row in enumerate(rows) for c, text in enumerate(row)]
    return Table(page_no=1, n_rows=len(rows), n_cols=len(rows[0]), cells=cells, caption=caption, context=context)


CAPTION = "Production target and achievement, 2023-24 (figures in Million Tonnes)"
ANNUAL_REPORT = [
    ["Subsidiary", "Target 2023-24", "Actual 2023-24", "Achievement (%)"],
    ["ECL", "48.00", "47.60", "99.17"],
    ["BCCL", "40.00", "40.50", "101.25"],
    ["CCL", "88.00", "86.10", "97.84"],
    ["SECL", "190.00", "187.00", "98.42"],
]


def run(table):
    mapping = mapper.rule_mapping(table)
    candidates = extract(table, mapping)
    validate.table_checks(candidates)
    return mapping, candidates


def test_a_target_and_actual_table_keeps_the_two_quantities_apart():
    # The caption says "target", which once gave the Actual column the target metric too.
    _, candidates = run(make_table(ANNUAL_REPORT, caption=CAPTION))
    secl = {c.metric: c.value for c in candidates if c.entity_code == "SECL"}
    assert secl["production_target"] == 190.0
    assert secl["coal_production"] == 187.0
    assert secl["achievement_pct"] == 98.42


def test_a_stated_achievement_is_recomputed_and_a_wrong_one_fails_the_check():
    _, candidates = run(make_table(ANNUAL_REPORT, caption=CAPTION))
    actual = next(c for c in candidates if c.entity_code == "SECL" and c.metric == "coal_production")
    assert any(ck["check"] == "achievement" and ck["result"] == "pass" for ck in actual.checks)

    rows = [list(r) for r in ANNUAL_REPORT]
    rows[4][3] = "89.99"  # a misprinted percentage
    _, bad = run(make_table(rows, caption=CAPTION))
    actual = next(c for c in bad if c.entity_code == "SECL" and c.metric == "coal_production")
    assert any(ck["check"] == "achievement" and ck["result"] == "fail" for ck in actual.checks)


def test_a_misprinted_total_is_caught_by_the_sum_check():
    rows = [
        ["Company", "2016-17"],
        ["CIL", "554.14"],
        ["SCCL", "61.34"],
        ["Others", "42.39"],
        ["All India", "675.87"],  # should be 657.87
    ]
    _, candidates = run(make_table(rows, caption="Company-wise production of raw coal (Million Tonnes)"))
    total = next(c for c in candidates if c.entity_code == "ALL_INDIA")
    assert any(ck["check"] == "total" and ck["result"] == "fail" for ck in total.checks)


def test_units_in_the_caption_convert_and_are_recorded():
    rows = [["Subsidiary", "2022-23", "2023-24"], ["ECL", "369.7", "476.0"], ["CCL", "761.0", "861.0"], ["NCL", "1313.0", "1362.0"]]
    _, candidates = run(make_table(rows, caption="Subsidiary-wise raw coal production (in Lakh Tonnes)"))
    ccl = next(c for c in candidates if c.entity_code == "CCL" and c.period == "FY2023-24")
    assert round(ccl.value, 2) == 86.1 and "lakh" in (ccl.conversion or "")


def test_an_ocr_trailing_mark_is_read_and_noted():
    rows = [["Company", "2016-17", "2017-18"], ["CIL", "554.14", "567.37"], ["SCCL", "61.34", "62.01."], ["Others", "42.39", "46.02"]]
    _, candidates = run(make_table(rows, caption="Company-wise production of raw coal (Million Tonnes)"))
    cell = next(c for c in candidates if c.entity_code == "SCCL" and c.period == "FY2017-18")
    assert cell.value == 62.01
    assert any(ck["check"] == "ocr_cleanup" and ck["result"] == "warn" for ck in cell.checks)


def test_pq_headers_parse_whether_the_layout_keeps_lines_or_merges_them():
    multi = "LOK SABHA\nUNSTARRED QUESTION NO. 2150\nTO BE ANSWERED ON 29.07.2024\nCOAL PRODUCTION BY CIL\n2150. SHRI X:"
    merged = "LOK SABHA UNSTARRED QUESTION NO. 3021 TO BE ANSWERED ON 10.03.2025 SAFETY IN COAL MINES\n3021. SHRI SURESH PATEL: Will the Minister"
    a, b = parse_pq_header(multi), parse_pq_header(merged)
    assert (a["pq_house"], a["pq_number"], a["pq_date"], a["pq_subject"]) == ("Lok Sabha", "Unstarred 2150", "29.07.2024", "Coal Production By Cil")
    assert (b["pq_number"], b["pq_date"], b["pq_subject"]) == ("Unstarred 3021", "10.03.2025", "Safety In Coal Mines")


def test_document_kinds_set_source_precedence():
    assert classify("LOK SABHA UNSTARRED QUESTION NO. 1 TO BE ANSWERED ON 01.01.2025", "x.pdf", ".pdf")["doc_kind"] == "pq_reply"
    coal_directory = classify("COAL DIRECTORY OF INDIA 2018-19", "x.pdf", ".pdf")
    press = classify("Press Information Bureau, provisional production", "x.pdf", ".pdf")
    assert coal_directory["precedence"] > press["precedence"]
    assert classify("", "production.xlsx", ".xlsx")["doc_kind"] == "spreadsheet"
