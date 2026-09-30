"""Capture real backend output as fixtures for the plugin's UI render tests.

    python scripts/make_ui_fixtures.py        # backend must be running on :8642 with the sample corpus ingested

Writes plugins/stratum-ui/test/fixtures/backend.json. The fixtures are the SAMPLE corpus's own answers — real
output, not hand-written JSON — so the tests exercise the components against exactly what the backend emits.
"""

from __future__ import annotations

import json
from pathlib import Path

import smoke

OUT = Path(__file__).resolve().parents[2] / "plugins" / "stratum-ui" / "test" / "fixtures" / "backend.json"


def get(path: str, payload: dict | None = None):
    body, _ = smoke.call(path, payload)
    assert "http_error" not in body, (path, body)
    return body


def main() -> None:
    out: dict = {"documents": get("/documents"), "stats": get("/stats")}
    facts = get("/facts?limit=500")
    out["facts"] = facts
    flagged = next((f for f in facts["facts"] if f["status"] == "flagged"), facts["facts"][0])
    out["fact_flagged"] = get(f"/facts/{flagged['id']}")
    verified = next(f for f in facts["facts"] if f["status"] == "verified" and f["entity_code"] == "SECL")
    out["fact_verified"] = get(f"/facts/{verified['id']}")
    out["overlay"] = get("/documents/5/pages/1/overlay")
    xlsx = next(d for d in out["documents"] if d["filename"].endswith(".xlsx"))
    out["doc_xlsx"] = get(f"/documents/{xlsx['id']}")
    out["table_xlsx"] = get(f"/documents/{xlsx['id']}/tables/{out['doc_xlsx']['tables_info'][0]['id']}")
    out["topics"] = get("/topics")
    out["metrics"] = get("/metrics")
    out["ask"] = {
        "single": get("/ask", {"question": "What was the coal production of CCL in FY2023-24?"}),
        "compare": get("/ask", {"question": "Compare subsidiary-wise coal production FY2023-24 vs FY2024-25"}),
        "insufficient": get("/ask", {"question": "What is the coal production of Mars Colony in 2024?"}),
        "achievement": get("/ask", {"question": "Did SECL achieve its production target in FY2023-24?"}),
        "explain": get("/ask", {"question": "Why was offtake affected by rake availability?"}),
    }
    out["pq"] = get("/pq", {"text": smoke.PQ})
    out["reports"] = [get("/reports", {"template": t}) for t in ("subsidiary_annual_production", "target_vs_achievement", "multi_year_trend")]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
