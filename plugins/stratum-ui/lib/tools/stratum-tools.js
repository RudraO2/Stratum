/**
 * Stratum's four tools: the harness-visible face of the Python backend.
 *
 *   stratum_ask       question → SQL over verified facts, document search, or both
 *   stratum_pq_reply  a parliamentary question → a drafted reply (.docx) with annexures and warnings
 *   stratum_report    a report request → one of the templates (.docx)
 *   stratum_topics    topics, trends and the word cloud over the library
 *
 * The local model never calls these by itself (`local-provider.js` sends no tool
 * definitions, for the reasons recorded there). The lanes in `lanes/stratum.js` decide
 * from the router's task type and emit the call; the harness then dispatches it for
 * real through `tools/pre-execute` — so the egress seal still sees every call — and
 * `execute` below does one loopback fetch.
 *
 * Two projections of one result:
 *  - `render` — the model-facing text. Compact and readable: the answer, then a
 *    "Sources" block. The lane streams the answer part of it as the assistant's reply.
 *  - `presentationMeta` — the whole JSON result, persisted with the session log, which
 *    the keyed toolviews in `client.js` turn into cards (tables, citation chips, notes).
 *
 * A backend failure is returned as a value, not thrown: a thrown error becomes a generic
 * red tool row, where a value renders as a sentence the operator can act on.
 *
 * Written structurally against the harness's `ToolDefinition`, like every tool in this
 * package, because a `link:`-mounted plugin cannot resolve the harness's own packages.
 */

import { createHash } from "node:crypto";
import { backendJson } from "../backend/client.js";
import { recordTool } from "../trace/turn.js";

export const ASK_TOOL_NAME = "stratum_ask";
export const PQ_TOOL_NAME = "stratum_pq_reply";
export const REPORT_TOOL_NAME = "stratum_report";
export const TOPICS_TOOL_NAME = "stratum_topics";

export const STRATUM_TOOL_NAMES = [ASK_TOOL_NAME, PQ_TOOL_NAME, REPORT_TOOL_NAME, TOPICS_TOOL_NAME];

/** Separates the answer from the sources in a tool result's text; the lane streams what is above it. */
export const SOURCES_MARKER = "\n\n---\nSources:";

/** The shape every result is validated against: loose by design, the backend owns the contract. */
const RESULT_SCHEMA = { type: "object", additionalProperties: true, properties: { status: { type: "string" } } };

const short = (text, n = 70) => {
	const flat = String(text ?? "").replace(/\s+/g, " ").trim();
	return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

const digest = (text) => createHash("sha1").update(String(text ?? "")).digest("hex").slice(0, 8);

/** The deliverable's file name, a pure function of the arguments so `presentCall` and `execute` agree. */
export function pqFilename(args) {
	return `PQ-reply-${digest(args?.text)}.docx`;
}

export function reportFilename(args) {
	return `Report-${digest(`${args?.template ?? ""}|${args?.request ?? ""}|${JSON.stringify(args?.params ?? {})}`)}.docx`;
}

/** Workspace-relative path the deliverables row opens (the backend writes into the repo's `deliverables/`). */
const deliverablePath = (name) => `deliverables/${name}`;

function requireString(args, key) {
	if (typeof args?.[key] !== "string" || args[key].trim() === "") throw new Error(`invalid ${key}: expected a non-empty string`);
}

/** The "Sources" block: one line per citation, enough for the model (and a reader of the log) to follow. */
function sourcesBlock(citations) {
	if (!Array.isArray(citations) || citations.length === 0) return "";
	const lines = citations.slice(0, 12).map((c) => {
		const where = c.page_no ? ` p.${c.page_no}` : "";
		return `[${c.n}] ${short(c.filename, 80)}${where} — ${short(c.snippet, 110)}`;
	});
	return `${SOURCES_MARKER}\n${lines.join("\n")}`;
}

/** An answer with notes for anything a careful officer would want to know before relying on it. */
function askText(value) {
	if (value?.status === "error") return value.answer;
	const parts = [String(value?.answer ?? "").trim() || "Insufficient verified evidence available."];
	for (const d of value?.discrepancies ?? []) {
		parts.push(`Note: ${d.entity} ${d.period} — ${d.other_source}${d.pq ? ` (${d.pq})` : ""} states ${d.other}, against ${d.reported} used here (${d.note}).`);
	}
	if (value?.guard && value.guard.ok === false) parts.push(`Warning: figures not found in the evidence: ${value.guard.unsupported.join(", ")}.`);
	return parts.join("\n\n") + sourcesBlock(value?.citations);
}

function pqText(value) {
	if (value?.status === "error") return value.answer;
	const h = value.header ?? {};
	const lines = [`Draft reply prepared for ${[h.pq_house, h.pq_number].filter(Boolean).join(" ")}${h.pq_date ? ` (${h.pq_date})` : ""}${h.pq_subject ? ` — ${h.pq_subject}` : ""}.`];
	for (const part of value.parts ?? []) lines.push(`(${part.label}) ${String(part.answer ?? "").replace(/\s*\[\d+\]/g, "").trim()}`);
	if ((value.warnings ?? []).length > 0) {
		lines.push(`Review before sending — ${value.warnings.length} note${value.warnings.length === 1 ? "" : "s"}:`);
		for (const w of value.warnings) lines.push(`• ${w.message}`);
	}
	if (value.docx_path) lines.push(`Draft saved as ${deliverablePath(String(value.docx_path).split(/[\\/]/).at(-1))}.`);
	return lines.join("\n\n") + sourcesBlock(value.citations);
}

function reportText(value) {
	if (value?.status === "error") return value.answer;
	const lines = [`Report "${value.title}" generated from verified facts.`];
	for (const s of value.sections ?? []) {
		if (s.type === "narrative" && s.text) lines.push(s.text.replace(/\s*\[\d+\]/g, ""));
	}
	const g = value.guard ?? {};
	lines.push(`Number guard: ${g.checked ?? 0} figures checked, ${g.unsupported ?? 0} unsupported.`);
	if (value.docx_path) lines.push(`Report saved as ${deliverablePath(String(value.docx_path).split(/[\\/]/).at(-1))}.`);
	return lines.join("\n\n") + sourcesBlock(value.citations);
}

function topicsText(value) {
	if (value?.status === "error") return value.answer;
	if (value?.status !== "ok") return value?.message ?? "Topics have not been built yet.";
	const lines = [`${value.topics.length} topics found across ${value.chunks} passages from ${value.documents} documents:`];
	for (const t of value.topics.slice(0, 8)) lines.push(`• ${t.label} — ${t.count} passages (${t.keywords.slice(0, 4).join(", ")})`);
	return lines.join("\n");
}

/** A backend failure as a result the toolview and the lane can both show. */
function failure(error) {
	return { status: "error", answer: `Stratum could not complete this: ${error instanceof Error ? error.message : String(error)}`, error: String(error?.message ?? error) };
}

/** Wrap a backend call so a failure becomes a value. */
async function run(name, call, outcome) {
	const started = Date.now();
	try {
		const value = await call();
		recordTool(name, { outcome: outcome(value), seconds: (Date.now() - started) / 1000 });
		return value;
	} catch (error) {
		recordTool(name, { outcome: "failed", seconds: (Date.now() - started) / 1000 });
		return failure(error);
	}
}

/**
 * Build the four tool definitions.
 * @param {{ backend?: typeof backendJson }} [options] - injected in tests.
 */
export function createStratumTools({ backend = backendJson } = {}) {
	return [
		{
			name: ASK_TOOL_NAME,
			description:
				"Answer a question about the ingested Coal India / Ministry of Coal documents. Figures come from verified facts " +
				"(SQL over extracted tables, each with a citation to its source cell); explanations come from document search. " +
				"Reply 'Insufficient verified evidence available.' when the library cannot answer.",
			parameters: {
				type: "object",
				properties: { question: { type: "string", description: "The question, in English or Hindi." } },
				required: ["question"],
				additionalProperties: false,
			},
			output: {
				schema: RESULT_SCHEMA,
				render: (_args, value) => [{ type: "text", text: askText(value) }],
				presentationMeta: (_args, value) => value,
			},
			async execute(args) {
				requireString(args, "question");
				return run(ASK_TOOL_NAME, () => backend("/v1/ask", { method: "POST", body: { question: args.question } }), (v) => `${v.route ?? "?"} → ${v.status ?? "?"}`);
			},
			presentCall(args) {
				return { card: "generic", title: `Ask the library — ${short(args?.question)}`, kind: "search" };
			},
		},
		{
			name: PQ_TOOL_NAME,
			description:
				"Draft the reply to a Lok Sabha / Rajya Sabha question: splits parts (a)(b)(c), answers each from verified facts, builds annexure tables, " +
				"finds similar past replies, warns where a figure differs from what was told to Parliament before, and writes the reply as a .docx.",
			parameters: {
				type: "object",
				properties: { text: { type: "string", description: "The full text of the parliamentary question." } },
				required: ["text"],
				additionalProperties: false,
			},
			output: {
				schema: RESULT_SCHEMA,
				render: (_args, value) => [{ type: "text", text: pqText(value) }],
				presentationMeta: (_args, value) => value,
			},
			async execute(args) {
				requireString(args, "text");
				return run(PQ_TOOL_NAME, () => backend("/v1/pq", { method: "POST", body: { text: args.text, filename: pqFilename(args) } }), (v) => `${(v.parts ?? []).length} parts, ${(v.warnings ?? []).length} warnings`);
			},
			/** The deliverables row reads `kind: "edit"` and `locations[].path` — the same shape the harness's own editor tools use. */
			presentCall(args) {
				return { card: "generic", title: "Draft parliamentary reply", kind: "edit", locations: [{ path: deliverablePath(pqFilename(args)) }] };
			},
		},
		{
			name: REPORT_TOOL_NAME,
			description:
				"Generate a report as a .docx from verified facts: subsidiary-wise annual production, target vs achievement, or a multi-year trend. " +
				"Pass `template` when known, otherwise describe the report in `request`.",
			parameters: {
				type: "object",
				properties: {
					template: { type: "string", description: "Template id: subsidiary_annual_production, target_vs_achievement or multi_year_trend." },
					request: { type: "string", description: "The operator's own words, used to pick a template and its parameters." },
					params: { type: "object", description: "Optional template parameters such as period, entity, metric, years." },
				},
				additionalProperties: false,
			},
			output: {
				schema: RESULT_SCHEMA,
				render: (_args, value) => [{ type: "text", text: reportText(value) }],
				presentationMeta: (_args, value) => value,
			},
			async execute(args) {
				const body = { template: args?.template, request: args?.request, params: args?.params, filename: reportFilename(args) };
				return run(REPORT_TOOL_NAME, () => backend("/v1/reports", { method: "POST", body }), (v) => `${v.template} · guard ${v.guard?.ok ? "ok" : "flagged"}`);
			},
			presentCall(args) {
				return { card: "generic", title: "Generate report", kind: "edit", locations: [{ path: deliverablePath(reportFilename(args)) }] };
			},
		},
		{
			name: TOPICS_TOOL_NAME,
			description: "Show the topics discovered across the library (BERTopic over document passages), with counts per year and subsidiary. Set `rebuild` to recompute them first.",
			parameters: {
				type: "object",
				properties: { rebuild: { type: "boolean", description: "Recompute the topics from the current library before answering." } },
				additionalProperties: false,
			},
			output: {
				schema: RESULT_SCHEMA,
				render: (_args, value) => [{ type: "text", text: topicsText(value) }],
				presentationMeta: (_args, value) => value,
			},
			async execute(args) {
				const call = () => (args?.rebuild ? backend("/v1/topics/rebuild", { method: "POST", body: {} }) : backend("/v1/topics"));
				const value = await run(TOPICS_TOOL_NAME, call, (v) => `${(v.topics ?? []).length} topics`);
				// Nothing built yet is the common first call: build once rather than answer "not built".
				if (value?.status === "not_built" && !args?.rebuild) {
					return run(TOPICS_TOOL_NAME, () => backend("/v1/topics/rebuild", { method: "POST", body: {} }), (v) => `${(v.topics ?? []).length} topics`);
				}
				return value;
			},
			presentCall(args) {
				return { card: "generic", title: args?.rebuild ? "Rebuild library topics" : "Library topics", kind: "search" };
			},
		},
	];
}

export { askText, pqText, reportText, topicsText };
