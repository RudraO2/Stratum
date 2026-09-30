/**
 * Bridges our own `ModelProvider` contract (model-provider.js) onto the
 * harness's `ctx.llm.registerAdapter(providers, adapter)` seam.
 *
 * Deliberately does NOT import `@deepseek-ai/dsh-llm` to get its `LlmAdapter`
 * base class. Two things were verified directly against the installed
 * harness (0.1.1-rc.2) on 28 August 2026, the day-one timebox for this seam:
 *
 * 1. `registerAdapter` never does an `instanceof` check — every method it
 *    calls (`providerInfo`, `providerRetryPolicy`, `prepareCall`, `stream`)
 *    is duck-typed, so a plain object implementing them registers exactly
 *    like a real `LlmAdapter` subclass would.
 * 2. This plugin is mounted through a `link:` row in the profile's
 *    `package.json`, i.e. loaded through a symlink. Node resolves bare
 *    specifiers from a symlinked module's REAL on-disk path, which is this
 *    repo — not the profile's `node_modules` the harness's own packages live
 *    in — so `import "@deepseek-ai/dsh-llm"` from here fails with
 *    `ERR_MODULE_NOT_FOUND` even though the harness process has that package
 *    loaded and working.
 *
 * Duck-typing sidesteps both: the contract stays ours (CONTEXT.md "Plugin
 * contract" — "the harness is an implementation of them"), and there is
 * nothing here for the symlink to break.
 */

import { answerFrom, laneCall, pieces as textPieces, servesTaskType, toolHasReported, toolResultText, userText } from "../lanes/stratum.js";
import { STRATUM_SYSTEM_PROMPT } from "./persona.js";
import { announceRefusals, loadFleet } from "../registry/loader.js";
import { imageRefsIn, resolveMessageImages } from "../attachments/images.js";
import { currentTaskType, runtimeModelForCurrentTurn } from "../router/dispatch.js";
import { recordImages } from "../trace/turn.js";

/** Exact model identity this adapter reports; nothing here validates against a catalog (advisory only, per the harness's own contract). */
async function resolveModel(provider, model) {
	return { provider, id: model, name: model };
}

/**
 * The fleet from `registry/models.yaml`, shaped as the harness's model list
 * entries and attributed to `provider`. This is what makes Story 3.3's "a new
 * member added to that file appears in the UI model list" true: the list is
 * read from the registry on every call, never from a second copy here.
 *
 * `licence`, `context`, `modalities` and `capabilities` ride along as advisory
 * fields — the harness duck-types model entries and does not validate them, and
 * the router (Stories 3.5-3.6) reads the same shape. The licence loader (Story
 * 3.4) drops disallowed-licence members before they reach here, so an
 * unrunnable model is never choosable; a registry read failure yields an empty
 * list rather than breaking the picker.
 * @param {string} provider - the provider token this adapter serves under.
 */
function fleetModels(provider) {
	try {
		return loadFleet().loaded.map((member) => ({
			provider,
			id: member.name,
			name: member.name,
			role: member.role,
			licence: member.licence,
			context: member.context,
			modalities: member.modalities,
			capabilities: member.capabilities,
		}));
	} catch (error) {
		console.warn(`@stratum/dsh-client-ui-base: fleet registry not listed — ${error.message}`);
		return [];
	}
}

/**
 * Streams one turn from `modelProvider`, translated into the harness's chunk
 * vocabulary. Consecutive `text` pieces accumulate into one streamed text
 * block, closed by the next tool-call piece or end of stream; each
 * `tool-call` piece (Story 5.1) is its own block, opened and closed
 * immediately since a replayed call is never fragmentary. At most one block
 * is ever open at a time, so block-start/block-end stay paired even when
 * `modelProvider.answer()` throws mid-stream — the open text block, if any,
 * is closed in the `catch` before the terminal `error` finish chunk. Finish
 * reason is `tool-calls` whenever any tool-call block was emitted, `stop`
 * otherwise (StreamChunk contract, `packages/llm/llm/src/types.ts`).
 * @param {import("./model-provider.js").ModelProvider} modelProvider
 * @param {{ messages: unknown[] }} options
 */
/**
 * The runtime model this turn should be answered by, from the router's decision.
 *
 * Resolved here because this is the last point before the provider is called and
 * the first point where the decision and the fleet are both reachable. Never
 * throws and never blocks a turn: a dispatch that cannot resolve leaves `model`
 * undefined, and the provider falls back to its configured default. The reason
 * is logged rather than swallowed, because a silent fallback looks exactly like
 * a routing decision.
 *
 * `replay` ignores `model` entirely, so this is inert under the replay provider
 * and its tests are unaffected.
 */
function dispatchForTurn() {
	try {
		const dispatch = runtimeModelForCurrentTurn(loadFleet().loaded);
		if (dispatch.runtimeId === null && dispatch.reason !== "no-routing-decision") {
			console.warn(
				`@stratum/dsh-client-ui-base: routing decision not dispatched (${dispatch.reason}` +
					`${dispatch.member ? `, member "${dispatch.member}"` : ""}) — falling back to the provider's default model`,
			);
		}
		return dispatch;
	} catch (error) {
		console.warn(`@stratum/dsh-client-ui-base: dispatch not resolved — ${error instanceof Error ? error.message : String(error)}`);
		return { runtimeId: null, member: null, reason: "dispatch-failed" };
	}
}

/**
 * The Stratum lane's two steps, as harness pieces (see `lanes/stratum.js`).
 *
 * Step one emits a `tool-call` built from the operator's own words; the harness
 * dispatches the real tool. Step two streams the answer the tool rendered — no
 * model call in either, so nothing can be added to a verified answer on the way out.
 * @param {string} taskType - `ask`, `pq_reply`, `report` or `topics`.
 * @param {{ messages: unknown[] }} options
 */
async function* stratumLanePieces(taskType, options) {
	if (toolHasReported(options.messages)) {
		const answer = answerFrom(toolResultText(options.messages));
		yield* textPieces(answer || "Stratum returned no text for this request.");
		return;
	}
	const text = userText(options.messages);
	if (text === "") {
		yield { type: "text", text: "Tell me what you would like to look up in the library." };
		return;
	}
	const call = laneCall(taskType, text);
	yield { type: "tool-call", id: `st-${taskType}-${Date.now()}`, name: call.name, arguments: JSON.stringify(call.args) };
}

async function* streamImpl(modelProvider, options, readImageRequest) {
	const dispatch = dispatchForTurn();
	// Attached pictures are resolved from their durable references into bytes
	// before the provider sees them, so the provider stays a wire serialiser and
	// nothing below this line knows the harness's attachment service exists.
	// A turn with no attachment resolves to the same array it was given.
	const messages = await resolveMessageImages(options.messages, readImageRequest);
	// The residency panel answers "did the model
	// actually see the picture?" from this, which is why it counts what was
	// resolved rather than what was attached.
	recordImages(imageRefsIn(messages).length);
	// The lane that shapes the request is chosen by task type; the model that
	// answers a plain turn by dispatch. Both come from the same routing decision.
	const taskType = currentTaskType();
	const model = dispatch.runtimeId ?? undefined;
	let pieces;
	if (servesTaskType(taskType)) {
		pieces = stratumLanePieces(taskType, { ...options, messages });
	} else {
		pieces = modelProvider.answer({ messages, model, system: STRATUM_SYSTEM_PROMPT });
	}
	let index = -1;
	let openTextIndex = -1;
	let openText = "";
	let sawToolCall = false;
	try {
		for await (const piece of pieces) {
			if (piece.type === "text") {
				if (piece.text.length === 0) continue;
				if (openTextIndex === -1) {
					index += 1;
					openTextIndex = index;
					yield { type: "block-start", index: openTextIndex, blockType: "text" };
				}
				openText += piece.text;
				yield { type: "text-delta", index: openTextIndex, text: piece.text };
				continue;
			}
			if (piece.type !== "tool-call") continue;
			if (openTextIndex !== -1) {
				yield { type: "block-end", index: openTextIndex, block: { type: "text", text: openText } };
				openTextIndex = -1;
				openText = "";
			}
			sawToolCall = true;
			index += 1;
			const toolIndex = index;
			yield { type: "block-start", index: toolIndex, blockType: "tool-call" };
			yield { type: "tool-call-delta", index: toolIndex, id: piece.id, name: piece.name, argumentsDelta: piece.arguments };
			yield { type: "block-end", index: toolIndex, block: { type: "tool-call", id: piece.id, name: piece.name, arguments: piece.arguments } };
		}
		if (openTextIndex !== -1) {
			yield { type: "block-end", index: openTextIndex, block: { type: "text", text: openText } };
		}
		yield { type: "finish", reason: sawToolCall ? { kind: "tool-calls" } : { kind: "stop" } };
	} catch (error) {
		if (openTextIndex !== -1) {
			yield { type: "block-end", index: openTextIndex, block: { type: "text", text: openText } };
		}
		yield {
			type: "finish",
			reason: { kind: "error", failure: { message: error instanceof Error ? error.message : String(error), code: "MODEL_PROVIDER_ERROR" } },
		};
	}
}

/**
 * @param {import("./model-provider.js").ModelProvider} modelProvider - the selected provider this adapter serves turns from.
 * @param {{ displayName: string, readImageRequest?: (ref: object, policy: object) => Promise<{ data: Uint8Array, mediaType: string }> }} options
 *   `readImageRequest` is the harness's `ctx.attachments.readImageRequest`, passed
 *   in by `index.js` rather than reached for here, so this file keeps knowing
 *   nothing about the host beyond the seam it is handed. Omitted — in every unit
 *   test, and in a profile with no attachment service — image blocks resolve to
 *   nothing and a text turn is unaffected.
 */
export function createLlmAdapter(modelProvider, { displayName, readImageRequest }) {
	// State every licence refusal once, at mount — an error line per refused
	// fleet member naming the licence that caused it (Story 3.4). This is the
	// "not a warning, a refusal" the licence policy requires; `fleetModels`
	// then serves only the members that passed.
	try {
		announceRefusals(loadFleet().refused);
	} catch (error) {
		console.warn(`@stratum/dsh-client-ui-base: fleet registry not read for the licence gate — ${error.message}`);
	}

	const stream = (options) => streamImpl(modelProvider, options, readImageRequest);
	return {
		providerInfo(provider) {
			return { id: provider, name: displayName };
		},
		providerRetryPolicy() {
			return undefined;
		},
		async listModels(provider) {
			return fleetModels(provider ?? "replay");
		},
		resolveModel,
		async prepareCall(provider, model) {
			return { model: await resolveModel(provider, model), stream };
		},
		stream,
	};
}
