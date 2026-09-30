<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="Logo-dark.svg">
    <img src="Logo.svg" alt="Stratum" width="72">
  </picture>
</p>

# Stratum

**Evidence-first document intelligence for CMPDI and Coal India.** Drop in annual reports, statistics,
spreadsheets, scans and past parliamentary replies. Ask questions, draft the reply to a Lok Sabha question,
generate a report — and every figure in every answer links to the cell it was read from.

Runs entirely on one laptop. No cloud, no API key, nothing leaves the machine — and the workbench counts that.

*Smart India Hackathon 2026 — CMPDI / CIL: AI-assisted document processing, automated reports, topic
identification, question answering, validation and traceability. Built on
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).*

## What it does

| | |
|---|---|
| **Library** | PDF, Excel, CSV and scans become *evidence* (pages, tables, cells with boxes) and *facts* (numbers with a unit, a period, and the cell they came from). Image-only pages are OCR'd; figures and bad scans are described by a local vision model. |
| **Ask** | "Subsidiary-wise production, FY2022-23 vs FY2023-24" returns an exact table. Click a number: the page opens with the cell boxed, the checks it passed beside it. Mixed questions ("why did production rise?") add the passages that explain it. English, Hindi, and Hinglish. |
| **PQ Reply Builder** | Paste a Lok Sabha / Rajya Sabha question: parts (a)(b)(c) answered from facts, annexure tables, similar past replies — and a warning when a figure differs from what was told to Parliament before. Comes out as an official-format Word document. |
| **Reports** | Subsidiary-wise production, target vs achievement, multi-year trend — a Word document with charts and a citation trail. |
| **Topics** | What the documents are about (BERTopic over the library), with a word cloud and topic-over-time. |
| **Review** | A fact a check refuses to pass goes to a review queue with the reason. Accept, correct, or reject; nothing flagged reaches an answer unseen. |
| **Metrics** | Extraction exact-match, routing accuracy, numeric correctness, citation correctness, unsupported-number rate, automation % — computed now from a hand-checked gold set, each with its denominator. |
| **The seal** | Outbound calls are denied before they run and counted. Open it deliberately, and the record shows what left. |

## How it stays honest

- **The model maps, the code extracts.** For a table, a model (or plain rules) says *which column is which
  metric and period*; it never returns a number. Code copies the digits out of the cells.
- **Status is evidence, not confidence.** `verified` (another source agrees, or a person approved it),
  `consistent` (every check passed), `flagged` (a check failed). The checks are listed on screen: units,
  plausible range, totals that must add up, stated growth and achievement recomputed, year-on-year jumps,
  provisional vs final.
- **The model never writes SQL.** A question becomes a `QueryIntent` and then a parameterised lookup.
- **A number guard.** Every number in generated text must appear in the evidence, or the text is flagged
  (Hindi digits included).
- **"Insufficient verified evidence available."** is an answer, and Stratum sets aside anything only loosely
  related rather than showing it as support.

## Run it

Needs Windows, Node ≥ 22.15, pnpm, [uv](https://docs.astral.sh/uv/), and (for real local inference) a GPU with
~4 GB. The model runtime is [llama.cpp](https://github.com/ggml-org/llama.cpp) behind llama-swap.

```bat
run.bat models      :: once — fetch the inference runtime and write the llama-swap config
run.bat             :: backend + models + workbench, fullscreen (kiosk)
run.bat windowed    :: the same in an ordinary browser tab -> http://127.0.0.1:3090
run.bat check       :: is everything set up correctly?
run.bat stop
```

| Port | What |
|---|---|
| 3090 | the workbench (DeepSeek Harness web, `DSH_HOME=~/.dsh-stratum`) |
| 8642 | the Stratum backend (FastAPI, loopback only) |
| 8090 | llama-swap → Qwen3-4B (text) and Qwen3-VL-2B (vision) |

The harness home, the workspace (`~/.stratum/workspace`, where generated `.docx` files land) and the data
(`D:\stratum\data` by default) are all separate from any other project on the machine.

Try the sample corpus: open the **Library** (sidebar foot), add everything in `corpus/sample/`, then ask
*"Give subsidiary-wise coal production for 2022-23 and 2023-24"*, click a figure, and paste a question from
`backend/scripts/smoke.py` into the composer.

## Layout

```
backend/                  Python: ingestion, facts, search, ask, PQ, reports, topics, metrics  (FastAPI, SQLite)
  stratum/ingest/           Docling / pandas -> CUES -> chunks -> embeddings
  stratum/facts/            mapper (rules or model) -> verbatim extraction -> checks -> review
  stratum/ask/              intent -> SQL compiler | hybrid search -> compose -> number guard
  stratum/pq/ reports/ topics/ metrics/
  tests/                    pytest over the deterministic core
plugins/stratum-ui/       the harness plugin: lanes, tools, proxy (host) and the tabs and cards (browser)
profile/                  the harness profile patch, agent preset, settings
registry/ runtime/        the model fleet (with licences) and the llama-swap config
scripts/                  start, kiosk, doctor, licence audit, demo recorder
corpus/sample/            eight SAMPLE documents with known figures
plan.md                   the SIH solution document — critique of the first design, architecture, metrics
```

## Tests

```
npm test               # plugin: lanes, tools, proxy, and every tab and card rendered against real backend output
npm run test:backend   # backend: parsing, the number guard, extraction and checks, PQ headers, routing
npm run doctor         # the whole install
npm run licence-audit  # permissive licences only — PyMuPDF (AGPL) is banned
```

## Status

A working MVP on a synthetic sample corpus. The measured percentages in `plan.md` §12 are on that corpus and
say so; they show the measurement works, not how Stratum does on real CMPDI documents. Not built, and named
as such: Laya/SetFit routing (needs query logs), MinerU (the scale-up parser), Postgres/pgvector (the
production target behind the same SQL layer), and the timed trials that would turn "time reduction" from
a column into a number.

## Licence

MIT. See `THIRD_PARTY_NOTICES.md` for everything it stands on — the harness, the models, every Python
dependency and its licence.
