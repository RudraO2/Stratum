"""Licence audit of the Python environment Stratum actually runs in.

The rule: permissive licences only. PyMuPDF (AGPL) is banned; pypdfium2 renders pages, Docling
(MIT) reads layout, Qwen (Apache-2.0) are the models.

    python scripts/licence_audit.py              # print the report; exit 1 on a banned licence
    python scripts/licence_audit.py --markdown   # the third-party table, for THIRD_PARTY_NOTICES.md

Three outcomes per installed distribution:
  permissive  MIT / BSD / Apache / ISC / PSF / Zlib / Unlicense / CC0 ...        -> fine
  disclosed   weak copyleft (MPL, LGPL, EPL) used unmodified as a library        -> listed, allowed
  banned      AGPL / GPL / SSPL / proprietary / unknown                          -> fails the audit

Package metadata describes the package, not what it vendored; a component that bundles something with a
different licence needs a hand-written entry in DECISIONS below, with the reason.
"""

from __future__ import annotations

import re
import sys
from importlib import metadata

BANNED_PACKAGES = {"pymupdf", "fitz", "pymupdf4llm"}

PERMISSIVE = re.compile(
    r"\b(mit|bsd|apache|isc|psf|python software foundation|python-2\.0|zlib|unlicense|cc0|0bsd|public domain|hpnd|mit-cmu|boost|bsl-1\.0|ofl|open font)\b",
    re.I,
)
WEAK = re.compile(r"\b(mpl|mozilla public|lgpl|lesser general public|eclipse public|epl|cddl)\b", re.I)
STRONG = re.compile(r"\b(agpl|affero|gpl|general public license|sspl|commons clause|proprietary|commercial)\b", re.I)

# Hand-written decisions for packages whose metadata is missing or misleading. Each needs a reason.
DECISIONS = {
    "pip": ("permissive", "MIT (packaging tool, not shipped)"),
}


def licence_text(dist: metadata.Distribution) -> str:
    meta = dist.metadata
    parts = []
    expression = meta.get("License-Expression")
    if expression:
        parts.append(expression)
    declared = meta.get("License")
    if declared and len(declared) < 200:
        parts.append(declared)
    parts += [c.split("::")[-1].strip() for c in meta.get_all("Classifier") or [] if c.startswith("License ::")]
    return "; ".join(dict.fromkeys(p for p in parts if p))


def classify(name: str, text: str) -> tuple[str, str]:
    if name in DECISIONS:
        return DECISIONS[name]
    if not text or text.upper() == "UNKNOWN":
        return "banned", "no licence declared in the package metadata — decide and record it in DECISIONS"
    # "GPL" inside "LGPL" or alongside an alternative ("MIT OR GPL") is judged per clause
    clauses = re.split(r"\bor\b|/|,|;| AND ", text, flags=re.I)
    if any(PERMISSIVE.search(c) and not STRONG.search(c) for c in clauses):
        return "permissive", text
    if WEAK.search(text) and not re.search(r"\b(agpl|affero|(?<!l)gpl)\b", text, re.I):
        return "disclosed", text
    if STRONG.search(text):
        return "banned", text
    return "banned", f"unrecognised licence text: {text}"


def main() -> int:
    rows = []
    for dist in metadata.distributions():
        name = (dist.metadata.get("Name") or "").strip()
        if not name:
            continue
        verdict, text = classify(name.lower(), licence_text(dist))
        rows.append((name, dist.version, verdict, text))
    rows.sort(key=lambda r: r[0].lower())

    if "--markdown" in sys.argv:
        print("| Package | Version | Licence |\n|---|---|---|")
        for name, version, verdict, text in rows:
            print(f"| {name} | {version} | {text.replace('|', '/')[:90]} |")
        return 0

    banned_present = [r for r in rows if r[0].lower() in BANNED_PACKAGES]
    by = {"permissive": 0, "disclosed": 0, "banned": 0}
    for _, _, verdict, _ in rows:
        by[verdict] += 1
    print(f"{len(rows)} Python distributions: {by['permissive']} permissive, {by['disclosed']} weak-copyleft (disclosed), {by['banned']} banned/unknown")
    for name, version, verdict, text in rows:
        if verdict == "disclosed":
            print(f"  disclosed  {name} {version}: {text}")
    for name, version, verdict, text in rows:
        if verdict == "banned":
            print(f"  BANNED     {name} {version}: {text}")
    for name, version, _, _ in banned_present:
        print(f"  BANNED     {name} {version}: explicitly banned package is installed")
    return 1 if by["banned"] or banned_present else 0


if __name__ == "__main__":
    raise SystemExit(main())
