"""Smoke-test the running backend (127.0.0.1:8642). Prints a compact result per call.

    python scripts/smoke.py [ask|pq|reports|topics|metrics|all]
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8642/v1"


def call(path: str, payload: dict | None = None, timeout: int = 600):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(BASE + path, data=data, headers={"content-type": "application/json"} if data else {})
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read())
            return body, time.time() - started
    except urllib.error.HTTPError as error:
        return {"http_error": error.code, "body": error.read().decode()[:600]}, time.time() - started


def show(title: str, body, seconds: float, keys=None):
    print(f"\n=== {title}  ({seconds:.1f}s)")
    if keys and isinstance(body, dict):
        body = {k: body.get(k) for k in keys}
    print(json.dumps(body, indent=1, ensure_ascii=False)[:2400])


ASK = [
    "What was the coal production of Central Coalfields Limited in FY 2023-24?",
    "Compare subsidiary-wise coal production FY2023-24 vs FY2024-25",
    "Why was offtake affected by rake availability?",
    "SECL ka 2022-23 mein utpadan kitna tha?",
    "What is the coal production of Mars Colony in 2024?",
]


def run_ask():
    for question in ASK:
        body, seconds = call("/ask", {"question": question})
        show(question, body, seconds, ["route", "intent", "answer", "guard", "citations", "notes", "status", "language"])


PQ = """LOK SABHA
UNSTARRED QUESTION NO. 1234
TO BE ANSWERED ON 05.08.2025

COAL PRODUCTION BY SECL

Will the Minister of COAL be pleased to state:
(a) the coal production of South Eastern Coalfields Limited during the last three years;
(b) whether the production target was achieved in 2023-24; and
(c) the steps taken to improve evacuation?
"""


def run_pq():
    body, seconds = call("/pq", {"text": PQ})
    show("PQ reply", body, seconds)


def run_reports():
    templates, _ = call("/reports/templates")
    show("templates", templates, 0)
    for template in [t["id"] for t in templates]:
        body, seconds = call("/reports", {"template": template})
        show(f"report {template}", body, seconds)


def run_topics():
    body, seconds = call("/topics/rebuild", {})
    show("topics rebuild", body, seconds)


def run_metrics():
    body, seconds = call("/metrics")
    show("metrics", body, seconds)


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in (("ask", run_ask), ("pq", run_pq), ("reports", run_reports), ("topics", run_topics), ("metrics", run_metrics)):
        if which in ("all", name):
            fn()
