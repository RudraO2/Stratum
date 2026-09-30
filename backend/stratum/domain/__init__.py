"""The coal domain: canonical entities, metrics, units, financial-year periods, numbers.

Everything here is deterministic. It is what lets "SECL", "S.E.C.L." and
"South Eastern Coalfields Ltd." be one entity, "2023-24", "FY24" and
"2023-2024" be one period, and "1,23,456 lakh tonnes" be one number in one unit.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

MASTER_PATH = Path(__file__).with_name("master.yaml")


@lru_cache(maxsize=1)
def master() -> dict:
    return yaml.safe_load(MASTER_PATH.read_text(encoding="utf-8"))


def norm(text: str | None) -> str:
    """Lower-case, punctuation to spaces, collapsed whitespace."""
    if not text:
        return ""
    text = str(text).lower().replace("&", " and ").replace("_", " ")
    # dotted acronyms: "S.E.C.L." -> "secl"
    text = re.sub(r"\b(?:[a-z]\.){2,}", lambda m: m.group(0).replace(".", "") + " ", text)
    text = re.sub(r"[‐-―]", "-", text)
    text = re.sub(r"[^\w%'\-/ऀ-ॿ]+", " ", text)
    text = text.replace("-", " ")
    return re.sub(r"\s+", " ", text).strip()


# ── entities ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Entity:
    code: str
    type: str
    name: str
    parent: str | None = None


@lru_cache(maxsize=1)
def _entity_index() -> tuple[dict[str, Entity], dict[str, str], list[tuple[str, str]]]:
    by_code: dict[str, Entity] = {}
    alias_to_code: dict[str, str] = {}
    for item in master()["entities"]:
        entity = Entity(item["code"], item["type"], item["name"], item.get("parent"))
        by_code[entity.code] = entity
        for alias in [item["name"], item["code"], *item.get("aliases", [])]:
            alias_to_code[norm(alias)] = entity.code
    # Longest alias first, so "south eastern coalfields" wins over "eastern coalfields".
    ordered = sorted(alias_to_code.items(), key=lambda kv: -len(kv[0]))
    return by_code, alias_to_code, ordered


def entity(code: str) -> Entity | None:
    return _entity_index()[0].get(code)


def cil_subsidiaries(producing_only: bool = True) -> list[str]:
    codes = [e.code for e in _entity_index()[0].values() if e.type == "subsidiary"]
    return [c for c in codes if not (producing_only and c == "CMPDI")]


def entities_of_type(kind: str) -> list[str]:
    return [e.code for e in _entity_index()[0].values() if e.type == kind]


_ENTITY_NOISE = re.compile(r"^(\d+[.)]?\s*|[ivx]+[.)]\s*|sl\s*no\s*)|\s*(\*+|#|\(p\)|\(provisional\)|ltd|limited)$")


def resolve_entity(text: str | None) -> Entity | None:
    """A table row/column label → canonical entity, or None."""
    key = norm(text)
    if not key:
        return None
    key = _ENTITY_NOISE.sub("", key).strip()
    key = re.sub(r"\s*\b(ltd|limited)\b\s*$", "", key).strip()
    _, alias_to_code, ordered = _entity_index()
    code = alias_to_code.get(key)
    if code:
        return entity(code)
    for alias, code in ordered:
        # a short alias ("cil") must match a whole word, never a substring of another word
        if len(alias) <= 4:
            if re.fullmatch(rf"(total\s+)?{re.escape(alias)}(\s+total)?", key):
                return entity(code)
        elif key.startswith(alias) or key.endswith(alias):
            return entity(code)
    return None


def find_entities(text: str) -> list[str]:
    """Every entity mentioned in free text (a question), in order of appearance."""
    haystack = f" {norm(text)} "
    found: list[tuple[int, str]] = []
    taken: list[tuple[int, int]] = []
    for alias, code in _entity_index()[2]:
        if len(alias) < 2 or alias in {"total", "india", "others", "t"}:
            continue
        for match in re.finditer(rf"(?<=\s){re.escape(alias)}(?=\s)", haystack):
            span = (match.start(), match.end())
            if any(not (span[1] <= a or span[0] >= b) for a, b in taken):
                continue
            taken.append(span)
            found.append((span[0], code))
    ordered: list[str] = []
    for _, code in sorted(found):
        if code not in ordered:
            ordered.append(code)
    if re.search(r"\ball[\s-]+india\b", haystack):
        ordered.append("ALL_INDIA") if "ALL_INDIA" not in ordered else None
    return ordered


# ── metrics ────────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def _metric_index() -> tuple[dict[str, dict], list[tuple[str, str]]]:
    by_key = {m["key"]: m for m in master()["metrics"]}
    aliases = []
    for m in master()["metrics"]:
        for alias in [m["label"], m["key"].replace("_", " "), *m.get("aliases", [])]:
            aliases.append((norm(alias), m["key"]))
    aliases.sort(key=lambda kv: -len(kv[0]))
    return by_key, aliases


def metric(key: str) -> dict | None:
    return _metric_index()[0].get(key)


def metric_keys() -> list[str]:
    return list(_metric_index()[0].keys())


def resolve_metric(text: str | None) -> str | None:
    key = norm(text)
    if not key:
        return None
    for alias, metric_key in _metric_index()[1]:
        if re.search(rf"(^|\s){re.escape(alias)}(\s|$)", key):
            return metric_key
    return None


def find_metric(text: str) -> str | None:
    """The metric a question is about. Targets and offtake are checked before plain production."""
    key = norm(text)
    if re.search(r"\btarget", key):
        return "offtake_target" if re.search(r"offtake|despatch|dispatch", key) else "production_target"
    if re.search(r"\b(offtake|off take|despatch|dispatch|supply|supplied)\b", key):
        return "coal_offtake"
    if re.search(r"\b(overburden|over burden|obr)\b", key):
        return "obr"
    return resolve_metric(text)


# ── units ──────────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def _unit_index() -> list[tuple[str, str, float, str]]:
    """(alias, raw unit key, factor, canonical unit), longest alias first."""
    out = []
    for raw_key, spec in master()["units"].items():
        aliases, factor = spec[0], spec[1]
        canonical = spec[2] if len(spec) > 2 else raw_key
        for alias in [raw_key.replace("_", " "), *aliases]:
            out.append((norm(alias), raw_key, float(factor), canonical))
    out.sort(key=lambda item: -len(item[0]))
    return out


@dataclass(frozen=True)
class UnitMatch:
    raw: str
    canonical: str
    factor: float

    @property
    def conversion(self) -> str | None:
        return None if self.factor == 1.0 else f"{self.raw} × {self.factor:g} → {self.canonical}"


def resolve_unit(text: str | None) -> UnitMatch | None:
    """Find a unit in a caption, header or free text ("(in Million Tonnes)", "Lakh Te")."""
    if text in master()["units"]:  # already a unit key, e.g. a stored mapping's "million_tonnes"
        spec = master()["units"][text]
        return UnitMatch(text, spec[2] if len(spec) > 2 else text, float(spec[1]))
    key = norm(text)
    if not key:
        return None
    key = key.replace(" te ", " tonnes ").replace(" te", " tonnes")
    for alias, raw, factor, canonical in _unit_index():
        if len(alias) <= 2:  # "mt", "lt", "t", "m", "%": only as a whole token
            if re.search(rf"(^|[\s(]){re.escape(alias)}($|[\s)])", key):
                return UnitMatch(raw, canonical, factor)
        elif alias in key:
            return UnitMatch(raw, canonical, factor)
    return None


# ── periods ────────────────────────────────────────────────────────────────

_FY_PATTERNS = [
    re.compile(r"\bfy\s*'?(\d{4})\s*[-/–]\s*(\d{2,4})\b", re.I),
    re.compile(r"\b(\d{4})\s*[-/–]\s*(\d{2,4})\b"),
    re.compile(r"\bfy\s*'?(\d{2})\s*[-/–]\s*(\d{2})\b", re.I),
    re.compile(r"\bfy\s*'?(\d{2,4})\b", re.I),
]
_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def fy_label(start_year: int) -> str:
    return f"FY{start_year}-{(start_year + 1) % 100:02d}"


def _fy_from(a: str, b: str | None) -> str | None:
    if b is None:
        # "FY24" / "FY2024" means the year ending March 2024 → FY2023-24
        year = int(a)
        year = year + 2000 if year < 100 else year
        return fy_label(year - 1) if 1950 < year < 2100 else None
    start = int(a)
    start = start + 2000 if start < 100 else start
    end = int(b)
    end = end + (start // 100) * 100 if end < 100 else end
    if end < start:  # 1999-00
        end += 100
    if end - start != 1 or not (1950 < start < 2100):
        return None
    return fy_label(start)


def parse_period(text: str | None) -> tuple[str, str] | None:
    """A header like '2023-24', 'FY 2023-24 (Prov.)', 'FY24', 'Apr-Sep 2024-25' → (period, kind)."""
    if not text:
        return None
    raw = str(text)
    low = raw.lower()
    partial = re.search(r"\b(apr(?:il)?)\s*[-–to ]+\s*([a-z]{3,9})\b", low)
    for pattern in _FY_PATTERNS:
        match = pattern.search(raw)
        if not match:
            continue
        groups = match.groups()
        fy = _fy_from(groups[0], groups[1] if len(groups) > 1 else None)
        if fy:
            if partial and partial.group(2)[:3] in _MONTHS and partial.group(2)[:3] != "mar":
                return f"{fy}:Apr-{partial.group(2)[:3].title()}", "fy_partial"
            return fy, "fy"
    month = re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,'-]*(\d{4}|\d{2})\b", low)
    if month:
        year = int(month.group(2))
        year = year + 2000 if year < 100 else year
        return f"{year}-{_MONTHS[month.group(1)]:02d}", "month"
    year = re.fullmatch(r"\s*((19|20)\d{2})\s*", raw)
    if year:
        return year.group(1), "calendar_year"
    return None


def find_periods(text: str) -> list[str]:
    """Every FY mentioned in a question, in order; 'between 2019-20 and 2023-24' expands to the range."""
    found: list[str] = []
    for match in re.finditer(r"(?i)\bfy\s*'?\d{2,4}(?:\s*[-/–]\s*\d{2,4})?|\b\d{4}\s*[-/–]\s*\d{2,4}\b", text):
        parsed = parse_period(match.group(0))
        if parsed and parsed[1] == "fy" and parsed[0] not in found:
            found.append(parsed[0])
    if len(found) == 2 and re.search(r"(?i)\b(between|from|to|till|until|through|–|-)\b", text) and re.search(r"(?i)\b(between|from)\b", text):
        a, b = sorted(found, key=fy_start)
        found = [fy_label(y) for y in range(fy_start(a), fy_start(b) + 1)]
    last_n = re.search(r"(?i)\b(?:last|past|previous)\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+(?:financial\s+)?years\b", text)
    if last_n and not found:
        words = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
        n = int(words.get(last_n.group(1).lower(), last_n.group(1)))
        found = [f"LAST:{n}"]
    return found


def fy_start(period: str) -> int:
    match = re.match(r"FY(\d{4})", period or "")
    return int(match.group(1)) if match else 0


# ── numbers ────────────────────────────────────────────────────────────────

_NA = {"", "-", "–", "—", "na", "n a", "nil", "n/a", "..", "...", "neg", "negligible", "x"}


def parse_number(text: str | None) -> float | None:
    """'1,23,456.7', '(12.5)', '47.12*', '8.5%', '−3.2' → float; NA markers → None."""
    if text is None:
        return None
    raw = str(text).strip()
    if raw.lower() in _NA:
        return None
    raw = raw.replace("−", "-").replace("–", "-")
    negative = raw.startswith("(") and raw.endswith(")")
    cleaned = re.sub(r"[*#@$†‡^]+|\(p\)|\(prov\.?\)|%", "", raw, flags=re.I).strip("() ")
    cleaned = cleaned.replace(",", "").replace(" ", "").rstrip(".,:;|_")  # OCR often leaves a stray mark after a figure ("62.01.")
    if not re.fullmatch(r"[+-]?\d+(\.\d+)?", cleaned):
        return None
    value = float(cleaned)
    return -value if negative else value


NUMBER_IN_TEXT = re.compile(r"(?<![\w.])[+-]?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?(?![\w])|(?<![\w.])[+-]?\d+(?:\.\d+)?(?![\w])")


_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def ascii_digits(text: str) -> str:
    """Devanagari digits → ASCII, so a Hindi answer cannot slip figures past the guard."""
    return (text or "").translate(_DEVANAGARI_DIGITS)


def numbers_in(text: str) -> list[float]:
    out = []
    for match in NUMBER_IN_TEXT.finditer(ascii_digits(text)):
        value = parse_number(match.group(0))
        if value is not None:
            out.append(value)
    return out


def precedence(doc_kind: str | None) -> int:
    return int(master()["source_precedence"].get(doc_kind or "document", 50))


def format_value(value: float, unit: str) -> str:
    if unit == "percent":
        return f"{value:.2f}%"
    if abs(value) >= 1000:
        return f"{value:,.2f}"
    return f"{value:.2f}"


UNIT_LABELS = {
    "million_tonnes": "MT",
    "million_cubic_metres": "M.Cu.M",
    "million_tonnes_per_annum": "MTPA",
    "percent": "%",
    "persons": "persons",
    "tonnes_per_manshift": "t/manshift",
    "metres": "m",
}


def unit_label(unit: str) -> str:
    return UNIT_LABELS.get(unit, unit.replace("_", " "))
