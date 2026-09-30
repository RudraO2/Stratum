"""The coal domain's deterministic parsing: numbers, financial years, units, entities, metrics."""

from stratum import domain
from stratum.ask import guard


def test_numbers_read_indian_grouping_brackets_marks_and_ocr_noise():
    assert domain.parse_number("1,23,456.7") == 123456.7
    assert domain.parse_number("(12.5)") == -12.5
    assert domain.parse_number("47.12*") == 47.12
    assert domain.parse_number("8.5%") == 8.5
    assert domain.parse_number("62.01.") == 62.01  # a scan left a stray full stop
    assert domain.parse_number("NA") is None
    assert domain.parse_number("-") is None
    assert domain.parse_number("Total") is None


def test_hindi_digits_cannot_slip_a_figure_past_the_guard():
    assert domain.numbers_in("उत्पादन १८७.०० मिलियन टन था") == [187.0]
    verdict = guard.check("SECL का उत्पादन १९९.५० था", [187.0])
    assert not verdict["ok"] and verdict["unsupported"] == [199.5]
    assert guard.check("SECL का उत्पादन १८७.०० था", [187.0])["ok"]


def test_financial_years_in_every_notation():
    assert domain.parse_period("2023-24") == ("FY2023-24", "fy")
    assert domain.parse_period("FY 2023-24 (Prov.)") == ("FY2023-24", "fy")
    assert domain.parse_period("FY24") == ("FY2023-24", "fy")  # the year ending March 2024
    assert domain.parse_period("2023-2024") == ("FY2023-24", "fy")
    assert domain.parse_period("1999-00") == ("FY1999-00", "fy")
    assert domain.parse_period("Apr-Sep 2024-25") == ("FY2024-25:Apr-Sep", "fy_partial")
    assert domain.find_periods("between 2019-20 and 2021-22") == ["FY2019-20", "FY2020-21", "FY2021-22"]
    assert domain.find_periods("for the last three years") == ["LAST:3"]


def test_units_convert_to_canonical():
    lakh = domain.resolve_unit("(in Lakh Tonnes)")
    assert lakh.canonical == "million_tonnes" and lakh.factor == 0.1
    assert domain.resolve_unit("Million Tonnes").factor == 1.0


def test_entities_and_metrics_resolve_from_free_text():
    for text in ("SECL", "S.E.C.L.", "South Eastern Coalfields Ltd.", "South Eastern Coalfields Limited"):
        assert domain.resolve_entity(text).code == "SECL", text
    assert domain.resolve_entity("Total CIL").code == "CIL"
    assert domain.find_entities("Compare MCL and NCL") == ["MCL", "NCL"]
    assert domain.find_metric("coal despatch of WCL") == "coal_offtake"
    assert domain.find_metric("production target of SECL") == "production_target"
    assert domain.find_metric("offtake target") == "offtake_target"


def test_the_guard_skips_years_and_citations_and_flags_invented_figures():
    allowed = [187.0, 167.0, 11.98]
    assert guard.check("SECL produced 187.00 MT in FY2023-24 [2], up 11.98%.", allowed)["ok"]
    bad = guard.check("SECL produced 190.00 MT in FY2023-24 [2].", allowed)
    assert not bad["ok"] and bad["unsupported"] == [190.0]
