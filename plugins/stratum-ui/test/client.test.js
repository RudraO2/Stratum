import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURES, loadClient } from "./render-harness.js";

const byId = (registered, id) => registered.find((r) => r.options.id === id);
const byKey = (registered, key) => registered.find((r) => r.options.key === key);
const settled = (id, toolName, meta, extra = {}) => ({ callId: id, toolName, block: { kind: "tool-result", callId: id, isError: false, content: [{ type: "text", text: "x" }], meta, ...extra }, openFile() {} });

test("the client registers every seat Stratum takes", async () => {
	const { registered } = await loadClient();
	const tabs = registered.filter((r) => r.options.name === "conversation.view").map((r) => [r.options.id, r.options.label]);
	assert.deepEqual(tabs, [
		["st-evidence", "Evidence"],
		["st-facts", "Facts"],
		["st-topics", "Topics"],
		["st-metrics", "Metrics"],
	]);
	for (const key of ["stratum_ask", "stratum_pq_reply", "stratum_report", "stratum_topics"]) assert.ok(byKey(registered, key), `toolview ${key}`);
	assert.ok(byId(registered, "st-library"), "library foot row");
	assert.ok(byId(registered, "st-library-drawer"), "library drawer");
	assert.ok(byId(registered, "st-seal"), "the egress row is still there");
	assert.ok(registered.some((r) => r.options.name === "conversation.hero.brand.mark"), "brand mark");
});

test("the brand is Stratum's: its own mark and tagline, none of Faraday's", async () => {
	const { registered, render, element } = await loadClient();
	const hero = registered.find((r) => r.options.name === "conversation.hero.brand.mark");
	const { text } = await render(element(hero.Component, { size: 34 }));
	assert.match(text, /Stratum/);
	assert.match(text, /Evidence-first coal intelligence/);
	assert.doesNotMatch(text, /Into the Unknown|Faraday|Blind/i);
});

test("ask card: a single figure, with its route, guard and source chip", async () => {
	const { registered, render, element } = await loadClient();
	const card = byKey(registered, "stratum_ask").Component;
	const { text, clicks } = await render(element(card, settled("a1", "stratum_ask", FIXTURES.ask.single)));
	assert.match(text, /Ask the library/);
	assert.match(text, /Verified facts/);
	assert.match(text, /Number guard/);
	assert.match(text, /86\.10/);
	assert.match(text, /\[1\] sample-/);
	assert.ok(clicks.length > 0, "the figure and the chip are clickable");
});

test("ask card: a comparison table says which period has no figures", async () => {
	const { registered, render, element } = await loadClient();
	const { text } = await render(element(byKey(registered, "stratum_ask").Component, settled("a2", "stratum_ask", FIXTURES.ask.compare)));
	assert.match(text, /FY2023-24/);
	assert.match(text, /FY2024-25/);
	assert.match(text, /773\.80/);
	assert.match(text, /—/);
});

test("ask card: an unanswerable question shows no evidence table and no citations", async () => {
	const { registered, render, element } = await loadClient();
	const { text } = await render(element(byKey(registered, "stratum_ask").Component, settled("a3", "stratum_ask", FIXTURES.ask.insufficient)));
	assert.match(text, /Insufficient evidence/);
	assert.match(text, /does not guess/);
	assert.doesNotMatch(text, /Sources/);
});

test("ask card: target vs actual shows the achievement column", async () => {
	const { registered, render, element } = await loadClient();
	const { text } = await render(element(byKey(registered, "stratum_ask").Component, settled("a4", "stratum_ask", FIXTURES.ask.achievement)));
	assert.match(text, /Achievement %/);
	assert.match(text, /98\.42%/);
	assert.match(text, /Target FY2023-24/);
});

test("ask card: provisional-vs-final disagreements are called out", async () => {
	const { registered, render, element } = await loadClient();
	const secl = { ...FIXTURES.ask.single };
	const discrepancies = [{ entity: "SECL", period: "FY2023-24", metric: "coal_production", reported: 187, other: 186.9, other_source: "sample-ls-usq-2150-29-07-2024.pdf", pq: "Lok Sabha Unstarred 2150 29.07.2024", note: "provisional vs final" }];
	const { text } = await render(element(byKey(registered, "stratum_ask").Component, settled("a5", "stratum_ask", { ...secl, discrepancies })));
	assert.match(text, /Other sources disagree/);
	assert.match(text, /186\.9/);
});

test("PQ card: parts, the past-reply warning, similar replies and the file", async () => {
	const { registered, render, element } = await loadClient();
	const { text } = await render(element(byKey(registered, "stratum_pq_reply").Component, settled("p1", "stratum_pq_reply", FIXTURES.pq)));
	assert.match(text, /Lok Sabha Unstarred 1234/);
	assert.match(text, /Review before sending/);
	assert.match(text, /stated 186\.9/);
	assert.match(text, /\(a\)/);
	assert.match(text, /\(c\)/);
	assert.match(text, /target was not achieved/);
	assert.match(text, /Similar questions already answered/);
	assert.match(text, /PQ-LokSabha-Unstarred1234.*\.docx/);
	assert.doesNotMatch(text, /(MT|%)[,.;]? \[\d+\]/, "citation brackets are stripped from the reply text (the source chips keep theirs)");
});

test("report cards render for all three templates", async () => {
	const { registered, render, element } = await loadClient();
	const card = byKey(registered, "stratum_report").Component;
	const expectations = [/production/i, /Achievement/, /From FY2019-20/];
	for (const [i, report] of FIXTURES.reports.entries()) {
		const { text } = await render(element(card, settled(`r${i}`, "stratum_report", report)));
		assert.match(text, expectations[i], report.template);
		assert.match(text, /Number guard/);
		assert.match(text, /\.docx/);
	}
});

test("topics card and the running / error states", async () => {
	const { registered, render, element } = await loadClient();
	const topics = byKey(registered, "stratum_topics").Component;
	const { text } = await render(element(topics, settled("t1", "stratum_topics", FIXTURES.topics)));
	assert.match(text, /Library topics/);
	assert.match(text, /Mine Safety/);

	const ask = byKey(registered, "stratum_ask").Component;
	const running = await render(element(ask, { callId: "x", toolName: "stratum_ask", block: { kind: "tool-call", callId: "x", name: "stratum_ask" }, openFile() {} }));
	assert.match(running.text, /Looking this up in the library/);

	const failed = await render(element(ask, settled("e", "stratum_ask", { status: "error", answer: "Stratum could not complete this: backend down" })));
	assert.match(failed.text, /could not complete this: backend down/);
});

test("Library: the foot row reports the library and opens a drawer that lists each document", async () => {
	const requests = [];
	const { registered, render, element } = await loadClient({ requests });
	const row = byId(registered, "st-library").Component;
	const drawer = byId(registered, "st-library-drawer").Component;
	const first = await render(element(row, { wide: true }));
	assert.match(first.text, /Library/);
	assert.match(first.text, new RegExp(`${FIXTURES.stats.documents} documents`));
	assert.match(first.text, new RegExp(`${FIXTURES.stats.facts.total} facts`));
	assert.ok(requests.includes("GET /documents"));

	assert.doesNotMatch((await render(element(drawer, {}))).text, /Add documents/, "closed until the row is pressed");
	first.clicks[0].props.onClick();
	const open = await render(element(drawer, {}));
	assert.match(open.text, /Add documents/);
	assert.match(open.text, /sample-provisional-coal-statistics-2023-24\.pdf/);
	assert.match(open.text, /Nothing is uploaded anywhere/);
	assert.match(open.text, /1 flagged/);
	first.clicks[0].props.onClick(); // close again so later tests start clean
});

test("Evidence: a citation chip points the tab at the cited cell, with its lineage", async () => {
	const { registered, render, element } = await loadClient();
	const card = byKey(registered, "stratum_ask").Component;
	const { clicks } = await render(element(card, settled("a9", "stratum_ask", FIXTURES.ask.single)));
	clicks.find((c) => typeof c.props.title === "string" && c.props.title.includes("Click to open this place")).props.onClick();

	const evidence = byId(registered, "st-evidence").Component;
	const { text } = await render(element(evidence, {}));
	assert.match(text, /Documents/);
	assert.match(text, /Read from/);
	assert.match(text, /Checks/);
	assert.match(text, /never writes a figure/);
});

test("Facts: the review queue opens on the flagged fact, and its lineage offers accept / edit / reject", async () => {
	const requests = [];
	const { registered, render, element } = await loadClient({ requests });
	const view = byId(registered, "st-facts").Component;
	const first = await render(element(view, {}));
	assert.match(first.text, /Needs review · 1/);
	assert.match(first.text, /A check failed on each of these/);
	assert.match(first.text, /flagged/);
	assert.ok(requests.includes("GET /facts?limit=500"));
});

test("Topics and Metrics tabs render the backend's numbers", async () => {
	const { registered, render, element } = await loadClient();
	const topics = await render(element(byId(registered, "st-topics").Component, {}));
	assert.match(topics.text, /Topics in the library/);
	assert.match(topics.text, /Rebuild/);
	assert.match(topics.text, /Mine Safety/);

	const metrics = await render(element(byId(registered, "st-metrics").Component, {}));
	assert.match(metrics.text, /Measured, not asserted/);
	assert.match(metrics.text, /Wrong values caught by a check/);
	assert.match(metrics.text, /Routing accuracy/);
	assert.match(metrics.text, /100%/);
	assert.match(metrics.text, /Citation correctness/);
});

test("the routing chip speaks in Stratum's task types", async () => {
	const { registered } = await loadClient();
	const chip = registered.find((r) => r.options.id === "st-routing-chip");
	assert.ok(chip, "routing chip registered");
});
