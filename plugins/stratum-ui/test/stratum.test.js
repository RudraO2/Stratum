import assert from "node:assert/strict";
import { test } from "node:test";
import { backendPathFor } from "../lib/backend/proxy.js";
import { configureBackend, backendEndpoint, isLoopbackUrl } from "../lib/backend/client.js";
import { answerFrom, laneCall, pieces, servesTaskType, toolHasReported, toolResultText, userText } from "../lib/lanes/stratum.js";
import { classifyRequest } from "../lib/router/classify.js";
import { ASK_TOOL_NAME, createStratumTools, PQ_TOOL_NAME, pqFilename, SOURCES_MARKER } from "../lib/tools/stratum-tools.js";
import { buildRequestBody } from "../lib/model-plane/local-provider.js";

const PQ = `LOK SABHA UNSTARRED QUESTION NO. 1234
Will the Minister of COAL be pleased to state:
(a) the coal production of SECL during the last three years;
(b) whether the target was achieved?`;

test("router sends the four workflows to their task types", () => {
	assert.equal(classifyRequest(PQ).taskType, "pq_reply");
	assert.equal(classifyRequest("Generate a target vs achievement report for FY2023-24").taskType, "report");
	assert.equal(classifyRequest("Show me the topics and a word cloud").taskType, "topics");
	assert.equal(classifyRequest("What was SECL coal production in FY2023-24?").taskType, "ask");
	assert.equal(classifyRequest("hello").taskType, "chat");
});

test("a lane call uses the operator's own words as arguments", () => {
	assert.deepEqual(laneCall("ask", "What was CCL production?"), { name: ASK_TOOL_NAME, args: { question: "What was CCL production?" } });
	assert.equal(laneCall("pq_reply", PQ).name, PQ_TOOL_NAME);
	assert.equal(laneCall("pq_reply", PQ).args.text, PQ);
	assert.deepEqual(laneCall("topics", "rebuild the topics").args, { rebuild: true });
	assert.deepEqual(laneCall("topics", "show topics").args, { rebuild: false });
	assert.equal(servesTaskType("ask"), true);
	assert.equal(servesTaskType("chat"), false);
	assert.equal(servesTaskType("vision"), false);
});

test("step two is recognised from the message list and streams only the answer part", () => {
	const user = { role: "user", content: "What was CCL production?" };
	const reported = {
		role: "user",
		source: { kind: "tool" },
		content: [{ type: "tool-result", content: [{ type: "text", text: `CCL produced 86.10 MT [1].${SOURCES_MARKER}\n[1] file.xlsx — cell` }] }],
	};
	assert.equal(toolHasReported([user]), false);
	assert.equal(toolHasReported([user, reported]), true);
	assert.equal(answerFrom(toolResultText([user, reported])), "CCL produced 86.10 MT [1].");
	assert.equal(userText([user, reported]), "What was CCL production?");
});

test("the answer streams as text pieces the adapter accepts, and reassembles exactly", () => {
	const text = "CCL produced 86.10 MT [1]. A longer sentence follows so that it spans several pieces.";
	const out = [...pieces(text)];
	assert.ok(out.length > 1);
	assert.ok(out.every((piece) => piece.type === "text" && typeof piece.text === "string"));
	assert.equal(out.map((piece) => piece.text).join(""), text);
});

test("tool definitions are well formed and the deliverable path is a pure function of the arguments", () => {
	const tools = createStratumTools({ backend: async () => ({}) });
	assert.deepEqual(tools.map((t) => t.name), ["stratum_ask", "stratum_pq_reply", "stratum_report", "stratum_topics"]);
	for (const tool of tools) {
		assert.equal(typeof tool.execute, "function");
		assert.equal(tool.parameters.type, "object");
		assert.equal(typeof tool.output.render, "function");
	}
	const pq = tools.find((t) => t.name === PQ_TOOL_NAME);
	const view = pq.presentCall({ text: PQ });
	assert.equal(view.kind, "edit");
	assert.equal(view.locations[0].path, `deliverables/${pqFilename({ text: PQ })}`);
	assert.equal(pqFilename({ text: PQ }), pqFilename({ text: PQ }));
	assert.notEqual(pqFilename({ text: PQ }), pqFilename({ text: `${PQ} ` }));
});

test("ask renders the answer, discrepancy notes and sources; a backend failure becomes a sentence", async () => {
	const ask = createStratumTools({
		backend: async () => ({
			status: "answered",
			answer: "CCL produced 86.10 MT [1].",
			guard: { ok: true, unsupported: [] },
			discrepancies: [{ entity: "CCL", period: "FY2023-24", other_source: "PQ", other: 86.0, reported: 86.1, note: "sources disagree" }],
			citations: [{ n: 1, filename: "sample.xlsx", page_no: 1, snippet: "CCL · FY2023-24 · 86.10 MT" }],
		}),
	})[0];
	const value = await ask.execute({ question: "CCL?" });
	const text = ask.output.render({}, value)[0].text;
	assert.match(text, /^CCL produced 86\.10 MT \[1\]\./);
	assert.match(text, /Note: CCL FY2023-24/);
	assert.ok(text.includes(SOURCES_MARKER));
	assert.equal(answerFrom(text).includes("Sources"), false);

	const down = createStratumTools({ backend: async () => { throw new Error("connect ECONNREFUSED"); } })[0];
	const failed = await down.execute({ question: "CCL?" });
	assert.equal(failed.status, "error");
	assert.match(down.output.render({}, failed)[0].text, /could not complete/);
	await assert.rejects(() => down.execute({ question: "  " }), /invalid question/);
});

test("the proxy only maps /stratum/api/* onto /v1/* and refuses traversal", () => {
	assert.equal(backendPathFor("/stratum/api/documents/3/pages/1.png"), "/v1/documents/3/pages/1.png");
	assert.equal(backendPathFor("/stratum/api/ask"), "/v1/ask");
	assert.equal(backendPathFor("/stratum/api/../secret"), null);
	assert.equal(backendPathFor("/stratum/api//x"), null);
	assert.equal(backendPathFor("/other/path"), null);
});

test("the backend endpoint stays on this machine", () => {
	assert.equal(isLoopbackUrl("http://127.0.0.1:8642"), true);
	assert.equal(isLoopbackUrl("http://localhost:8642"), true);
	assert.equal(isLoopbackUrl("https://example.com"), false);
	assert.equal(isLoopbackUrl("file:///etc/passwd"), false);
	const before = backendEndpoint();
	configureBackend("http://evil.example.com:8642");
	assert.equal(backendEndpoint(), before);
	configureBackend("http://127.0.0.1:9999/");
	assert.equal(backendEndpoint(), "http://127.0.0.1:9999");
	configureBackend(before);
});

test("the local provider sends Stratum's persona only when asked", () => {
	const plain = buildRequestBody({ messages: [{ role: "user", content: "hi" }] }, "st-text");
	assert.equal(plain.messages[0].role, "user");
	const withPersona = buildRequestBody({ messages: [{ role: "user", content: "hi" }], system: "You are Stratum." }, "st-text");
	assert.deepEqual(withPersona.messages[0], { role: "system", content: "You are Stratum." });
});
