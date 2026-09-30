/**
 * Stratum's request classifier: keyword rules, no model call.
 *
 * Forked from Faraday's classifier (same return shape, so the routing chip and
 * the session events read it unchanged); the rules are Stratum's own. The task
 * type decides which lane runs:
 *
 *   pq_reply — a parliamentary / ministry question → PQ Reply Builder
 *   report   — "generate/prepare a report …"       → report templates
 *   topics   — topics, trends, word cloud           → topic module
 *   ask      — any question about the library      → SQL / RAG / mixed (the backend picks)
 *   vision   — an image is attached                 → the vision member answers directly
 *   chat     — greetings, small talk                → a plain turn
 *
 * Deterministic on purpose: the same words always take the same route, and the
 * chip can show exactly which rules fired. The backend's own router then picks
 * SQL vs RAG vs both inside `ask`, with a schema-constrained model call.
 */

import { lastGenuineUserMessage } from "../model-plane/injected.js";

export const TASK_TYPES = ["ask", "pq_reply", "report", "topics", "vision", "chat"];

/** Tie-break order: the more specific workflow wins. */
export const TASK_TYPE_PRIORITY = ["pq_reply", "report", "topics", "ask", "vision", "chat"];

export const FALLBACK_TASK_TYPE = "ask";
export const IMAGE_FALLBACK_TASK_TYPE = "vision";
export const IMAGE_TASK_TYPES = ["vision"];

const RULES = {
	pq_reply: [
		["lok-sabha", /\blok\s+sabha\b/],
		["rajya-sabha", /\brajya\s+sabha\b/],
		["starred", /\b(un)?starred\s+question\b/],
		["pleased-to-state", /\bpleased\s+to\s+state\b/],
		["minister-of-coal", /\bminister\s+of\s+coal\b/],
		["parts-a-b", /\(a\)[\s\S]{0,400}\(b\)/],
		["pq-noun", /\b(parliament(ary)?\s+question|pq\s+reply|reply\s+to\s+(the\s+)?(pq|parliament))\b/],
	],
	report: [
		["generate-report", /\b(generate|prepare|create|make|draft|produce|build)\b[\s\S]{0,60}\b(report|briefing|brief|summary\s+note)\b/],
		["report-template", /\b(target\s+vs\.?\s+achievement|subsidiary-?wise\s+(annual\s+)?production\s+report|trend\s+report)\b/],
		["docx", /\b(docx|word\s+document)\b/],
	],
	topics: [
		["topics", /\b(topics?|themes?)\b/],
		["word-cloud", /\bword\s*-?cloud\b/],
		["trending", /\b(trending|most\s+discussed|frequently\s+asked|recurring\s+issues?)\b/],
	],
	ask: [
		["question-word", /\b(what|which|how\s+much|how\s+many|why|when|where|who|list|show|compare|give|tell)\b/],
		["question-mark", /\?\s*$/],
		["production", /\b(production|produced|output|dispatch|offtake|despatch|overburden|obr|capacity|target|achievement)\b/],
		["coal-entity", /\b(cil|coal\s+india|cmpdi|secl|mcl|ncl|ccl|bccl|ecl|wcl|nec|sccl|singareni|mine|coalfield|colliery|block)\b/],
		["geology", /\b(reserves?|resources?|seam|borehole|exploration|drilling|geolog\w*|grade|gcv|stripping\s+ratio)\b/],
		["period", /\b(fy\s?\d{2,4}|20\d{2}\s*-\s*\d{2,4}|\d{4}-\d{2}|financial\s+year|quarter|month)\b/],
		["hindi", /[ऀ-ॿ]{3,}/],
	],
	vision: [],
	chat: [
		["greeting", /^\s*(hi|hello|hey|namaste|good\s+(morning|afternoon|evening)|thanks?|thank\s+you)\b[\s!.]*$/],
		["about-you", /\b(who\s+are\s+you|what\s+can\s+you\s+do|help\s+me\s+get\s+started)\b/],
	],
};

/**
 * Classify one request.
 * @param {string} text - the operator's own words for this turn.
 * @param {{ hasImage?: boolean }} [options]
 */
export function classifyRequest(text, options = {}) {
	const haystack = (typeof text === "string" ? text : "").toLowerCase();
	const hasImage = options?.hasImage === true;
	const scores = {};
	const matchedRules = {};
	let matchedRuleCount = 0;
	for (const taskType of TASK_TYPES) {
		const hits = [];
		for (const [name, test] of RULES[taskType]) {
			if (test.test(haystack)) hits.push(name);
		}
		scores[taskType] = hits.length;
		matchedRules[taskType] = hits;
		matchedRuleCount += hits.length;
	}

	if (hasImage) {
		return { taskType: IMAGE_FALLBACK_TASK_TYPE, scores, matchedRules, matchedRuleCount, fallback: false, tied: false, hasImage };
	}
	// A greeting is chat even though "hi, what can you do?" also hits a question word.
	if (scores.chat > 0 && scores.pq_reply === 0 && scores.report === 0 && scores.ask <= 2) {
		return { taskType: "chat", scores, matchedRules, matchedRuleCount, fallback: false, tied: false, hasImage };
	}
	const eligible = TASK_TYPES.filter((type) => type !== "vision" && type !== "chat");
	const eligibleHits = eligible.reduce((total, type) => total + scores[type], 0);
	if (eligibleHits === 0) {
		const taskType = haystack.trim().length < 12 ? "chat" : FALLBACK_TASK_TYPE;
		return { taskType, scores, matchedRules, matchedRuleCount, fallback: true, tied: false, hasImage };
	}
	// Workflow types need only one strong signal to beat `ask`, whose rules are broad by design.
	for (const type of ["pq_reply", "report", "topics"]) {
		if (scores[type] >= (type === "pq_reply" ? 1 : 1)) {
			const leaders = TASK_TYPE_PRIORITY.filter((candidate) => ["pq_reply", "report", "topics"].includes(candidate) && scores[candidate] > 0);
			return { taskType: leaders[0], scores, matchedRules, matchedRuleCount, fallback: false, tied: leaders.length > 1, hasImage };
		}
	}
	return { taskType: "ask", scores, matchedRules, matchedRuleCount, fallback: false, tied: false, hasImage };
}

/** The last genuine user message's plain text. */
export function lastUserText(messages) {
	const message = lastGenuineUserMessage(messages);
	if (!message) return "";
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter((block) => block && block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}
