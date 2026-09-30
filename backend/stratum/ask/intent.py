"""Question → QueryIntent (the semantic layer's input).

Deterministic first: metric, entities and financial years are found by the
same domain rules the fact extractor uses, so "SECL", "2023-24" and
"despatch" mean the same thing in a question as in a table. The local model is
asked only when a question plainly wants a figure but names no metric the
rules recognise — and even then it only fills this intent; it never writes SQL.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

from .. import db, domain, llm

EXPLAIN = re.compile(r"\b(why|reasons?|cause[sd]?|explain|factors?|due to|what led|how come|attributed)\b|कारण|क्यों", re.I)
COMPARE = re.compile(r"\b(compare|comparison|vs\.?|versus|growth|increase|decrease|decline|declined|fall|fell|rise|rose|change|trend|over the years|year[- ]on[- ]year)\b|तुलना|वृद्धि", re.I)
POLICY = re.compile(r"\b(steps?|measures?|initiatives?|policy|policies|schemes?|programmes?|status of|describe|what is|how is|how are|tell me about)\b", re.I)
FIGURE_WANTED = re.compile(r"\b(how much|how many|quantity|figures?|numbers?|total|volume|amount)\b|कितना|कितने|कितनी", re.I)
SUBSIDIARY_WISE = re.compile(r"\bsubsidiar(y|ies)[\s-]*wise\b|\beach subsidiar|\ball subsidiar|\bsubsidiaries\b|\bcompany[\s-]*wise\b", re.I)
STATE_WISE = re.compile(r"\bstate[\s-]*wise\b|\beach state\b|\ball states\b|\bstates\b|राज्यवार", re.I)
HINDI_METRICS = [
    ("उत्पादन", "coal_production"), ("प्रेषण", "coal_offtake"), ("डिस्पैच", "coal_offtake"), ("उठाव", "coal_offtake"),
    ("ओवरबर्डन", "obr"), ("लक्ष्य", "production_target"),
    # Romanised Hindi ("Hinglish") — how many officers actually type it
    ("utpadan", "coal_production"), ("utpaadan", "coal_production"), ("pedawar", "coal_production"),
    ("uthaav", "coal_offtake"), ("uthav", "coal_offtake"), ("preshan", "coal_offtake"), ("lakshya", "production_target"),
]
HINGLISH_WORDS = re.compile(r"\b(kitna|kitni|kitne|kya|kaise|kyon|kyun|batao|bataiye|bataye|mein|hai|hain|tha|thi|ka|ki|ke|tak|aur|wala|wali|sabhi)\b", re.I)


def detect_language(question: str) -> str:
    """'hi' for Devanagari or for Romanised Hindi (at least two Hindi function words); answers follow the question's language."""
    if re.search(r"[ऀ-ॿ]{3,}", question):
        return "hi"
    words = {w.lower() for w in HINGLISH_WORDS.findall(question)}
    return "hi" if len(words) >= 2 else "en"


@dataclass
class QueryIntent:
    route: str  # sql | rag | sql_rag
    metric: str | None = None
    entities: list[str] = field(default_factory=list)
    periods: list[str] = field(default_factory=list)
    scope: str = "specific"  # specific | subsidiaries | states | all
    compare: bool = False
    explain: bool = False
    achievement: bool = False  # "was the target achieved?": actual vs target, with achievement %
    language: str = "en"
    source: str = "rules"
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _available_periods(metric: str) -> list[str]:
    found = db.rows("SELECT DISTINCT period FROM facts WHERE metric=? AND period_kind='fy' AND status != 'rejected'", (metric,))
    return sorted((r["period"] for r in found), key=domain.fy_start)


def probe_metric(intent: QueryIntent) -> str:
    """The metric whose availability bounds the answer: for target-vs-actual, the target."""
    return TARGET_OF.get(intent.metric, intent.metric) if intent.achievement else intent.metric


ACHIEVEMENT = re.compile(r"\b(achiev\w*|fulfil\w*|attain\w*|surpass\w*|exceed\w*|short[\s-]?fall)\b|\btarget\b.*\b(met|reached)\b|\bmet\b.*\btarget\b|लक्ष्य.*(प्राप्त|हासिल)", re.I)
TARGET_OF = {"coal_production": "production_target", "coal_offtake": "offtake_target"}
BASE_OF = {v: k for k, v in TARGET_OF.items()}


def parse(question: str, context: str = "") -> QueryIntent:
    """`context` (a PQ's subject line, the previous part) may only supply a missing entity or year — never the metric."""
    q = question.strip()
    language = detect_language(q)
    metric = domain.find_metric(q)
    if metric in {"growth_pct", "achievement_pct"}:
        metric = "coal_production"
    if metric is None:
        for word, key in HINDI_METRICS:
            if word in q.lower():
                metric = key
                break
    if metric and POLICY.search(q) and not domain.find_periods(q) and not domain.find_entities(q) and not FIGURE_WANTED.search(q) and not ACHIEVEMENT.search(q):
        metric = None  # "What steps are taken to enhance production?" asks for the documents, not a figure
    achievement = bool(ACHIEVEMENT.search(q)) and (metric in {None, *TARGET_OF, *BASE_OF} or domain.find_metric(q) == "achievement_pct") and bool(re.search(r"target|लक्ष्य|lakshya", q, re.I))
    if achievement:
        metric = BASE_OF.get(metric, metric) or "coal_production"
    entities = domain.find_entities(q)
    periods = domain.find_periods(q)
    if context:
        entities = entities or domain.find_entities(context)
        periods = periods or domain.find_periods(context)
    explain = bool(EXPLAIN.search(q))
    compare = bool(COMPARE.search(q)) or len(periods) > 1
    scope = "specific"
    if SUBSIDIARY_WISE.search(q):
        scope = "subsidiaries"
    elif STATE_WISE.search(q):
        scope = "states"

    intent = QueryIntent(route="rag", metric=metric, entities=entities, periods=periods, scope=scope, compare=compare and not achievement, explain=explain, achievement=achievement, language=language)

    if metric is None and FIGURE_WANTED.search(q) and llm.available():
        _llm_fill(intent, q)

    if intent.metric:
        unknown = None if entities or scope != "specific" else _unknown_entity(q)
        if unknown:
            # Never answer "Mars Colony" with All-India figures: search the documents only.
            intent.notes.append(f"“{unknown}” is not in the master data — searching documents only")
            return intent
        intent.route = "sql_rag" if intent.explain else "sql"
        _resolve_scope_and_periods(intent)
    return intent


_PROPER = re.compile(r"\b(?:of|for|at|by|in|from)\s+((?:[A-Z][\w&'.-]*\s*){1,4})")
_NOT_ENTITIES = {
    "India", "Indian", "Coal", "Ltd", "Limited", "Parliament", "Lok", "Sabha", "Rajya", "Ministry", "Government", "FY",
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
    "Hindi", "English", "Table", "Annexure", "Chapter", "Million", "Tonnes", "MT",
}


def _unknown_entity(question: str) -> str | None:
    """A capitalised name after 'of/for/in…' that the master data does not know ("Mars Colony")."""
    for match in _PROPER.finditer(question):
        name = match.group(1).strip().rstrip(".")
        words = [w for w in name.split() if w not in _NOT_ENTITIES and not re.fullmatch(r"FY[\d\-/]*|[A-Z]{1,2}\d*|\d[\d\-/]*", w)]
        if words and not domain.resolve_entity(name) and not domain.find_metric(name):
            return " ".join(words)
    return None


INTENT_SCHEMA = {
    "type": "object",
    "properties": {
        "wants_figures": {"type": "boolean"},
        "metric": {"type": "string", "enum": [*domain.metric_keys(), "none"]},
    },
    "required": ["wants_figures", "metric"],
    "additionalProperties": False,
}


def _llm_fill(intent: QueryIntent, question: str) -> None:
    try:
        answer = llm.chat_json(
            [
                {"role": "system", "content": "Classify a question about Indian coal statistics. Return JSON only. metric is the measured quantity the question asks for: coal_production, coal_offtake (despatch), obr (overburden removal), production_target, offtake_target, capacity, reserves, resources, manpower, oms, exploration_drilling — or none."},
                {"role": "user", "content": question},
            ],
            INTENT_SCHEMA,
            schema_name="st_intent",
            max_tokens=60,
        )
    except Exception:  # noqa: BLE001
        return
    if answer.get("wants_figures") and answer.get("metric") not in (None, "none", "growth_pct", "achievement_pct"):
        intent.metric = answer["metric"]
        intent.source = "rules+llm"


def _resolve_scope_and_periods(intent: QueryIntent) -> None:
    if intent.scope == "subsidiaries":
        extra = [code for code in intent.entities if domain.entity(code) and domain.entity(code).type != "subsidiary"]
        intent.entities = domain.cil_subsidiaries() + ["CIL"] + [e for e in extra if e != "CIL"]
    elif intent.scope == "states":
        intent.entities = [r["entity_code"] for r in db.rows("SELECT DISTINCT entity_code FROM facts WHERE entity_type='state' AND metric=?", (intent.metric,))]
    probe = probe_metric(intent)
    if not intent.entities:
        present = {r["entity_code"] for r in db.rows("SELECT DISTINCT entity_code FROM facts WHERE metric=?", (probe,))}
        intent.entities = [code for code in ("ALL_INDIA", "CIL") if code in present] or ["CIL"]
        intent.notes.append("no entity named — showing All India / CIL")

    available = _available_periods(probe)
    if intent.periods and intent.periods[0].startswith("LAST:"):
        n = int(intent.periods[0].split(":")[1])
        intent.periods = available[-n:]
    elif not intent.periods:
        if available:
            intent.periods = available[-2:] if intent.compare else available[-1:]
            intent.notes.append(f"no year named — using latest available ({', '.join(intent.periods)})")
    if intent.periods and len(intent.periods) == 1 and intent.compare and available:
        index = available.index(intent.periods[0]) if intent.periods[0] in available else -1
        if index > 0:
            intent.periods = [available[index - 1], intent.periods[0]]
