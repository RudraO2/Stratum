/**
 * A minimal React stand-in, enough to execute `lib/client.js` without a browser or react-dom.
 *
 * The client is a loader-format bundle: `window.__ModuleLoader__.load({ factory })`. This loads the real file
 * into a `vm` sandbox, hands its factory a fake `require` (React hooks that work, primitives that render
 * their children), applies it with a fake slot registry, and renders whatever it registered into text.
 * Effects run, `fetch` answers from fixtures, state updates re-render until nothing changes — so a tab's
 * data path is exercised, not just its loading state.
 *
 * It proves the components do not throw and show the right words for real backend output. It does not prove
 * how anything looks; that is for a person (and the screenshots in docs/).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CLIENT_SOURCE = readFileSync(join(HERE, "..", "lib", "client.js"), "utf8");
export const FIXTURES = JSON.parse(readFileSync(join(HERE, "fixtures", "backend.json"), "utf8"));

const element = (type, props, key) => ({ $$element: true, type, props: props ?? {}, key });

function createRuntime() {
	const fibers = new Map();
	let current = null;
	let index = 0;
	let dirty = false;
	let effects = [];
	const clicks = [];
	const titles = [];

	const react = {
		useState(initial) {
			const fiber = current;
			const i = index++;
			if (!(i in fiber.hooks)) fiber.hooks[i] = typeof initial === "function" ? initial() : initial;
			return [
				fiber.hooks[i],
				(next) => {
					const value = typeof next === "function" ? next(fiber.hooks[i]) : next;
					if (!Object.is(value, fiber.hooks[i])) {
						fiber.hooks[i] = value;
						dirty = true;
					}
				},
			];
		},
		useEffect(fn, deps) {
			const fiber = current;
			const i = index++;
			const prev = fiber.hooks[i];
			const changed = !prev || !deps || deps.length !== prev.deps.length || deps.some((d, k) => !Object.is(d, prev.deps[k]));
			if (changed) {
				fiber.hooks[i] = { deps: deps ?? [] };
				effects.push(fn);
			}
		},
		useRef(initial) {
			const fiber = current;
			const i = index++;
			fiber.hooks[i] ??= { current: initial ?? null };
			return fiber.hooks[i];
		},
		useMemo: (fn) => fn(),
		useCallback: (fn) => fn,
		useSyncExternalStore(subscribe, getSnapshot) {
			const fiber = current;
			const i = index++;
			if (!fiber.hooks[i]) {
				fiber.hooks[i] = { subscribed: true };
				subscribe(() => {
					dirty = true;
				});
			}
			return getSnapshot();
		},
	};
	react.useLayoutEffect = react.useEffect;

	function expand(node, path) {
		if (node === null || node === undefined || typeof node === "boolean") return "";
		if (typeof node === "string" || typeof node === "number") return String(node);
		if (Array.isArray(node)) return node.map((child, i) => expand(child, `${path}.${i}`)).join(" ");
		if (typeof node.props?.onClick === "function") clicks.push({ type: node.type, props: node.props });
		if (typeof node.type === "function") {
			const key = `${path}/${node.type.name || "anon"}${node.key ? `:${node.key}` : ""}`;
			let fiber = fibers.get(key);
			if (!fiber) fibers.set(key, (fiber = { hooks: [] }));
			current = fiber;
			index = 0;
			const out = node.type(node.props);
			return expand(out, key);
		}
		const p = node.props ?? {};
		// Only what a person can read on screen counts as text. Tooltips and aria-labels are collected
		// separately (`titles`) so a test can assert on them without them masking a missing visible label.
		for (const x of [p.title, p["aria-label"]]) if (typeof x === "string") titles.push(x);
		return expand(p.children, `${path}.${String(node.type)}`);
	}

	async function render(root) {
		let text = "";
		for (let pass = 0; pass < 10; pass += 1) {
			dirty = false;
			effects = [];
			clicks.length = 0;
			titles.length = 0;
			text = expand(root, "root");
			for (const effect of effects) effect();
			for (let tick = 0; tick < 4; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
			if (!dirty) break;
		}
		return { text: text.replace(/\s+/g, " "), clicks: [...clicks], titles: titles.join(" | ") };
	}

	return { react, render };
}

/** Primitives: components that show their children (and a label/anchor), so their words land in the text. */
function primitives() {
	const show = (props) => element("div", props);
	return new Proxy(
		{},
		{
			get(_target, name) {
				if (typeof name !== "string") return undefined;
				if (name.startsWith("Icon")) return () => null;
				if (name === "Menu") return (props) => props.anchor ?? null;
				if (name === "StateDot") return (props) => element("span", { "aria-label": `dot:${props.state}` });
				return show;
			},
		},
	);
}

/** Route a proxied backend path to a fixture; `undefined` means 404. */
export function routeFixture(path, method = "GET") {
	const f = FIXTURES;
	if (path === "/documents") return f.documents;
	if (path === "/stats") return f.stats;
	if (path.startsWith("/facts?")) return f.facts;
	if (/^\/facts\/\d+\/review$/.test(path)) return f.fact_verified;
	const fact = path.match(/^\/facts\/(\d+)$/);
	if (fact) return Number(fact[1]) === f.fact_verified.id ? f.fact_verified : f.fact_flagged;
	if (/\/pages\/\d+\/overlay$/.test(path)) return f.overlay;
	if (/^\/documents\/8\/tables\/\d+$/.test(path)) return f.table_xlsx;
	if (/^\/documents\/\d+$/.test(path)) return method === "DELETE" ? { deleted: 1 } : f.doc_xlsx;
	if (path === "/topics") return f.topics;
	if (path === "/metrics") return f.metrics;
	return undefined;
}

/**
 * Load the client and apply it. Returns the registered components and a `render` function.
 * @param {{ requests?: string[] }} [options] - collects every proxied request path, for assertions.
 */
export async function loadClient({ requests = [] } = {}) {
	const runtime = createRuntime();
	const jsx = (type, props, key) => element(type, props, key);
	const jsxRuntime = { jsx, jsxs: jsx, Fragment: (props) => props.children };
	const host = { react: runtime.react, "react/jsx-runtime": jsxRuntime, "@deepseek-ai/dsh-client-ui-primitives": primitives() };

	let captured = null;
	const documentStub = {
		title: "Stratum",
		head: { appendChild() {} },
		body: {},
		createElement: () => ({ dataset: {}, remove() {}, style: {} }),
		querySelector: () => null,
		querySelectorAll: () => [],
	};
	const sandbox = {
		window: { __ModuleLoader__: { load: (definition) => (captured = definition) } },
		document: documentStub,
		console,
		setTimeout,
		clearTimeout,
		setInterval: () => 0,
		clearInterval() {},
		FormData: class {
			append() {}
		},
		fetch: async (url, init = {}) => {
			const path = String(url).replace("/stratum/api", "");
			requests.push(`${init.method ?? "GET"} ${path}`);
			const data = routeFixture(path, init.method);
			return { ok: data !== undefined, status: data === undefined ? 404 : 200, text: async () => JSON.stringify(data ?? { detail: "not found" }) };
		},
	};
	vm.runInNewContext(CLIENT_SOURCE, sandbox, { filename: "client.js" });
	if (!captured) throw new Error("client.js did not call window.__ModuleLoader__.load");

	const exports = captured.factory((name) => {
		if (!(name in host)) throw new Error(`unexpected require("${name}")`);
		return host[name];
	});

	const registered = [];
	const ctx = {
		slots: {
			inject(_slot, factory) {
				const made = factory();
				if (made && typeof made.next === "function") for (const _ of made);
				return () => {};
			},
			register(options, Component) {
				registered.push({ options, Component });
				return () => {};
			},
		},
		inject() {},
	};
	const dispose = exports.apply(ctx);
	return { exports, registered, dispose, render: (node) => runtime.render(node), element: (type, props) => element(type, props) };
}
