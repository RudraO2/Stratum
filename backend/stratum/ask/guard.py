"""The number guard: generated text may only state numbers the evidence contains.

Every number in an answer, PQ reply or report narrative is matched against the
evidence bundle — fact values, derived values we computed (differences, % change,
sums), numbers in cited passages and in the question itself. Years, financial
years and citation markers are not claims and are skipped. Anything left over is
an unsupported number, shown on screen and counted in the metrics.
"""

from __future__ import annotations

import re

from .. import domain

SKIP = re.compile(r"\[\d+\]|\b(?:fy\s*)?(?:19|20)\d{2}\s*[-–/]\s*\d{2,4}\b|\bfy\s*\d{2,4}\b|\b(?:19|20)\d{2}\b|^\s*\d+[.)]\s", re.I | re.M)


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= max(0.011, 0.006 * abs(b))


def check(text: str, allowed: list[float]) -> dict:
    cleaned = SKIP.sub(" ", domain.ascii_digits(text))
    found = domain.numbers_in(cleaned)
    pool = [abs(v) for v in allowed if v is not None]
    unsupported = []
    for value in found:
        if abs(value) < 10 and float(value).is_integer():  # counts ("three subsidiaries", "(a)") are not figures
            continue
        if any(_close(abs(value), candidate) for candidate in pool):
            continue
        unsupported.append(value)
    return {"ok": not unsupported, "checked": len(found), "unsupported": unsupported}
