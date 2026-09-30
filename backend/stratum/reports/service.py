"""Report engine: YAML template → verified tables + charts + guarded narrative → DOCX."""

from __future__ import annotations

import io
import re
import time
from pathlib import Path

import yaml

from .. import db, docx_out, domain, llm
from ..ask import guard, sql
from ..ask.intent import QueryIntent
from ..ask.service import _citation_for_chunk, _citation_for_fact
from ..facts import service as facts
from ..config import COMPOSE_MODE
from ..search import hybrid

TEMPLATES_PATH = Path(__file__).with_name("templates.yaml")

NARRATIVE_PROMPT = """You write one short paragraph (3–5 sentences) for an official Coal India / Ministry of Coal report.
Use ONLY the figures in the table below, written exactly as shown, with the citation number in square brackets after each figure.
Mention the largest and smallest contributors and the overall change where the table shows it. No recommendations, no speculation."""


def templates() -> list[dict]:
    return yaml.safe_load(TEMPLATES_PATH.read_text(encoding="utf-8"))


def _fy_periods(metric: str) -> list[str]:
    found = db.rows("SELECT DISTINCT period FROM facts WHERE metric=? AND period_kind='fy' AND status!='rejected'", (metric,))
    return sorted((r["period"] for r in found), key=domain.fy_start)


def _periods(spec: str, metric: str, params: dict) -> list[str]:
    available = _fy_periods(metric)
    if not available:
        return []
    latest = params.get("period") if params.get("period") not in (None, "latest") else available[-1]
    if spec == "latest":
        return [latest]
    match = re.fullmatch(r"latest-(\d+)\.\.latest", spec)
    if match:
        start = domain.fy_start(latest) - int(match.group(1))
        return [domain.fy_label(y) for y in range(start, domain.fy_start(latest) + 1)]
    match = re.fullmatch(r"last:(\d+)", spec)
    if match:
        upto = [p for p in available if domain.fy_start(p) <= domain.fy_start(latest)]
        return upto[-int(match.group(1)) :]
    return [spec]


def _entities(spec, params: dict) -> list[str]:
    if spec == "subsidiaries":
        return domain.cil_subsidiaries() + ["CIL"]
    if spec == "subsidiaries_only":
        return domain.cil_subsidiaries()
    return [params.get("entity", "CIL") if e == "{entity}" else e for e in (spec if isinstance(spec, list) else [spec])]


def _fill(text: str, params: dict) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: str(params.get(m.group(1), m.group(0))), text)


def _chart(kind: str, series: dict[str, list[tuple[str, float]]], title: str, unit: str) -> bytes:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(7.5, 3.6), dpi=150)
    palette = ["#2a6f97", "#e07a1f", "#6a994e", "#8d5a97"]
    names = list(series.keys())
    if kind == "line":
        for i, name in enumerate(names):
            xs = [x for x, _ in series[name]]
            ys = [y for _, y in series[name]]
            ax.plot(xs, ys, marker="o", color=palette[i % 4], label=name, linewidth=2)
            for x, y in zip(xs, ys):
                ax.annotate(f"{y:,.1f}", (x, y), textcoords="offset points", xytext=(0, 6), ha="center", fontsize=7)
    else:
        labels = [x for x, _ in series[names[0]]] if names else []
        width = 0.8 / max(1, len(names))
        for i, name in enumerate(names):
            values = dict(series[name])
            xs = [j + i * width - 0.4 + width / 2 for j in range(len(labels))]
            ax.bar(xs, [values.get(l, 0) for l in labels], width=width, color=palette[i % 4], label=name)
        ax.set_xticks(range(len(labels)))
        ax.set_xticklabels(labels, fontsize=8)
    ax.set_title(title, fontsize=10)
    ax.set_ylabel(domain.unit_label(unit), fontsize=8)
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(axis="y", alpha=0.3)
    if len(names) > 1:
        ax.legend(fontsize=7, frameon=False)
    fig.tight_layout()
    out = io.BytesIO()
    fig.savefig(out, format="png")
    plt.close(fig)
    return out.getvalue()


TOTAL_CODES = {"CIL", "ALL_INDIA"}


def _narrative(table: dict, cite_for: dict[int, int]) -> tuple[str, list[float]]:
    """Report wording, stated by the template from the verified table.

    A small model asked to describe a table with a total row calls the total a "contributor" and, once, the
    production of coal "revenue". The figures and the verdicts here are arithmetic on cited facts, so there
    is nothing for a model to get wrong — and the number guard still checks every figure it finds.
    Returns the text and any derived figures it states (shares, counts) so the guard can match them.
    """
    extra: list[float] = []
    if "facts" not in table:  # target vs achievement
        rows = [r for r in table["rows"] if r.get("achievement_pct") is not None]
        parts = [r for r in rows if r["entity"] not in TOTAL_CODES]
        if not parts:
            return "", extra
        met = [r for r in parts if r["achievement_pct"] >= 100]
        short = sorted((r for r in parts if r["achievement_pct"] < 100), key=lambda r: r["achievement_pct"])
        period = (table.get("periods") or [""])[0]
        text = f"In {period}, {len(met)} of {len(parts)} subsidiaries met or exceeded their production target"
        if met:
            text += " (" + ", ".join(f"{r['entity']} {r['achievement_pct']:.2f}%" for r in met) + ")"
        if short:
            text += f"; the largest shortfall was {short[0]['entity']} at {short[0]['achievement_pct']:.2f}% of target"
        total = next((r for r in rows if r["entity"] in TOTAL_CODES), None)
        if total:
            cites = total.get("cites") or [None, None]
            t_ref = f" [{cites[0]}]" if cites[0] else ""
            a_ref = f" [{cites[1]}]" if cites[1] else ""
            text += f". Coal India overall achieved {total['achievement_pct']:.2f}% of its {total['target']:.2f} MT target{t_ref}, producing {total['actual']:.2f} MT{a_ref}."
        else:
            text += "."
        return text, extra

    periods = table["periods"]
    if not periods or not table["rows"]:
        return "", extra
    last = len(periods) - 1
    label = (domain.metric(table["metric"]) or {}).get("label", table["metric"]).lower()
    unit = table["unit_label"]

    def ref(cell):
        return f" [{cite_for.get(cell['fact_id'], '?')}]"

    total = next((r for r in table["rows"] if r["entity_code"] in TOTAL_CODES and r["cells"][last]), None)
    subs = set(domain.cil_subsidiaries())
    parts = [r for r in table["rows"] if r["entity_code"] in subs and r["cells"][last]]

    if len(parts) >= 3:
        text = ""
        if total:
            cell = total["cells"][last]
            text = f"In {periods[last]}, {total['entity']} recorded {label} of {cell['display']} {unit}{ref(cell)}"
            if len(periods) >= 2 and total["change_pct"] is not None:
                text += f", {total['change_pct']:+.2f}% against {periods[0]}"
            text += ". "
        big = max(parts, key=lambda r: r["cells"][last]["value"])
        small = min(parts, key=lambda r: r["cells"][last]["value"])
        bc, sc = big["cells"][last], small["cells"][last]
        text += f"Among the subsidiaries, {big['short']} was the largest at {bc['display']} {unit}{ref(bc)}"
        if total and total["cells"][last]["value"]:
            share = bc["value"] / total["cells"][last]["value"] * 100
            extra += [round(share, 1), round(share, 2)]
            text += f" ({share:.1f}% of the total)"
        text += f" and {small['short']} the smallest at {sc['display']} {unit}{ref(sc)}."
        return text, extra

    row = table["rows"][0]
    filled = [(p, c) for p, c in zip(periods, row["cells"]) if c]
    if len(filled) >= 2:
        (p0, c0), (p1, c1) = filled[0], filled[-1]
        peak_p, peak_c = max(filled, key=lambda pc: pc[1]["value"])
        text = f"From {p0} to {p1}, {label} of {row['entity']} moved from {c0['display']} {unit}{ref(c0)} to {c1['display']} {unit}{ref(c1)}"
        if row["change_pct"] is not None:
            text += f", a change of {row['change_pct']:+.2f}%"
        text += f"; the highest year was {peak_p} at {peak_c['display']} {unit}{ref(peak_c)}."
        return text, extra
    if filled:
        p, c = filled[0]
        return f"{row['entity']} recorded {label} of {c['display']} {unit} in {p}{ref(c)}.", extra
    return "", extra


def generate(template_id: str, params: dict | None = None, filename: str | None = None) -> dict:
    started = time.time()
    template = next((t for t in templates() if t["id"] == template_id), None)
    if template is None:
        raise KeyError(template_id)
    params = {**template.get("params", {}), **(params or {})}
    metric_key = params.get("metric", "coal_production")
    params.setdefault("metric_label", (domain.metric(metric_key) or {}).get("label", metric_key))
    entity = domain.entity(params.get("entity", "CIL"))
    params.setdefault("entity_name", entity.name if entity else params.get("entity"))
    if params.get("period") in (None, "latest"):
        available = _fy_periods("coal_production")
        params["period"] = available[-1] if available else "latest"

    doc = docx_out.new_document()
    title = _fill(template["title"], params)
    docx_out.centered(doc, "STRATUM — AUTOMATED REPORT", size=10)
    docx_out.centered(doc, title, size=14)
    docx_out.centered(doc, f"Generated {time.strftime('%d %B %Y, %H:%M')} from verified facts. Every figure is traceable to its source (see Evidence trail).", bold=False, size=9)
    doc.add_paragraph()

    citations: list[dict] = []
    cite_for: dict[int, int] = {}
    sections_out = []
    last_table = None
    allowed: list[float] = []
    unsupported_total = 0
    checked_total = 0

    def cite(fact):
        if fact["id"] not in cite_for:
            cite_for[fact["id"]] = len(citations) + 1
            citations.append(_citation_for_fact(cite_for[fact["id"]], fact))
        return cite_for[fact["id"]]

    for section in template["sections"]:
        kind = section["type"]
        if kind == "heading":
            text = _fill(section["text"], params)
            p = doc.add_paragraph()
            p.add_run(text).bold = True
            sections_out.append({"type": "heading", "text": text})
        elif kind == "table":
            metric = _fill(section["metric"], params)
            intent = QueryIntent(route="sql", metric=metric, entities=_entities(section["entities"], params), periods=_periods(_fill(section["periods"], params), metric, params), compare=True)
            table = sql.run(intent)
            for fact in table["facts"]:
                cite(fact)
                allowed.append(fact["value"])
            allowed += table["derived"]
            last_table = table
            if table["rows"]:
                head, rows = docx_out.table_rows(table)
                docx_out.table(doc, head, rows, title=table["title"])
            else:
                docx_out.paragraph(doc, "Insufficient verified evidence available for this table.", italic=True)
            sections_out.append({"type": "table", "table": {k: v for k, v in table.items() if k not in {"facts", "derived"}}})
        elif kind == "target_table":
            period = _periods(section.get("period", "latest"), section["actual"], params)
            period = period[-1] if period else params["period"]
            rows = []
            last_table = {"rows": [], "title": f"Target vs achievement {period}", "periods": [period], "unit_label": "MT"}
            for code in _entities(section["entities"], params):
                target = facts.canonical(section["target"], code, period)
                actual = facts.canonical(section["actual"], code, period)
                if not target and not actual:
                    continue
                pct = round(actual["value"] / target["value"] * 100, 2) if target and actual and target["value"] else None
                t_ref = a_ref = None
                if target:
                    t_ref = cite(target)
                    allowed.append(target["value"])
                if actual:
                    a_ref = cite(actual)
                    allowed.append(actual["value"])
                if pct is not None:
                    allowed.append(pct)
                rows.append([code, f"{target['value']:.2f}" if target else "—", f"{actual['value']:.2f}" if actual else "—", f"{pct:.2f}%" if pct is not None else "—"])
                last_table["rows"].append({"entity": code, "target": target["value"] if target else None, "actual": actual["value"] if actual else None, "achievement_pct": pct, "cites": [t_ref, a_ref]})
            if rows:
                docx_out.table(doc, ["Entity", f"Target {period} (MT)", f"Actual {period} (MT)", "Achievement"], rows, title=f"Production target vs achievement, {period}")
            else:
                docx_out.paragraph(doc, "Insufficient verified evidence available: no target figures have been extracted yet.", italic=True)
            sections_out.append({"type": "target_table", "rows": last_table["rows"], "period": period})
        elif kind == "chart":
            metrics = section["metric"] if isinstance(section["metric"], list) else [_fill(section["metric"], params)]
            series: dict[str, list[tuple[str, float]]] = {}
            unit = "million_tonnes"
            for metric in metrics:
                periods = _periods(_fill(section["periods"], params), metric, params)
                for code in _entities(section["entities"], params):
                    for period in periods:
                        fact = facts.canonical(metric, code, period)
                        if not fact:
                            continue
                        unit = fact["unit"]
                        if section["kind"] == "line":
                            series.setdefault(code, []).append((period, fact["value"]))
                        else:
                            label = (domain.metric(metric) or {}).get("label", metric) if len(metrics) > 1 else period
                            series.setdefault(label, []).append((code, fact["value"]))
            if series:
                png = _chart(section["kind"], series, title, unit)
                docx_out.image(doc, png)
                sections_out.append({"type": "chart", "kind": section["kind"], "series": {k: v for k, v in series.items()}})
        elif kind == "narrative" and last_table and last_table.get("rows"):
            text, derived = _narrative(last_table, cite_for)
            allowed += derived
            verdict = guard.check(text, allowed) if text else {"ok": True, "checked": 0, "unsupported": []}
            if not text:
                text = "See the table above."
            unsupported_total += len(verdict["unsupported"])
            checked_total += verdict["checked"]
            docx_out.paragraph(doc, text)
            sections_out.append({"type": "narrative", "text": text, "guard": verdict})
        elif kind == "evidence":
            query = _fill(section["query"], params)
            hits = [h for h in hybrid.search(query, k=4, exclude_kinds=["table"]) if h["vector_sim"] >= 0.8]
            if not hits:
                docx_out.paragraph(doc, "No supporting narrative evidence found in the library.", italic=True)
            for hit in hits:
                n = len(citations) + 1
                citations.append(_citation_for_chunk(n, hit))
                docx_out.paragraph(doc, f"“{hit['text'][:500].strip()}…” [{n}]", keep_citations=True, size=10)
            sections_out.append({"type": "evidence", "passages": [{"n": c["n"], "snippet": c["snippet"], "filename": c["filename"], "page_no": c["page_no"]} for c in citations if c["kind"] == "passage"]})

    docx_out.evidence_section(doc, citations, heading="Evidence trail")
    path = docx_out.save(doc, f"Report-{template_id}", filename)
    result = {
        "template": template_id,
        "title": title,
        "params": params,
        "sections": sections_out,
        "citations": citations,
        "docx_path": str(path),
        "guard": {"ok": unsupported_total == 0, "checked": checked_total, "unsupported": unsupported_total},
        "seconds": round(time.time() - started, 2),
    }
    db.execute(
        "INSERT INTO answers(kind, question, route, payload, guard_ok, unsupported, numbers, seconds, at) VALUES ('report',?,?,?,?,?,?,?,?)",
        (title, template_id, db.dumps(result), int(unsupported_total == 0), unsupported_total, checked_total, result["seconds"], time.time()),
    )
    return result


def pick_template(text: str) -> tuple[str, dict]:
    """Which template a free-text request asks for, and its parameters."""
    low = text.lower()
    params: dict = {}
    periods = domain.find_periods(text)
    if periods and not periods[0].startswith("LAST:"):
        params["period"] = periods[-1]
    if re.search(r"target|achievement", low):
        return "target_vs_achievement", params
    if re.search(r"trend|over the (last|past)|years|historical", low):
        entities = domain.find_entities(text)
        if entities:
            params["entity"] = entities[0]
        metric = domain.find_metric(text)
        if metric and metric not in {"growth_pct", "achievement_pct"}:
            params["metric"] = metric
        n = re.search(r"(\d{1,2})\s+years", low)
        if n:
            params["years"] = int(n.group(1))
        return "multi_year_trend", params
    return "subsidiary_annual_production", params
