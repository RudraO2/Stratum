# SIH Solution Plan — AI-Assisted Geological, Mining & Production Information Platform for CMPDI/CIL

## Exact SIH Problem Statement (Verbatim)

**Background:**\
\
CMPDI/CIL subsidiaries play a key role in providing geological and mining information to the Ministry of Coal and responding to parliamentary and high-priority administrative inquiries. These reports require compilation of data from scanned PDFs, digital documents, spreadsheets, images, and historical archives. The current workflow is largely manual, resulting in:\
\
• High dependence on individual expertise\
• Delay in generating reports and analytics\
• Higher probability of manual errors\
• Limited ability to quickly retrieve insights when required Objectives:\
• Deploy an automated platform for AI-assisted geological, mining and any other production figures document processing and reporting.\
• Enhance data validation, consistency, and traceability across historical and contemporary datasets.\
• Build an efficient, scalable foundation for future digital transformation initiatives within each CIL subsidiary and the Ministry of Coal.\
\
Desired Outcomes: The solution should be implemented in structured phases, including requirement analysis, data digitization and pre-processing, platform development, system testing, integration with CIL subsidiary workflows, training, and continuous enhancement to ensure scalability and long-term adoption.\
\
1\. Automated Report Generation Platform 2. Automated Word Cloud and Topic Identification Module 3. AI-Based Query and Response System Expected Benefits:\
\
• Reduction in report preparation time as less as it can be, quantified in percentage.\
• Maximum accuracy, calculated in percentage in structured extraction and report generation.\
• Maximum automation, calculated in percentage of repetitive reporting and response workflows.\
• Faster response to high-level inquiries and parliamentary questions\
• Improved data accessibility, transparency, and standardization\
• Strengthened operational efficiency and informed decision-making using historical insights and AI-generated recommendations Impact:\
\
The proposed system should significantly modernize CMPDI/CIL subsidiaries reporting ecosystem, reduce dependency on manual processes, improve response timelines, and strengthen the coal sectorâ€™s capability to support governance, policy planning, and operational excellence.

---

# 1. Proposed Solution Summary

We will build a **local-first, evidence-driven, multimodal intelligence platform** for CMPDI/CIL that can ingest historical and modern data from heterogeneous sources, normalize it into a common evidence format, extract authoritative structured facts, retrieve supporting evidence, answer questions, generate reports, discover topics, and preserve end-to-end traceability.

The key design principle is:

> **Do not treat every source as plain text and do not rely on one RAG pipeline for every question.**

The platform will use different execution paths depending on the question:

- **SQL / structured retrieval** for numerical production, dispatch, capacity, mine, subsidiary, year, grade, and other measurable figures.
- **Hybrid RAG** for descriptive information, historical explanations, observations, policies, conclusions, and report text.
- **Knowledge graph retrieval** for entity relationships such as mine → coalfield → subsidiary → district → geological formation.
- **Visual / multimodal retrieval** for scanned documents, geological maps, figures, layouts, charts, and difficult OCR cases.
- **Laya decision models** for routing, classification, confidence scoring, validation, and human-review gates.
- **Generative LLMs** only where natural-language reasoning, summarization, report writing, or response generation is required.

This prevents the common failure mode of using a generative LLM as both the database and the reasoning engine.

---

# 2. High-Level Architecture

```text
                         CMPDI / CIL DATA SOURCES
                                  │
        ┌─────────────────────────┼──────────────────────────┐
        │                         │                          │
   Scanned PDFs              Digital Docs              Structured Data
 Historical archives       DOCX/PPTX/PDF              XLSX/CSV/DB/API
 Maps / images / charts    Reports / notices          Production figures
        │                         │                          │
        └─────────────────────────┼──────────────────────────┘
                                  │
                           INGESTION GATEWAY
                                  │
                       File fingerprint + metadata
                                  │
                        Parser / OCR selection
                                  │
                 ┌────────────────┼─────────────────┐
                 │                                  │
            Docling / MinerU                 Native tabular parsers
                 │                                  │
                 └────────────────┬─────────────────┘
                                  │
                     CIL UNIFIED EVIDENCE SCHEMA
                                  │
             ┌────────────────────┼────────────────────┐
             │                    │                    │
        Evidence Store        Fact Store          Graph Store
       text/page/table      PostgreSQL / SQL      entities/relations
             │                    │                    │
       Hybrid index          validated facts       graph index
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  │
                       LAYA DECISION LAYER
             routing / classification / validation / confidence
                                  │
        ┌─────────────────────────┼────────────────────────┐
        │                         │                        │
       SQL                    Hybrid RAG               Graph / Visual
        │                         │                        │
        └─────────────────────────┼────────────────────────┘
                                  │
                           EVIDENCE BUNDLE
                                  │
                        Generative LLM Layer
                                  │
       ┌──────────────────────────┼──────────────────────────┐
       │                          │                          │
 Parliamentary Q&A         Automated Reports       Analytics / Topics
       │                          │                          │
       └──────────────────────────┼──────────────────────────┘
                                  │
                        CITATIONS + TRACEABILITY
```

---

# 3. Core Architectural Principle: Universal Evidence Contract

We should **not build separate custom logic for every file type** and we should **not invent another PDF parser from scratch**.

Instead, mature parsing tools should convert heterogeneous documents into one normalized internal contract.

We will create a domain-specific schema called:

## CUES — CIL Unified Evidence Schema

Every ingested file should eventually be represented in a consistent structure.

Example:

```json
{
  "schema_version": "1.0",
  "document_id": "sha256:...",
  "source": {
    "filename": "production_report_2025.pdf",
    "subsidiary": "SECL",
    "mime_type": "application/pdf",
    "sha256": "...",
    "ingested_at": "..."
  },
  "document_metadata": {
    "title": "...",
    "document_type": "annual_report",
    "year": 2025,
    "language": "en"
  },
  "blocks": [
    {
      "block_id": "b001",
      "type": "text",
      "page": 4,
      "section": "Production",
      "text": "...",
      "bbox": [100, 210, 800, 600],
      "confidence": 0.98
    }
  ],
  "tables": [
    {
      "table_id": "t001",
      "page": 7,
      "headers": [],
      "rows": [],
      "bbox": [],
      "confidence": 0.96
    }
  ],
  "facts": [
    {
      "entity": "Mine XYZ",
      "metric": "coal_production",
      "value": 7.42,
      "unit": "million_tonnes",
      "period": "FY2025",
      "source_block": "t001",
      "confidence": 0.99
    }
  ],
  "provenance": {
    "parser": "docling",
    "parser_version": "...",
    "original_page": 7
  }
}
```

The schema must preserve:

- original file identity;
- checksum / hash;
- page number;
- section hierarchy;
- table and cell locations;
- bounding boxes where available;
- OCR confidence;
- parser/model used;
- extraction timestamps;
- source subsidiary;
- version history;
- normalized business facts;
- confidence score;
- human-review status.

This becomes the common language between ingestion, search, SQL, graph, reporting, and audit systems.

---

# 4. Ingestion Layer

## 4.1 Supported Inputs

Initial target formats:

- Scanned PDF
- Searchable PDF
- DOC / DOCX
- PPT / PPTX
- XLS / XLSX
- CSV
- JPG / PNG / TIFF
- Text / Markdown
- HTML
- Existing databases
- Historical archive exports
- Future APIs from CIL subsidiaries

## 4.2 Parser Strategy

Primary candidates:

### Docling
Use for:

- PDF
- DOCX
- XLSX
- PPTX
- images
- page structure
- layout preservation
- tables
- reading order
- structured document output

Repository:
https://github.com/docling-project/docling

### MinerU
Use where document quality is difficult:

- scanned historical reports;
- OCR-heavy pages;
- complex layout;
- tables;
- figures;
- mathematical/technical layouts;
- mixed-language documents.

Repository:
https://github.com/opendatalab/MinerU

## 4.3 Parser Routing

The ingestion gateway should inspect each incoming file and choose the best parser.

Example:

```text
Upload
  │
  ├─ XLSX/CSV ───────────→ native structured parser
  │
  ├─ searchable PDF ─────→ Docling
  │
  ├─ scanned PDF ────────→ MinerU / OCR pipeline
  │
  ├─ image/map ──────────→ OCR + visual model
  │
  └─ DOCX/PPTX ──────────→ Docling
```

The original file must always be preserved unchanged in immutable storage.

---

# 5. Two-Layer Knowledge Architecture

One of the most important design decisions is to separate **evidence** from **facts**.

## 5.1 Evidence Layer

Stores what was actually present in source material.

Example hierarchy:

```text
Document
  → Page
    → Section
      → Paragraph
      → Table
        → Row
          → Cell
      → Figure
      → Image
```

This layer is used for:

- citations;
- human verification;
- semantic retrieval;
- historical explanations;
- audit trails;
- report evidence.

## 5.2 Fact Layer

Stores normalized authoritative data.

Example:

```text
Mine       = Gevra
Subsidiary = SECL
Metric     = Coal Production
Value      = 59
Unit       = Million Tonnes
Period     = FY2024-25
Source     = annual_report.pdf / page 48 / table 11
Confidence = 0.99
Status     = verified
```

The fact layer should live primarily in a relational database such as PostgreSQL.

This is where calculations, filters, aggregations, percentages, trends, subsidiary-wise comparisons, and report tables should come from.

---

# 6. Canonical Domain Model

Before building the AI layer, we should define canonical entities and metrics.

## Candidate Entities

- CIL
- CMPDI
- Subsidiary
- Mine
- Coalfield
- Project
- Geological block
- State
- District
- Financial year
- Calendar year
- Coal grade
- Seam
- geological formation
- production unit
- equipment / operation category
- report
- parliamentary question
- ministry request

## Candidate Metrics

- coal production
- coal dispatch
- overburden removal
- capacity
- target production
- achieved production
- growth percentage
- mine depth
- reserve
- resource
- stripping ratio
- productivity
- manpower
- grade-wise production
- subsidiary-wise production
- project progress
- safety statistics

All terms should have aliases and canonical units.

Example:

```text
"MT", "Mt", "million tonne", "million tonnes"
                ↓
        million_tonnes
```

The ontology and units layer is necessary for consistency across decades of documents.

---

# 7. Laya Decision Layer

Laya should **not** replace the LLM, OCR, database, embeddings, or RAG system.

It should act as a lightweight deterministic decision layer around them.

Repository / project candidate:
https://github.com/NandhaKishorM/laya

## 7.1 Query Routing

Example classes:

- `sql`
- `rag`
- `sql_plus_rag`
- `graph`
- `visual`
- `report_generation`
- `topic_analysis`

Example:

```text
Question:
"What was SECL coal production during FY2024-25?"

Laya decision:
route = SQL
confidence = high
```

```text
Question:
"Why did production decline during FY2024-25?"

Laya decision:
route = SQL + Hybrid RAG
```

```text
Question:
"Which mines belonging to SECL operate in this coalfield?"

Laya decision:
route = Graph
```

## 7.2 Ingestion Classification

Laya can classify:

- document type;
- subsidiary;
- probable year;
- extraction priority;
- whether OCR is needed;
- whether structured extraction is required;
- whether human review is required.

## 7.3 Validation Gates

After extracting a fact:

```text
Docling / MinerU
      ↓
Fact extraction
      ↓
Laya decision
      ↓
 ┌──────────────┬──────────────┐
 │              │              │
auto-accept    recheck       human review
```

Validation inputs can include:

- parser confidence;
- schema validity;
- historical range;
- unit consistency;
- adjacent totals;
- arithmetic checks;
- duplicate/conflicting values;
- source reliability.

## 7.4 Human-in-the-Loop Thresholds

Examples:

```text
confidence >= 0.98
→ auto-accept

0.85 <= confidence < 0.98
→ automated cross-check

confidence < 0.85
→ human verification queue
```

Exact thresholds should be tuned on validation data, not hard-coded permanently.

---

# 8. Structured Numerical Query Path

Numerical answers must come from structured data whenever possible.

Example question:

> Give subsidiary-wise coal production between FY2020 and FY2025.

Execution:

```text
User query
   ↓
Laya router
   ↓
SQL route
   ↓
NL-to-query planning
   ↓
query validation / allowlist
   ↓
PostgreSQL
   ↓
result table
   ↓
evidence links
   ↓
LLM explanation
```

Example SQL pattern:

```sql
SELECT
    subsidiary,
    financial_year,
    SUM(production_mt) AS production_mt
FROM production_fact
WHERE financial_year BETWEEN 'FY2020-21' AND 'FY2024-25'
GROUP BY subsidiary, financial_year
ORDER BY financial_year, subsidiary;
```

The LLM should never invent the values; it should explain structured results.

---

# 9. Hybrid RAG Path

Use RAG for narrative/documentary questions.

Candidate base platform:

## RAGFlow
https://github.com/infiniflow/ragflow

Use as the initial platform shell because it already covers much of:

- document ingestion;
- OCR/document parsing;
- chunking;
- embeddings;
- hybrid retrieval;
- reranking;
- citations;
- agent workflows;
- knowledge organization.

Potential SIH strategy:

> **Fork RAGFlow and spend our development time on the CIL domain model, structured facts, validation, query routing, report templates, governance, and traceability.**

This avoids rebuilding commodity RAG infrastructure.

## Hybrid Retrieval

Combine:

- BM25 / keyword retrieval;
- vector embeddings;
- metadata filters;
- page / section hierarchy;
- reranking;
- source permissions;
- date / subsidiary / report-type filtering.

---

# 10. Graph Retrieval

Some questions are relational rather than textual.

Example:

```text
Subsidiary
   ↓ owns
Mine
   ↓ belongs to
Coalfield
   ↓ located in
District
   ↓ geological unit
Formation
```

Possible graph databases:

- Neo4j
- PostgreSQL + AGE
- Memgraph
- other graph stores depending on deployment constraints

Graph retrieval should be used for:

- mine ownership relationships;
- coalfield relationships;
- project dependencies;
- historical entity aliases;
- geology relationships;
- organizational links;
- report-to-entity mapping.

## Alternative / reference projects

### LightRAG
https://github.com/HKUDS/LightRAG

### RAG-Anything
https://github.com/HKUDS/RAG-Anything

Use them as references for multimodal + graph retrieval architecture, or as alternatives if RAGFlow becomes too restrictive.

---

# 11. Visual / Multimodal Retrieval

Some evidence cannot be reliably converted to plain text:

- geological maps;
- cross-sections;
- mine layouts;
- scanned figures;
- charts;
- complex tabular pages;
- poor OCR historical scans.

For those pages:

```text
page image
   ↓
visual embedding / multimodal representation
   ↓
visual retrieval
   ↓
VLM interpretation
   ↓
source page citation
```

Candidate approach:

- ColPali-style visual retrieval / modern multi-vector visual document retrieval;
- VLM only on selected pages, not every document;
- OCR output retained alongside page image.

This should be a fallback/specialized route rather than the default for all data.

---

# 12. Long-Document Retrieval Alternative

For very long annual reports, geological reports, DPRs, and historical archives, test hierarchical retrieval.

Candidate:

## PageIndex
https://github.com/VectifyAI/PageIndex

Concept:

```text
Annual Report
│
├── Production
│   ├── Subsidiary Production
│   └── Mine Production
│
├── Geology
│   ├── Exploration
│   └── Reserves
│
└── Annexures
```

Instead of relying only on flat vector chunks, the system can reason over section hierarchy.

We should benchmark this against conventional chunk-based RAG rather than adopting it blindly.

---

# 13. Automated Report Generation Platform

The report engine must generate reports from **validated structured facts + cited documentary evidence**.

## Report Template Types

Initial examples:

- monthly production report;
- quarterly production report;
- annual production summary;
- subsidiary-wise comparison;
- mine-wise performance report;
- target vs achievement report;
- historical trend report;
- parliamentary question response;
- ministry information request;
- geological summary;
- executive briefing note;
- anomaly/exception report.

## Report Generation Flow

```text
Report request
    ↓
Template selection
    ↓
required-data schema
    ↓
SQL + RAG + Graph retrieval
    ↓
validation rules
    ↓
Evidence Bundle
    ↓
LLM narrative generation
    ↓
Citation insertion
    ↓
structured tables / charts
    ↓
quality checks
    ↓
DOCX / PDF / dashboard output
```

Every generated statement should ideally be associated with either:

- structured fact IDs; or
- document/page evidence.

---

# 14. Automated Word Cloud and Topic Identification Module

Candidate project:

## BERTopic
https://github.com/MaartenGr/BERTopic

Instead of only showing word clouds, the module should support:

- topic clustering;
- topic naming;
- topic frequency;
- topic change over time;
- topic comparison between subsidiaries;
- key phrase extraction;
- hierarchical topics;
- document drill-down;
- word clouds as visualization only.

Example output:

```text
Topic: Mine Safety
1980 ███
1990 █████
2000 ███████
2010 █████████
2020 █████████████
```

This creates useful historical analytics instead of a cosmetic word cloud.

---

# 15. AI-Based Query and Response System

The chat interface should not directly ask one LLM to search everything.

## Query Pipeline

```text
User question
    ↓
Authentication / role permissions
    ↓
Laya query classifier
    ↓
Query planner
    ↓
┌──────────┬────────────┬──────────┬───────────┐
│ SQL      │ Hybrid RAG │ Graph    │ Visual    │
└──────────┴────────────┴──────────┴───────────┘
    ↓
Evidence aggregation
    ↓
conflict detection
    ↓
LLM response generation
    ↓
citations + confidence + source links
```

## Response Requirements

Answers should expose:

- direct answer;
- supporting source(s);
- page/table/cell where possible;
- data period;
- unit;
- confidence / verification state where useful;
- discrepancy warning when sources conflict;
- downloadable report or table where relevant.

---

# 16. Provenance and Traceability

This is mandatory for the domain.

For every extracted numerical value, retain:

```text
Document
   ↓
File hash
   ↓
Page
   ↓
Table
   ↓
Row / column / cell
   ↓
Original extracted text/value
   ↓
Normalized value
   ↓
Unit transformation
   ↓
Parser version
   ↓
Validation status
   ↓
Human reviewer, if any
```

Example:

```text
Value: 13.74 MT
Source: Annual_Report_1987.pdf
Page: 42
Table: 7
Row: 4
Column: Production
OCR Confidence: 0.94
Parser: MinerU
Normalized Unit: million_tonnes
Validation: cross-checked
```

The UI should let authorized users open the exact evidence page.

---

# 17. Data Validation System

Validation must combine deterministic checks and AI-based decisions.

## Deterministic Validation

Examples:

- totals = sum of components;
- percentage calculation checks;
- unit compatibility;
- year / date validity;
- duplicate records;
- null mandatory fields;
- known subsidiary/mine codes;
- impossible negative values;
- configured plausible ranges;
- cross-document consistency;
- schema validation.

## AI-Assisted Validation

Use Laya / specialized classifiers for:

- ambiguous column interpretation;
- table-type classification;
- source relevance;
- extraction confidence;
- conflicting evidence prioritization;
- review escalation.

## Human Review

A review console should show:

- extracted value;
- source crop/page;
- parsed table;
- normalized record;
- reason for flag;
- accept / edit / reject action.

Corrections should become feedback for improving extraction rules and models.

---

# 18. Data Storage Architecture

Suggested storage layers:

## Object Storage

Use for original source files and page images.

Candidate options:

- MinIO
- S3-compatible storage
- government/private object storage

## PostgreSQL

Use for:

- normalized facts;
- metadata;
- users/roles;
- report templates;
- validation status;
- lineage records;
- structured analytics.

## Vector / Hybrid Search

Options:

- RAGFlow's supported storage;
- OpenSearch / Elasticsearch;
- PostgreSQL + pgvector;
- Milvus / Qdrant depending on final stack.

## Graph Store

Use only if graph use cases demonstrate sufficient value.

This prevents unnecessary infrastructure during the first prototype.

---

# 19. Security and Government Deployment Considerations

The architecture should be designed for on-premise or private-cloud deployment.

Key requirements:

- role-based access control;
- subsidiary-level data isolation;
- document access permissions;
- encryption in transit;
- encryption at rest;
- immutable original documents;
- audit logs;
- user-query logs;
- report-generation logs;
- model/version tracking;
- data-retention policy;
- backup and disaster recovery;
- no external model/API dependency for sensitive data unless explicitly approved;
- support for offline/local inference;
- administrator model controls.

The architecture should remain model-agnostic so that approved local models can replace cloud APIs.

---

# 20. Evaluation and Accuracy Measurement

The problem statement specifically asks for measurable percentages.

We must therefore create a benchmark dataset rather than claim unverified accuracy.

## Gold Dataset

Initial benchmark suggestion:

- 500 manually verified structured facts;
- 100 tables;
- 100 parliamentary-style questions;
- 100 narrative/document questions;
- 50 difficult scanned historical pages;
- 25 maps/charts/figures if multimodal retrieval is in scope;
- representative documents from multiple CIL subsidiaries;
- historical and recent documents.

## Metrics

### Digitization

- OCR Character Error Rate (CER)
- OCR Word Error Rate (WER)
- page success rate

### Tables

- table detection accuracy
- cell extraction accuracy
- header identification accuracy
- row/column alignment accuracy

### Structured Facts

- precision
- recall
- F1 score
- exact numerical match
- unit normalization accuracy

### Retrieval

- Recall@K
- Precision@K
- Mean Reciprocal Rank where useful
- reranking accuracy
- source-page hit rate

### Generated Answers

- factual correctness
- citation correctness
- citation completeness
- numerical correctness
- answer completeness
- unsupported-claim rate

### Reports

- field accuracy
- template completion percentage
- human correction rate
- report generation time

### Automation

```text
Automation % =
(number of workflow steps completed without human intervention)
/
(total repetitive workflow steps)
× 100
```

### Time Reduction

```text
Time reduction % =
(manual baseline time - assisted workflow time)
/
manual baseline time
× 100
```

## RAG Evaluation Candidate

Ragas:
https://github.com/vibrantlabsai/ragas

Use Ragas for retrieval/generation evaluation where appropriate, but keep numerical verification deterministic.

---

# 21. Candidate Technology Stack

## Platform Base

- RAGFlow

## Document Parsing

- Docling
- MinerU

## Decision Models

- Laya

## Structured Database

- PostgreSQL

## Vector / Hybrid Retrieval

- RAGFlow-native stack initially
- evaluate pgvector/OpenSearch/Qdrant if required

## Graph Retrieval

- LightRAG / RAG-Anything concepts
- Neo4j or PostgreSQL AGE if dedicated graph DB is required

## Long Document Retrieval

- PageIndex as benchmark / optional path

## Topic Modelling

- BERTopic

## Evaluation

- Ragas
- deterministic Python/SQL test harness

## Backend

- Python
- FastAPI

## Frontend

- React / Next.js

## Data Processing

- Python
- Pandas / Polars
- Pydantic

## Background Jobs

- Celery / Redis or equivalent queue

## Deployment

- Docker
- Docker Compose for prototype
- Kubernetes only if scale/operations justify it later

---

# 22. Repository Reuse Strategy

The project should be developed by combining proven open-source components rather than rebuilding everything.

## Primary Candidates

### RAGFlow
https://github.com/infiniflow/ragflow

Role:
- application shell;
- ingestion infrastructure;
- RAG infrastructure;
- citation/retrieval foundations;
- workflows.

### Docling
https://github.com/docling-project/docling

Role:
- normalized document extraction;
- layout/table-aware parsing;
- CUES source representation.

### MinerU
https://github.com/opendatalab/MinerU

Role:
- difficult PDFs;
- OCR-heavy historical documents;
- complex tables/layouts.

### LightRAG
https://github.com/HKUDS/LightRAG

Role:
- graph retrieval research/reference;
- alternative retrieval architecture.

### RAG-Anything
https://github.com/HKUDS/RAG-Anything

Role:
- multimodal + knowledge graph reference architecture.

### Pathway LLM App
https://github.com/pathwaycom/llm-app

Role:
- reference architecture for live ingestion;
- unstructured-to-SQL patterns;
- structured data extraction workflows.

### PageIndex
https://github.com/VectifyAI/PageIndex

Role:
- long-document hierarchical retrieval benchmark.

### BERTopic
https://github.com/MaartenGr/BERTopic

Role:
- topic modelling;
- trend extraction;
- word-cloud inputs.

### Ragas
https://github.com/vibrantlabsai/ragas

Role:
- retrieval/response evaluation.

---

# 23. Implementation Phases

## Phase 0 — Requirement Analysis

### Tasks

- collect representative CMPDI/CIL documents;
- identify subsidiaries and user roles;
- enumerate top 20 recurring report types;
- enumerate top 100 recurring questions;
- list important metrics and units;
- identify historical archives;
- identify security/deployment constraints;
- document current manual workflow time;
- define accuracy expectations;
- define acceptance criteria.

### Output

- requirements document;
- canonical domain vocabulary;
- benchmark dataset specification;
- deployment constraints;
- initial CUES schema.

---

## Phase 1 — Data Ingestion Prototype

### Tasks

- support PDF, image, XLSX, CSV, DOCX;
- implement file hashing;
- original-file storage;
- integrate Docling;
- integrate MinerU fallback;
- generate normalized CUES JSON;
- preserve page and table provenance;
- create ingestion dashboard.

### Success Criteria

- selected document formats ingest automatically;
- extracted blocks and tables retain page-level traceability;
- parsing failures are visible and retryable.

---

## Phase 2 — Structured Fact Extraction

### Tasks

- define production schema;
- define mine/subsidiary master data;
- extract structured records from XLSX/CSV;
- extract selected table types from reports;
- normalize units;
- implement duplicate detection;
- implement arithmetic validation;
- store authoritative facts in PostgreSQL;
- build review queue.

### Success Criteria

- first set of production metrics can be queried directly from SQL;
- every value links back to source evidence.

---

## Phase 3 — Retrieval and Q&A

### Tasks

- deploy/fork RAGFlow;
- build hybrid index;
- create metadata filtering;
- integrate Laya query routing;
- implement SQL route;
- implement RAG route;
- implement combined SQL + RAG route;
- return citations.

### Success Criteria

- numerical questions use database facts;
- narrative questions use cited evidence;
- mixed questions combine both.

---

## Phase 4 — Automated Reporting

### Tasks

- build report-template engine;
- define required fields per report;
- query SQL automatically;
- retrieve supporting evidence;
- generate narrative sections;
- attach citations;
- add charts and tables;
- export DOCX/PDF;
- support approval workflow.

### Success Criteria

- at least 3 high-frequency reports produced automatically;
- measurable reduction in preparation time;
- all numbers are source-linked.

---

## Phase 5 — Topic / Trend Analytics

### Tasks

- BERTopic integration;
- keyphrase extraction;
- topic naming;
- topic-over-time view;
- subsidiary comparison;
- word cloud;
- source-document drill-down.

### Success Criteria

- system surfaces interpretable historical themes;
- users can trace a topic back to documents.

---

## Phase 6 — Graph and Multimodal Enhancements

Only after core flows work.

### Tasks

- entity relationship extraction;
- graph store prototype;
- graph question routing;
- visual retrieval prototype;
- geological map/figure experiments;
- PageIndex long-document benchmark.

### Success Criteria

- these components must demonstrate measurable improvement over simpler retrieval before becoming mandatory production dependencies.

---

## Phase 7 — Evaluation and Hardening

### Tasks

- create gold-standard benchmark;
- measure extraction precision/recall;
- measure numerical exact match;
- measure citation correctness;
- measure report field accuracy;
- adversarial test questions;
- conflict tests;
- access-control tests;
- latency tests;
- large-file tests;
- disaster-recovery test;
- model fallback test.

### Output

A measurable evaluation report containing:

- accuracy %;
- automation %;
- time reduction %;
- failure categories;
- improvement actions.

---

## Phase 8 — CMPDI/CIL Workflow Integration

### Tasks

- SSO / authentication integration;
- role mapping;
- document repositories;
- existing databases;
- report approval process;
- audit/compliance workflow;
- export formats;
- ministry/parliamentary workflow alignment.

---

## Phase 9 — Training and Continuous Enhancement

### Tasks

- user onboarding;
- administrator training;
- reviewer training;
- standard operating procedures;
- feedback capture;
- extraction-rule updates;
- benchmark expansion;
- model evaluation before upgrades;
- periodic quality audits.

---

# 24. MVP Scope for SIH

We should not attempt the entire production system during the hackathon.

The SIH MVP should demonstrate the complete lifecycle on a smaller dataset.

## MVP Features

1. Upload scanned PDF / digital PDF / XLSX.
2. Automatic file classification.
3. Docling/MinerU parsing.
4. CUES normalized evidence JSON.
5. Production fact extraction.
6. PostgreSQL fact store.
7. Hybrid document retrieval.
8. Laya route selection.
9. SQL answers for numerical questions.
10. RAG answers for documentary questions.
11. Combined SQL + RAG answer.
12. Page/source citations.
13. One-click report generation.
14. Topic analysis / word cloud.
15. Validation dashboard.
16. Accuracy/time/automation metrics dashboard.

## Demo Dataset

Use a deliberately mixed set:

- historical scanned report;
- searchable annual report;
- Excel production sheet;
- image/table-heavy page;
- 20–50 representative documents.

---

# 25. Suggested SIH Demo Story

A strong demo sequence:

## Demo 1 — Historical Digitization

Upload an old scanned report.

Show:

```text
PDF
→ OCR/layout detection
→ table extraction
→ normalized facts
→ source coordinates
```

## Demo 2 — Structured Query

Ask:

> "Show subsidiary-wise coal production for the selected years."

Show that the system uses SQL and returns exact figures.

## Demo 3 — Analytical Question

Ask:

> "Why did production decline during this period?"

Show SQL trends + supporting documentary evidence.

## Demo 4 — Traceability

Click one number.

Open:

```text
Source PDF
→ page
→ table
→ original cell
```

## Demo 5 — Parliamentary Response

Paste a parliamentary-style question.

Generate:

- short answer;
- supporting table;
- cited evidence;
- downloadable report.

## Demo 6 — Historical Topic Analysis

Show:

- discovered topics;
- timeline;
- word cloud;
- document drill-down.

## Demo 7 — Metrics

Show actual benchmark results:

- extraction accuracy;
- answer accuracy;
- automation percentage;
- report preparation time reduction.

This final metric screen directly addresses the SIH judging criteria.

---

# 26. What We Should Not Build From Scratch

Avoid spending SIH development time on:

- generic PDF parsing;
- generic OCR engines;
- generic embedding models;
- vector database implementation;
- generic chatbot UI infrastructure;
- generic RAG plumbing;
- general-purpose topic-modelling algorithms;
- standard file-storage infrastructure.

Reuse open-source projects and focus originality on:

- CIL Unified Evidence Schema;
- coal/mining domain model;
- fact extraction;
- unit normalization;
- validation;
- provenance;
- Laya-based routing;
- evidence aggregation;
- parliamentary/report workflows;
- measurable evaluation.

---

# 27. Key Differentiators for the SIH Submission

The pitch should emphasize these points:

## 1. Evidence-First AI

Every answer and report can be traced back to source documents and structured facts.

## 2. Not Just RAG

The platform intelligently routes between:

- SQL;
- RAG;
- SQL + RAG;
- graph retrieval;
- visual retrieval.

## 3. Universal Evidence Contract

All document types become one interoperable evidence format.

## 4. Numerical Truth Lives in a Database

Production figures are validated structured records, not values generated from vector search.

## 5. Local-First / Model-Agnostic

Sensitive government data can remain inside approved infrastructure.

## 6. Laya Decision Layer

Small decision models handle classification, routing, validation, and review escalation instead of wasting generative-model calls.

## 7. Human-in-the-Loop

Low-confidence or conflicting values are sent to reviewers rather than silently accepted.

## 8. Measurable Impact

Accuracy, automation, and time reduction are benchmarked quantitatively.

---

# 28. Initial Database Sketch

```text
users
roles
subsidiaries
mines
coalfields
documents
document_versions
pages
blocks
tables
table_cells
facts
fact_sources
fact_validation
entities
entity_aliases
relationships
reports
report_templates
report_runs
questions
answers
citations
review_tasks
audit_logs
```

## Example `facts` table

```text
id
entity_id
metric_code
value_numeric
value_text
unit_code
period_start
period_end
financial_year
source_id
confidence
validation_status
created_at
updated_at
```

---

# 29. Suggested API Boundaries

```text
POST /ingest
GET  /documents/{id}
GET  /documents/{id}/evidence
POST /extract/facts
POST /validate/facts
POST /query
POST /query/sql
POST /query/rag
POST /reports/generate
GET  /reports/{id}
POST /topics/analyze
GET  /audit/{id}
GET  /metrics/evaluation
```

Keep components modular so parser, model, database, or retrieval engine can be changed later.

---

# 30. Failure Handling

The system must explicitly handle:

- unreadable scans;
- incomplete tables;
- OCR uncertainty;
- duplicate documents;
- conflicting documents;
- unit ambiguity;
- historical name changes;
- table continuation across pages;
- missing years;
- inconsistent financial-year notation;
- malformed spreadsheets;
- model timeout;
- retrieval with insufficient evidence;
- unsupported questions.

The correct behavior when evidence is insufficient is:

> "Insufficient verified evidence available."

not fabrication.

---

# 31. Immediate Development Order

The recommended engineering order is:

```text
1. Collect sample documents
        ↓
2. Define domain schema + CUES
        ↓
3. Build ingestion adapters
        ↓
4. Preserve provenance
        ↓
5. Extract structured facts
        ↓
6. Store facts in PostgreSQL
        ↓
7. Deploy hybrid document retrieval
        ↓
8. Add Laya routing/validation
        ↓
9. Build unified query API
        ↓
10. Add report generation
        ↓
11. Add topic analysis
        ↓
12. Build benchmark + metrics
        ↓
13. Add graph/visual features only where justified
```

This order minimizes risk and produces a usable platform at every phase.

---

# 32. First Sprint Checklist

## Data

- [ ] Collect 20–50 representative files.
- [ ] Include scanned PDFs.
- [ ] Include digital PDFs.
- [ ] Include XLSX/CSV production data.
- [ ] Include at least one complex table.
- [ ] Include at least one map/image-heavy document.

## Domain Model

- [ ] Create subsidiary master table.
- [ ] Create mine master table.
- [ ] Define 10–20 core metrics.
- [ ] Define canonical units.
- [ ] Define financial-year representation.

## Ingestion

- [ ] Integrate Docling.
- [ ] Evaluate MinerU on difficult scans.
- [ ] Implement file hashing.
- [ ] Store original files.
- [ ] Produce CUES JSON.

## Structured Data

- [ ] Design PostgreSQL schema.
- [ ] Implement XLSX ingestion.
- [ ] Implement first table extractor.
- [ ] Store source lineage.

## Retrieval

- [ ] Run RAGFlow locally.
- [ ] Index normalized evidence.
- [ ] Test hybrid retrieval.
- [ ] Return page citations.

## Laya

- [ ] Run model locally.
- [ ] Define query-route choices.
- [ ] Evaluate router on 100 sample questions.
- [ ] Define validation decisions.

## UI

- [ ] File upload.
- [ ] ingestion status.
- [ ] chat/query screen.
- [ ] source viewer.
- [ ] validation queue.
- [ ] report-generation screen.

## Evaluation

- [ ] Create initial gold dataset.
- [ ] Track exact numerical match.
- [ ] Track retrieval hit rate.
- [ ] Track citation correctness.
- [ ] Measure report-generation time.

---

# 33. Final Architecture Statement

The proposed SIH solution is **not a chatbot placed on top of PDFs**.

It is a **multimodal evidence and decision platform** that:

1. ingests heterogeneous historical and modern CMPDI/CIL data;
2. converts it into a universal evidence schema;
3. separates documentary evidence from authoritative structured facts;
4. validates and normalizes production/geological information;
5. uses Laya to route, classify, and validate decisions;
6. chooses SQL, hybrid RAG, graph, or visual retrieval according to the question;
7. uses generative models only for reasoning and language generation;
8. produces cited parliamentary responses and automated reports;
9. provides topic and historical-trend analytics;
10. preserves complete provenance and auditability;
11. measures accuracy, automation, and time savings quantitatively;
12. remains local-first, scalable, and model-agnostic for future CMPDI/CIL deployment.

The development philosophy should be:

> **Reuse mature open-source infrastructure for generic AI/document-processing tasks, and focus our original engineering effort on CIL-specific data standardization, validation, evidence traceability, domain intelligence, and operational workflows.**

