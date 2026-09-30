/**
 * The Stratum lanes: how a question becomes a backend call on the `local` provider.
 *
 * ## Why lanes exist
 *
 * `local-provider.js` sends no tool definitions, so a 4B model can never call a tool
 * itself — measured and recorded there: it wraps the call in prose the server does not
 * parse. So the lane does what the model cannot do reliably: the router's task type
 * picks the tool, **our code** builds the call, and the harness dispatches the real
 * registered tool through the ordinary waterfall (egress seal included).
 *
 * ## Two steps, no model call in either
 *
 * **Step one** (the turn's last message is the operator's): emit a synthetic
 * `tool-call`. The operator's own words are the arguments — no model rewrites the
 * question, so there is no paraphrase to drift from what was asked.
 *
 * **Step two** (the last message is the tool's result): stream the answer text that the
 * tool rendered. It was composed by the backend and has already passed the number guard;
 * a model re-reading it would only add a chance to introduce a figure that is not there.
 * The evidence — table, citation chips, discrepancy notes — is on the card above it.
 *
 * `chat` and `vision` are plain model turns and never reach a lane.
 *
 * Re-entry: the harness runs step two as a fresh model call whose last message is the
 * tool result, so "has the tool reported" is read from the message list, not remembered.
 */

import { lastGenuineUserMessage } from "../model-plane/injected.js";
import { ASK_TOOL_NAME, PQ_TOOL_NAME, REPORT_TOOL_NAME, SOURCES_MARKER, TOPICS_TOOL_NAME } from "../tools/stratum-tools.js";

/** Task type → the tool its lane calls. */
export const LANE_TOOLS = {
	ask: ASK_TOOL_NAME,
	pq_reply: PQ_TOOL_NAME,
	report: REPORT_TOOL_NAME,
	topics: TOPICS_TOOL_NAME,
};

/** Whether a task type is served by a lane (otherwise it is a plain model turn). */
export function servesTaskType(taskType) {
	return typeof taskType === "string" && Object.hasOwn(LANE_TOOLS, taskType);
}

/** The plain text of a message, whichever content shape it arrived in. */
export function textOf(message) {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

/** The operator's own words for this turn. */
export function userText(messages) {
	return textOf(lastGenuineUserMessage(messages)).trim();
}

const REBUILD = /\b(rebuild|refresh|recompute|re-?run|re-?generate|update)\b/i;

/**
 * The tool call a lane makes for this request.
 * @param {string} taskType - one of {@link LANE_TOOLS}' keys.
 * @param {string} text - the operator's words.
 * @returns {{ name: string, args: object }}
 */
export function laneCall(taskType, text) {
	const name = LANE_TOOLS[taskType];
	switch (taskType) {
		case "pq_reply":
			return { name, args: { text } };
		case "report":
			return { name, args: { request: text } };
		case "topics":
			return { name, args: { rebuild: REBUILD.test(text) } };
		default:
			return { name, args: { question: text } };
	}
}

/** Has a tool already reported back on this step? True when the last message is a tool result. */
export function toolHasReported(messages) {
	const last = Array.isArray(messages) ? messages.at(-1) : undefined;
	if (last?.role !== "user" || last?.source?.kind !== "tool") return false;
	return Array.isArray(last.content) && last.content.some((block) => block?.type === "tool-result");
}

/** The text of the tool result in the last message. */
export function toolResultText(messages) {
	const last = Array.isArray(messages) ? messages.at(-1) : undefined;
	if (!Array.isArray(last?.content)) return "";
	const parts = [];
	for (const block of last.content) {
		if (block?.type !== "tool-result") continue;
		if (typeof block.content === "string") parts.push(block.content);
		else if (Array.isArray(block.content)) {
			for (const inner of block.content) if (inner?.type === "text" && typeof inner.text === "string") parts.push(inner.text);
		}
	}
	return parts.join("\n");
}

/** What the assistant says: the tool's text above its sources block. */
export function answerFrom(resultText) {
	const cut = String(resultText ?? "").indexOf(SOURCES_MARKER);
	return (cut === -1 ? String(resultText ?? "") : resultText.slice(0, cut)).trim();
}

/** Split text into small `text` pieces so the answer streams into the transcript instead of landing whole. */
export function* pieces(text, size = 28) {
	for (let i = 0; i < text.length; i += size) yield { type: "text", text: text.slice(i, i + size) };
}
