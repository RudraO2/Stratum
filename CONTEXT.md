# Stratum

The shared language for Stratum — the second SIH 2026 submission: evidence-first document
intelligence for CMPDI and Coal India, running entirely on the operator's own machine. This file
is the vocabulary humans and agents both use. It is deliberately short: only terms whose meaning is
specific to *this* project.

General AI jargon (token, VRAM, quantisation, RAG, embedding, OCR) carries its ordinary meaning here
and is not redefined.

## The system

**Stratum**:
The product name. Geological layers, which is also the architecture: *evidence* (what a document
says, with its page and box) under *facts* (numbers with lineage and checks) under *answers*
(text that may only state what the layers below contain). One constant in `scripts/stratum-config.mjs`.
_Avoid_: the workbench (that is the harness UI), the platform, the tool

**Evidence**:
What a document actually says: pages, text blocks, tables and cells, each with a bounding box and its
heading path. Stored as **CUES** — a thin versioned shape over the parser's output plus our
provenance. Evidence is never edited.

**Fact**:
One number with a meaning: an entity (a subsidiary, a state, All India), a metric, a financial year,
a unit, a value — copied verbatim from a cell, with the cell it came from. Facts are extracted by
code; a model may only say *where* they are.
_Avoid_: data point, record, row

**Status** (of a fact):
Earned from named checks, never from a model's confidence. `verified` — another independent source
agrees, or a person approved it. `consistent` — every applicable check passed. `flagged` — a check
failed; it is in the review queue with the reason. `rejected` — a person said no. No thresholds.

**Check**:
A deterministic test a fact goes through and is shown with: units, plausible range, totals (the
subsidiaries sum to the CIL row), stated growth % and achievement % recomputed, year-on-year jump,
agreement with other sources, provisional-vs-final. The Facts tab and the lineage panel list them.

**"The LLM maps, the code extracts"**:
The one design rule the ingestion rests on. For a table the model (or, for standard tables, plain
rules) returns a *mapping* — which column is which metric and period, what the unit is. It never
returns a number. Code then copies the digits out of the cells. A model cannot invent a value it is
never asked to write.

**Semantic layer** (`QueryIntent`):
How a question becomes a query without a model writing SQL: `{metric, entities, periods, scope,
compare, explain, achievement}` → parameterised lookups. Rules parse it first; a schema-constrained
model call fills it only when the rules find no metric.

**Number guard**:
Every number in generated text must match the evidence bundle (fact values, derived figures we
computed, numbers in cited passages, the question itself) within a tolerance, or the text is
flagged. Years, financial years and citation markers are not claims. Devanagari digits are normalised
first, so a Hindi answer cannot slip a figure past it. Its counts feed the unsupported-number rate.

**Insufficient verified evidence**:
The answer when the library cannot answer. Stratum prints exactly that and sets aside whatever
loosely related text it found, rather than showing it as if it were support.

**Source precedence**:
Coal Directory > Annual Report > Provisional Statistics > PQ reply > press release. The same metric
legitimately differs across sources (provisional vs final), so a figure is reported from the
highest-precedence, non-provisional source, and every other source that disagrees is shown as a
**discrepancy** beside it.

**Library**:
The documents Stratum has read. A drawer opened from the sidebar foot: add PDF, Excel, CSV or scans;
see pages, tables, facts and what was flagged for each. Documents are copied to the machine's own
store and read here.

**Lane**:
How a question becomes a tool call on the local provider. The local model is never given tool
definitions (a 4B model wraps the call in prose the server cannot parse), so the router's task type
picks the tool, our code builds the call from the operator's own words, and the harness dispatches
the real tool. The answer text is what the tool rendered — no model re-reads it on the way out.

**Task type**:
What the router classifies a request as: `ask`, `pq_reply`, `report`, `topics` (each a lane),
`vision` (an image is attached) or `chat`. The routing chip shows it.

**PQ Reply Builder**:
The headline feature. A Lok Sabha / Rajya Sabha question in, a draft reply out: parts (a)(b)(c)
answered from facts, annexure tables, similar past replies, **review notes** (above all: a figure that
differs from what was told to Parliament before), and an official-format Word document. The
ministry's real risk is contradicting a previous reply; the warning is the point.

**Past-reply mismatch**:
A figure in the draft that differs, beyond rounding, from the same figure in an archived PQ reply.
Deliberately stricter than cross-source verification: 186.9 told to the House and 187.0 now on file is
worth a line.

**Gold set**:
Hand-checked ground truth (`backend/stratum/metrics/gold.yaml`): facts a person reads off the page,
labelled questions with expected routes and figures, and timed trials. Every metric on the Metrics tab
is computed from it and from the system's own logs. For the sample corpus the facts are generated from
the constants the documents were written from — never from Stratum's output.

**The seal**:
Whether Stratum is denying outbound calls. Closed by default, closed again by a restart, opened only
from the control in the Sovereignty drawer — which is recorded like any other attempt. It is what makes
the egress monitor an instrument rather than an assertion. The backend and the model runtime are
loopback only, and the plugin refuses a non-loopback backend endpoint.
_Avoid_: the toggle, the switch, egress mode

**Egress monitor** / **Sovereignty drawer**:
The count of outbound attempts and the record of each. Resting form: the row at the sidebar foot.
Full form: the drawer it opens (seal, record, residency, model plane). Inherited from Faraday.

**Routing chip**:
The small element beside the composer showing what kind of task the router saw and which fleet member
answered, expanding into the score per member.

**Fleet**:
The open-weight models on the machine — text (Qwen3-4B), vision (Qwen3-VL-2B). Licence-constrained to
permissive names; the loader refuses anything else (a decoy is declared so the refusal is visible).

**Model plane**:
Everything behind the `ModelProvider` interface: **local** (llama.cpp through llama-swap, real
inference, genuinely offline), **replay** (authored responses for plain chat, disclosed on screen),
**remote** (development only, never in a demo).

**Harness**:
DeepSeek Harness (MIT, Node): the scaffolding Stratum's UI runs in. Everything in it is a plugin;
`plugins/stratum-ui` is ours. Built on, not forked — the brand guidelines bless "built on DeepSeek
Harness".

## Scope words

**Sample corpus**:
Eight small files in `corpus/sample/`, every one stamped SAMPLE and generated from known figures
(`backend/scripts/make_sample_corpus.py`). It exercises every path: digital tables, a spreadsheet in
lakh tonnes, an image-only scan with a deliberate misprint, three PQ replies, a provisional press
release. Results on it demonstrate that the measurement works, not how Stratum does on real documents.

**The cut line**:
What ships versus what is named out loud as out of scope: Laya/SetFit routing, MinerU, Postgres/pgvector,
a graph database, ColPali are all named and not built. Stating it is part of the pitch.

## Audiences

**The panel**: SIH evaluators.
**The client**: CMPDI and Coal India — pitched on deployability by their own IT, on audit evidence, and
on never contradicting a previous answer to Parliament. Not on benchmark charts.
