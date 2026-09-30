/**
 * Stratum base plugin, browser half.
 *
 * Written directly in the host loader's module format, so this package ships no
 * React and needs no bundler: `require` inside the factory resolves
 * `react/jsx-runtime` and every `@deepseek-ai/dsh-client-*` package from the
 * host at load time.
 *
 * Deliberately not an ES module, despite `"type": "module"` in the manifest.
 * The host serves this file as a raw bundle to the browser's module loader and
 * never `import`s it, so it is written as the loader's own format — a top-level
 * `window.__ModuleLoader__.load(...)` call with a CommonJS-shaped factory. Only
 * `exports["./client"]` points here, and only the host reads that.
 *
 * Story 1.1 mounted the seam and took no slot. Story 1.5 is the first
 * occupant: the Stratum mark in `conversation.hero.brand.mark` and
 * `sidebar.brand.mark`, the two places the DeepSeek whale used to render (see
 * `apply` below for why both, not just the one AC1 names). What Story 1.1 did
 * do is check that the host supplied the React seam every later panel depends
 * on, so a broken seam is reported here, by package name, instead of
 * surfacing as an obscure failure inside the routing chip or the egress
 * monitor — kept as-is below.
 *
 * Story 1.4 takes this package's first slot: `conversation.hero.agentPreset`.
 * The host's own agent-preset roster always includes its four shipped presets
 * (`standard`/`code`/`minimal`/`cordis`) alongside ours — `dsh-agent-presets`
 * hard-codes its shipped root into every deployment's resolved config, so a
 * profile patch cannot remove them (verified against a running `dsh web`,
 * 28 Aug 2026: `agentPreset.list` names all four no matter what this profile's
 * `cordis.patch.yml` configures). This component is an indicator rather than a
 * wrapper around the host's own hero chip: it reads the same roster over the
 * same host RPCs and shows only the presets Stratum authored
 * (`trust: 'user'`), so "Standard mode" and its shipped siblings never appear
 * here even though the host still lists them elsewhere (Settings > Agent
 * presets, unavoidably, for the same reason).
 *
 * It shipped as a dropdown and was corrected to a read-only indicator on
 * 28 Aug 2026: SIH26117 requires the system to pick automatically, so a control
 * asking the operator to classify the task contradicts the entry's own claim.
 *
 * Story 3.8 — "the model changes by itself when the task type changes" — lives
 * on the routing chip, not here. `conversation.hero.*` is the new-session
 * screen: `@deepseek-ai/dsh-client-ui-agent-preset`'s own `AgentPresetSeat`
 * records that the hero seat "is only available before a conversation starts",
 * and the hero is replaced by the conversation view once a turn runs — so the
 * hero indicator is never on screen at the moment a mid-session reclassification
 * happens. This indicator therefore stays a new-session affordance showing the
 * deployment's authored task types; the surface that visibly moves when the
 * router reclassifies is the routing chip at `conversation.input.model`, which
 * re-reads the `st-routing` view every turn (see `buildRoutingChip`).
 *
 * Story 3.2 takes one more seat: `conversation.session.header.utilities`, a
 * read-only pill naming the active model-plane provider. When `replay` is the
 * provider it says so in plain words and says the responses are authored, not
 * captured (ADR-0001 amendment, 28 Aug 2026). The provider name is read from
 * the host's `llm.providers` directory — the Stratum adapter registered
 * in the host half (`index.js`) surfaces there as `Stratum (<provider>)` —
 * so this indicator reports the configured provider rather than guessing it.
 *
 * Story 3.7 takes the last seat: `conversation.input.model`, a `single` slot,
 * so occupying it replaces the stock model picker outright
 * (`@deepseek-ai/dsh-client-ui-model-selection` is disabled in the profile —
 * docs/profile-install.md, Story 3.7 section). This is the routing chip
 * (CONTEXT.md): it names the fleet member the router picked for the last turn
 * and expands to show the working — the classified task type, the score per
 * fleet member, and the members filtered out before scoring with the reason
 * each was. The decision is not recomputed here: the host half appends a
 * `router/routed` session event per turn (Story 3.6), and this reads it back
 * through a registered conversation view (`st-routing`) folded from that
 * event, so the chip shows the decision the router actually recorded — never
 * an animation without an event behind it (NFR8).
 *
 * Story 2.2 adds the egress monitor. It was a chip in
 * `conversation.session.header.utilities` and a floating card in
 * `shell.overlay`; on 30 August 2026 it became a permanent seal row at
 * `sidebar.footer.action` and the Sovereignty drawer. The chip's slot is scoped
 * *session*, so the one claim this product rests on was absent from the
 * new-session screen — the first thing an evaluator sees. The foot row's slot
 * is scoped `root`, which is both the fix and the more honest siting: the seal
 * belongs to this installation's outbound access, not to one conversation.
 *
 * Both surfaces show one number — the count of `egress/denied` session events
 * the denial waterfall records (host half) — folded through a registered
 * `st-egress` conversation view. The zero is counted, never a literal (FR15),
 * and it is the rebuild of the 27 August spike's hand-rolled monitor against
 * the shipped primitives and theme tokens (UX-DR7).
 *
 * Story 2.3's canary was removed on 30 August 2026 (ADR-0007), and with it the
 * composer button that fired it. The demonstration is now the request an
 * operator actually types — "open WhatsApp" — refused by the same waterfall and
 * recorded on the same event, so nothing on screen depends on a control that
 * existed to be pressed.
 *
 * Story 2.4 adds no seat either. The drawer is the audit surface: it lists
 * every recorded egress event — the timestamp the harness
 * stamped on the event, the tool, and the refused target — in the order the log
 * wrote them. The lines come from the same `st-egress` view the count comes
 * from, so reading the log on screen needs no terminal and a fresh denial lands
 * in the list through the subscription that was already there.
 *
 * Story 4.5's provenance crop viewer took this package's first
 * `conversation.view` seat — a whole tab listing every OCR line and the page
 * region it was read from. It was removed on 31 August 2026 with the OCR
 * service behind it (ADR-0008). An attached picture now reaches the vision
 * model as a picture, and the harness's own `conversation.message.images`
 * gallery shows it against the message that carried it, with a lightbox for
 * the original — evidence in the transcript rather than in a tab.
 *
 * Story 3.8 adds no seat. Because the `st-routing` view keeps the highest-seq
 * `router/routed` node and the chip subscribes through `useSyncExternalStore`,
 * a turn that classifies as a different task type moves the chip to the newly
 * selected fleet member — trigger and expanded working both — with no user
 * action. Story 3.8 is the regression cover for that cross-turn behaviour.
 */
window.__ModuleLoader__.load({
	id: "@stratum/dsh-client-ui-base",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/** Everything a Stratum panel needs from the host's React. */
		const REQUIRED_JSX_EXPORTS = ["jsx", "jsxs", "Fragment"];

		/**
		 * A bolted-shut pipe flange, six holes around a solid plate — the
		 * metaphor the project is named for. `fill="currentColor"` so it
		 * inherits the hero's own text colour rather than a hard-rolled hex,
		 * which is what makes it correct in both themes without a media query.
		 */
		/**
		 * The Stratum mark, from `Logo.svg`.
		 *
		 * Authored at 1254pt and drawn through the group transform below, which is
		 * how the artwork was exported. Rescaling the coordinates by hand would risk
		 * shifting the curves for no gain, and the transform costs nothing.
		 * The viewBox is cropped to the artwork rather than to the exported canvas:
		 * measured in the browser, the paths occupy 426 x 682 of a 1254 x 1254
		 * export, so drawing the full canvas rendered the mark at a third of the
		 * width of its seat. `favicon.svg` carries the same paths and the same crop.
		 */
		// Strata: a solid top layer over two layers of rock, drawn in `currentColor` so it
		// takes the text colour of whatever seat it sits in - correct in light and dark alike.
		const MARK_LAYERS = {
			top: "M24 4 L44 13 L24 22 L4 13 Z",
			lines: ["M4 20.5 L24 29.5 L44 20.5", "M4 28.5 L24 37.5 L44 28.5"],
		};

		/**
		 * The Stratum mark. Same `size`/`className` shape the host's own
		 * `OfficialBrandMark` takes, since `conversation.hero.brand.mark` is a
		 * `single` slot and this occupies it outright.
		 */
		/**
		 * The wordmark beside the mark in the sidebar.
		 *
		 * `sidebar.brand.name` is a slot with a shipped fallback, and the fallback
		 * reads "DSH Local Build" with the harness's build hash beside it. Correct
		 * for the harness; wrong for a product that has just told the operator it is
		 * called Stratum, and it sits directly beside our own mark at the top of the
		 * sidebar, on screen for the whole demo. Taking the seat is the same one-line
		 * move Story 1.5 made for the mark.
		 *
		 * No colour, weight or size of ours: the seat is already styled by the
		 * sidebar around it, and a wordmark that restyles itself would stop matching
		 * the row it sits in (UX-DR7).
		 */
		/**
		 * The hero lockup: the mark, the product name, and the tagline under it.
		 *
		 * The hero headline reads "Into the Unknown" and there is no seat for it. It
		 * is a locale string (`hero.headline`) inside `dsh-client-ui-conversation`,
		 * `ui-conversation` takes no config, and `locale.register` throws rather than
		 * overriding: it refuses a namespace/locale pair that is already registered,
		 * and the conversation package registers both of the two shipped locales. So
		 * there is no supported way to change that string, and it is the largest text
		 * on the first screen of the demo, naming somebody else's product.
		 *
		 * What this does instead: the shipped headline node is hidden by the
		 * stylesheet below, and the words are rendered HERE, as real text in a real
		 * component. CSS only hides; it never fabricates text through `content:`, so
		 * the name stays selectable, readable by a screen reader, and themed like
		 * everything else.
		 *
		 * How it degrades matters, because the hook is a build-hashed class name. If
		 * a harness upgrade renames it the rule stops matching, and the hero shows
		 * both "Stratum" and "Into the Unknown". Untidy, and visible immediately -
		 * which is the right failure for a demo surface, rather than a blank hero.
		 * The harness version this was checked against is pinned in package.json.
		 */
		function StratumHero({ size, className }) {
			let jsxRuntime;
			try {
				jsxRuntime = require("react/jsx-runtime");
			} catch {
				return null;
			}
			if (typeof jsxRuntime?.jsx !== "function") return null;
			const { jsx, jsxs } = jsxRuntime;
			return jsxs("span", {
				style: { display: "inline-flex", alignItems: "center", gap: "0.4em" },
				children: [
					jsx(RingedMark, { size, className }),
					jsxs("span", {
						style: { display: "inline-flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.05 },
						children: [
							// No font-size of ours: the name inherits the headline's own type.
							jsx("span", { children: "Stratum" }),
							// The tagline is sized against that headline rather than in px, so it
							// stays in proportion if the harness restyles the hero.
							jsx("span", {
								style: { fontSize: "0.34em", fontWeight: 400, letterSpacing: "0.04em", color: "var(--dsw-alias-label-secondary)" },
								children: "Evidence-first coal intelligence",
							}),
						],
					}),
				],
			});
		}

		function StratumWordmark() {
			let jsxRuntime;
			try {
				jsxRuntime = require("react/jsx-runtime");
			} catch {
				return null;
			}
			if (typeof jsxRuntime?.jsx !== "function") return null;
			return jsxRuntime.jsx("span", { children: "Stratum" });
		}

		/**
		 * The seal, drawn as a ring around the mark.
		 *
		 * The cheapest true thing on the screen: Stratum is named after the plate
		 * bolted over a line to isolate it, and a closed ring around the mark is
		 * that plate. Continuous means sealed. Broken means open.
		 *
		 * Restraint is the whole design. The sealed ring is a hairline in the
		 * theme's own border token and carries no colour at all — a permanently
		 * green logo is a reassurance nobody reads by the third minute, and this
		 * is industrial control software (UX-DR7). Colour appears only in the
		 * abnormal state, where an amber dashed ring is the point. Until the host
		 * has answered once there is no ring: this client does not know the seal's
		 * state and must not imply either answer.
		 *
		 * It is decoration in the strict sense — `aria-hidden`, no title, no
		 * click. The seal row at the sidebar foot is the accessible statement of
		 * the same fact, and saying it twice to a screen reader helps nobody.
		 * @param props.size - the square edge the seat asked for.
		 */
		function SealRing({ size, children }) {
			const { useSyncExternalStore } = require("react");
			const { jsx, jsxs } = require("react/jsx-runtime");
			const state = useSyncExternalStore(seal.subscribe, seal.get);
			const open = state.known && !state.sealed;
			const edge = typeof size === "number" && Number.isFinite(size) ? size : 24;
			return jsxs("span", {
				style: {
					position: "relative",
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: `${edge}px`,
					height: `${edge}px`,
					flex: "0 0 auto",
				},
				children: [
					state.known
						? jsx("span", {
								"aria-hidden": "true",
								style: {
									position: "absolute",
									inset: 0,
									borderRadius: "50%",
									border: open
										? "1.5px dashed var(--dsw-alias-state-warn-primary)"
										: "1px solid var(--dsw-alias-border-l3)",
								},
							})
						: null,
					jsx("span", {
						style: { display: "inline-flex", alignItems: "center", justifyContent: "center" },
						children,
					}),
				],
			});
		}

		/**
		 * The mark inside its ring, at the size the seat asked for. The ring owns
		 * the seat's full square and the artwork sits at 62% of it, so taking the
		 * ring costs the mark a little presence and costs the layout nothing.
		 */
		function RingedMark({ size, className }) {
			const { jsx } = require("react/jsx-runtime");
			const edge = typeof size === "number" && Number.isFinite(size) ? size : 24;
			return jsx(SealRing, { size: edge, children: jsx(StratumMark, { size: Math.round(edge * 0.62), className }) });
		}

		function StratumMark({ size, className }) {
			let jsxRuntime;
			try {
				jsxRuntime = require("react/jsx-runtime");
			} catch {
				return null;
			}
			if (typeof jsxRuntime?.jsx !== "function") return null;
			const { jsx, jsxs } = jsxRuntime;
			return jsxs("svg", {
				xmlns: "http://www.w3.org/2000/svg",
				viewBox: "0 0 48 44",
				width: size,
				height: size,
				className,
				"aria-hidden": true,
				focusable: "false",
				children: [
					jsx("path", { d: MARK_LAYERS.top, fill: "currentColor" }, "top"),
					...MARK_LAYERS.lines.map((d, index) =>
						jsx("path", { d, fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" }, `l${index}`),
					),
				],
			});
		}

		/**
		 * Report anything missing from the host's React seam. Resolution happens
		 * here rather than at factory scope so that an unresolvable module is
		 * reported by name instead of throwing before this check can run.
		 * @returns whether the seam is usable.
		 */
		function checkHostReactSeam() {
			let jsxRuntime;
			try {
				jsxRuntime = require("react/jsx-runtime");
			} catch (error) {
				console.error(
					"@stratum/dsh-client-ui-base: the host did not supply react/jsx-runtime — no Stratum panel can render",
					error,
				);
				return false;
			}
			const missing = REQUIRED_JSX_EXPORTS.filter((name) => jsxRuntime?.[name] === undefined);
			if (missing.length > 0) {
				console.error(
					`@stratum/dsh-client-ui-base: the host's react/jsx-runtime is missing ${missing.join(", ")} — Stratum panels will not render correctly`,
				);
				return false;
			}
			return true;
		}

		let rpcCounter = 0;

		/**
		 * Call one host RPC method over the same wire the client SDK uses, without
		 * requiring this bundler-free package to ship a copy of that SDK.
		 * @param method - dotted RPC method name, e.g. "agentPreset.list".
		 * @param payload - the method's request payload.
		 * @returns the envelope's `result` — `{ ok: true, value }` or `{ ok: false, error }`.
		 */
		function callApi(method, payload) {
			rpcCounter += 1;
			const rpcId = `st-${Date.now().toString(36)}-${String(rpcCounter)}`;
			return fetch(`/api/${method}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
			})
				.then((response) => response.json())
				.then((body) => body.result)
				.catch((error) => ({ ok: false, error: { message: String(error) } }));
		}

		/**
		 * Build the hero task-type picker component. Built inside a function
		 * (rather than at module scope) so every host module it needs is resolved
		 * once, at mount time, alongside the React seam check.
		 * @returns the component.
		 */
		function buildTaskTypeIndicator() {
			const { useEffect, useState } = require("react");
			const { jsx, jsxs } = require("react/jsx-runtime");
			const { IconAgentPresetOutline16 } = require("@deepseek-ai/dsh-client-ui-primitives");

			const INITIAL = { status: "loading", label: "" };

			/**
			 * The hero's task-type indicator: shows which task type is active, and
			 * offers no way to change it.
			 *
			 * Story 1.4 originally shipped this seat as a dropdown the operator picked
			 * from. That was corrected on 28 Aug 2026: SIH26117 asks for a system that
			 * "automatically picks the right one for a given task", and a control that
			 * asks the operator to classify the task is the human doing the router's
			 * job. It also collided with Story 3.7's routing chip at
			 * `conversation.input.model` — a different seat — so the two would have
			 * shipped side by side making opposite claims about the same decision.
			 *
			 * The read path below is the new-session task type only. It does not
			 * track the router mid-session: the hero is gone by the time a turn
			 * reclassifies (see the file header). Story 3.8's "shows it moving"
			 * surface is the routing chip at `conversation.input.model`.
			 *
			 * Rendered as a bare inherited element rather than a `Button`. There is no
			 * tag or badge primitive in the harness, a `Button` with no handler still
			 * reads as clickable, and a disabled one reads as broken. An unstyled
			 * element inherits the hero's own typography and density, which is what the
			 * design rule asks for and costs no hand-rolled colour, radius or spacing.
			 * @returns the indicator, or null while loading and when the deployment
			 * authors no Stratum preset.
			 */
			function TaskTypeIndicator() {
				const [state, setState] = useState(INITIAL);

				useEffect(() => {
					let cancelled = false;
					callApi("agentPreset.list", {}).then((result) => {
						if (cancelled || !result.ok) return;
						const ours = result.value.presets.filter(
							(preset) => preset.trust === "user" && preset.broken === undefined,
						);
						if (ours.length === 0) return;
						const active = ours.find((preset) => preset.isDefault) ?? ours[0];
						setState({ status: "ready", label: active.name ?? active.id });
					});
					return () => {
						cancelled = true;
					};
				}, []);

				if (state.status !== "ready") return null;

				return jsxs("span", {
					title: "Task type, selected by the router. Stratum classifies the request; there is nothing here to set.",
					children: [jsx(IconAgentPresetOutline16, {}), " ", state.label],
				});
			}

			return TaskTypeIndicator;
		}

		/**
		 * Plain-words disclosure for each model-plane provider. Keyed by the
		 * provider token the host half selects (`config.modelPlane.provider`) and
		 * reports back through `llm.providers`.
		 *
		 * The `replay` wording is load-bearing: it says "replay" outright, and it
		 * says the responses are *authored* rather than captured, because for
		 * Phase 0 there is no `local` run to capture from (ADR-0001 amendment,
		 * 28 August 2026). None of these read as a warning or an apology — the
		 * pill states the operating mode the way an instrument states a reading.
		 */
		const PROVIDER_DISCLOSURE = {
			replay: {
				label: "Replay — authored responses",
				title:
					"Stratum is answering from the replay provider: stored responses authored by hand for this Phase 0 build, served in place of live model inference and disclosed here as the operating mode. Per the 28 August 2026 amendment to ADR-0001 there is no local run to capture from yet, so replacing an authored response with a captured one later is a data change, not a code change.",
			},
			local: {
				label: "Local — offline inference",
				title:
					"Stratum is answering from the local provider: llama.cpp on this machine, with no network path off the box.",
			},
			remote: {
				label: "Remote — development only",
				title:
					"Stratum is answering from the remote provider: a rented GPU used only during development. ADR-0001 keeps it out of every demo and recording.",
			},
		};

		/**
		 * Build the header's active-provider disclosure.
		 *
		 * A read-only pill, never a control: which provider answers is a
		 * `cordis.patch.yml` value (`config.modelPlane.provider`), not something
		 * an operator sets from the UI. Built inside a function so every host
		 * module it needs is resolved once, at mount time.
		 * @returns the component.
		 */
		function buildProviderDisclosure() {
			const { useEffect, useState } = require("react");
			const { jsx, jsxs } = require("react/jsx-runtime");
			const { Pill, StateDot } = require("@deepseek-ai/dsh-client-ui-primitives");

			/**
			 * The active model-plane provider, named without a menu.
			 *
			 * Reads the host's `llm.providers` directory and finds the Stratum
			 * adapter by its `Stratum (<provider>)` display name — the
			 * shape `createLlmAdapter` gives it in `model-plane/llm-adapter.js`.
			 * Renders nothing until that lookup resolves and nothing if it fails:
			 * an unproven provider name is worse than an absent pill (NFR8).
			 * @returns the pill, or null.
			 */
			function ProviderDisclosure() {
				const [provider, setProvider] = useState(null);

				useEffect(() => {
					let cancelled = false;
					callApi("llm.providers", {}).then((result) => {
						if (cancelled || !result.ok) return;
						const ours = result.value.providers.find(
							(row) =>
								typeof row.displayName === "string" &&
								row.displayName.startsWith("Stratum (") &&
								row.active === true,
						);
						if (ours) setProvider(ours.provider);
					});
					return () => {
						cancelled = true;
					};
				}, []);

				if (provider === null) return null;

				const disclosure = PROVIDER_DISCLOSURE[provider] ?? {
					label: `Model plane — ${provider}`,
					title: `Stratum is answering from the ${provider} provider.`,
				};

				return jsx(Pill, {
					children: jsxs("span", {
						title: disclosure.title,
						style: { display: "inline-flex", alignItems: "center", gap: "4px" },
						children: [jsx(StateDot, { state: "done", size: 8 }), disclosure.label],
					}),
				});
			}

			return ProviderDisclosure;
		}

		/**
		 * The plugin-owned session event the host half's router appends per turn
		 * (Story 3.6, `index.js` `ROUTED_EVENT`). Its data is the whole
		 * `RoutingDecision`: `{ taskType, scored, excluded, selected, tied, allZero }`.
		 */
		const ROUTED_EVENT = "router/routed";

		/**
		 * The conversation view target and Definition kind the routing chip reads.
		 * The Definition folds every `router/routed` event into a node; the view
		 * builder keeps the one from the latest turn (highest `anchorSeq`), which
		 * is the decision the chip shows.
		 */
		const ROUTING_VIEW_TARGET = "st-routing";
		const ROUTING_DEFINITION_KIND = "st-routing";

		/**
		 * View builder for {@link ROUTING_VIEW_TARGET}: retains the routing
		 * decision from the highest-seq `router/routed` node it has seen. Routing
		 * events are append-only and one-per-turn, so "highest seq" is "latest
		 * turn" and an older node never supersedes a newer one.
		 * @returns a `ConversationViewBuilder` — `{ empty, replace, apply }`.
		 */
		function createRoutingViewBuilder() {
			const empty = { decision: null };
			let bestSeq = -1;
			let snapshot = empty;
			function consider(node) {
				if (node && typeof node.anchorSeq === "number" && node.anchorSeq >= bestSeq) {
					bestSeq = node.anchorSeq;
					snapshot = { decision: node.data };
				}
			}
			return {
				empty,
				replace(input) {
					bestSeq = -1;
					snapshot = empty;
					for (const node of input.nodes) consider(node);
					return snapshot;
				},
				apply(input) {
					for (const node of input.upserts) consider(node);
					return snapshot;
				},
			};
		}

		/** The view Definition registered with `ctx.conversationViews`. */
		const routingViewDefinition = {
			target: ROUTING_VIEW_TARGET,
			create: createRoutingViewBuilder,
		};

		/**
		 * The event Definition registered with `ctx.conversationEvents`. A
		 * single-event business: each `router/routed` event is its own Context,
		 * keyed by the event's own seq, and carries the whole decision as state.
		 */
		const routingNodeDefinition = {
			kind: ROUTING_DEFINITION_KIND,
			target: ROUTING_VIEW_TARGET,
			match(event) {
				return event && event.type === ROUTED_EVENT
					? { id: String(event.seq), role: "start" }
					: null;
			},
			start(_context, match) {
				return match.event.data;
			},
			update(context) {
				return context.state;
			},
			buildViewNode(context) {
				if (context.state === undefined) return null;
				return {
					key: context.key,
					kind: ROUTING_DEFINITION_KIND,
					id: context.id,
					target: ROUTING_VIEW_TARGET,
					anchorSeq: context.start?.event?.seq ?? 0,
					data: context.state,
				};
			},
		};

		/**
		 * Drop the `Qwen/` org prefix for the chip's compact surfaces; the full
		 * id still rides `title` attributes and the expanded rows.
		 * @param name - a fleet member id, e.g. `Qwen/Qwen2.5-VL-7B-Instruct`.
		 */
		function shortMemberName(name) {
			if (typeof name !== "string") return String(name ?? "");
			const slash = name.lastIndexOf("/");
			return slash >= 0 ? name.slice(slash + 1) : name;
		}

		/**
		 * Build the `Menu` entries that show the router's working: the classified
		 * task type, one scored row per fleet member (the selected one carries the
		 * check), and one row per member filtered out before scoring with its
		 * reason. Everything is `Menu` primitive chrome; only flexbox layout and
		 * `ui-theme` colour tokens are set inline.
		 * @param decision - the `RoutingDecision` from the `router/routed` event.
		 * @param jsx - host `react/jsx-runtime` `jsx`.
		 * @param jsxs - host `react/jsx-runtime` `jsxs`.
		 * @returns `MenuEntry[]`.
		 */
		function buildRoutingMenuItems(decision, jsx, jsxs) {
			const SECONDARY = { color: "var(--dsw-alias-label-secondary)" };
			const items = [];

			// `tied` / `allZero` come straight from the scorer (Story 3.6): a
			// score tie is broken by fleet declaration order, and `allZero` means
			// no eligible member declared a capability this task type scores.
			const taskNotes = [];
			if (decision.tied) taskNotes.push("score tie — broken by fleet order");
			if (decision.allZero) taskNotes.push("no strong match");
			const taskLabel =
				(TASK_LABELS[decision.taskType] ?? decision.taskType) + (taskNotes.length > 0 ? ` (${taskNotes.join("; ")})` : "");
			items.push({ type: "label", id: "st-r-task-h", text: "Task type — classified by the router" });
			items.push({ type: "label", id: "st-r-task", text: taskLabel });

			items.push({ type: "separator", id: "st-r-s1" });
			items.push({ type: "label", id: "st-r-scored-h", text: "Fleet — score per member" });
			const scored = Array.isArray(decision.scored) ? decision.scored : [];
			if (scored.length === 0) {
				items.push({ type: "label", id: "st-r-scored-none", text: "No fleet member was eligible to score" });
			}
			for (const member of scored) {
				const matched = Array.isArray(member.matched) ? member.matched : [];
				const working =
					matched.length > 0
						? matched.map((hit) => `${hit.capability} +${hit.points}`).join(" · ")
						: decision.allZero
							? "no scored capability — first eligible member selected"
							: "no scored capability";
				items.push({
					id: `st-r-score:${member.name}`,
					label: jsxs("span", {
						title: `${member.name} — score ${member.score}`,
						style: { display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 },
						children: [
							jsx("span", { style: { flex: "1 1 auto", minWidth: 0 }, children: shortMemberName(member.name) }),
							jsx("span", { style: SECONDARY, children: `score ${member.score}` }),
						],
					}),
				});
				items.push({ type: "label", id: `st-r-score-w:${member.name}`, text: working });
			}

			const excluded = Array.isArray(decision.excluded) ? decision.excluded : [];
			if (excluded.length > 0) {
				items.push({ type: "separator", id: "st-r-s2" });
				items.push({ type: "label", id: "st-r-excl-h", text: "Filtered out before scoring" });
				for (const member of excluded) {
					const reason = member.reason || {};
					items.push({
						id: `st-r-excl:${member.name}`,
						label: jsx("span", {
							title: reason.detail || reason.code || "",
							style: { display: "block", minWidth: 0 },
							children: shortMemberName(member.name),
						}),
					});
					items.push({
						type: "label",
						id: `st-r-excl-r:${member.name}`,
						text: reason.detail || reason.code || "excluded before scoring",
					});
				}
			}

			// The rows are informational; nothing is selectable. A member row is
			// kept as an `item` only so the trailing check can mark the selected
			// member — the working lines below each are `label` entries, which the
			// primitive renders as wrapping tertiary text.
			return items;
		}

		/**
		 * Build the routing chip component for the `conversation.input.model`
		 * seat. Built inside a function so every host module it needs is resolved
		 * once, at mount time, alongside the React-seam check.
		 * @param ctx - client root context, carrying `sessions`.
		 * @returns the component.
		 */
		function buildRoutingChip(ctx) {
			const { useState, useSyncExternalStore } = require("react");
			const { jsx, jsxs } = require("react/jsx-runtime");
			const { Pill, StateDot, Menu } = require("@deepseek-ai/dsh-client-ui-primitives");

			const NO_DECISION = null;

			/**
			 * Subscribe to the session's `st-routing` view and return the latest
			 * routing decision, or null before the first turn records one.
			 *
			 * This is the whole of Story 3.8's client side: the host half appends a
			 * fresh `router/routed` event on the first step of every turn (Story 3.6),
			 * the `st-routing` view builder folds each into a node and keeps the
			 * highest-seq one, and `useSyncExternalStore` re-renders the chip whenever
			 * that snapshot changes. So when turn N+1 classifies as a different task
			 * type, the chip's trigger and its expanded working move to the newly
			 * selected member with no user action — driven by a recorded event, never
			 * an animation (NFR8).
			 * @param sessionId - the framework-resolved session id from the slot.
			 */
			function useRoutingDecision(sessionId) {
				const session = ctx.sessions?.binding?.(sessionId)?.session ?? null;
				return useSyncExternalStore(
					(onChange) => (session ? session.subscribe(onChange) : () => {}),
					() => {
						if (!session) return NO_DECISION;
						const view = session.getSnapshot().views.get(ROUTING_VIEW_TARGET);
						return (view && view.decision) || NO_DECISION;
					},
				);
			}

			/**
			 * The routing chip. Trigger names the selected fleet member (or
			 * "Auto-routing" before a turn records a decision); clicking it opens
			 * the working. A `single` slot with nothing to show renders a quiet
			 * non-interactive pill rather than null, so the seat the stock picker
			 * used to hold is never visibly empty.
			 * @returns the chip.
			 */
			function RoutingChip(props) {
				const decision = useRoutingDecision(props.sessionId);
				const [open, setOpen] = useState(false);
				const locked = props.locked === true;

				const selected = decision && typeof decision.selected === "string" ? decision.selected : null;
				const taskName = decision && typeof decision.taskType === "string" ? (TASK_LABELS[decision.taskType] ?? decision.taskType) : null;
				const label = selected ? `${taskName ? `${taskName} · ` : ""}${shortMemberName(selected)}` : "Auto-routing";
				const canOpen = decision !== NO_DECISION && !locked;

				const anchor = jsx(Pill, {
					active: open,
					onClick: canOpen ? () => setOpen((v) => !v) : undefined,
					"aria-haspopup": canOpen ? "menu" : undefined,
					"aria-expanded": canOpen ? open : undefined,
					disabled: locked,
					title: selected
						? `The router classified this as ${taskName ?? "a task"} and picked ${selected}. Open for the score per fleet member.`
						: "The router picks a fleet member from its classifier score once the first turn runs.",
					children: jsxs("span", {
						style: { display: "inline-flex", alignItems: "center", gap: "6px" },
						children: [
							selected ? jsx(StateDot, { state: "done", size: 8 }) : null,
							label,
						],
					}),
				});

				if (!canOpen) return anchor;

				return jsx(Menu, {
					open,
					anchor,
					items: buildRoutingMenuItems(decision, jsx, jsxs),
					selectedId: `st-r-score:${selected}`,
					onSelect: () => {},
					onClose: () => setOpen(false),
					side: "top",
					align: "end",
					portal: true,
				});
			}

			return RoutingChip;
		}

		/* ---------------------------------------------------------------------
		 * Egress monitor (Story 2.2)
		 *
		 * The always-on display of outbound attempts (CONTEXT.md "Egress
		 * monitor"). Two seats: a compact chip in
		 * `conversation.session.header.utilities` (list, session) and a full
		 * panel in `shell.overlay` (list, root). Both read one number — the
		 * count of `egress/denied` session events the denial waterfall appends
		 * (host half, `index.js`) — folded through a registered conversation
		 * view. The zero is `that fold's node count`, never a literal (FR15),
		 * and it moves only on a real recorded denial, never an animation
		 * (NFR8). The request an operator types is what first makes it non-zero on
		 * stage — "open WhatsApp", refused before it runs.
		 *
		 * This replaces the 27 August spike's the earlier egress spike
		 * (hand-written greens, a hand-rolled pill — the counter-example the UI
		 * rules exist to prevent, UX-DR7). Nothing here sets a colour: `StateDot`
		 * carries the green/red state through `--dsw-*` tokens, `Pill` and
		 * `Button` are shipped primitives, and the panel's surface uses only
		 * `ui-theme` background/border/shadow tokens.
		 *
		 * Story 2.4 makes the full panel the audit surface as well as the
		 * instrument: the same fold that produces the count also carries every
		 * denial's timestamp, tool and refused target, and the panel lists them
		 * oldest first. The decision to extend this panel rather than declare a
		 * separate audit seat is recorded in the story's spec — an evaluator who
		 * asks "show me" is already looking at the monitor, and a second surface
		 * showing the same events would be two places to keep in step.
		 * ------------------------------------------------------------------- */

		/**
		 * The four markers the host half appends, mapped to the short kind each
		 * audit line is rendered from. The monitor used to fold one of them —
		 * `egress/denied` — which made it a record of this system's own
		 * successes and nothing else. It now folds the seal being opened and
		 * closed, the calls the open seal let through, and what became of them.
		 *
		 * That is the difference between an instrument and a claim. A count of
		 * denials, on its own, cannot be told apart from a count taken while
		 * nothing was being enforced; a list that also shows the seal opening at
		 * 14:32 and a call reaching the internet at 14:33 is a log that tells on
		 * itself, and an evaluator can read it as evidence rather than as
		 * decoration.
		 */
		const EGRESS_EVENT_KINDS = {
			"egress/denied": "denied",
			"egress/permitted": "permitted",
			"egress/escaped": "escaped",
			"egress/seal": "seal",
		};
		const EGRESS_VIEW_TARGET = "st-egress";
		const EGRESS_DEFINITION_KIND = "st-egress";

		/** The seal's loopback channel. */
		const SEAL_CHANNEL = "/st-seal";

		/**
		 * View builder for {@link EGRESS_VIEW_TARGET}. Keeps one node per
		 * `egress/denied` event (keyed, so replay is idempotent) and reports
		 * `count` as the number of those nodes — derived by counting, not
		 * written down — alongside `entries`, the denials themselves in the
		 * order the log wrote them (Story 2.4), and the most recent one for the
		 * panel's summary line.
		 * @returns a `ConversationViewBuilder` — `{ empty, replace, apply }`.
		 */
		function createEgressViewBuilder() {
			/**
			 * @param nodes - the retained denial nodes.
			 * @returns `{ count, entries, latest }` — `entries` sorted by the
			 * log's own sequence number, so they read in the order they were
			 * written however they arrived; `count` is `entries.length`.
			 */
			function summarise(nodes) {
				const entries = nodes
					.map((node) => {
						const data = (node && node.data) || {};
						const anchorSeq = node && typeof node.anchorSeq === "number" ? node.anchorSeq : null;
						const seq = anchorSeq ?? (typeof data.seq === "number" ? data.seq : -1);
						return { ...data, seq };
					})
					.sort((a, b) => a.seq - b.seq);
				// `count` stays the number of DENIALS, not of entries: it is what the
				// chip has always shown and what FR15's counted zero means. The other
				// kinds are counted separately rather than folded into it, because a
				// single number that rose whether the seal stopped a call or waved it
				// through would be worse than no number at all.
				return {
					count: entries.filter((entry) => entry.kind === "denied").length,
					permitted: entries.filter((entry) => entry.kind === "permitted").length,
					escaped: entries.filter((entry) => entry.kind === "escaped" && entry.reached === true).length,
					entries,
					latest: entries.length > 0 ? entries[entries.length - 1] : null,
				};
			}
			let seen = new Map();
			function keyOf(node) {
				return node && (node.key ?? node.id);
			}
			return {
				empty: summarise([]),
				replace(input) {
					seen = new Map();
					for (const node of input.nodes) {
						const key = keyOf(node);
						if (key !== undefined && key !== null) seen.set(key, node);
					}
					return summarise([...seen.values()]);
				},
				apply(input) {
					for (const node of input.upserts) {
						const key = keyOf(node);
						if (key !== undefined && key !== null) seen.set(key, node);
					}
					return summarise([...seen.values()]);
				},
			};
		}

		/** The view Definition registered with `ctx.conversationViews`. */
		const egressViewDefinition = {
			target: EGRESS_VIEW_TARGET,
			create: createEgressViewBuilder,
		};

		/**
		 * The event Definition registered with `ctx.conversationEvents`: each
		 * `egress/denied` event is its own Context, keyed by its seq, carrying
		 * `{ tool, target }` as state.
		 */
		const egressNodeDefinition = {
			kind: EGRESS_DEFINITION_KIND,
			target: EGRESS_VIEW_TARGET,
			match(event) {
				return event && EGRESS_EVENT_KINDS[event.type] !== undefined
					? { id: String(event.seq), role: "start" }
					: null;
			},
			// Story 2.4 keeps the envelope's own `time` and `seq` alongside the
			// event's `{ tool, target }` data. `SessionEvent` carries both (unix
			// epoch milliseconds and the monotonic log sequence), so the audit
			// line on screen reads the timestamp the log recorded rather than a
			// second clock reading taken when the panel happened to render.
			start(_context, match) {
				const data = match.event.data || {};
				return {
					kind: EGRESS_EVENT_KINDS[match.event.type],
					tool: data.tool,
					target: data.target,
					// `egress/seal`: whether the seal ended up closed.
					// `egress/escaped`: whether the call actually arrived.
					sealed: data.sealed,
					reached: data.reached,
					detail: data.detail,
					time: typeof match.event.time === "number" ? match.event.time : null,
					seq: typeof match.event.seq === "number" ? match.event.seq : null,
				};
			},
			update(context) {
				return context.state;
			},
			buildViewNode(context) {
				if (context.state === undefined) return null;
				return {
					key: context.key,
					kind: EGRESS_DEFINITION_KIND,
					id: context.id,
					target: EGRESS_VIEW_TARGET,
					anchorSeq: context.start?.event?.seq ?? 0,
					data: context.state,
				};
			},
		};

		/**
		 * A tiny observable holding whether the full egress panel is open. The
		 * chip toggles it; the panel renders on it. Module-scoped so the two
		 * seats — which sit in different slot scopes and never share props —
		 * see the same value. Hand-rolled rather than pulled from
		 * `dsh-client-runtime/client` because a value import of that package
		 * from a plugin bundle inlines a second module instance (its README's
		 * documented boundary).
		 */
		function createOpenStore() {
			let open = false;
			const listeners = new Set();
			function emit() {
				for (const listener of listeners) listener();
			}
			return {
				get: () => open,
				set(next) {
					if (next === open) return;
					open = next;
					emit();
				},
				toggle() {
					open = !open;
					emit();
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			};
		}

		const drawerOpen = createOpenStore();

		/**
		 * How wide the Sovereignty drawer is, in pixels, and the one thing about
		 * this UI the operator gets to keep.
		 *
		 * A fixed width is a guess about a screen we do not own. The ledger's lines
		 * are URLs and command text — the two kinds of string with no natural
		 * wrapping point — so the reader who most needs this panel is exactly the
		 * reader for whom our guess is too narrow, and on a projector at 1280 the
		 * same number is too wide. So it is a drag, and it is remembered.
		 *
		 * Persisted to `localStorage` rather than to the harness's own settings:
		 * this is a per-machine display preference, not deployment state, and it
		 * must never be a reason a profile fails to load. Every read and write is
		 * wrapped — a browser with site data blocked throws on access rather than
		 * returning null, and a drawer that cannot remember its width is a much
		 * smaller problem than a panel that will not render.
		 */
		const DRAWER_WIDTH_KEY = "stratum.sovereignty.width";
		const DRAWER_MIN_WIDTH = 300;
		const DRAWER_MAX_WIDTH = 720;
		const DRAWER_DEFAULT_WIDTH = 380;

		function clampWidth(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return DRAWER_DEFAULT_WIDTH;
			return Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, Math.round(value)));
		}

		function createWidthStore() {
			let width = DRAWER_DEFAULT_WIDTH;
			try {
				const stored = globalThis.localStorage?.getItem(DRAWER_WIDTH_KEY);
				if (stored !== null && stored !== undefined) width = clampWidth(Number(stored));
			} catch {
				// Site data blocked, or a private window. The default is a fine answer.
			}
			const listeners = new Set();
			return {
				get: () => width,
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				/** Set the width without writing it down — called for every pointer move. */
				set(next) {
					const clamped = clampWidth(next);
					if (clamped === width) return;
					width = clamped;
					for (const listener of listeners) listener();
				},
				/** Write the current width down — called once, when the drag ends. */
				commit() {
					try {
						globalThis.localStorage?.setItem(DRAWER_WIDTH_KEY, String(width));
					} catch {
						// Same reasoning as the read: not remembering is not a failure.
					}
				},
			};
		}

		const drawerWidth = createWidthStore();

		/**
		 * Inset the application by the drawer's width while it is open.
		 *
		 * The drawer is a reading surface, not a popover: an evaluator has it open
		 * while they type the request that fills it, and a panel that covers the
		 * transcript is a panel they close before the interesting part happens. So
		 * the app gives up the width rather than being covered by it.
		 *
		 * `#root` is the harness's own mount node (`document.getElementById("root")`
		 * in its web boot), and padding it is the least invasive way to reach the
		 * whole frame: ui-layout's AppFrame fills it, and nothing of ours has to
		 * know the frame's internal structure or its build-hashed class names. The
		 * drawer itself is `position: fixed`, so it sits in the strip the padding
		 * reclaims. One rule, one job — the same technique the hero headline is
		 * hidden with.
		 */
		let insetStyleNode = null;
		function applyInset(pixels) {
			if (typeof document === "undefined" || !document.head) return;
			if (insetStyleNode === null) {
				insetStyleNode = document.createElement("style");
				insetStyleNode.dataset.Stratum = "drawer-inset";
				document.head.appendChild(insetStyleNode);
			}
			insetStyleNode.textContent =
				pixels > 0 ? `#root { box-sizing: border-box; padding-right: ${pixels}px; }` : "";
		}
		function disposeInset() {
			insetStyleNode?.remove();
			insetStyleNode = null;
		}

		/**
		 * The seal's state, as this client understands it, plus the only route
		 * this client has to change it.
		 *
		 * The seal itself lives on the host (`egress/seal.js`) — process-wide,
		 * closed at boot, never persisted open. This store is a cache of it,
		 * seeded by asking on mount so a reloaded page shows the truth rather
		 * than an assumption, and updated from what the host answers rather than
		 * from what the button hoped would happen. A control that moved its own
		 * indicator and then told the host would be able to show "sealed" while
		 * the machine was open, which is the one lie this panel must not be
		 * capable of.
		 *
		 * `known` stays false until the host has answered once. Until then the
		 * UI says it does not know yet, rather than assuming the safe answer and
		 * showing a reassurance it has not earned.
		 */
		function createSealStore() {
			let state = { sealed: true, known: false, busy: false };
			let connection = null;
			const listeners = new Set();
			function emit() {
				for (const listener of listeners) listener();
			}
			function set(next) {
				state = { ...state, ...next };
				emit();
			}
			async function call(endpoint, sessionId) {
				if (!connection) return;
				set({ busy: true });
				try {
					const result = await connection.rpc.call(SEAL_CHANNEL, endpoint, sessionId ? { sessionId } : {});
					if (result?.ok === true && typeof result.value?.sealed === "boolean") {
						set({ sealed: result.value.sealed, known: true, busy: false });
						return;
					}
					set({ busy: false });
				} catch (error) {
					console.warn(
						`@stratum/dsh-client-ui-base: the seal did not answer — ${error instanceof Error ? error.message : String(error)}`,
					);
					set({ busy: false });
				}
			}
			return {
				get: () => state,
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				/** Point the store at the host transport, and read the seal once. */
				bind(next) {
					connection = next;
					void call("get");
				},
				/**
				 * Ask the host to open or close the seal.
				 * @param sealed - true to close it, false to open it.
				 * @param sessionId - the session to record the change on, when there is one.
				 */
				request(sealed, sessionId) {
					return call(sealed ? "close" : "open", sessionId);
				},
			};
		}

		const seal = createSealStore();

		/**
		 * The host transport, once the client root has one.
		 *
		 * The drawer is registered unconditionally — the monitor is worth more than
		 * any detail inside it, and a client with no transport must still be able to
		 * read the ledger its own session log produced. But two sections of it (the
		 * residency read and the log export's provider line) do need the host, so
		 * they ask this rather than being gated behind an `inject` that would take
		 * the whole drawer down with them.
		 */
		let hostConnection = null;

		/**
		 * The host's command directory, once the client root has one.
		 *
		 * `remote.commands` is a service the client runtime declares and injects
		 * (`@deepseek-ai/dsh-client-runtime`: `inject = ["connection", "typert",
		 * "remote", "remote.commands"]`), and it is what
		 * `@deepseek-ai/dsh-client-ui-commands` reads the `/` directory through.
		 *
		 * Held module-scoped and reached through its own nested `inject`, rather
		 * than named alongside `connection` in one gate: Cordis only puts injected
		 * services on the context, so asking for both together would mean a client
		 * without `remote` loses the composer menu and the seal binding as well.
		 * Absent, the menu opens with the document alone.
		 */
		let commandDirectory = null;

		/**
		 * The clock reading for one audit line, from the `time` the harness
		 * stamped on the denial event. Local wall time with seconds, because an
		 * evaluator reads it against the moment the request was refused. Renders
		 * an em dash rather than inventing a time when the record carries none.
		 * @param time - unix epoch milliseconds, or null.
		 */
		function denialClock(time) {
			if (typeof time !== "number" || !Number.isFinite(time)) return "—";
			return new Date(time).toLocaleTimeString();
		}

		/**
		 * The same instant as a full ISO 8601 stamp, for the audit line's
		 * `title` — the unambiguous form, next to the readable one.
		 * @param time - unix epoch milliseconds, or null.
		 */
		function denialStamp(time) {
			if (typeof time !== "number" || !Number.isFinite(time)) return "no timestamp recorded";
			return new Date(time).toISOString();
		}

		/**
		 * Read the folded egress snapshot for a session, or null when the view
		 * is not ready yet. `count` on a ready snapshot is the counted number
		 * of denial events — this function never invents one.
		 * @param session - a session face, or null.
		 */
		/**
		 * One audit entry, in the words an evaluator reads on screen.
		 *
		 * Plain sentences rather than event names: the person this list has to
		 * convince is a domain expert reading it once, over someone's shoulder,
		 * without a glossary. "Refused" and "Reached the internet" are readable
		 * from across a room; `egress/escaped { reached: true }` is not.
		 *
		 * A field the record does not carry is named as missing rather than
		 * filled in — an audit surface that invents a value is worse than one
		 * that admits a gap.
		 * @param entry - one folded entry from the `st-egress` view.
		 * @returns `{ headline, detail }`, both plain text.
		 */
		function describeEntry(entry) {
			const tool = typeof entry.tool === "string" && entry.tool !== "" ? entry.tool : "an unrecorded tool";
			const target =
				typeof entry.target === "string" && entry.target !== "" ? entry.target : "an unrecorded target";
			switch (entry.kind) {
				case "seal":
					return entry.sealed === false
						? {
								headline: "Seal opened",
								detail: "Stratum stopped denying outbound calls. Recorded here because the operator did it.",
							}
						: { headline: "Seal closed", detail: "Outbound calls are denied again." };
				case "permitted":
					return {
						headline: "Permitted — the seal was open",
						detail: `${tool} was allowed to reach ${target}. Nothing in this application stood in its way.`,
					};
				case "escaped":
					return entry.reached === true
						? {
								headline: "Reached the internet",
								detail: `${target} answered. The seal was open and nothing else stopped this call.`,
							}
						: {
								headline: "Left the application — stopped outside it",
								detail: `${target} was attempted and nothing came back. ${
									typeof entry.detail === "string" && entry.detail !== "" ? entry.detail : "No response."
								} Whatever refused this was not Stratum.`,
							};
				default:
					return {
						headline: "Denied",
						detail: `${tool} tried to reach ${target}. Stratum denied it before it ran.`,
					};
			}
		}

		function readEgressSnapshot(session) {
			if (!session) return null;
			const view = session.getSnapshot().views.get(EGRESS_VIEW_TARGET);
			return view || null;
		}

		/**
		 * Build the permanent seal row for `sidebar.footer.action`.
		 *
		 * WHY IT MOVED. Until 30 August 2026 this was a `Pill` in
		 * `conversation.session.header.utilities` — a slot scoped *session*, so the
		 * header it sat in did not exist until a conversation did. The one claim
		 * this product rests on was therefore missing from the new-session screen:
		 * the first thing an evaluator sees, and the moment the workbench
		 * introduces itself. That was not a styling problem with a styling fix; it
		 * was the wrong scope.
		 *
		 * `sidebar.footer.action` is a `list` slot scoped `root`, declared by
		 * `@deepseek-ai/dsh-client-ui-sidebar` and rendered beside Settings at the
		 * sidebar foot (read from that package's own slot declaration, 30 Aug 2026).
		 * Root scope is the whole point rather than a convenience: the seal is a
		 * property of this installation's outbound access, not of one conversation,
		 * so the shell is where it is *true*, and being always on screen falls out
		 * of that rather than being arranged.
		 *
		 * It states one thing and counts one number. The ledger, the switch and
		 * everything about the machine are in the drawer it opens.
		 *
		 * The count does not turn the row red and leave it red. A denial is the seal
		 * doing its job, and a permanent alarm colour for good news is an alarm
		 * colour nobody reads by the third minute; the standing colour states the
		 * seal and nothing else. A fresh denial is loud for a few seconds — see
		 * `useRecentIncrease` — and then it is a number in a list.
		 * @param ctx - client root context, carrying `sessions`.
		 * @returns the component.
		 */
		function buildSealFootRow(ctx) {
			const { useEffect, useRef, useState, useSyncExternalStore } = require("react");
			const { jsx, jsxs } = require("react/jsx-runtime");
			const { StateDot, Tooltip } = require("@deepseek-ai/dsh-client-ui-primitives");

			/**
			 * True for a few seconds after `value` goes up, false otherwise.
			 *
			 * The moment a denial lands has to be visible from the back of a room
			 * without leaving a mark on the interface afterwards. This is the "for a
			 * few seconds" half; the notice at the top of the window is the loud half.
			 */
			function useRecentIncrease(value, scope) {
				// `scope` is the session the value belongs to. Without it this fires on
				// a session switch, because the count of another conversation's denials
				// is a different number and a bigger one reads as a fresh refusal — the
				// same defect `DenialNotice` carried until 31 August 2026. Changing
				// scope re-seats the baseline instead of flashing it.
				const previous = useRef({ scope, value });
				const [recent, setRecent] = useState(false);
				useEffect(() => {
					const before = previous.current;
					previous.current = { scope, value };
					if (before.scope !== scope) return undefined;
					if (typeof value !== "number" || typeof before.value !== "number" || value <= before.value) return undefined;
					setRecent(true);
					const timer = setTimeout(() => setRecent(false), 6000);
					return () => clearTimeout(timer);
				}, [scope, value]);
				return recent;
			}

			/**
			 * The row. `wide` is the sidebar's own fold state, handed to every footer
			 * action: true for the full column, false for the 56px rail. The rail form
			 * is the dot alone, because that is the whole shelf there is — and the
			 * `Tooltip` that names it is the same one the sidebar puts on its own
			 * controls when it is collapsed, so a collapsed Stratum behaves like a
			 * collapsed harness.
			 */
			function SealFootRow(props) {
				const wide = props?.wide !== false;
				const [hot, setHot] = useState(false);
				const sealState = useSyncExternalStore(seal.subscribe, seal.get);
				const list = ctx.sessions?.list ?? null;
				const current = useSyncExternalStore(
					(onChange) => (list ? list.subscribe(onChange) : () => {}),
					() => (list ? list.getSnapshot().current ?? null : null),
				);
				const session = current ? ctx.sessions?.binding?.(current)?.session ?? null : null;
				const snapshot = useSyncExternalStore(
					(onChange) => (session ? session.subscribe(onChange) : () => {}),
					() => readEgressSnapshot(session),
				);
				const count = snapshot === null ? null : snapshot.count;
				const fresh = useRecentIncrease(count, current);
				const open = sealState.known && !sealState.sealed;

				// Line two: the state, then what has been counted under it. "Sealed"
				// alone was the whole label until 30 August 2026 and read as a
				// property of the sidebar rather than as the name of a surface —
				// sealed *what*? The title says which instrument this is; the state
				// is its reading.
				const state = !sealState.known ? "Checking…" : open ? "OPEN" : "Sealed";
				const counted = count === null ? null : `${count} denied`;
				const title = open
					? "Egress monitor: the seal is OPEN — Stratum is not denying outbound calls. Open it for the record and the control that closes the seal."
					: count === null
						? "Egress monitor: sealed. Outbound calls are denied before they run. Open it for the record."
						: `Egress monitor: sealed, ${count} outbound attempt${count === 1 ? "" : "s"} denied and recorded this session. Open it for the record.`;

				const row = jsxs("button", {
					type: "button",
					onClick: () => drawerOpen.toggle(),
					onMouseEnter: () => setHot(true),
					onMouseLeave: () => setHot(false),
					onFocus: () => setHot(true),
					onBlur: () => setHot(false),
					"aria-haspopup": "dialog",
					"aria-label": title,
					title,
					style: {
						display: "flex",
						alignItems: "center",
						gap: "10px",
						width: "100%",
						justifyContent: wide ? "flex-start" : "center",
						padding: wide ? "7px 10px" : "8px 0",
						// A hairline and a surface of its own. Two of the three things
						// that were wrong with the old row were the same thing: it looked
						// like a label, so nobody would think to press it. A control that
						// opens something is drawn as a control.
						border: "1px solid",
						borderColor: open
							? "var(--dsw-alias-state-warn-primary)"
							: hot
								? "var(--dsw-alias-border-l3)"
								: "var(--dsw-alias-border-l1)",
						borderRadius: "8px",
						background: open
							? "var(--dsw-alias-state-warn-tertiary)"
							: hot
								? "var(--dsw-alias-interactive-bg-hover)"
								: "var(--dsw-alias-bg-layer-2)",
						color: "var(--dsw-alias-label-primary)",
						font: "inherit",
						textAlign: "left",
						cursor: "pointer",
						transition: "background 120ms ease, border-color 120ms ease",
					},
					children: [
						// Two readings only, deliberately: the seal is holding, or it is
						// not. What has been denied is a number, not a colour.
						jsx(StateDot, { state: open ? "warning" : "done", size: 8 }),
						wide
							? jsxs("span", {
									style: { flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" },
									children: [
										jsx("span", { style: { fontSize: "13px", lineHeight: 1.25 }, children: "Egress monitor" }),
										jsxs("span", {
											style: {
												fontSize: "11.5px",
												lineHeight: 1.25,
												color: open ? "var(--dsw-alias-state-warn-label)" : "var(--dsw-alias-label-tertiary)",
											},
											children: [
												state,
												counted === null
													? null
													: jsxs("span", {
															style: {
																fontVariantNumeric: "tabular-nums",
																color: fresh ? "var(--dsw-alias-state-error-primary)" : undefined,
																fontWeight: fresh ? 600 : 400,
																transition: "color 200ms ease",
															},
															children: [" \u00b7 ", counted],
														}),
											],
										}),
									],
								})
							: null,
						// The one-look answer to "can I press this?". A label has no
						// chevron; a thing that opens a panel does.
						wide
							? jsx("span", {
									"aria-hidden": "true",
									style: { flex: "0 0 auto", color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" },
									children: "\u203a",
								})
							: null,
					],
				});

				// A hairline above the whole foot group, so the session list ends and
				// the machine's own controls begin. The sidebar renders footer actions
				// directly above Settings, so a border here separates both of them from
				// the conversations rather than separating them from each other.
				const separated = jsx("div", {
					style: {
						// `sidebar.footer.action` is a flex container, so this wrapper is
						// a flex child and sizes to its content unless it is told not to.
						// Without this the row hugged the left of the column at about
						// half its width and read as a stray chip rather than as the
						// foot of the sidebar.
						flex: "1 1 auto",
						width: "100%",
						minWidth: 0,
						boxSizing: "border-box",
						borderTop: "1px solid var(--dsw-alias-border-l1)",
						paddingTop: "8px",
						marginTop: "4px",
					},
					children: row,
				});

				return jsx(Tooltip, { label: title, delayMs: 500, disabled: wide, children: separated });
			}

			return SealFootRow;
		}

		/**
		 * Build the Sovereignty drawer for `shell.overlay`. Root-scoped, so it
		 * has no `sessionId` prop — it reads `ctx.sessions.list.current` and
		 * binds that session itself.
		 *
		 * WHAT IT IS. One surface answering one question: what is this machine
		 * doing, and what has it refused? Before 30 August 2026 that question had
		 * three different answers in three different geometries — the egress
		 * monitor was a floating card with a Dismiss button, residency was a
		 * dropdown menu of disabled items, and the open seal was a band. Three
		 * shapes for one idea, and the card landed on top of the transcript the
		 * evaluator was reading.
		 *
		 * The band stays, because a state nobody may forget they are in should
		 * take space rather than borrow a colour. The other two are here, ranked
		 * by consequence rather than split evenly: the seal is the argument, the
		 * ledger is the evidence, residency and the model plane are context and
		 * arrive collapsed. A drawer that opened at fifty-fifty would be giving
		 * half its room to the least consequential thing in it.
		 *
		 * It insets the application rather than covering it (see `applyInset`),
		 * and its width is a drag the operator keeps (see `drawerWidth`), because
		 * the two kinds of string in the ledger — URLs and command text — are the
		 * two with no natural wrapping point.
		 *
		 * `details` (ui-layout's own resizable right column) was the other
		 * candidate and was not taken: it is a `single` slot scoped *session*, so
		 * occupying it would both displace the harness's own tool-detail panel and
		 * leave the drawer unopenable on the new-session screen — the exact fault
		 * this redesign exists to fix.
		 * @param ctx - client root context, carrying `sessions`.
		 * @returns the component.
		 */
		function buildSovereigntyDrawer(ctx) {
			const { useEffect, useRef, useState, useSyncExternalStore } = require("react");
			const { jsx, jsxs } = require("react/jsx-runtime");
			const { Button, StateDot } = require("@deepseek-ai/dsh-client-ui-primitives");

			const SECONDARY = { color: "var(--dsw-alias-label-secondary)" };
			const TERTIARY = { color: "var(--dsw-alias-label-tertiary)" };
			/** Section headings. Small, spaced, uppercase — the vernacular of a plant panel, not of a web page. */
			const SECTION_LABEL = {
				...TERTIARY,
				fontSize: "10px",
				fontWeight: 600,
				letterSpacing: "0.14em",
				textTransform: "uppercase",
			};

			/** Current session id from the sessions list store, or null. */
			function useCurrentSessionId() {
				const list = ctx.sessions?.list ?? null;
				return useSyncExternalStore(
					(onChange) => (list ? list.subscribe(onChange) : () => {}),
					() => (list ? list.getSnapshot().current ?? null : null),
				);
			}

			/** The session face for the current session, or null. */
			function useCurrentSession(sessionId) {
				return sessionId ? ctx.sessions?.binding?.(sessionId)?.session ?? null : null;
			}

			/**
			 * The host's trace read — residency, the live provider, and what the
			 * last turn routed to. Polled only while the drawer is open: llama-swap
			 * is being asked over HTTP every two seconds, and doing that behind a
			 * closed panel is work nobody is looking at. Two seconds is chosen
			 * against the thing being watched — a model swap on this card takes
			 * about three — rather than to feel live.
			 */
			function useTrace(open) {
				const [trace, setTrace] = useState(null);
				useEffect(() => {
					if (!open || hostConnection === null) return undefined;
					let live = true;
					async function read() {
						try {
							const result = await hostConnection.rpc.call(TRACE_CHANNEL, TRACE_ENDPOINT, {});
							if (live) setTrace(result?.ok === true ? result.value : null);
						} catch {
							// A section that says nothing is better than a drawer that throws.
							if (live) setTrace(null);
						}
					}
					read();
					const timer = setInterval(read, 2000);
					return () => {
						live = false;
						clearInterval(timer);
					};
				}, [open]);
				return trace;
			}

			/**
			 * One ledger line: the timestamp the log recorded, what happened in
			 * words, and the target underneath.
			 *
			 * A field the record does not carry is named as missing rather than
			 * filled in — an audit surface that invents a value is worse than one
			 * that admits a gap. `title` carries the ISO stamp and the whole
			 * sentence for a reader who wants the unambiguous form.
			 * @param entry - one folded entry from the `st-egress` view.
			 * @returns the row, keyed by the event's log sequence number.
			 */
			function ledgerLine(entry) {
				const line = describeEntry(entry);
				const denied = entry.kind === "denied";
				return jsxs(
					"div",
					{
						role: "listitem",
						title: `${denialStamp(entry.time)} — ${line.headline}. ${line.detail}`,
						style: {
							display: "flex",
							flexDirection: "column",
							gap: "1px",
							padding: "8px 0",
							borderBottom: "1px solid var(--dsw-alias-border-l1)",
						},
						children: [
							jsxs("div", {
								style: { display: "flex", alignItems: "baseline", gap: "10px" },
								children: [
									jsx("span", {
										style: { ...TERTIARY, fontVariantNumeric: "tabular-nums", flex: "0 0 auto", fontSize: "11.5px" },
										children: denialClock(entry.time),
									}),
									jsx("span", {
										style: { flex: "1 1 auto", minWidth: 0, fontSize: "12.5px", fontWeight: denied ? 500 : 400 },
										children: line.headline,
									}),
								],
							}),
							jsx("div", {
								// `overflowWrap: anywhere`, not `wordBreak: break-all`. This line
								// carries both a sentence and a target, and break-all breaks the
								// sentence too — "Recorded here because the o / perator did it."
								// Anywhere leaves prose alone and still breaks a URL that has no
								// space in it, which is the only string that needs it.
								style: { ...SECONDARY, fontSize: "11.5px", overflowWrap: "anywhere", lineHeight: 1.45 },
								children: line.detail,
							}),
						],
					},
					`st-egress-line:${entry.seq}`,
				);
			}

			/**
			 * A collapsed section. Context, on request.
			 *
			 * Hand-rolled rather than taken from the shipped `DisclosureRow`
			 * primitive: that component's owner props are not documented anywhere
			 * this package can read, and a guessed prop shape that renders wrong is
			 * worse than a button and a region built from the same theme tokens
			 * everything else here uses. Revisit if its contract is ever published.
			 * @param props.label - the section name.
			 * @param props.summary - the one fact worth seeing while collapsed.
			 */
			function Disclosure(props) {
				const [open, setOpen] = useState(false);
				return jsxs("div", {
					style: { borderTop: "1px solid var(--dsw-alias-border-l1)" },
					children: [
						jsxs("button", {
							type: "button",
							onClick: () => setOpen((was) => !was),
							"aria-expanded": open ? "true" : "false",
							style: {
								display: "flex",
								alignItems: "center",
								gap: "10px",
								width: "100%",
								padding: "13px 18px",
								border: 0,
								background: "transparent",
								color: "var(--dsw-alias-label-primary)",
								font: "inherit",
								fontSize: "13px",
								textAlign: "left",
								cursor: "pointer",
							},
							children: [
								jsx("span", {
									"aria-hidden": "true",
									style: {
										...TERTIARY,
										fontSize: "10px",
										display: "inline-block",
										transform: open ? "rotate(90deg)" : "none",
										transition: "transform 120ms ease",
									},
									children: "\u25b8",
								}),
								jsx("span", { style: { flex: "1 1 auto" }, children: props.label }),
								props.summary === null || props.summary === undefined
									? null
									: jsx("span", { style: { ...SECONDARY, fontSize: "12px" }, children: props.summary }),
							],
						}),
						open
							? jsx("div", {
									style: { padding: "0 18px 14px", display: "flex", flexDirection: "column", gap: "5px" },
									children: props.children,
								})
							: null,
					],
				});
			}

			/** One line of detail inside a disclosure. */
			function detailLine(text, key) {
				return jsx("div", { style: { ...SECONDARY, fontSize: "12px", lineHeight: 1.5 }, children: text }, key);
			}

			/**
			 * The seal control: a switch, labelled with the state it is in.
			 *
			 * WHY A SWITCH AND NOT A HOLD. It was a press-and-hold first, and the
			 * reasoning was sound on paper - resistance where the consequence is real,
			 * and a gesture the room can see being performed. In use it was neither.
			 * The hold had no pointer capture, so the smallest drag cancelled it and
			 * the operator could not tell whether the control or their hand had failed;
			 * its only feedback was a two-pixel bar at half opacity. A control whose
			 * failure mode is indistinguishable from a broken button is worse than a
			 * plain one, whatever it protects.
			 *
			 * And the protection was aimed at the wrong risk. What makes opening the
			 * seal safe is not that it is hard to press: it is that the seal is closed
			 * at boot and never persisted open, that opening is recorded on the session
			 * log, that a band across the window says so for as long as it lasts, and
			 * that every call it lets through is recorded too. None of that depends on
			 * the gesture. The gesture only ever cost legibility.
			 *
			 * On a projector this has to read at a glance and change in front of the
			 * room: ask the workbench to open WhatsApp and watch it refused, throw the
			 * switch, ask again and watch it reach. The switch is the demo's whole
			 * argument that the number beside it is counted rather than painted.
			 *
			 * `role="switch"` with `aria-checked`, operable by Space and Enter, so it
			 * is a real switch to a screen reader and not a div that happens to slide.
			 * Track, thumb and text take `ui-theme` tokens only - no colour of ours
			 * (UX-DR7).
			 * @param props.sessionId - the session the change is recorded against.
			 */
			function SealControl(props) {
				const state = useSyncExternalStore(seal.subscribe, seal.get);
				const open = state.known && !state.sealed;
				const disabled = !state.known || state.busy;

				// One place, so the switch and its label can never disagree about which
				// way is which. `sealed` is the safe state, and it is the default.
				const toggle = () => {
					if (disabled) return;
					void seal.request(open, props.sessionId);
				};

				return jsx("button", {
					type: "button",
					role: "switch",
					"aria-checked": open ? "true" : "false",
					"aria-label": "Network seal",
					disabled,
					onClick: toggle,
					onKeyDown: (event) => {
						// Space and Enter both throw a switch. Enter alone is what a
						// button gives you for free, and a switch that ignores Space is
						// the one keyboard complaint every audit makes.
						if (event.key === " " || event.key === "Enter") {
							event.preventDefault();
							toggle();
						}
					},
					title: open
						? "Close the seal. Stratum goes back to denying every outbound call."
						: "Open the seal. This workbench will be allowed to make real outbound calls, and each one is recorded.",
					style: {
						position: "relative",
						flex: "0 0 auto",
						width: "38px",
						height: "22px",
						padding: 0,
						borderRadius: "11px",
						border: "1px solid var(--dsw-alias-border-l2)",
						// The open state is the loud one, so it takes the foreground
						// colour as a fill. Closed is the quiet surface every other
						// control in this drawer sits on.
						background: open ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-bg-layer-2)",
						cursor: disabled ? "default" : "pointer",
						opacity: disabled ? 0.5 : 1,
						transition: "background 120ms ease",
					},
					children: jsx("span", {
						"aria-hidden": "true",
						style: {
							position: "absolute",
							top: "2px",
							left: open ? "18px" : "2px",
							width: "16px",
							height: "16px",
							borderRadius: "50%",
							background: open ? "var(--dsw-alias-bg-layer-1)" : "var(--dsw-alias-label-secondary)",
							transition: "left 120ms ease",
						},
					}),
				});
			}

			/**
			 * The drag handle down the drawer's left edge.
			 *
			 * Pointer capture on the handle itself, so a fast drag that outruns the
			 * cursor keeps receiving events instead of stopping where the pointer
			 * left the element — the failure that made the old press-and-hold seal
			 * control indistinguishable from a broken button.
			 *
			 * `role="separator"` with `aria-orientation` and the arrow keys, because
			 * a resize that only exists as a drag does not exist for anyone using a
			 * keyboard. The width is written down when the gesture ends, not on
			 * every move: one `localStorage` write per drag rather than one per frame.
			 */
			function ResizeHandle() {
				const width = useSyncExternalStore(drawerWidth.subscribe, drawerWidth.get);
				const onPointerDown = (event) => {
					event.preventDefault();
					const node = event.currentTarget;
					const pointerId = event.pointerId;
					try {
						node.setPointerCapture?.(pointerId);
					} catch {
						// Older engines, and jsdom. The window listeners below still work.
					}
					const move = (moveEvent) => drawerWidth.set(window.innerWidth - moveEvent.clientX);
					const up = () => {
						try {
							node.releasePointerCapture?.(pointerId);
						} catch {
							// Already released, or never captured.
						}
						window.removeEventListener("pointermove", move);
						window.removeEventListener("pointerup", up);
						drawerWidth.commit();
					};
					window.addEventListener("pointermove", move);
					window.addEventListener("pointerup", up);
				};
				return jsx("div", {
					role: "separator",
					"aria-orientation": "vertical",
					"aria-label": "Resize the egress monitor",
					"aria-valuenow": width,
					"aria-valuemin": DRAWER_MIN_WIDTH,
					"aria-valuemax": DRAWER_MAX_WIDTH,
					tabIndex: 0,
					onPointerDown,
					onKeyDown: (event) => {
						// Wider is leftwards, which is why ArrowLeft adds.
						if (event.key === "ArrowLeft") {
							event.preventDefault();
							drawerWidth.set(width + 16);
							drawerWidth.commit();
						} else if (event.key === "ArrowRight") {
							event.preventDefault();
							drawerWidth.set(width - 16);
							drawerWidth.commit();
						}
					},
					style: {
						position: "absolute",
						left: "-3px",
						top: 0,
						bottom: 0,
						width: "7px",
						cursor: "col-resize",
						touchAction: "none",
						zIndex: 1,
					},
				});
			}

			/**
			 * Write the ledger out as a file.
			 *
			 * The on-screen list convinces the person standing at the machine. This
			 * is for the one who wants to take it away — an MRPL reviewer, or a
			 * judge who asks for the evidence rather than the demo. Plain text, one
			 * line per event, with the header naming what produced it, so it can be
			 * read with anything and quoted in a report.
			 *
			 * The harness's own "Session log" download beside it is the whole log
			 * and stays where it is; this is the egress record alone, which is the
			 * part somebody is actually auditing.
			 */
			function exportLedger(entries, sessionId, providerName) {
				const stamped = new Date();
				const lines = [
					"Stratum — egress record",
					`Session: ${sessionId ?? "none"}`,
					`Exported: ${stamped.toISOString()}`,
					`Model plane: ${providerName ?? "unknown"}`,
					`Events: ${entries.length}`,
					"",
					"Every line below is one event this session's log recorded. Denials are",
					"refusals Stratum made before the call ran; anything else is stated as",
					"what it was. Nothing here is derived from a counter.",
					"",
				];
				for (const entry of entries) {
					const line = describeEntry(entry);
					lines.push(`${denialStamp(entry.time)}  [${entry.kind ?? "unknown"}]  ${line.headline}`);
					lines.push(`    ${line.detail}`);
				}
				const name = `Stratum-egress-${stamped.toISOString().slice(0, 19).replace(/[:T]/g, "")}.txt`;
				try {
					const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
					const url = URL.createObjectURL(blob);
					const anchor = document.createElement("a");
					anchor.href = url;
					anchor.download = name;
					document.body.appendChild(anchor);
					anchor.click();
					anchor.remove();
					// Revoked on the next tick rather than immediately: some engines
					// have not finished reading the blob when click() returns.
					setTimeout(() => URL.revokeObjectURL(url), 1000);
				} catch (error) {
					console.warn(
						`@stratum/dsh-client-ui-base: the egress record could not be exported — ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}

			/**
			 * The drawer. Renders only while the seal row has opened it.
			 *
			 * `ui-theme` exposes colour, shadow and font tokens but no radius or
			 * spacing scale — every shipped primitive hard-codes those in px — so
			 * the surface's colours and borders are `--dsw-*` tokens and the
			 * spacing matches the sidebar it mirrors.
			 */
			function SovereigntyDrawer() {
				const open = useSyncExternalStore(drawerOpen.subscribe, drawerOpen.get);
				const width = useSyncExternalStore(drawerWidth.subscribe, drawerWidth.get);
				const sealState = useSyncExternalStore(seal.subscribe, seal.get);
				const sessionId = useCurrentSessionId();
				const session = useCurrentSession(sessionId);
				const snapshot = useSyncExternalStore(
					(onChange) => (session ? session.subscribe(onChange) : () => {}),
					() => readEgressSnapshot(session),
				);
				const trace = useTrace(open);

				const ready = snapshot !== null;
				const count = ready ? snapshot.count : null;
				const entries = ready && Array.isArray(snapshot.entries) ? snapshot.entries : [];
				// Calls this workbench let run. Counted and stated separately from
				// denials, because re-closing the seal does not un-send them: once
				// something has gone out, the session carries that fact whatever the
				// seal does next. `escaped` is folded in for sessions recorded before
				// 30 August 2026, when the canary wrote that event.
				const letThrough = ready
					? (typeof snapshot.permitted === "number" ? snapshot.permitted : 0) +
						(typeof snapshot.escaped === "number" ? snapshot.escaped : 0)
					: 0;

				// Keep the newest line in view. The ledger reads oldest-first — the
				// order the log wrote it — so a fresh line lands at the bottom, and
				// past the fold it lands where the person who just caused it cannot
				// see it. Declared above the `open` early return: hook order has to be
				// the same on the render that draws the drawer and the one that hides it.
				const listRef = useRef(null);
				useEffect(() => {
					const node = listRef.current;
					if (node) node.scrollTop = node.scrollHeight;
				}, [entries.length]);

				// The application gives up the width rather than being covered by it.
				useEffect(() => {
					syncInset();
					return () => syncInset();
				}, [open, width]);

				if (!open) return null;

				const sealOpen = sealState.known && !sealState.sealed;
				const sealHeadline = !sealState.known ? "Checking the seal" : sealOpen ? "Seal OPEN" : "Sealed";
				const sealSentence = !sealState.known
					? "Asking the workbench whether it is denying outbound calls."
					: sealOpen
						? "Outbound calls are not being denied by Stratum. Every call that runs is recorded below, and restarting the workbench closes the seal again."
						: "Outbound calls are denied before they run. Opening the seal is recorded here, and a restart closes it again.";

				const residency = Array.isArray(trace?.residency) ? trace.residency : [];
				const shown = (row) => row.name || row.model;
				const residentReady = residency.filter((row) => row.state === "ready");
				// A model coming or going is the most interesting thing this section
				// ever has to say — it is the card being too small for the fleet,
				// happening. Summarising only what is `ready` reported a swap in
				// progress as "nothing loaded", which is both wrong and the opposite
				// of what an evaluator is watching for.
				const moving = residency.filter((row) => row.state === "starting" || row.state === "stopping");
				const residencySummary =
					trace === null || trace.runtimeReachable === false
						? "not answering"
						: moving.length > 0
							? moving.map((row) => `${shown(row)} ${row.state}`).join(", ")
							: residentReady.length > 0
								? residentReady.map(shown).join(", ")
								: "nothing loaded";

				return jsxs("aside", {
					"aria-label": "Egress monitor",
					style: {
						// Fixed to the viewport, so it sits in the strip `applyInset`
						// reclaims rather than inside the frame it just narrowed.
						position: "fixed",
						top: 0,
						right: 0,
						bottom: 0,
						width: `${width}px`,
						display: "flex",
						flexDirection: "column",
						background: "var(--dsw-alias-bg-layer-1)",
						borderLeft: "1px solid var(--dsw-alias-border-l2)",
						color: "var(--dsw-alias-label-primary)",
						fontSize: "13px",
						zIndex: 30,
					},
					children: [
						jsx(ResizeHandle, {}),
						// Header
						jsxs("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: "8px",
								padding: "16px 18px 14px",
								borderBottom: "1px solid var(--dsw-alias-border-l1)",
							},
							children: [
								jsx("strong", { style: { flex: "1 1 auto", fontSize: "14px" }, children: "Egress monitor" }),
								jsx(Button, {
									variant: "ghost",
									size: "sm",
									onClick: () => drawerOpen.set(false),
									"aria-label": "Close the egress monitor",
									children: "Close",
								}),
							],
						}),
						// Scrolling body
						jsxs("div", {
							style: { flex: "1 1 auto", overflowY: "auto", display: "flex", flexDirection: "column" },
							children: [
								// The seal: the argument, and the one control.
								jsxs("div", {
									style: { padding: "16px 18px", display: "flex", alignItems: "flex-start", gap: "12px" },
									children: [
										jsxs("div", {
											style: { flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: "5px" },
											children: [
												jsxs("div", {
													style: { display: "flex", alignItems: "center", gap: "9px", fontSize: "15px", fontWeight: 600 },
													children: [
														jsx(StateDot, { state: sealOpen ? "warning" : "done", size: 9 }),
														jsx("span", {
															style: sealOpen ? { color: "var(--dsw-alias-state-warn-label)" } : undefined,
															children: sealHeadline,
														}),
													],
												}),
												jsx("span", { style: { ...SECONDARY, fontSize: "12px", lineHeight: 1.45 }, children: sealSentence }),
											],
										}),
										jsx(SealControl, { sessionId }),
									],
								}),
								// The ledger: the evidence.
								jsxs("div", {
									style: { padding: "16px 18px", borderTop: "1px solid var(--dsw-alias-border-l1)" },
									children: [
										jsx("div", { style: { ...SECTION_LABEL, marginBottom: "12px" }, children: "This session" }),
										!ready
											? jsx("span", { style: SECONDARY, children: "Waiting for a session." })
											: jsxs("div", {
													style: { display: "flex", flexDirection: "column" },
													children: [
														jsxs("div", {
															style: { display: "flex", gap: "26px", marginBottom: "14px" },
															children: [
																jsxs("div", {
																	children: [
																		jsx("div", {
																			style: {
																				fontSize: "28px",
																				fontWeight: 600,
																				letterSpacing: "-0.03em",
																				lineHeight: 1,
																				fontVariantNumeric: "tabular-nums",
																			},
																			children: String(count),
																		}),
																		jsx("div", { style: { ...SECONDARY, fontSize: "11.5px", marginTop: "3px" }, children: "denied this session" }),
																	],
																}),
																jsxs("div", {
																	children: [
																		jsx("div", {
																			style: {
																				fontSize: "28px",
																				fontWeight: 600,
																				letterSpacing: "-0.03em",
																				lineHeight: 1,
																				fontVariantNumeric: "tabular-nums",
																				color:
																					letThrough > 0
																						? "var(--dsw-alias-state-warn-label)"
																						: "var(--dsw-alias-label-tertiary)",
																			},
																			children: String(letThrough),
																		}),
																		jsx("div", { style: { ...SECONDARY, fontSize: "11.5px", marginTop: "3px" }, children: "let through" }),
																	],
																}),
															],
														}),
														entries.length > 0
															? jsx("div", {
																	role: "list",
																	"aria-label": "Egress record — oldest first",
																	ref: listRef,
																	style: {
																		display: "flex",
																		flexDirection: "column",
																		maxHeight: "40vh",
																		overflowY: "auto",
																		borderTop: "1px solid var(--dsw-alias-border-l1)",
																	},
																	children: entries.map((entry) => ledgerLine(entry)),
																})
															: null,
														jsx("div", {
															style: { ...TERTIARY, fontSize: "11.5px", lineHeight: 1.45, marginTop: "11px" },
															children:
																"Both figures are counts of events this session's log recorded, not printed labels.",
														}),
													],
												}),
									],
								}),
								// Context, collapsed.
								jsx(Disclosure, {
									label: "Residency",
									summary: residencySummary,
									children:
										residency.length === 0
											? [
													detailLine(
														trace === null || trace.runtimeReachable === false
															? "llama-swap is not answering, so nothing can be loaded. Start it, or switch the model plane to `replay` in the profile patch."
															: "Nothing is resident in GPU memory. A model loads on the next question.",
														"r0",
													),
												]
											: residency.map((row, index) =>
													detailLine(
														`${shown(row)} (${row.model}) — ${row.state}${
															typeof row.ttl === "number" && row.ttl > 0 ? `, unloads after ${row.ttl}s idle` : ""
														}`,
														`r${index}`,
													),
												),
								}),
								jsx(Disclosure, {
									label: "Model plane",
									summary: trace?.providerName ?? "unknown",
									children: [
										detailLine(
											trace?.taskType === null || trace?.taskType === undefined
												? "Nothing routed yet."
												: `Routed as ${trace.taskType} \u2192 ${trace.selected ?? "no member"}${trace.runtimeId ? ` (${trace.runtimeId})` : ""}`,
											"m0",
										),
										trace?.dispatchReason && trace.dispatchReason !== "routed"
											? // A fallback to the default model looks exactly like a routing
												// decision unless the reason is said out loud.
												detailLine(`Not dispatched: ${trace.dispatchReason}`, "m1")
											: null,
										trace?.images
											? detailLine(
													`${trace.images} attached image${trace.images === 1 ? "" : "s"} sent to the vision model`,
													"m2",
												)
											: null,
										...(Array.isArray(trace?.tools) ? trace.tools : []).map((tool, index) =>
											detailLine(`${index + 1}. ${tool.name}${tool.outcome ? ` — ${tool.outcome}` : ""}`, `t${index}`),
										),
									],
								}),
							],
						}),
						// Footer
						jsx("div", {
							style: {
								display: "flex",
								gap: "8px",
								padding: "12px 18px",
								borderTop: "1px solid var(--dsw-alias-border-l1)",
							},
							children: jsx(Button, {
								variant: "ghost",
								size: "sm",
								disabled: entries.length === 0,
								onClick: () => exportLedger(entries, sessionId, trace?.providerName),
								children: "Export egress record",
							}),
						}),
					],
				});
			}

			return SovereigntyDrawer;
		}

		/**
		 * The open-seal band.
		 *
		 * WHY A BAND AND NOT A RED CHIP. A control that changes only itself is
		 * not telling the truth about what it did — the consequence has to be
		 * visible in the same frame as the cause. So the seal's open state is
		 * not a colour somewhere in the header: it takes space at the top of the
		 * window and keeps it. The application looks different because it *is*
		 * different, and there is no reading of the screen in which an open seal
		 * goes unnoticed.
		 *
		 * It cannot be dismissed. A dismissable warning is a warning that will
		 * be dismissed, and the state it describes is the one state nobody
		 * should be able to forget they are in.
		 *
		 * Its weight comes from occupying the layout, not from shouting: the
		 * surface, border and shadow are the same `ui-theme` tokens every other
		 * panel uses, and the only colour is `StateDot`'s own. This is
		 * industrial control software (UX-DR7); a stripe of hand-mixed red would
		 * read as pasted on, which is the failure this project has already made
		 * once and written a rule about.
		 *
		 * Closed by the same call the panel's control uses, so the band is a
		 * second way to reach one action rather than a second mechanism.
		 * @param ctx - client root context, carrying `sessions`.
		 * @returns the component.
		 */
		function buildSealBand(ctx) {
			const { useSyncExternalStore } = require("react");
			const { jsx, jsxs } = require("react/jsx-runtime");
			const { StateDot, Button } = require("@deepseek-ai/dsh-client-ui-primitives");

			function SealBand() {
				const state = useSyncExternalStore(seal.subscribe, seal.get);
				const list = ctx.sessions?.list ?? null;
				const sessionId = useSyncExternalStore(
					(onChange) => (list ? list.subscribe(onChange) : () => {}),
					() => (list ? list.getSnapshot().current ?? null : null),
				);

				// Silent unless it has something true to say. Until the host has
				// answered once, this client does not know the seal's state and must
				// not imply either answer.
				if (!state.known || state.sealed) return null;

				return jsx("div", {
					style: {
						position: "absolute",
						top: "12px",
						left: "0",
						right: "0",
						display: "flex",
						justifyContent: "center",
						pointerEvents: "none",
					},
					children: jsxs("section", {
						role: "status",
						"aria-label": "The egress seal is open",
						style: {
							pointerEvents: "auto",
							display: "flex",
							alignItems: "center",
							gap: "10px",
							maxWidth: "min(680px, calc(100% - 32px))",
							padding: "8px 10px 8px 14px",
							borderRadius: "12px",
							background: "var(--dsw-alias-bg-layer-1)",
							border: "1px solid var(--dsw-alias-border-l2)",
							boxShadow: "var(--dsw-shadow-lv2)",
							color: "var(--dsw-alias-label-primary)",
						},
						children: [
							jsx(StateDot, { state: "warning", size: 10 }),
							jsxs("span", {
								style: { flex: "1 1 auto" },
								children: [
									jsx("strong", { children: "The egress seal is open." }),
									" Outbound calls are not being blocked by Stratum.",
								],
							}),
							jsx(Button, {
								variant: "ghost",
								size: "sm",
								disabled: state.busy,
								onClick: () => void seal.request(true, sessionId),
								children: "Close the seal",
							}),
						],
					}),
				});
			}

			return SealBand;
		}

		/* ---------------------------------------------------------------------
		 * Residency (30 August 2026)
		 *
		 * CONTEXT.md "Residency": which fleet members are resident in VRAM at a
		 * given moment, and how long they stay before eviction. It was a chip in
		 * the session header until 30 August 2026 and is now a collapsed section
		 * in the Sovereignty drawer: it describes the machine, which is what that
		 * drawer is for, and the header it used to sit in carried four pills of
		 * equal weight with nothing to say which one was the claim.
		 *
		 * The spec asked for an execution-trace surface. Most of what one would show
		 * already has a home — the routing chip carries every classifier score and
		 * exclusion reason, and the approval note carries the model and the tool
		 * sequence in a form that survives the file being emailed. Repeating those here would be work spent making the same fact
		 * visible in a fourth place.
		 *
		 * One thing is genuinely invisible: which models are in 4 GB of VRAM right
		 * now, and what was evicted to make room. That is the hardest constraint on
		 * this build, and it is the difference between a chip that changes a label
		 * and a machine visibly managing a card too small for its fleet. So this
		 * shows residency, with the turn's trace as the detail underneath.
		 *
		 * Read from llama-swap's own `/running` through the host. We do not own
		 * loading or eviction, so a panel with its own idea of what is loaded would
		 * be a second source of truth that can disagree with the thing actually
		 * holding the memory — the same reasoning that keeps the egress monitor
		 * counting events rather than a counter.
		 * ------------------------------------------------------------------- */

		const TRACE_CHANNEL = "/st-trace";
		const TRACE_ENDPOINT = "read";


		/**
		 * What the harness's attachment path admits, and nothing more.
		 *
		 * `@deepseek-ai/dsh-attachment`'s version-one image contract is PNG, JPEG,
		 * WebP and GIF. Offering a file type it will reject would put the refusal
		 * after the picker instead of inside it.
		 */
		const ATTACH_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

		/**
		 * Build the composer menu for `conversation.input.left`.
		 *
		 * WHAT THIS REPLACES. The harness's own `+` opens a flat list of slash
		 * commands, and the upload control sat away from it at the far end of the
		 * row, beside the send button. Two places to start something, and the one
		 * this product actually wants a judge to press was the one that looked
		 * like a status pill. So `+` becomes the single entry point: the document
		 * first, the commands tucked under one row that opens on hover.
		 *
		 * Built from the shipped `Menu`, including the submenu — its item shape
		 * carries `submenu`, and it opens that submenu on `mouseenter` and on
		 * `focus` with `aria-haspopup="menu"` already wired. Nothing here is a
		 * hand-rolled menu.
		 *
		 * One detail worth knowing about that primitive: a `type: "label"` item
		 * renders `text`, not `label`. An item passing only `label` renders as an
		 * empty row, which is how the old residency chip's two headings were
		 * invisible without anyone noticing.
		 *
		 * The harness's own `+` is hidden by the stylesheet in `apply`, and this
		 * takes its place at the head of the row through flex `order`. That is a
		 * real dependency on someone else's markup: if a harness upgrade renames
		 * the class, the shipped `+` comes back and there are two of them — untidy
		 * and immediately visible, which is the right failure for a demo surface
		 * rather than a composer with no commands in it.
		 * @returns the component.
		 */
		function buildComposerMenu(readCommands) {
			const { useEffect, useRef, useState } = require("react");
			const { jsx, jsxs } = require("react/jsx-runtime");
			const { IconPlusOutline16, Menu, StateDot, Tooltip } = require("@deepseek-ai/dsh-client-ui-primitives");

			/**
			 * Hand a picked file to the harness's own attachment draft.
			 *
			 * **Why a synthesised paste rather than an upload of our own.** The
			 * harness already owns this end to end: `@deepseek-ai/dsh-attachment`
			 * validates and durably commits the image, and
			 * `@deepseek-ai/dsh-client-ui-attachment` draws the composer's draft
			 * thumbnail rail, the drop target, the history gallery and the
			 * lightbox. It listens for `paste` on the composer and takes any image
			 * file it finds there — verified in the running workbench on
			 * 31 August 2026: a synthetic paste carrying one PNG produced a draft
			 * card in the rail, and the event came back `defaultPrevented`.
			 *
			 * So this control exists only to make that path *discoverable*. Paste
			 * and drag-and-drop both work already, and neither is visible to
			 * somebody seeing the workbench for the first time; a menu row is. It
			 * is the same choice `typeIntoComposer` makes below — put the input
			 * where the harness is already looking and let the harness do the
			 * work, rather than opening a second path into it that can disagree.
			 *
			 * Returns false when the composer is not on screen, so the caller can
			 * say so instead of appearing to have done nothing.
			 */
			function handToComposer(file) {
				const field = document.querySelector("textarea");
				if (!field) return false;
				try {
					const transfer = new DataTransfer();
					transfer.items.add(file);
					field.focus();
					// The harness calls `preventDefault` when it takes the image, so a
					// cancelled event is the acknowledgement that it did.
					return !field.dispatchEvent(
						new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
					);
				} catch (error) {
					console.warn(
						`@stratum/dsh-client-ui-base: the image could not be handed to the composer — ${error instanceof Error ? error.message : String(error)}`,
					);
					return false;
				}
			}

			/**
			 * Put a slash command on the composer's line, ready to send.
			 *
			 * Deliberately types rather than executes. The harness owns command
			 * dispatch — argument claiming, the image envelope, the lifecycle pair
			 * on the session log — and a second path into that would be a second
			 * thing to be wrong. Pressing Enter after this runs the command through
			 * exactly the code that runs it when someone types the slash themselves.
			 *
			 * The composer is a controlled React input, so its value is set through
			 * the prototype's own setter and announced with an `input` event; React
			 * listens for that and updates its state. Assigning `.value` directly
			 * would show the text and leave React believing the field was empty.
			 */
			function typeIntoComposer(text) {
				const field = document.querySelector("textarea");
				if (!field) return false;
				try {
					const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
					if (setter) setter.call(field, text);
					else field.value = text;
					field.dispatchEvent(new Event("input", { bubbles: true }));
					field.focus();
					const end = field.value.length;
					field.setSelectionRange?.(end, end);
					return true;
				} catch (error) {
					console.warn(
						`@stratum/dsh-client-ui-base: the command could not be typed into the composer — ${error instanceof Error ? error.message : String(error)}`,
					);
					return false;
				}
			}

			function ComposerMenu(props) {
				// idle -> reading -> ingesting -> ready | failed
				const [phase, setPhase] = useState("idle");
				const [detail, setDetail] = useState("");
				const [open, setOpen] = useState(false);
				const [commands, setCommands] = useState([]);
				const inputRef = useRef(null);
				const docInputRef = useRef(null);

				// The commands this session actually has, read from the host's own
				// directory rather than listed here. A hard-coded menu would drift
				// from the harness the first time it shipped one more.
				//
				// Read through the `remote.commands` client service, which is what
				// `@deepseek-ai/dsh-client-ui-commands` itself uses. An earlier
				// version asked the HTTP gateway for `command.list` and got "not
				// found": that namespace is not on `/api/`, and guessing a wire name
				// is not the same as using the seam the harness declares.
				useEffect(() => {
					if (typeof readCommands !== "function" || !props.sessionId) return undefined;
					let live = true;
					Promise.resolve()
						.then(() => readCommands(props.sessionId))
						.then((rows) => {
							if (!live || !Array.isArray(rows)) return;
							setCommands(rows.filter((row) => typeof row?.name === "string"));
						})
						.catch((error) => {
							// A menu that opens with the document alone is a working menu.
							console.warn(
								`@stratum/dsh-client-ui-base: the command directory could not be read — ${error instanceof Error ? error.message : String(error)}`,
							);
						});
					return () => {
						live = false;
					};
				}, [props.sessionId]);

				function onPicked(event) {
					const file = event.target?.files?.[0];
					// Reset the input so picking the same file twice still fires a change.
					if (event.target) event.target.value = "";
					if (!file) return;

					// No progress states here, on purpose. The image goes straight into
					// the composer's draft rail, where the thumbnail *is* the
					// confirmation: it is on screen, it can be removed, and it is
					// plainly not sent yet. The control this replaces had five phases
					// because it was running several seconds of OCR behind a pill.
					// There is no longer any work to narrate.
					if (handToComposer(file)) {
						setPhase("idle");
						setDetail("");
						return;
					}
					setPhase("failed");
					setDetail("the composer is not open, so there is nothing to attach to");
				}

				const items = [
					{ id: "st-add-doc", label: "Add a document to the library (PDF, Excel)" },
					{
						id: "st-attach",
						label: "Attach an image",
						icon: phase === "failed" ? jsx(StateDot, { tone: "danger" }) : undefined,
					},
					{ id: "st-sep", type: "separator" },
					{
						id: "st-commands",
						label: "Commands",
						// `submenu` is what makes the row open on hover instead of
						// selecting. With no commands in the directory yet the row is
						// disabled rather than opening onto nothing.
						disabled: commands.length === 0,
						submenu: commands.map((row) => ({
							id: `st-cmd:${row.name}`,
							label: typeof row.description === "string" && row.description !== ""
								? `${row.name} \u2014 ${row.description}`
								: row.name,
						})),
					},
				];

				const onSelect = (id) => {
					if (id === "st-add-doc") {
						setOpen(false);
						docInputRef.current?.click();
						return;
					}
					if (id === "st-attach") {
						setOpen(false);
						inputRef.current?.click();
						return;
					}
					if (typeof id === "string" && id.startsWith("st-cmd:")) {
						setOpen(false);
						typeIntoComposer(`/${id.slice("st-cmd:".length)} `);
					}
				};

				// Shaped like the harness's own `+`: the same 28px round button on the
				// same `--dsw-specific-selector` surface, so the control that replaced
				// it is not a different-looking control in the same place.
				const anchor = jsxs("button", {
					type: "button",
					"aria-label": "Add a document, attach an image, or run a command",
					"aria-haspopup": "menu",
					"aria-expanded": open ? "true" : "false",
					onClick: () => setOpen((was) => !was),
					style: {
						display: "grid",
						placeItems: "center",
						width: "28px",
						height: "28px",
						flex: "none",
						padding: 0,
						border: "none",
						borderRadius: "999px",
						background: "var(--dsw-specific-selector)",
						color: "var(--dsw-alias-label-primary)",
						cursor: "pointer",
					},
					children: [
						jsx(IconPlusOutline16, { size: 14 }),
						// Kept in the tree rather than created on demand, so the handler
						// above always has something to open. Hidden from assistive
						// technology because the menu row is the control.
						jsx("input", {
							ref: inputRef,
							type: "file",
							accept: ATTACH_ACCEPT,
							onChange: onPicked,
							style: { display: "none" },
							tabIndex: -1,
							"aria-hidden": "true",
						}),
						// Documents go to the Library (the backend reads them), not to the model's context.
						jsx("input", {
							ref: docInputRef,
							type: "file",
							multiple: true,
							accept: ".pdf,.xlsx,.xls,.csv,.txt,.md,.png,.jpg,.jpeg,.tif,.tiff",
							onChange: (event) => {
								const files = Array.from(event.target?.files ?? []);
								if (event.target) event.target.value = "";
								if (files.length === 0) return;
								libraryOpen.set(true);
								void uploadFiles(files);
							},
							style: { display: "none" },
							tabIndex: -1,
							"aria-hidden": "true",
						}),
					],
				});

				return jsx("span", {
					// The slot renders after the harness's own `+` and its mode
					// controls. `order` puts this back at the head of the row, which is
					// where the control it replaces was.
					style: { order: -1, display: "inline-flex", alignItems: "center" },
					title: phase === "idle" ? undefined : detail,
					children: jsx(Menu, {
						open,
						onOpenChange: setOpen,
						onClose: () => setOpen(false),
						side: "top",
						align: "start",
						portal: true,
						anchor: jsx(Tooltip, {
							label: "Add a document, attach an image, or run a command",
							side: "top",
							delayMs: 500,
							children: anchor,
						}),
						items,
						onSelect,
					}),
				});
			}

			return ComposerMenu;
		}

		/**
		 * The denial notice.
		 *
		 * The moment a refusal happens is the moment this product has to be
		 * legible from the back of a room, and it is the moment nothing on the
		 * screen used to move unless the drawer happened to be open. Before
		 * 30 August 2026 the canary button carried that job: it turned a colour
		 * and the panel opened itself. With the canary gone (ADR-0007) the
		 * trigger is the operator's own request, so the announcement has to come
		 * from the record rather than from a control.
		 *
		 * It is transient on purpose. A denial is the seal *working*, and marking
		 * the interface permanently for good news teaches a room to ignore the
		 * mark — so this says its piece for eight seconds and leaves the standing
		 * colour to state the seal alone. What it announced is in the ledger
		 * afterwards, which is where a record belongs.
		 *
		 * It watches the same `st-egress` view everything else reads and fires on
		 * the count going up. There is no path from any control in this package
		 * to this component: it cannot be made to appear except by an event the
		 * host actually wrote (NFR8).
		 * @param ctx - client root context, carrying `sessions`.
		 * @returns the component.
		 */
		function buildDenialNotice(ctx) {
			const { useEffect, useRef, useState, useSyncExternalStore } = require("react");
			const { jsx, jsxs } = require("react/jsx-runtime");
			const { Button, StateDot } = require("@deepseek-ai/dsh-client-ui-primitives");

			/** How long the notice stays up. Long enough to read aloud, short enough not to become furniture. */
			const NOTICE_MS = 8000;

			/**
			 * How recently a denial must have been recorded to be announced.
			 *
			 * A refusal is news while it is happening and a record afterwards. This is
			 * the line between the two, and it is what makes opening an old
			 * conversation silent — see {@link buildDenialNotice} for the defect that
			 * put it here. Generous enough that a slow turn still announces its own
			 * denial, short enough that nothing in a stored session ever qualifies.
			 */
			const NOTICE_FRESH_MS = 15000;

			function DenialNotice() {
				const list = ctx.sessions?.list ?? null;
				const current = useSyncExternalStore(
					(onChange) => (list ? list.subscribe(onChange) : () => {}),
					() => (list ? list.getSnapshot().current ?? null : null),
				);
				const session = current ? ctx.sessions?.binding?.(current)?.session ?? null : null;
				const snapshot = useSyncExternalStore(
					(onChange) => (session ? session.subscribe(onChange) : () => {}),
					() => readEgressSnapshot(session),
				);
				// The newest denial, not the newest event: a seal change landing in the
				// same instant must not be announced as a refusal.
				const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
				const denials = entries.filter((entry) => entry.kind === "denied");
				const latest = denials.length > 0 ? denials[denials.length - 1] : null;
				const latestSeq = typeof latest?.seq === "number" ? latest.seq : null;

				// WHY THIS ASKS *WHEN*, AND NOT HOW MANY.
				//
				// It watched the session's denial count until 31 August 2026, and a
				// count is a property of one session. Opening or switching to a
				// conversation that already carried denials read as a rise — 0 to 2 —
				// and the notice announced somebody's old refusal as though it had
				// just happened: an "Outbound call denied … web.whatsapp.com" card
				// over a session that had made no such call.
				//
				// Re-seating a baseline on the session id was tried first and is not
				// enough, because `current` and the session's own snapshot do not
				// arrive together. The switch lands, the baseline is re-seated against
				// the *previous* session's still-current snapshot, and the new
				// session's log arrives one render later looking exactly like a jump.
				// Measured on 31 August 2026: it still fired on the second switch.
				//
				// So the question is not "is this number bigger than the last one I
				// saw" but "did this refusal just happen". A denial carries the log's
				// own `time`, and a refusal recorded more than {@link NOTICE_FRESH_MS}
				// ago is history however it arrived on screen — a switch, a reload, a
				// log streaming in. `seq` is kept alongside it so a single denial is
				// announced once rather than on every re-render inside that window.
				//
				// It fails in the quiet direction. A clock skewed far enough into the
				// past silences the notice rather than announcing stale refusals, and
				// the denial is still counted, still on the seal row, and still in the
				// drawer's record — which is where a record belongs.
				const announced = useRef(null);
				const [notice, setNotice] = useState(null);

				useEffect(() => {
					if (latest === null || latestSeq === null) return undefined;
					if (announced.current === latestSeq) return undefined;
					const time = typeof latest.time === "number" ? latest.time : null;
					if (time === null || Date.now() - time > NOTICE_FRESH_MS) return undefined;
					announced.current = latestSeq;
					setNotice(latest);
					const timer = setTimeout(() => setNotice(null), NOTICE_MS);
					return () => clearTimeout(timer);
				}, [current, latestSeq]);

				if (notice === null) return null;

				const tool = typeof notice.tool === "string" && notice.tool !== "" ? notice.tool : "a tool";
				const target =
					typeof notice.target === "string" && notice.target !== "" ? notice.target : "an unrecorded target";

				return jsx("div", {
					style: {
						position: "absolute",
						top: "12px",
						left: 0,
						right: 0,
						display: "flex",
						justifyContent: "center",
						pointerEvents: "none",
					},
					children: jsxs("section", {
						role: "status",
						"aria-label": "An outbound call was denied",
						style: {
							pointerEvents: "auto",
							display: "flex",
							alignItems: "center",
							gap: "10px",
							maxWidth: "min(680px, calc(100% - 32px))",
							padding: "8px 10px 8px 14px",
							borderRadius: "12px",
							background: "var(--dsw-alias-bg-layer-1)",
							border: "1px solid var(--dsw-alias-border-l2)",
							boxShadow: "var(--dsw-shadow-lv2)",
							color: "var(--dsw-alias-label-primary)",
							fontSize: "13px",
						},
						children: [
							jsx(StateDot, { state: "error", size: 10 }),
							jsxs("span", {
								style: { flex: "1 1 auto", minWidth: 0 },
								children: [
									jsx("strong", { children: "Outbound call denied." }),
									// The target is the fact worth reading out. It is allowed to
									// truncate rather than wrap: this is a notice, not the record,
									// and the record is one click away and complete.
									jsx("span", {
										style: {
											color: "var(--dsw-alias-label-secondary)",
											marginLeft: "6px",
											fontVariantNumeric: "tabular-nums",
										},
										children: `${tool} \u2192 ${target}`,
									}),
								],
							}),
							jsx(Button, {
								variant: "ghost",
								size: "sm",
								onClick: () => {
									setNotice(null);
									drawerOpen.set(true);
								},
								children: "Show",
							}),
						],
					}),
				});
			}

			return DenialNotice;
		}

		/**
		 * Hold the tab title against the harness, which rewrites it after hydration.
		 *
		 * `@deepseek-ai/dsh-client-ui-renderer` renders a `DocumentTitle` component
		 * beside `renderSlot("root")` with a hard-coded `const productTitle =
		 * "DeepSeek Harness"`, and sets `document.title` from a `useEffect`. The
		 * host-side `tapIndex` swap in `index.js` wins the first paint and loses to
		 * that effect, so the tab read "DeepSeek Harness" from hydration onward.
		 *
		 * There is no row to disable — `DocumentTitle` is rendered directly, not
		 * registered into a slot — and no config key to override, so the only
		 * out-of-tree fix is to watch the title node and put ours back. Editing
		 * harness source is forbidden (NFR5).
		 *
		 * The harness writes either `productTitle` alone or `${sessionTitle} — ${productTitle}`,
		 * so the session title is preserved and only the product half is replaced.
		 * @returns a dispose function that stops observing.
		 */
		function holdTabTitle() {
			const HOST_PRODUCT_TITLE = "DeepSeek Harness";
			const OUR_PRODUCT_TITLE = "Stratum";

			function correct() {
				const current = document.title;
				if (!current.includes(HOST_PRODUCT_TITLE)) return;
				const corrected = current.split(HOST_PRODUCT_TITLE).join(OUR_PRODUCT_TITLE);
				if (corrected !== current) document.title = corrected;
			}

			correct();

			const titleElement = document.querySelector("title");
			if (titleElement === null || typeof MutationObserver !== "function") {
				console.warn(
					"@stratum/dsh-client-ui-base: no <title> element or no MutationObserver — the tab title will revert to the harness's once the client renders",
				);
				return () => {};
			}

			// childList catches the text node swap React makes; characterData with
			// subtree catches an in-place edit of the existing text node.
			const observer = new MutationObserver(correct);
			observer.observe(titleElement, { childList: true, characterData: true, subtree: true });
			return () => {
				observer.disconnect();
			};
		}

		/* ---------------------------------------------------------------------
		 * Story 4.5's provenance crop viewer stood here until 31 August 2026.
		 *
		 * It listed every OCR line the ingestion service returned and cut a crop of
		 * the page region each was read from. ADR-0008 removed the OCR service, so
		 * there are no extracted lines and no pixel boxes left to cite: an attached
		 * picture goes to the vision model as a picture. The harness's own
		 * `conversation.message.images` gallery shows it in the transcript and its
		 * lightbox opens the original — which is the evidence this tab existed to
		 * give, shown against the message that carried it instead of in a tab of
		 * its own.
		 * ------------------------------------------------------------------- */


		/* ---------------------------------------------------------------------
		 * Stratum panels: Library, Evidence, Facts, Topics, Metrics, and the cards
		 * a tool result renders as.
		 *
		 * Everything here reads the Python backend through the host's same-origin
		 * proxy (`/stratum/api/*` → `127.0.0.1:8642/v1/*`, see `backend/proxy.js`),
		 * so the page never makes a cross-origin request. Chrome comes from the
		 * shipped primitives and `--dsw-*` tokens only — no hand-written colour —
		 * which is what keeps it correct in light and dark without a media query.
		 * ------------------------------------------------------------------- */

		const API = "/stratum/api";

		/** One JSON call to the backend through the proxy. Throws an Error whose message is the backend's own. */
		async function api(path, { method = "GET", body, form } = {}) {
			const init = { method, headers: { accept: "application/json" } };
			if (form) init.body = form;
			else if (body !== undefined) {
				init.headers["content-type"] = "application/json";
				init.body = JSON.stringify(body);
			}
			const response = await fetch(`${API}${path}`, init);
			const text = await response.text();
			let data = null;
			try {
				data = text ? JSON.parse(text) : null;
			} catch {
				data = null;
			}
			if (!response.ok) {
				const detail = data && (data.detail ?? data.error);
				throw new Error(detail ? (typeof detail === "string" ? detail : JSON.stringify(detail)) : `the backend answered ${response.status}`);
			}
			return data;
		}

		/** A small observable value. `set` takes a patch object or a function of the current state. */
		function createStore(initial) {
			let state = initial;
			const listeners = new Set();
			return {
				get: () => state,
				set(patch) {
					const next = typeof patch === "function" ? patch(state) : patch;
					state = { ...state, ...next };
					for (const listener of listeners) listener();
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			};
		}

		/** The document library as the client knows it, refreshed while anything is watching it. */
		const library = createStore({ docs: [], stats: null, loaded: false, error: null, uploads: [] });
		const libraryOpen = createOpenStore();
		let libraryWatchers = 0;
		let libraryTimer = null;

		async function refreshLibrary() {
			try {
				const [docs, stats] = await Promise.all([api("/documents"), api("/stats")]);
				library.set({ docs, stats, loaded: true, error: null });
			} catch (error) {
				library.set({ loaded: true, error: error instanceof Error ? error.message : String(error) });
			}
		}

		/** Start polling the library; returns the stop function. Several watchers share one timer. */
		function watchLibrary() {
			libraryWatchers += 1;
			if (libraryWatchers === 1) {
				void refreshLibrary();
				libraryTimer = setInterval(() => void refreshLibrary(), 3000);
			}
			return () => {
				libraryWatchers -= 1;
				if (libraryWatchers === 0 && libraryTimer !== null) {
					clearInterval(libraryTimer);
					libraryTimer = null;
				}
			};
		}

		function patchUpload(id, patch) {
			library.set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
		}

		/** Upload files to the backend. Each one is a document row the moment it lands; ingestion then runs in the backend's own queue. */
		async function uploadFiles(files) {
			for (const file of Array.from(files ?? [])) {
				const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
				library.set((s) => ({ uploads: [...s.uploads, { id, name: file.name, state: "uploading" }] }));
				try {
					const form = new FormData();
					form.append("file", file, file.name);
					const result = await api("/documents", { method: "POST", form });
					patchUpload(id, { state: result.duplicate ? "duplicate" : "queued" });
				} catch (error) {
					patchUpload(id, { state: "failed", message: error instanceof Error ? error.message : String(error) });
				}
				await refreshLibrary();
				setTimeout(() => library.set((s) => ({ uploads: s.uploads.filter((u) => u.id !== id) })), 7000);
			}
		}

		/** Where the Evidence tab is pointed: a document, a page, optionally a fact and a box to highlight. */
		const evidence = createStore({ documentId: null, page: 1, factId: null, chunkId: null, bbox: null, ts: 0 });

		/** Switch the conversation's view ring to the tab with this label (the harness keeps its tab state private). */
		function activateTab(label) {
			const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((node) => node.textContent?.trim() === label);
			tab?.click();
		}

		/** Point the Evidence tab at a citation and bring it to the front. */
		function openEvidence(target) {
			evidence.set({
				documentId: target.documentId ?? null,
				page: target.page || 1,
				factId: target.factId ?? null,
				chunkId: target.chunkId ?? null,
				bbox: target.bbox ?? null,
				ts: Date.now(),
			});
			activateTab("Evidence");
		}

		/** Evidence target for one citation object from `/v1/ask`, `/v1/pq`. */
		function citationTarget(citation) {
			return {
				documentId: citation.document_id,
				page: citation.page_no,
				factId: citation.kind === "fact" ? citation.fact_id : null,
				chunkId: citation.kind === "passage" ? citation.chunk_id : null,
				bbox: citation.bbox,
			};
		}

		const SHORT_FILE = (name, n = 38) => (typeof name === "string" && name.length > n ? `${name.slice(0, n - 1)}…` : name ?? "");
		const ROUTE_LABELS = { sql: "Verified facts", rag: "Documents", sql_rag: "Facts + documents" };
		const TASK_LABELS = { ask: "Ask", pq_reply: "PQ reply", report: "Report", topics: "Topics", vision: "Vision", chat: "Chat" };
		const DOC_KIND_LABELS = {
			annual_report: "Annual report",
			pq_reply: "PQ reply",
			press_release: "Press release",
			provisional_stats: "Provisional statistics",
			coal_directory: "Coal Directory",
			spreadsheet: "Spreadsheet",
			document: "Document",
		};

		/** The shared, themed building blocks of every Stratum panel. Built once, at mount, from the host's React. */
		function buildUi() {
			const { useEffect, useState, useSyncExternalStore } = require("react");
			const { jsx, jsxs } = require("react/jsx-runtime");
			const { Button, Pill, StateDot } = require("@deepseek-ai/dsh-client-ui-primitives");

			const SECONDARY = { color: "var(--dsw-alias-label-secondary)" };
			const TERTIARY = { color: "var(--dsw-alias-label-tertiary)" };
			const SECTION_LABEL = { ...TERTIARY, fontSize: "10px", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" };
			const NUM = { fontVariantNumeric: "tabular-nums" };

			/** Hyperscript over the host's jsx runtime: `h("div", props, ...children)`; nested arrays and falsy children are flattened away. */
			function h(type, props, ...children) {
				const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);
				if (kids.length === 0) return jsx(type, props ?? {});
				if (kids.length === 1) return jsx(type, { ...(props ?? {}), children: kids[0] });
				return jsxs(type, { ...(props ?? {}), children: kids });
			}

			const useStore = (store) => useSyncExternalStore(store.subscribe, store.get);

			/** GET a backend path while `path` is set; reloads when `deps` change. */
			function useJson(path, deps = []) {
				const [state, setState] = useState({ data: null, error: null, loading: path !== null });
				const [tick, setTick] = useState(0);
				useEffect(() => {
					if (path === null) {
						setState({ data: null, error: null, loading: false });
						return undefined;
					}
					let live = true;
					setState((s) => ({ ...s, loading: true, error: null }));
					api(path)
						.then((data) => live && setState({ data, error: null, loading: false }))
						.catch((error) => live && setState({ data: null, error: error instanceof Error ? error.message : String(error), loading: false }));
					return () => {
						live = false;
					};
					// eslint-disable-next-line react-hooks/exhaustive-deps
				}, [path, tick, ...deps]);
				return { ...state, reload: () => setTick((n) => n + 1) };
			}

			/** The dot beside a fact: flagged is amber, rejected is red, everything else is the quiet "done" green. */
			function StatusDot({ status, size = 8 }) {
				const state = status === "flagged" ? "warning" : status === "rejected" ? "error" : "done";
				return jsx(StateDot, { state, size });
			}

			const STATUS_WORDS = {
				verified: "Verified — two sources agree, or a person approved it",
				consistent: "Consistent — every check passed",
				flagged: "Flagged — a check failed; needs review",
				rejected: "Rejected by a reviewer",
			};

			/** A titled surface; the card chrome every tool result shares. */
			function Card({ title, meta, children, style }) {
				return h(
					"section",
					{
						style: {
							display: "flex",
							flexDirection: "column",
							gap: "12px",
							padding: "14px 16px",
							margin: "6px 0",
							border: "1px solid var(--dsw-alias-border-l2)",
							borderRadius: "12px",
							background: "var(--dsw-alias-bg-layer-1)",
							color: "var(--dsw-alias-label-primary)",
							fontSize: "13px",
							lineHeight: 1.5,
							minWidth: 0,
							...style,
						},
					},
					(title || meta) &&
						h(
							"div",
							{ style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
							title && h("strong", { style: { fontSize: "13.5px" } }, title),
							meta,
						),
					children,
				);
			}

			/** A small text-only tag (route, document kind, guard result). */
			function Tag({ children, title, tone }) {
				return h(
					"span",
					{
						title,
						style: {
							display: "inline-flex",
							alignItems: "center",
							gap: "5px",
							padding: "1px 8px",
							border: "1px solid",
							borderColor: tone === "warn" ? "var(--dsw-alias-state-warn-primary)" : "var(--dsw-alias-border-l2)",
							borderRadius: "999px",
							fontSize: "11.5px",
							lineHeight: "18px",
							color: tone === "warn" ? "var(--dsw-alias-state-warn-label)" : "var(--dsw-alias-label-secondary)",
							background: tone === "warn" ? "var(--dsw-alias-state-warn-tertiary)" : "transparent",
							whiteSpace: "nowrap",
						},
					},
					children,
				);
			}

			/** A citation chip: `[n] file p.N`, opening the Evidence tab at the cited place. */
			function CitationChip({ citation }) {
				const target = citationTarget(citation);
				const label = `[${citation.n}] ${SHORT_FILE(citation.filename, 34)}${citation.page_no ? ` · p.${citation.page_no}` : ""}`;
				return jsx(Pill, {
					onClick: () => openEvidence(target),
					title: `${citation.filename}${citation.page_no ? `, page ${citation.page_no}` : ""}\n${citation.snippet ?? ""}\n\nClick to open this place in the Evidence tab.`,
					children: h("span", { style: { display: "inline-flex", alignItems: "center", gap: "6px" } }, citation.status ? jsx(StatusDot, { status: citation.status, size: 7 }) : null, label),
				});
			}

			const cellStyle = { padding: "6px 10px", borderBottom: "1px solid var(--dsw-alias-border-l1)", textAlign: "right", ...NUM, whiteSpace: "nowrap" };
			const headStyle = { ...cellStyle, ...SECONDARY, fontWeight: 500, fontSize: "11.5px" };

			/** The answer table. Every figure is a button that opens the cell it was read from. */
			function AnswerTable({ table, citations }) {
				const byFact = new Map((citations ?? []).filter((c) => c.kind === "fact").map((c) => [c.fact_id, c]));
				return h(
					"div",
					{ style: { overflowX: "auto" } },
					h(
						"table",
						{ style: { borderCollapse: "collapse", width: "100%", fontSize: "13px" } },
						h(
							"thead",
							null,
							h(
								"tr",
								null,
								h("th", { style: { ...headStyle, textAlign: "left" } }, table.kind === "achievement" ? "Entity" : `Entity (${table.unit_label})`),
								table.periods.map((p) => h("th", { key: p, style: headStyle }, p)),
								table.show_change && h("th", { style: headStyle }, table.change_label ?? "Change %"),
							),
						),
						h(
							"tbody",
							null,
							table.rows.map((row) =>
								h(
									"tr",
									{ key: row.entity_code },
									h("td", { style: { ...cellStyle, textAlign: "left" }, title: row.entity }, row.short),
									row.cells.map((cell, i) => {
										if (!cell) return h("td", { key: i, style: { ...cellStyle, ...TERTIARY } }, "—");
										const citation = byFact.get(cell.fact_id);
										return h(
											"td",
											{ key: i, style: cellStyle },
											h(
												"button",
												{
													type: "button",
													title: `${STATUS_WORDS[cell.status] ?? cell.status}${cell.provisional ? " · provisional" : ""}${citation ? "\nClick to see the source cell." : ""}`,
													onClick: citation ? () => openEvidence(citationTarget(citation)) : undefined,
													style: { all: "unset", cursor: citation ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: "6px" },
												},
												jsx(StatusDot, { status: cell.status, size: 7 }),
												cell.display,
												cell.provisional && h("sup", { style: { ...TERTIARY, fontSize: "9px" } }, "P"),
											),
										);
									}),
									table.show_change &&
										h(
											"td",
											{ style: { ...cellStyle, ...SECONDARY } },
											row.change_pct === null || row.change_pct === undefined ? "—" : table.kind === "achievement" ? `${row.change_pct.toFixed(2)}%` : `${row.change_pct > 0 ? "+" : ""}${row.change_pct.toFixed(2)}%`,
										),
								),
							),
						),
					),
				);
			}

			/** The number guard's verdict as a tag: what was checked, and whether everything in the text is in the evidence. */
			function GuardTag({ guard }) {
				if (!guard) return null;
				if (guard.ok) {
					return h(Tag, { title: "Every number in the answer was matched against the cited evidence." }, jsx(StateDot, { state: "done", size: 7 }), guard.checked > 0 ? `Number guard · ${guard.checked} checked` : "Number guard");
				}
				return h(Tag, { tone: "warn", title: `Not found in the evidence: ${(guard.unsupported ?? []).join(", ")}` }, jsx(StateDot, { state: "warning", size: 7 }), `Unsupported figures: ${(guard.unsupported ?? []).join(", ")}`);
			}

			/** Discrepancy lines: where another source states a different figure for the same thing. */
			function Discrepancies({ items }) {
				if (!items || items.length === 0) return null;
				const seen = new Set();
				const unique = items.filter((d) => {
					const key = `${d.entity}|${d.period}|${d.other_source}|${d.other}`;
					if (seen.has(key)) return false;
					seen.add(key);
					return true;
				});
				return h(
					"div",
					{ style: { display: "flex", flexDirection: "column", gap: "4px" } },
					h("div", { style: SECTION_LABEL }, "Other sources disagree"),
					unique.map((d, i) =>
						h(
							"div",
							{ key: i, style: { display: "flex", gap: "8px", alignItems: "baseline", color: "var(--dsw-alias-state-warn-label)", fontSize: "12.5px" } },
							jsx(StateDot, { state: "warning", size: 7 }),
							h("span", null, `${d.entity} ${d.period}: ${d.other_source}${d.pq ? ` (${d.pq})` : ""} states ${d.other}, this answer uses ${d.reported} — ${d.note}.`),
						),
					),
				);
			}

			/** Plain muted paragraph. */
			function Muted({ children, style }) {
				return h("div", { style: { ...SECONDARY, fontSize: "12.5px", ...style } }, children);
			}

			/** A labelled block inside a panel. */
			function Section({ label, children }) {
				return h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, label && h("div", { style: SECTION_LABEL }, label), children);
			}

			/** A big number with its caption, for the Library strip and the Metrics tiles. */
			function Stat({ value, caption, warn }) {
				return h(
					"div",
					{ style: { minWidth: 0 } },
					h("div", { style: { fontSize: "24px", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1, ...NUM, color: warn ? "var(--dsw-alias-state-warn-label)" : undefined } }, value),
					h("div", { style: { ...SECONDARY, fontSize: "11.5px", marginTop: "4px" } }, caption),
				);
			}

			return { h, useStore, useJson, StatusDot, Card, Tag, CitationChip, AnswerTable, GuardTag, Discrepancies, Muted, Section, Stat, STATUS_WORDS, SECONDARY, TERTIARY, SECTION_LABEL, NUM, Button, Pill, StateDot, cellStyle, headStyle, jsx, jsxs };
		}

		/** The application gives up the width of whichever drawer is open (the two never open together). */
		function syncInset() {
			applyInset(drawerOpen.get() || libraryOpen.get() ? drawerWidth.get() : 0);
		}

		/** What the Library says about one document's state, as a short line. */
		function docStatusLine(doc) {
			if (doc.status === "ready") {
				const bits = [`${doc.pages} ${doc.pages === 1 ? "page" : "pages"}`];
				if (doc.tables) bits.push(`${doc.tables} ${doc.tables === 1 ? "table" : "tables"}`);
				bits.push(`${doc.facts} ${doc.facts === 1 ? "fact" : "facts"}`);
				return bits.join(" · ");
			}
			if (doc.status === "failed") return doc.status_detail || "could not be read";
			const pct = typeof doc.progress === "number" ? ` ${Math.round(doc.progress * 100)}%` : "";
			return `${doc.status_detail || doc.status}${pct}`;
		}

		/**
		 * The Library's row at the sidebar foot: where documents go in. Sits above the egress row in the same
		 * slot (`sidebar.footer.action`, root scope), styled as the same kind of control, because both answer a
		 * question the operator needs on the first screen — "what does this know?" and "what does it send?".
		 */
		function buildLibraryFootRow(ui) {
			const { useEffect, useState } = require("react");
			const { h, useStore, jsx, StateDot } = ui;
			const { Tooltip } = require("@deepseek-ai/dsh-client-ui-primitives");

			function LibraryFootRow(props) {
				const wide = props?.wide !== false;
				const [hot, setHot] = useState(false);
				const state = useStore(library);
				const open = useStore(libraryOpen);
				useEffect(() => watchLibrary(), []);
				const stats = state.stats;
				const busy = (stats?.processing ?? 0) > 0;
				const line = state.error
					? "backend not reachable"
					: !state.loaded
						? "Checking…"
						: busy
							? `${stats.processing} being read…`
							: `${stats?.documents ?? 0} ${(stats?.documents ?? 0) === 1 ? "document" : "documents"} · ${stats?.facts?.total ?? 0} facts`;
				const title = `Library: ${line}. Open it to add documents and see what was read from them.`;
				const row = h(
					"button",
					{
						type: "button",
						onClick: () => libraryOpen.toggle(),
						onMouseEnter: () => setHot(true),
						onMouseLeave: () => setHot(false),
						onFocus: () => setHot(true),
						onBlur: () => setHot(false),
						"aria-haspopup": "dialog",
						"aria-expanded": open ? "true" : "false",
						"aria-label": title,
						title,
						style: {
							display: "flex",
							alignItems: "center",
							gap: "10px",
							width: "100%",
							justifyContent: wide ? "flex-start" : "center",
							padding: wide ? "7px 10px" : "8px 0",
							border: "1px solid",
							borderColor: open || hot ? "var(--dsw-alias-border-l3)" : "var(--dsw-alias-border-l1)",
							borderRadius: "8px",
							background: open || hot ? "var(--dsw-alias-interactive-bg-hover)" : "var(--dsw-alias-bg-layer-2)",
							color: "var(--dsw-alias-label-primary)",
							font: "inherit",
							textAlign: "left",
							cursor: "pointer",
							transition: "background 120ms ease, border-color 120ms ease",
						},
					},
					jsx(StateDot, { state: state.error ? "error" : busy ? "warning" : "done", size: 8 }),
					wide &&
						h(
							"span",
							{ style: { flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" } },
							h("span", { style: { fontSize: "13px", lineHeight: 1.25 } }, "Library"),
							h("span", { style: { fontSize: "11.5px", lineHeight: 1.25, color: "var(--dsw-alias-label-tertiary)" } }, line),
						),
					wide && h("span", { "aria-hidden": "true", style: { flex: "0 0 auto", color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" } }, "›"),
				);
				return jsx(Tooltip, { label: title, delayMs: 500, disabled: wide, children: row });
			}
			return LibraryFootRow;
		}

		/**
		 * The Library drawer (`shell.overlay`, root scope): add documents, see what was read from each.
		 * Same mechanics as the Sovereignty drawer — fixed to the right edge, the application gives up its
		 * width rather than being covered — and the two never open together.
		 */
		function buildLibraryDrawer(ui) {
			const { useEffect, useRef, useState } = require("react");
			const { h, useStore, Stat, Muted, Tag, StatusDot, Button, SECONDARY, TERTIARY, SECTION_LABEL } = ui;

			const ACCEPT = ".pdf,.xlsx,.xls,.csv,.txt,.md,.png,.jpg,.jpeg,.tif,.tiff";

			function DocRow({ doc }) {
				const ready = doc.status === "ready";
				const failed = doc.status === "failed";
				const dotStatus = failed ? "rejected" : ready ? (doc.flagged > 0 ? "flagged" : "verified") : "flagged";
				return h(
					"div",
					{ style: { display: "flex", flexDirection: "column", gap: "4px", padding: "10px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)" } },
					h(
						"div",
						{ style: { display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 } },
						h("span", { style: { flex: "0 0 auto", alignSelf: "center" } }, h(StatusDot, { status: dotStatus, size: 8 })),
						h("span", { title: doc.filename, style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 } }, doc.title && doc.title !== doc.filename ? doc.title : doc.filename),
					),
					doc.title && doc.title !== doc.filename && h("div", { style: { ...TERTIARY, fontSize: "11.5px", paddingLeft: "16px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, doc.filename),
					h(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", paddingLeft: "16px" } },
						h(Tag, null, DOC_KIND_LABELS[doc.doc_kind] ?? doc.doc_kind),
						doc.is_provisional ? h(Tag, { title: "Figures in this document are provisional." }, "Provisional") : null,
						h("span", { style: { ...SECONDARY, fontSize: "12px" } }, docStatusLine(doc)),
						ready && doc.flagged > 0 && h(Tag, { tone: "warn" }, `${doc.flagged} flagged`),
					),
					ready &&
						h(
							"div",
							{ style: { display: "flex", gap: "4px", paddingLeft: "10px" } },
							h(Button, { variant: "ghost", size: "sm", onClick: () => openEvidence({ documentId: doc.id, page: 1 }) }, "View evidence"),
							h(
								Button,
								{
									variant: "ghost",
									size: "sm",
									onClick: () => {
										if (globalThis.confirm?.(`Remove "${doc.filename}" and every fact read from it?`)) {
											api(`/documents/${doc.id}`, { method: "DELETE" }).then(refreshLibrary).catch(() => {});
										}
									},
								},
								"Remove",
							),
						),
				);
			}

			function UploadLine({ upload }) {
				const words = { uploading: "uploading…", queued: "queued — being read", duplicate: "already in the library", failed: upload.message || "failed" };
				return h(
					"div",
					{ style: { display: "flex", gap: "8px", fontSize: "12px", ...SECONDARY, minWidth: 0 } },
					h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, upload.name),
					h("span", { style: { flex: "0 0 auto", color: upload.state === "failed" ? "var(--dsw-alias-state-error-primary)" : undefined } }, words[upload.state]),
				);
			}

			function LibraryDrawer() {
				const open = useStore(libraryOpen);
				const width = useStore(drawerWidth);
				const state = useStore(library);
				const inputRef = useRef(null);
				const [over, setOver] = useState(false);

				useEffect(() => (open ? watchLibrary() : undefined), [open]);
				useEffect(() => {
					syncInset();
					return () => syncInset();
				}, [open, width]);

				if (!open) return null;
				const stats = state.stats;
				const docs = state.docs;

				return h(
					"aside",
					{
						"aria-label": "Library",
						style: {
							position: "fixed",
							top: 0,
							right: 0,
							bottom: 0,
							width: `${width}px`,
							display: "flex",
							flexDirection: "column",
							background: "var(--dsw-alias-bg-layer-1)",
							borderLeft: "1px solid var(--dsw-alias-border-l2)",
							color: "var(--dsw-alias-label-primary)",
							fontSize: "13px",
							zIndex: 30,
						},
					},
					h(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: "8px", padding: "16px 18px 14px", borderBottom: "1px solid var(--dsw-alias-border-l1)" } },
						h("strong", { style: { flex: "1 1 auto", fontSize: "14px" } }, "Library"),
						h(Button, { variant: "ghost", size: "sm", onClick: () => libraryOpen.set(false), "aria-label": "Close the library" }, "Close"),
					),
					h(
						"div",
						{ style: { flex: "1 1 auto", overflowY: "auto", display: "flex", flexDirection: "column" } },
						h(
							"div",
							{ style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", padding: "16px 18px" } },
							h(Stat, { value: String(stats?.documents ?? "—"), caption: "documents" }),
							h(Stat, { value: String(stats?.pages ?? "—"), caption: "pages" }),
							h(Stat, { value: String(stats?.facts?.total ?? "—"), caption: "facts" }),
							h(Stat, { value: String(stats?.facts?.flagged ?? 0), caption: "flagged", warn: (stats?.facts?.flagged ?? 0) > 0 }),
						),
						h(
							"div",
							{ style: { padding: "0 18px 14px" } },
							h(
								"div",
								{
									role: "button",
									tabIndex: 0,
									onClick: () => inputRef.current?.click(),
									onKeyDown: (e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click(),
									onDragOver: (e) => {
										e.preventDefault();
										setOver(true);
									},
									onDragLeave: () => setOver(false),
									onDrop: (e) => {
										e.preventDefault();
										setOver(false);
										void uploadFiles(e.dataTransfer?.files);
									},
									style: {
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
										gap: "4px",
										padding: "16px",
										border: "1px dashed",
										borderColor: over ? "var(--dsw-alias-label-secondary)" : "var(--dsw-alias-border-l3)",
										borderRadius: "10px",
										background: over ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
										cursor: "pointer",
										textAlign: "center",
									},
								},
								h("span", { style: { fontWeight: 500 } }, "Add documents"),
								h("span", { style: { ...SECONDARY, fontSize: "12px" } }, "Drop PDF, Excel, CSV or scans here, or click to choose"),
								h("input", {
									ref: inputRef,
									type: "file",
									multiple: true,
									accept: ACCEPT,
									style: { display: "none" },
									tabIndex: -1,
									"aria-hidden": "true",
									onChange: (e) => {
										const files = Array.from(e.target.files ?? []);
										e.target.value = "";
										void uploadFiles(files);
									},
								}),
							),
							state.uploads.length > 0 && h("div", { style: { display: "flex", flexDirection: "column", gap: "4px", marginTop: "10px" } }, state.uploads.map((u) => h(UploadLine, { key: u.id, upload: u }))),
						),
						h(
							"div",
							{ style: { padding: "4px 18px 18px", borderTop: "1px solid var(--dsw-alias-border-l1)" } },
							h("div", { style: { ...SECTION_LABEL, margin: "14px 0 4px" } }, "Documents"),
							state.error
								? h(Muted, null, `The backend is not reachable: ${state.error}. Start it with run.bat.`)
								: !state.loaded
									? h(Muted, null, "Reading the library…")
									: docs.length === 0
										? h(Muted, null, "Nothing has been added yet. Drop a Provisional Coal Statistics PDF, an annual report, a parliamentary reply or a production sheet above.")
										: docs.map((d) => h(DocRow, { key: d.id, doc: d })),
						),
					),
					h(
						"div",
						{ style: { padding: "12px 18px", borderTop: "1px solid var(--dsw-alias-border-l1)", ...TERTIARY, fontSize: "11.5px", lineHeight: 1.45 } },
						"Documents are copied to this machine's own store and read here. Nothing is uploaded anywhere.",
					),
				);
			}

			return LibraryDrawer;
		}

		const fmtValue = (value) => Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

		/**
		 * The lineage of one fact: what it is, the cell it was copied from, every check it went through,
		 * and what other sources say. With `actions`, a reviewer can accept, edit or reject it — the only
		 * way a flagged fact becomes a verified one. This is "no confidence thresholds" made visible:
		 * the status is a list of named checks you can read.
		 */
		function buildLineagePanel(ui) {
			const { useState } = require("react");
			const { h, useJson, StatusDot, Tag, Muted, Section, Button, SECONDARY, TERTIARY, NUM, STATUS_WORDS, StateDot, jsx } = ui;

			const CHECK_DOT = { pass: "done", warn: "warning", fail: "error" };

			function LineagePanel({ factId, actions, onChanged }) {
				const { data: fact, error, loading, reload } = useJson(factId ? `/facts/${factId}` : null);
				const [editing, setEditing] = useState(false);
				const [value, setValue] = useState("");
				const [busy, setBusy] = useState(false);
				const [problem, setProblem] = useState(null);

				if (!factId) return h(Muted, null, "Click a highlighted figure to see where it came from and what was checked.");
				if (loading && !fact) return h(Muted, null, "Reading the lineage…");
				if (error) return h(Muted, { style: { color: "var(--dsw-alias-state-error-primary)" } }, `Could not read this fact: ${error}`);
				if (!fact) return null;

				const source = fact.sources?.[0];
				async function review(action) {
					setBusy(true);
					setProblem(null);
					try {
						await api(`/facts/${fact.id}/review`, { method: "POST", body: { action, value: action === "edit" ? Number(value) : undefined, reviewer: "reviewer" } });
						setEditing(false);
						reload();
						onChanged?.();
					} catch (e) {
						setProblem(e instanceof Error ? e.message : String(e));
					} finally {
						setBusy(false);
					}
				}

				return h(
					"div",
					{ style: { display: "flex", flexDirection: "column", gap: "14px" } },
					h(
						"div",
						{ style: { display: "flex", flexDirection: "column", gap: "4px" } },
						h("div", { style: { ...SECONDARY, fontSize: "12px" } }, `${fact.entity_name} · ${fact.metric_label} · ${fact.period}`),
						h(
							"div",
							{ style: { display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" } },
							h("span", { style: { fontSize: "26px", fontWeight: 600, letterSpacing: "-0.03em", ...NUM } }, fmtValue(fact.value)),
							h("span", { style: SECONDARY }, fact.unit_label),
							h(StatusDot, { status: fact.status, size: 9 }),
						),
						h("div", { style: { fontSize: "12px", color: fact.status === "flagged" ? "var(--dsw-alias-state-warn-label)" : "var(--dsw-alias-label-secondary)" } }, STATUS_WORDS[fact.status] ?? fact.status),
						h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, fact.is_provisional ? h(Tag, null, "Provisional") : null, fact.reviewed ? h(Tag, null, "Reviewed by a person") : null),
					),
					source &&
						h(
							Section,
							{ label: "Read from" },
							h("div", { style: { fontSize: "12.5px" } }, `“${source.raw_text}” in ${fact.filename}${source.page_no ? `, page ${source.page_no}` : ""}`),
							source.table_caption && h("div", { style: { ...SECONDARY, fontSize: "12px" } }, `Table: ${source.table_caption}`),
							source.row_text && h("div", { style: { ...SECONDARY, fontSize: "12px", fontFamily: "var(--ds-font-family-code)" } }, source.row_text),
							source.column_header && h("div", { style: { ...SECONDARY, fontSize: "12px" } }, `Column: ${source.column_header}`),
							source.conversion && h("div", { style: { fontSize: "12px" } }, `Converted: ${source.conversion.replace(/_/g, " ")}`),
							h("div", { style: { ...TERTIARY, fontSize: "11.5px" } }, `Copied verbatim from the cell by ${source.parser ?? "the parser"}. The model never writes a figure.`),
						),
					(fact.checks ?? []).length > 0 &&
						h(
							Section,
							{ label: "Checks" },
							fact.checks.map((c, i) =>
								h(
									"div",
									{ key: i, style: { display: "flex", gap: "8px", alignItems: "baseline", fontSize: "12.5px" } },
									jsx(StateDot, { state: CHECK_DOT[c.result] ?? "done", size: 7 }),
									h("span", { style: { flex: "0 0 auto", fontWeight: 500 } }, c.check_name.replace(/_/g, " ")),
									h("span", { style: SECONDARY }, c.detail),
								),
							),
						),
					(fact.alternatives ?? []).length > 0 &&
						h(
							Section,
							{ label: "Other sources say" },
							fact.alternatives.map((a) =>
								h(
									"div",
									{ key: a.id, style: { fontSize: "12.5px", color: "var(--dsw-alias-state-warn-label)" } },
									`${fmtValue(a.value)} — ${a.filename}${a.pq_number ? ` (${a.pq_house} ${a.pq_number}, ${a.pq_date})` : ""}${a.is_provisional ? ", provisional" : ""}`,
								),
							),
						),
					(fact.reviews ?? []).length > 0 &&
						h(
							Section,
							{ label: "Review history" },
							fact.reviews.map((r, i) => h("div", { key: i, style: { fontSize: "12.5px", ...SECONDARY } }, `${r.action} by ${r.reviewer}${r.action === "edit" ? `: ${fmtValue(r.old_value)} → ${fmtValue(r.new_value)}` : ""}${r.note ? ` — ${r.note}` : ""}`)),
						),
					actions &&
						h(
							"div",
							{ style: { display: "flex", flexDirection: "column", gap: "8px", paddingTop: "4px", borderTop: "1px solid var(--dsw-alias-border-l1)" } },
							editing
								? h(
										"div",
										{ style: { display: "flex", gap: "6px", alignItems: "center" } },
										h("input", {
											type: "number",
											step: "any",
											value,
											autoFocus: true,
											onChange: (e) => setValue(e.target.value),
											"aria-label": "Corrected value",
											style: { width: "120px", padding: "5px 8px", border: "1px solid var(--dsw-alias-border-l3)", borderRadius: "6px", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)", font: "inherit", ...NUM },
										}),
										h(Button, { variant: "outline", size: "sm", disabled: busy || value === "" || !Number.isFinite(Number(value)), onClick: () => review("edit") }, "Save"),
										h(Button, { variant: "ghost", size: "sm", onClick: () => setEditing(false) }, "Cancel"),
									)
								: h(
										"div",
										{ style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
										h(Button, { variant: "outline", size: "sm", disabled: busy || fact.status === "verified" && fact.reviewed, onClick: () => review("accept") }, "Accept"),
										h(Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => { setValue(String(fact.value)); setEditing(true); } }, "Edit value"),
										h(Button, { variant: "ghost", size: "sm", disabled: busy || fact.status === "rejected", onClick: () => review("reject") }, "Reject"),
										h(Button, { variant: "ghost", size: "sm", onClick: () => openEvidence({ documentId: fact.document_id, page: source?.page_no || 1, factId: fact.id }) }, "Show in evidence"),
									),
							problem && h("div", { style: { color: "var(--dsw-alias-state-error-primary)", fontSize: "12px" } }, problem),
						),
				);
			}
			return LineagePanel;
		}

		/** `conversation.view` tab: the page a figure came from, with every extracted cell boxed and clickable. */
		function buildEvidenceView(ui, LineagePanel) {
			const { useEffect, useState } = require("react");
			const { h, useStore, useJson, Muted, Tag, Button, SECONDARY, TERTIARY, SECTION_LABEL } = ui;

			function Box({ bbox, selected, title, onClick, dashed }) {
				if (!Array.isArray(bbox) || bbox.length < 4) return null;
				const [x0, y0, x1, y1] = bbox;
				return h("button", {
					type: "button",
					title,
					onClick,
					tabIndex: onClick ? 0 : -1,
					style: {
						position: "absolute",
						left: `${x0 * 100}%`,
						top: `${y0 * 100}%`,
						width: `${(x1 - x0) * 100}%`,
						height: `${(y1 - y0) * 100}%`,
						boxSizing: "border-box",
						padding: 0,
						cursor: onClick ? "pointer" : "default",
						background: selected ? "var(--dsw-alias-state-warn-tertiary)" : "transparent",
						border: selected ? "2px solid var(--dsw-alias-state-warn-primary)" : `1px ${dashed ? "dashed" : "solid"} var(--dsw-alias-border-l3)`,
						borderRadius: "2px",
					},
				});
			}

			/** A spreadsheet has no page image: show its table, with the cited cell marked. */
			function TableGrid({ documentId, tableId, mark }) {
				const { data, error } = useJson(tableId ? `/documents/${documentId}/tables/${tableId}` : null);
				if (error) return h(Muted, null, `Could not read the table: ${error}`);
				if (!data) return h(Muted, null, "Reading the table…");
				const grid = [];
				for (const cell of data.cells) (grid[cell.row_idx] ??= [])[cell.col_idx] = cell;
				return h(
					"div",
					{ style: { overflowX: "auto" } },
					data.caption && h("div", { style: { ...SECONDARY, fontSize: "12px", marginBottom: "8px" } }, data.caption),
					h(
						"table",
						{ style: { borderCollapse: "collapse", fontSize: "12.5px", ...ui.NUM } },
						h(
							"tbody",
							null,
							grid.map((row, r) =>
								h(
									"tr",
									{ key: r },
									(row ?? []).map((cell, c) => {
										const marked = mark && mark.row === r && mark.col === c;
										return h(
											"td",
											{
												key: c,
												style: {
													padding: "5px 10px",
													border: marked ? "2px solid var(--dsw-alias-state-warn-primary)" : "1px solid var(--dsw-alias-border-l1)",
													background: marked ? "var(--dsw-alias-state-warn-tertiary)" : cell?.is_header ? "var(--dsw-alias-bg-layer-2)" : "transparent",
													fontWeight: cell?.is_header ? 600 : 400,
													whiteSpace: "nowrap",
												},
											},
											cell?.text ?? "",
										);
									}),
								),
							),
						),
					),
				);
			}

			function EvidenceView() {
				const target = useStore(evidence);
				const lib = useStore(library);
				const [imageFailed, setImageFailed] = useState(false);
				useEffect(() => watchLibrary(), []);

				const ready = lib.docs.filter((d) => d.status === "ready");
				const docId = target.documentId ?? ready[0]?.id ?? null;
				const doc = ready.find((d) => d.id === docId) ?? null;
				const page = Math.max(1, Math.min(target.page || 1, doc?.pages || 1));
				const pageless = doc ? doc.parser === "pandas" || doc.parser === "plain" : false;
				useEffect(() => setImageFailed(false), [docId, page]);

				const overlay = useJson(doc && !pageless ? `/documents/${doc.id}/pages/${page}/overlay` : null, [doc?.id, page]);
				const lineage = useJson(target.factId ? `/facts/${target.factId}` : null);
				const detail = useJson(doc && pageless ? `/documents/${doc.id}` : null);
				const source = lineage.data?.sources?.[0];
				const gridTable = pageless ? (source?.table_id ?? detail.data?.tables_info?.[0]?.id ?? null) : null;

				const pickDoc = (id) => evidence.set({ documentId: id, page: 1, factId: null, chunkId: null, bbox: null, ts: Date.now() });
				const pickPage = (p) => evidence.set({ page: p, factId: null, chunkId: null, bbox: null, ts: Date.now() });
				const showImage = doc && !pageless && !imageFailed;

				if (!lib.loaded) return h(Muted, { style: { padding: "16px" } }, "Reading the library…");
				if (ready.length === 0) {
					return h(Muted, { style: { padding: "24px 16px" } }, "No document has been read yet. Open the Library at the bottom of the sidebar and add a PDF or spreadsheet; its pages and every extracted figure appear here.");
				}

				return h(
					"section",
					{ "aria-label": "Evidence", style: { display: "flex", alignItems: "flex-start", gap: "16px", padding: "16px", boxSizing: "border-box", color: "var(--dsw-alias-label-primary)" } },
					h(
						"div",
						{ style: { flex: "0 0 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: "14px", position: "sticky", top: "16px", maxHeight: "calc(100vh - 150px)", overflowY: "auto" } },
						h(
							"div",
							{ style: { display: "flex", flexDirection: "column", gap: "4px" } },
							h("div", { style: SECTION_LABEL }, "Documents"),
							ready.map((d) =>
								h(
									Button,
									{ key: d.id, variant: d.id === docId ? "outline" : "ghost", size: "sm", title: d.filename, onClick: () => pickDoc(d.id), style: { width: "100%", justifyContent: "flex-start", textAlign: "left" } },
									h("span", { style: { display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, SHORT_FILE(d.title && d.title !== d.filename ? d.title : d.filename, 30)),
								),
							),
						),
						doc && !pageless && doc.pages > 1 &&
							h(
								"div",
								{ style: { display: "flex", flexDirection: "column", gap: "4px" } },
								h("div", { style: SECTION_LABEL }, "Pages"),
								h("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap" } }, Array.from({ length: doc.pages }, (_, i) => h(Button, { key: i, variant: i + 1 === page ? "outline" : "ghost", size: "sm", onClick: () => pickPage(i + 1) }, String(i + 1)))),
							),
					),
					h(
						"div",
						{ style: { flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: "10px" } },
						doc &&
							h(
								"div",
								{ style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
								h("strong", { style: { fontSize: "13.5px" } }, doc.filename),
								h(Tag, null, DOC_KIND_LABELS[doc.doc_kind] ?? doc.doc_kind),
								doc.is_provisional ? h(Tag, null, "Provisional") : null,
								!pageless && h("span", { style: { ...SECONDARY, fontSize: "12px" } }, `page ${page} of ${doc.pages}`),
								target.chunkId && h(Tag, { title: "The passage the answer cited is outlined on the page." }, "Cited passage"),
							),
						showImage
							? h(
									"div",
									{ style: { position: "relative", maxWidth: "860px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", overflow: "hidden", background: "var(--dsw-alias-bg-layer-2)" } },
									h("img", {
										src: `${API}/documents/${doc.id}/pages/${page}.png`,
										alt: `Page ${page} of ${doc.filename}`,
										draggable: false,
										onError: () => setImageFailed(true),
										style: { display: "block", width: "100%", height: "auto" },
									}),
									(overlay.data?.tables ?? []).map((t) => h(Box, { key: `t${t.id}`, bbox: t.bbox, dashed: true, title: t.caption || "table" })),
									(overlay.data?.facts ?? []).map((f) =>
										h(Box, {
											key: `f${f.fact_id}`,
											bbox: f.bbox,
											selected: f.fact_id === target.factId,
											title: `${f.entity_code} · ${f.metric.replace(/_/g, " ")} · ${f.period}: ${f.raw_text} (${f.status})`,
											onClick: () => evidence.set({ factId: f.fact_id, bbox: null, chunkId: null }),
										}),
									),
									// A cited passage, or a fact whose cell is not in this page's overlay.
									target.bbox && (!target.factId || !(overlay.data?.facts ?? []).some((f) => f.fact_id === target.factId)) && h(Box, { bbox: target.bbox, selected: true, title: "Cited here" }),
								)
							: pageless
								? h(TableGrid, { documentId: doc?.id, tableId: gridTable, mark: source ? { row: source.row_idx, col: source.col_idx } : null })
								: doc
									? h(Muted, null, "This page image is not available.")
									: null,
						!pageless && overlay.error && h(Muted, null, `Overlay unavailable: ${overlay.error}`),
						h("div", { style: { ...TERTIARY, fontSize: "11.5px" } }, "Boxed figures are the cells Stratum extracted as facts; the outlined one is the cell the answer used."),
					),
					h("div", { style: { flex: "0 0 330px", minWidth: 0, position: "sticky", top: "16px", maxHeight: "calc(100vh - 150px)", overflowY: "auto" } }, h(LineagePanel, { factId: target.factId })),
				);
			}
			return EvidenceView;
		}

		/** `conversation.view` tab: every extracted fact, and the review queue for the ones a check failed. */
		function buildFactsView(ui, LineagePanel) {
			const { useState } = require("react");
			const { h, useJson, Muted, Tag, Button, StatusDot, SECONDARY, TERTIARY, NUM, cellStyle, headStyle } = ui;

			function FactsView() {
				const [filter, setFilter] = useState(null);
				const [selected, setSelected] = useState(null);
				const list = useJson("/facts?limit=500");
				if (list.error) return h(Muted, { style: { padding: "16px" } }, `Could not read the facts: ${list.error}`);
				if (!list.data) return h(Muted, { style: { padding: "16px" } }, "Reading the facts…");

				const { summary, facts } = list.data;
				const active = filter ?? ((summary.flagged ?? 0) > 0 ? "flagged" : "all");
				const shown = active === "all" ? facts : facts.filter((f) => f.status === active);
				const chips = [
					["flagged", "Needs review", summary.flagged ?? 0],
					["verified", "Verified", summary.verified ?? 0],
					["consistent", "Consistent", summary.consistent ?? 0],
					["rejected", "Rejected", summary.rejected ?? 0],
					["all", "All", summary.total ?? 0],
				];

				return h(
					"section",
					{ "aria-label": "Facts", style: { display: "flex", alignItems: "flex-start", gap: "16px", padding: "16px", boxSizing: "border-box", color: "var(--dsw-alias-label-primary)" } },
					h(
						"div",
						{ style: { flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: "12px" } },
						h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" } }, chips.filter(([key, , n]) => n > 0 || key === "all").map(([key, label, n]) => h(Button, { key, variant: key === active ? "outline" : "ghost", size: "sm", onClick: () => { setFilter(key); setSelected(null); } }, `${label} · ${n}`))),
						active === "flagged" && shown.length > 0 && h(Muted, null, "A check failed on each of these. Open one to see which, then accept it, correct it from the source page, or reject it. Nothing flagged is used in an answer until a person decides."),
						shown.length === 0
							? h(Muted, null, active === "flagged" ? "Nothing needs review." : "No facts in this view.")
							: h(
									"div",
									{ style: { overflowX: "auto", maxHeight: "calc(100vh - 230px)", overflowY: "auto", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: "8px" } },
									h(
										"table",
										{ style: { borderCollapse: "collapse", width: "100%", fontSize: "12.5px" } },
										h("thead", null, h("tr", null, ["Entity", "Metric", "Period", "Value", "Status", "Source"].map((t, i) => h("th", { key: t, style: { ...headStyle, textAlign: i >= 3 && i < 4 ? "right" : "left", position: "sticky", top: 0, background: "var(--dsw-alias-bg-layer-1)" } }, t)))),
										h(
											"tbody",
											null,
											shown.map((f) =>
												h(
													"tr",
													{
														key: f.id,
														onClick: () => setSelected(f.id),
														style: { cursor: "pointer", background: f.id === selected ? "var(--dsw-alias-interactive-bg-hover)" : "transparent" },
													},
													h("td", { style: { ...cellStyle, textAlign: "left" } }, f.entity_code),
													h("td", { style: { ...cellStyle, textAlign: "left" } }, f.metric.replace(/_/g, " ")),
													h("td", { style: { ...cellStyle, textAlign: "left" } }, f.period),
													h("td", { style: cellStyle }, `${fmtValue(f.value)} ${f.unit_label}`, f.is_provisional ? h("sup", { style: { ...TERTIARY, fontSize: "9px" } }, " P") : null),
													h("td", { style: { ...cellStyle, textAlign: "left" } }, h("span", { style: { display: "inline-flex", alignItems: "center", gap: "6px" } }, h(StatusDot, { status: f.status, size: 7 }), f.status)),
													h("td", { style: { ...cellStyle, textAlign: "left", ...SECONDARY }, title: f.filename }, `${SHORT_FILE(f.filename, 30)}${f.page_no ? ` · p.${f.page_no}` : ""}`),
												),
											),
										),
									),
								),
					),
					h("div", { style: { flex: "0 0 340px", minWidth: 0, position: "sticky", top: "16px", maxHeight: "calc(100vh - 150px)", overflowY: "auto" } }, h(LineagePanel, { factId: selected, actions: true, onChanged: () => { list.reload(); void refreshLibrary(); } })),
				);
			}
			return FactsView;
		}

		/** `conversation.view` tab: topics across the library, the word cloud, and topic-over-time. */
		function buildTopicsView(ui) {
			const { useState } = require("react");
			const { h, useJson, Muted, Tag, Button, Card, SECONDARY, TERTIARY, NUM, SECTION_LABEL } = ui;

			function YearBars({ byYear }) {
				const years = Object.entries(byYear ?? {});
				if (years.length === 0) return null;
				const max = Math.max(...years.map(([, n]) => n));
				return h(
					"div",
					{ style: { display: "flex", alignItems: "flex-end", gap: "6px", height: "44px" }, "aria-label": "Passages by document year" },
					years.map(([year, n]) =>
						h(
							"div",
							{ key: year, title: `${year}: ${n} passages`, style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", justifyContent: "flex-end", height: "100%" } },
							h("div", { style: { width: "18px", height: `${Math.max(3, (n / max) * 30)}px`, background: "var(--dsw-alias-label-secondary)", borderRadius: "2px 2px 0 0" } }),
							h("span", { style: { ...TERTIARY, fontSize: "10px", ...NUM } }, String(year).slice(-2)),
						),
					),
				);
			}

			function TopicsView() {
				const topics = useJson("/topics");
				const [building, setBuilding] = useState(false);
				const [problem, setProblem] = useState(null);
				async function rebuild() {
					setBuilding(true);
					setProblem(null);
					try {
						await api("/topics/rebuild", { method: "POST", body: {} });
						topics.reload();
					} catch (e) {
						setProblem(e instanceof Error ? e.message : String(e));
					} finally {
						setBuilding(false);
					}
				}
				const data = topics.data;
				return h(
					"section",
					{ "aria-label": "Topics", style: { display: "flex", flexDirection: "column", gap: "14px", padding: "16px", maxWidth: "980px", boxSizing: "border-box", color: "var(--dsw-alias-label-primary)" } },
					h(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
						h("strong", { style: { fontSize: "14px" } }, "Topics in the library"),
						data?.status === "ok" && h(Tag, null, `${data.topics.length} topics · ${data.chunks} passages · ${data.documents} documents`),
						h("span", { style: { flex: "1 1 auto" } }),
						h(Button, { variant: "outline", size: "sm", disabled: building, onClick: rebuild }, building ? "Building…" : data?.status === "ok" ? "Rebuild" : "Build topics"),
					),
					problem && h(Muted, { style: { color: "var(--dsw-alias-state-error-primary)" } }, problem),
					topics.error && h(Muted, null, `Could not read the topics: ${topics.error}`),
					data && data.status !== "ok" && h(Muted, null, data.message ?? "Topics have not been built yet."),
					data?.status === "ok" &&
						h(
							"div",
							{ style: { display: "flex", flexDirection: "column", gap: "14px" } },
							h("img", { src: `${API}/topics/wordcloud.png?v=${Math.round(data.built_at)}`, alt: "Word cloud of the most frequent terms across the library", style: { width: "100%", maxWidth: "860px", borderRadius: "10px", border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-layer-1)" }, onError: (e) => { e.target.style.display = "none"; } }),
							h(
								"div",
								{ style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "12px" } },
								data.topics.map((t) =>
									h(
										Card,
										{ key: t.id, title: t.label, meta: h(Tag, null, `${t.count} passages`), style: { margin: 0 } },
										h("div", { style: { display: "flex", gap: "5px", flexWrap: "wrap" } }, t.keywords.slice(0, 6).map((k) => h(Tag, { key: k }, k))),
										h(YearBars, { byYear: t.by_year }),
										t.examples?.[0] &&
											h(
												"button",
												{
													type: "button",
													onClick: () => openEvidence({ documentId: t.examples[0].document_id, page: t.examples[0].page_no }),
													title: "Open this passage's page in the Evidence tab",
													style: { all: "unset", cursor: "pointer", ...SECONDARY, fontSize: "12px", lineHeight: 1.45 },
												},
												`“${t.examples[0].snippet.replace(/\s+/g, " ").slice(0, 150)}…”`,
												h("span", { style: { ...TERTIARY, display: "block", marginTop: "2px" } }, `${SHORT_FILE(t.examples[0].filename, 40)} · p.${t.examples[0].page_no}`),
											),
									),
								),
							),
						),
				);
			}
			return TopicsView;
		}

		/** `conversation.view` tab: the percentages the problem statement asks for, computed from the gold set and the logs. */
		function buildMetricsView(ui) {
			const { h, useJson, Muted, Tag, Card, Stat, Button, SECONDARY, TERTIARY, SECTION_LABEL, cellStyle, headStyle } = ui;

			const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);

			function MetricsView() {
				const metrics = useJson("/metrics");
				if (metrics.error) return h(Muted, { style: { padding: "16px" } }, `Could not compute the metrics: ${metrics.error}`);
				if (!metrics.data) return h(Muted, { style: { padding: "16px" } }, "Computing against the gold set…");
				const m = metrics.data;
				const tiles = [
					["Extraction exact-match", pct(m.extraction.exact_match_pct), `${m.extraction.gold} hand-checked facts${m.extraction.gold === 0 ? " — fill metrics/gold.yaml" : ""}`],
					[
						"Wrong values caught by a check",
						m.extraction.wrong > 0 ? pct(m.extraction.wrong_caught_pct) : m.extraction.gold > 0 ? "none wrong" : "—",
						m.extraction.wrong > 0 ? `${m.extraction.wrong_caught} of ${m.extraction.wrong} wrong extractions carry a failed check, so none reaches an answer unseen` : "no wrong extraction to catch in the gold set",
					],
					["Routing accuracy", pct(m.routing.accuracy_pct), `${m.routing.questions} questions, SQL / documents / both`],
					["Numeric answers correct", pct(m.numeric_answers.correct_pct), `${m.numeric_answers.questions} questions with known figures`],
					["Citation correctness", pct(m.lineage.citation_correct_pct), `${m.lineage.facts} facts traced to their cell`],
					["Unsupported-number rate", pct(m.guard.unsupported_rate_pct), `${m.guard.unsupported} of ${m.guard.numbers_checked} figures in ${m.guard.answers} answers (lower is better)`],
					["Automation", pct(m.automation.automation_pct), `${m.automation.automated_steps} automated · ${m.automation.manual_steps} manual steps`],
					["Time reduction", pct(m.time.reduction_pct), m.time.trials > 0 ? `${m.time.trials} timed trials` : "no timed trials yet — add them to gold.yaml"],
				];
				return h(
					"section",
					{ "aria-label": "Metrics", style: { display: "flex", flexDirection: "column", gap: "16px", padding: "16px", maxWidth: "1000px", boxSizing: "border-box", color: "var(--dsw-alias-label-primary)" } },
					h(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
						h("strong", { style: { fontSize: "14px" } }, "Measured, not asserted"),
						h(Tag, null, `${m.library.documents} documents · ${m.library.chunks} passages · ${m.library.facts.total} facts`),
						h("span", { style: { flex: "1 1 auto" } }),
						h(Button, { variant: "ghost", size: "sm", onClick: metrics.reload }, "Recompute"),
					),
					h(Muted, null, "Every figure below is computed now — from the hand-checked gold set and from the system's own logs — and carries its denominator, so a small sample looks small."),
					h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "12px" } }, tiles.map(([title, value, caption]) => h(Card, { key: title, style: { margin: 0 } }, h("div", { style: { ...SECONDARY, fontSize: "12px" } }, title), h(Stat, { value, caption })))),
					m.extraction.details.some((d) => d.result !== "match") &&
						h(
							Card,
							{ title: "Extraction misses", style: { margin: 0 } },
							m.extraction.details.filter((d) => d.result !== "match").map((d, i) => h("div", { key: i, style: { fontSize: "12.5px", color: "var(--dsw-alias-state-warn-label)" } }, `${d.entity} ${d.metric} ${d.period}: expected ${d.value}, ${d.result === "missing" ? "not extracted" : `got ${d.got}`} (${d.source ?? "gold"})`)),
						),
					m.routing.details.some((d) => !d.ok) &&
						h(
							Card,
							{ title: "Routing misses", style: { margin: 0 } },
							m.routing.details.filter((d) => !d.ok).map((d, i) => h("div", { key: i, style: { fontSize: "12.5px" } }, `“${d.q}” → ${d.got} (expected ${d.expected})`)),
						),
				);
			}
			return MetricsView;
		}

		/**
		 * The cards a Stratum tool result renders as, registered as keyed `tool.call.toolview` entries
		 * (`key` = the wire tool name). A keyed entry replaces the harness's generic row for that tool, so each
		 * card carries its own header. The text of the answer is the assistant message beneath the card; the card
		 * is the *evidence* — the table whose every figure opens its source cell, the citations, the notes a
		 * careful officer would want before relying on it.
		 *
		 * The data is the tool's `presentationMeta`: the backend's whole JSON result, persisted with the session
		 * log, so a reopened session shows the same cards.
		 */
		function buildToolviews(ui) {
			const { h, Card, Tag, AnswerTable, GuardTag, Discrepancies, CitationChip, Muted, Section, StatusDot, StateDot, jsx, Button, SECONDARY, TERTIARY, SECTION_LABEL, NUM, cellStyle, headStyle } = ui;

			const RESULT_KEYS = ["answer", "table", "parts", "sections", "topics", "header", "status", "citations"];
			/** The tool's JSON result, wherever the harness tucked it inside the settled block. */
			function metaOf(block) {
				const seen = new Set();
				const look = (value, depth) => {
					if (!value || typeof value !== "object" || seen.has(value) || depth > 3) return null;
					seen.add(value);
					if (!Array.isArray(value) && RESULT_KEYS.some((k) => k in value)) return value;
					for (const inner of Object.values(value)) {
						const found = look(inner, depth + 1);
						if (found) return found;
					}
					return null;
				};
				return look(block?.meta, 0);
			}

			const textOf = (block) => (block?.content ?? []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");

			/** The frame every card shares: a running line while the tool works, an error line if it failed, the body when it settled. */
			function Frame({ block, running, title, children }) {
				if (block?.kind !== "tool-result") {
					return h(Card, null, h("div", { style: { display: "flex", alignItems: "center", gap: "8px", ...SECONDARY } }, jsx(StateDot, { state: "warning", size: 8 }), running));
				}
				const meta = metaOf(block);
				if (block.isError || meta?.status === "error") {
					return h(Card, { title }, h("div", { style: { display: "flex", gap: "8px", color: "var(--dsw-alias-state-error-primary)" } }, jsx(StateDot, { state: "error", size: 8 }), meta?.answer ?? (textOf(block) || "The tool failed.")));
				}
				if (!meta) return h(Card, { title }, h("div", { style: { whiteSpace: "pre-wrap", ...SECONDARY } }, textOf(block)));
				return children(meta);
			}

			const Notes = ({ notes }) =>
				notes && notes.length > 0 ? h("div", { style: { ...TERTIARY, fontSize: "12px" } }, notes.join(" · ")) : null;

			function Citations({ citations, limit = 12 }) {
				if (!citations || citations.length === 0) return null;
				return h(Section, { label: "Sources" }, h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, citations.slice(0, limit).map((c) => h(CitationChip, { key: `${c.n}`, citation: c }))));
			}

			/** The .docx the backend wrote: open it through the harness, or download it. */
			function FileChip({ path, openFile }) {
				if (!path) return null;
				const name = String(path).split(/[\\/]/).at(-1);
				return h(
					"div",
					{ style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "8px 10px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-2)" } },
					h("span", { style: { fontWeight: 500 } }, name),
					h("span", { style: { ...TERTIARY, fontSize: "12px", flex: "1 1 auto" } }, "Word document"),
					openFile && h(Button, { variant: "ghost", size: "sm", onClick: () => openFile(`deliverables/${name}`) }, "Open"),
					h("a", { href: `${API}/deliverables/${name}`, download: name, style: { color: "var(--dsw-alias-label-primary)", fontSize: "12.5px", textDecoration: "underline" } }, "Download"),
				);
			}

			function AskCard(props) {
				return h(Frame, { block: props.block, running: "Looking this up in the library…", title: "Ask the library" }, (m) => {
					const insufficient = m.status === "insufficient";
					const intent = m.intent ?? {};
					return h(
						Card,
						{
							title: "Ask the library",
							meta: [
								h(Tag, { key: "r", title: "Which path answered: SQL over verified facts, search over documents, or both." }, ROUTE_LABELS[m.route] ?? m.route),
								insufficient ? h(Tag, { key: "i", tone: "warn" }, "Insufficient evidence") : null,
								!insufficient && h(GuardTag, { key: "g", guard: m.guard }),
								m.composed_by && m.composed_by !== "none" && h(Tag, { key: "c", title: "Figures are always stated from the evidence table; this says who wrote the wording." }, m.composed_by === "llm" ? "Wording: local model" : "Wording: template"),
							],
						},
						m.table && m.table.rows.length > 0 && h(AnswerTable, { table: m.table, citations: m.citations }),
						h(Discrepancies, { items: m.discrepancies }),
						h(Citations, { citations: m.citations }),
						insufficient && h(Muted, null, "Nothing in the ingested documents answers this with verified evidence, so Stratum does not guess."),
						h(Notes, { notes: intent.notes }),
						h(
							"details",
							{ style: { ...TERTIARY, fontSize: "12px" } },
							h("summary", { style: { cursor: "pointer" } }, "How this was understood"),
							h("div", { style: { marginTop: "6px", fontFamily: "var(--ds-font-family-code)", fontSize: "11.5px", whiteSpace: "pre-wrap" } }, JSON.stringify({ route: intent.route, metric: intent.metric, entities: intent.entities, periods: intent.periods, scope: intent.scope, language: intent.language, parsed_by: intent.source, seconds: m.seconds }, null, 1)),
						),
					);
				});
			}

			function PqCard(props) {
				return h(Frame, { block: props.block, running: "Drafting the reply, part by part…", title: "Parliamentary reply" }, (m) => {
					const header = m.header ?? {};
					const headline = [header.pq_house, header.pq_number].filter(Boolean).join(" ");
					return h(
						Card,
						{
							title: headline || "Parliamentary reply",
							meta: [header.pq_date && h(Tag, { key: "d" }, header.pq_date), header.pq_subject && h("span", { key: "s", style: { ...SECONDARY, fontSize: "12.5px" } }, header.pq_subject)],
						},
						(m.warnings ?? []).length > 0 &&
							h(
								Section,
								{ label: `Review before sending · ${m.warnings.length}` },
								m.warnings.map((w, i) =>
									h(
										"div",
										{ key: i, style: { display: "flex", gap: "8px", alignItems: "baseline", fontSize: "12.5px", color: "var(--dsw-alias-state-warn-label)" } },
										jsx(StateDot, { state: "warning", size: 7 }),
										h("span", null, w.message),
									),
								),
							),
						(m.parts ?? []).map((part) =>
							h(
								"div",
								{ key: part.label, style: { display: "flex", flexDirection: "column", gap: "6px", paddingTop: "10px", borderTop: "1px solid var(--dsw-alias-border-l1)" } },
								h("div", { style: { display: "flex", gap: "8px", alignItems: "baseline" } }, h("strong", null, `(${part.label})`), h("span", { style: SECONDARY }, part.question)),
								h("div", { style: { whiteSpace: "pre-wrap", paddingLeft: "22px" } }, String(part.answer ?? "").replace(/\s*\[\d+(?:[-,]\s*\d+)*\]/g, "")),
								h("div", { style: { display: "flex", gap: "6px", paddingLeft: "22px" } }, h(Tag, null, ROUTE_LABELS[part.route] ?? part.route), part.status === "insufficient" ? h(Tag, { tone: "warn" }, "Needs officer input") : null, h(GuardTag, { guard: part.guard })),
								part.table && part.table.rows.length > 0 && part.table.rows.length <= 3 && h("div", { style: { paddingLeft: "22px" } }, h(AnswerTable, { table: part.table, citations: m.citations })),
							),
						),
						(m.annexures ?? []).map((a) => h(Section, { key: a.label, label: `${a.label} · part (${a.part})` }, h(AnswerTable, { table: a.table, citations: m.citations }))),
						(m.similar ?? []).length > 0 &&
							h(
								Section,
								{ label: "Similar questions already answered" },
								m.similar.map((s) =>
									h(
										"button",
										{ key: s.document_id, type: "button", onClick: () => openEvidence({ documentId: s.document_id, page: s.page_no }), title: "Open this reply in the Evidence tab", style: { all: "unset", cursor: "pointer", display: "flex", gap: "8px", alignItems: "baseline", fontSize: "12.5px" } },
										h("span", { style: { fontWeight: 500 } }, `${s.house ?? ""} ${s.number ?? ""}`.trim() || s.filename),
										s.date && h("span", { style: SECONDARY }, s.date),
										h("span", { style: { ...SECONDARY, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, s.subject && !/^[0-9a-f]{40,}$/.test(s.subject) ? s.subject : ""),
										h("span", { style: { ...TERTIARY, ...NUM } }, `${Math.round((s.similarity ?? 0) * 100)}% similar`),
									),
								),
							),
						h(Citations, { citations: m.citations }),
						h(FileChip, { path: m.docx_path, openFile: props.openFile }),
					);
				});
			}

			/** A small inline chart of one report series: a polyline for a trend, bars for a comparison. */
			function MiniChart({ kind, name, points }) {
				if (!points || points.length === 0) return null;
				const values = points.map((p) => p[1]);
				const max = Math.max(...values, 1);
				const min = kind === "line" ? Math.min(...values) : 0;
				const W = 220;
				const H = 44;
				const x = (i) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * (W - 8) + 4);
				const y = (v) => H - 4 - ((v - min) / Math.max(max - min, 1e-9)) * (H - 10);
				const bw = Math.max(4, W / points.length - 6);
				return h(
					"div",
					{ style: { display: "flex", alignItems: "center", gap: "10px", fontSize: "12px" } },
					h("span", { style: { flex: "0 0 70px", ...SECONDARY }, title: name }, SHORT_FILE(name, 12)),
					h(
						"svg",
						{ width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${name}: ${points.map((p) => `${p[0]} ${p[1]}`).join(", ")}`, style: { color: "var(--dsw-alias-label-secondary)" } },
						kind === "line"
							? [h("polyline", { key: "l", points: points.map((p, i) => `${x(i)},${y(p[1])}`).join(" "), fill: "none", stroke: "currentColor", strokeWidth: 1.8 }), ...points.map((p, i) => h("circle", { key: i, cx: x(i), cy: y(p[1]), r: 2.4, fill: "currentColor" }))]
							: points.map((p, i) => h("rect", { key: i, x: (i / points.length) * W + 3, y: y(p[1]), width: bw, height: H - 4 - y(p[1]), fill: "currentColor", opacity: 0.85 })),
					),
					h("span", { style: { ...NUM, ...SECONDARY } }, `${points.at(-1)[0]}: ${fmtValue(points.at(-1)[1])}`),
				);
			}

			function ReportCard(props) {
				return h(Frame, { block: props.block, running: "Building the report from verified facts…", title: "Report" }, (m) =>
					h(
						Card,
						{ title: m.title ?? "Report", meta: [m.guard && h(GuardTag, { key: "g", guard: { ok: m.guard.ok, checked: m.guard.checked, unsupported: m.guard.ok ? [] : [`${m.guard.unsupported} figure(s)`] } })] },
						(m.sections ?? []).map((s, i) => {
							if (s.type === "heading") return h("strong", { key: i, style: { paddingTop: "4px" } }, s.text);
							if (s.type === "table") return s.table.rows.length > 0 ? h(AnswerTable, { key: i, table: s.table, citations: m.citations }) : h(Muted, { key: i }, "Insufficient verified evidence for this table.");
							if (s.type === "target_table") {
								return h(
									"div",
									{ key: i, style: { overflowX: "auto" } },
									h(
										"table",
										{ style: { borderCollapse: "collapse", width: "100%", fontSize: "13px" } },
										h("thead", null, h("tr", null, ["Entity", `Target ${s.period}`, `Actual ${s.period}`, "Achievement"].map((t, j) => h("th", { key: t, style: { ...headStyle, textAlign: j === 0 ? "left" : "right" } }, t)))),
										h("tbody", null, s.rows.map((r) => h("tr", { key: r.entity }, h("td", { style: { ...cellStyle, textAlign: "left" } }, r.entity), h("td", { style: cellStyle }, r.target === null ? "—" : fmtValue(r.target)), h("td", { style: cellStyle }, r.actual === null ? "—" : fmtValue(r.actual)), h("td", { style: cellStyle }, r.achievement_pct === null ? "—" : `${r.achievement_pct.toFixed(2)}%`)))),
									),
								);
							}
							if (s.type === "chart") return h("div", { key: i, style: { display: "flex", flexDirection: "column", gap: "6px" } }, Object.entries(s.series).slice(0, 6).map(([name, points]) => h(MiniChart, { key: name, kind: s.kind, name, points })));
							if (s.type === "narrative") return h("div", { key: i, style: { whiteSpace: "pre-wrap" } }, String(s.text).replace(/\s*\[\d+(?:[-,]\s*\d+)*\]/g, ""));
							if (s.type === "evidence" && s.passages.length > 0) return h(Muted, { key: i }, `${s.passages.length} supporting passage${s.passages.length === 1 ? "" : "s"} quoted in the document.`);
							return null;
						}),
						h(Citations, { citations: m.citations }),
						h(FileChip, { path: m.docx_path, openFile: props.openFile }),
					),
				);
			}

			function TopicsCard(props) {
				return h(Frame, { block: props.block, running: "Reading the topics…", title: "Library topics" }, (m) => {
					if (m.status !== "ok") return h(Card, { title: "Library topics" }, h(Muted, null, m.message ?? "Topics have not been built yet."));
					return h(
						Card,
						{ title: "Library topics", meta: [h(Tag, { key: "n" }, `${m.topics.length} topics · ${m.chunks} passages`)] },
						m.topics.slice(0, 8).map((t) =>
							h(
								"div",
								{ key: t.id, style: { display: "flex", gap: "10px", alignItems: "baseline", minWidth: 0 } },
								h("span", { style: { flex: "0 0 auto", fontWeight: 500 } }, t.label),
								h("span", { style: { ...SECONDARY, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.keywords.slice(0, 5).join(", ")),
								h("span", { style: { ...TERTIARY, ...NUM } }, `${t.count}`),
							),
						),
						h("div", null, h(Button, { variant: "outline", size: "sm", onClick: () => activateTab("Topics") }, "Open the Topics tab")),
					);
				});
			}

			return { stratum_ask: AskCard, stratum_pq_reply: PqCard, stratum_report: ReportCard, stratum_topics: TopicsCard };
		}

		/**
		 * Replace the harness's two composer placeholders with Stratum's own. They are locale strings inside
		 * `dsh-client-ui-conversation` that nothing can override (see `StratumHero`), so the attribute is
		 * rewritten where it lands; React does not touch an attribute whose prop has not changed.
		 * @returns a dispose function that stops observing.
		 */
		function holdPlaceholders() {
			const MAP = {
				"Describe what you want to build": "Ask about production, offtake or targets — or paste a parliamentary question",
				"Message the agent": "Ask a follow-up, or paste the next question",
			};
			function fix() {
				for (const field of document.querySelectorAll("textarea[placeholder]")) {
					const next = MAP[field.getAttribute("placeholder")];
					if (next) field.setAttribute("placeholder", next);
				}
			}
			fix();
			if (typeof MutationObserver !== "function" || !document.body) return () => {};
			const observer = new MutationObserver(fix);
			observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["placeholder"] });
			return () => observer.disconnect();
		}

		/**
		 * Client plugin body. Checks the React seam, then takes nine seats.
		 *
		 * Story 1.5's mark goes into `conversation.hero.brand.mark` — `single`,
		 * so occupying it replaces whatever the host registered there (the
		 * DeepSeek whale) — and `sidebar.brand.mark`, the collapsed-rail seat:
		 * with `@deepseek-ai/dsh-client-ui-brand-official` disabled
		 * (`cordis.patch.yml`, `id: ui-brand-official`) nothing else fills it,
		 * and ui-layout falls back to its own built-in whale rather than
		 * rendering nothing, so we take it too rather than leave that fallback
		 * showing.
		 *
		 * `sidebar.brand.mark` is not in the verified seat table in
		 * `docs/deepseek-harness-notes.md` — nothing in this repo confirms which
		 * package declares it (its one known filler, `ui-brand-official`, is the
		 * one we've disabled). Confirmed empirically instead, by screenshot
		 * (`docs/screenshots/1-5-brand-mark-*.png`): re-verify by source if a
		 * harness upgrade ever changes ui-layout's rail rendering.
		 *
		 * Story 1.4's task-type indicator goes into `conversation.hero.agentPreset`,
		 * replacing the host's own chip for this deployment. It displays; it does not
		 * choose (corrected 28 Aug 2026 — see `buildTaskTypeIndicator`).
		 *
		 * Story 3.2's provider disclosure goes into
		 * `conversation.session.header.utilities` — a session-scoped `list` slot,
		 * so it is additive rather than a replacement — naming the active
		 * model-plane provider, and saying "replay" and "authored" in plain words
		 * when that is the provider (see `buildProviderDisclosure`).
		 *
		 * Story 3.7's routing chip goes into `conversation.input.model` — `single`,
		 * so occupying it replaces the stock model picker
		 * (`@deepseek-ai/dsh-client-ui-model-selection`, disabled in the profile).
		 * It also registers a conversation view (`st-routing`) and the event
		 * Definition that feeds it, both on `ctx.conversationEvents` /
		 * `ctx.conversationViews`, so the chip reads the router's recorded
		 * `router/routed` decision rather than recomputing it.
		 *
		 * Story 2.2's egress monitor takes two more: the compact chip shares
		 * `conversation.session.header.utilities` with the provider disclosure
		 * (list, additive), and the full panel takes `shell.overlay` (list,
		 * root). Both read one number — the count of `egress/denied` events —
		 * through a registered `st-egress` conversation view; the chip toggles
		 * the panel through a module-scoped open store.
		 *
		 * Story 4.5's crop viewer took `conversation.view` (list, session) until
		 * 31 August 2026; ADR-0008 removed it with the OCR service it read from.
		 * The seat is free again.
		 *
		 * The composer menu takes `conversation.input.left` (list, session). Its
		 * attach row hands the picked image to the harness's own attachment draft
		 * rather than uploading it anywhere of ours — see `handToComposer`.
		 *
		 * A broken React seam aborts all of them: every one of them renders
		 * through the host's `react/jsx-runtime`, so registering into a slot
		 * without it would trade one loud console error for obscure render
		 * failures. (The conversation Definitions carry no React and are
		 * registered regardless — a chip that never renders still leaves the
		 * session log's routing and egress views correct for anything else
		 * that reads them.)
		 * @param ctx - client root context, carrying the `slots`,
		 * `conversationEvents`, `conversationViews` and `sessions` services
		 * declared in `inject` below.
		 */
		function apply(ctx) {
			const disposeRoutingView = ctx.conversationViews?.register?.(routingViewDefinition);
			const disposeRoutingEvents = ctx.conversationEvents?.register?.(routingNodeDefinition);
			const disposeEgressView = ctx.conversationViews?.register?.(egressViewDefinition);
			const disposeEgressEvents = ctx.conversationEvents?.register?.(egressNodeDefinition);
			if (!checkHostReactSeam()) {
				return () => {
					disposeRoutingView?.();
					disposeRoutingEvents?.();
					disposeEgressView?.();
					disposeEgressEvents?.();
				};
			}
			const disposeTabTitle = holdTabTitle();
			const TaskTypeIndicator = buildTaskTypeIndicator();
			const ProviderDisclosure = buildProviderDisclosure();
			const RoutingChip = buildRoutingChip(ctx);
			const SealFootRow = buildSealFootRow(ctx);
			const SovereigntyDrawer = buildSovereigntyDrawer(ctx);
			const DenialNotice = buildDenialNotice(ctx);
			const SealBand = buildSealBand(ctx);
			const ui = buildUi();
			const LineagePanel = buildLineagePanel(ui);
			const EvidenceView = buildEvidenceView(ui, LineagePanel);
			const FactsView = buildFactsView(ui, LineagePanel);
			const TopicsView = buildTopicsView(ui);
			const MetricsView = buildMetricsView(ui);
			const LibraryFootRow = buildLibraryFootRow(ui);
			const LibraryDrawer = buildLibraryDrawer(ui);
			const toolviews = buildToolviews(ui);
			const disposePlaceholders = holdPlaceholders();
			// The two drawers share the right edge: opening one closes the other.
			const stopLibraryExclusion = libraryOpen.subscribe(() => libraryOpen.get() && drawerOpen.set(false));
			const stopSovereigntyExclusion = drawerOpen.subscribe(() => drawerOpen.get() && libraryOpen.set(false));
			// Hide the shipped hero headline so the lockup above is the only one on
			// screen. One rule, one job: it hides a node and fabricates nothing. The
			// selector matches the CSS-module local name rather than the build hash in
			// front of it, which is the stable half. See `StratumHero` for what happens
			// if a harness upgrade renames it.
			let disposeHeadlineStyle = () => {};
			if (typeof document !== "undefined" && document.head) {
				const style = document.createElement("style");
				style.dataset.Stratum = "hero-headline";
				style.textContent = [
					// The hero headline row is a grid, and the mark's cell is a fixed 34px
					// track - sized for a mark, which is all it ever held. The lockup is
					// wider than that and overflowed onto the Preview badge. Flex lets the
					// cell size to its content and keeps the badge after it.
					'[class*="_headline"] { display: flex !important; align-items: center; }',
					'[class*="_headlineText"] { display: none !important; }',
					// The harness's own `+`. Our composer menu stands in its place and
					// carries what it carried plus the document, so leaving both would
					// put two plus buttons side by side. Matched on the class fragment
					// AND the ARIA role, because `_add` alone matches other things and
					// the accessible name is a locale string. See `buildComposerMenu`
					// for what happens if a harness upgrade renames the class.
					'button[class*="_add"][aria-haspopup="listbox"] { display: none !important; }',
				].join("\n");
				document.head.appendChild(style);
				disposeHeadlineStyle = () => {
					style.remove();
				};
			}

			const disposeSidebarMark = ctx.slots.inject("sidebar.brand.mark", function* () {
				yield ctx.slots.register({ name: "sidebar.brand.mark" }, RingedMark);
			});
			const disposeSidebarName = ctx.slots.inject("sidebar.brand.name", function* () {
				yield ctx.slots.register({ name: "sidebar.brand.name" }, StratumWordmark);
			});
			const disposeHeroMark = ctx.slots.inject("conversation.hero.brand.mark", function* () {
				yield ctx.slots.register({ name: "conversation.hero.brand.mark" }, StratumHero);
			});
			// `conversation.hero.agentPreset` is a child slot the hero declares once
			// it renders, not a standing seam: registering before that declaration
			// exists fails loud ("slot ... is not declared"). `ctx.slots.inject`
			// defers the register/dispose pair until the parent has declared it.
			const disposeIndicator = ctx.slots.inject("conversation.hero.agentPreset", () => {
				const dispose = ctx.slots.register(
					{ name: "conversation.hero.agentPreset", id: "st-task-type-indicator" },
					TaskTypeIndicator,
				);
				return () => { dispose(); };
			});
			// `conversation.session.header.utilities` is a session-scoped list slot
			// ui-conversation declares — additive, so this pill sits alongside
			// whatever else registers there (the egress chip, in a later story).
			const disposeProviderDisclosure = ctx.slots.inject("conversation.session.header.utilities", () => {
				const dispose = ctx.slots.register(
					{ name: "conversation.session.header.utilities", id: "st-provider-disclosure" },
					ProviderDisclosure,
				);
				return () => { dispose(); };
			});
			// The seal row takes `sidebar.footer.action` — a `list` slot scoped
			// `root`, beside Settings at the sidebar foot. Root scope is why this
			// moved off `conversation.session.header.utilities` on 30 August 2026:
			// that slot is session-scoped, so the product's one load-bearing claim
			// was absent from the new-session screen. See `buildSealFootRow`.
			const disposeSealFootRow = ctx.slots.inject("sidebar.footer.action", () => {
				const dispose = ctx.slots.register(
					{ name: "sidebar.footer.action", id: "st-seal", order: -10 },
					SealFootRow,
				);
				return () => { dispose(); };
			});
			// The Sovereignty drawer takes `shell.overlay` (list, root).
			// Root-scoped, so no session id is injected — it reads
			// `ctx.sessions.list.current` itself. It renders only once the seal row
			// has opened it, and insets the application while it is open rather
			// than covering the transcript.
			const disposeDrawer = ctx.slots.inject("shell.overlay", () => {
				const dispose = ctx.slots.register(
					{ name: "shell.overlay", id: "st-sovereignty-drawer" },
					SovereigntyDrawer,
				);
				return () => { dispose(); };
			});
			// The denial notice shares `shell.overlay` with the drawer and the band.
			// It renders nothing until a denial lands, says its piece for eight
			// seconds, and leaves the record to the drawer — see `buildDenialNotice`.
			const disposeDenialNotice = ctx.slots.inject("shell.overlay", () => {
				const dispose = ctx.slots.register(
					{ name: "shell.overlay", id: "st-denial-notice" },
					DenialNotice,
				);
				return () => { dispose(); };
			});
			// The open-seal band shares `shell.overlay` with the panel (list, root).
			// It renders nothing while the seal is closed, which is almost always,
			// and takes space at the top of the window when it is not — see
			// `buildSealBand` for why that is a band rather than a colour.
			const disposeSealBand = ctx.slots.inject("shell.overlay", () => {
				const dispose = ctx.slots.register({ name: "shell.overlay", id: "st-seal-band" }, SealBand);
				return () => { dispose(); };
			});
			// The composer menu takes `conversation.input.left` (list, session) and
			// stands in for the harness's own `+`, which the stylesheet above hides:
			// the document first, then the commands under one row that opens on
			// hover. Deferred behind `ctx.inject(["connection"])` rather than named
			// in this plugin's own `inject` list — a hard gate on a service the
			// headless client has no reason to provide would take every other seat
			// down with it, and the monitor is worth more than any control beside it.
			//
			// Two controls have now left the right-hand end of the composer row: the
			// canary on 30 August 2026 (ADR-0007), and the upload control into this
			// menu. What is left there is the routing chip and the send button.
			// The Library: a foot row above the egress row, and its drawer (`shell.overlay`).
			const disposeLibraryRow = ctx.slots.inject("sidebar.footer.action", () => {
				const dispose = ctx.slots.register({ name: "sidebar.footer.action", id: "st-library", order: -20 }, LibraryFootRow);
				return () => { dispose(); };
			});
			const disposeLibraryDrawer = ctx.slots.inject("shell.overlay", () => {
				const dispose = ctx.slots.register({ name: "shell.overlay", id: "st-library-drawer" }, LibraryDrawer);
				return () => { dispose(); };
			});
			// Four tabs beside Chat (0) and the shipped Trajectory (10). `label` is what the tab reads; a
			// click on a citation chip finds the Evidence tab by that label.
			const tabs = [
				["st-evidence", "Evidence", 20, EvidenceView],
				["st-facts", "Facts", 30, FactsView],
				["st-topics", "Topics", 40, TopicsView],
				["st-metrics", "Metrics", 50, MetricsView],
			];
			const disposeTabs = tabs.map(([id, label, order, View]) =>
				ctx.slots.inject("conversation.view", () => {
					const dispose = ctx.slots.register({ name: "conversation.view", id, order, label }, View);
					return () => { dispose(); };
				}),
			);
			// One card per Stratum tool, keyed by the wire tool name.
			const disposeToolviews = Object.entries(toolviews).map(([key, View]) =>
				ctx.slots.inject("tool.call.toolview", () => {
					const dispose = ctx.slots.register({ name: "tool.call.toolview", key }, View);
					return () => { dispose(); };
				}),
			);
			let disposeComposerMenu;
			ctx.inject(["connection"], (connectedCtx) => {
				// Point the seal store at the host transport and read the seal once.
				// Everything that displays the seal — the band, the foot row, the mark's
				// ring, the drawer's control — reads that answer rather than assuming
				// one, so a reloaded page shows the machine's real state instead of the
				// safe-looking one.
				seal.bind(connectedCtx.connection);
				// The drawer's residency and model-plane sections read the host's trace
				// through this. Held module-scoped rather than passed in, so the drawer
				// stays registered unconditionally: a client with no transport keeps the
				// ledger its own session log produced and simply has no residency to show.
				hostConnection = connectedCtx.connection;

				// `remote.commands` is a service the client runtime declares and
				// injects; read lazily rather than gated on, so a context without it
				// loses the command rows and keeps the document.
				// Both names, because Cordis only puts injected services on the
				// context and the runtime registers `remote` and `remote.commands`
				// separately. The context is held rather than the service read out
				// of it once, so a directory that arrives late is still found.
				connectedCtx.inject(["remote", "remote.commands"], (remoteCtx) => {
					commandDirectory = remoteCtx;
				});
				// `list` answers `{ ok, value }` like the rest of the wire, not a bare
				// array — measured against the running harness, 30 August 2026.
				const readCommands = async (sessionId) => {
					const answer = await commandDirectory?.remote?.commands?.list?.(sessionId);
					return answer?.ok === true && Array.isArray(answer.value) ? answer.value : [];
				};
				const ComposerMenu = buildComposerMenu(readCommands);
				disposeComposerMenu = connectedCtx.slots.inject("conversation.input.left", () => {
					const dispose = connectedCtx.slots.register(
						{
							name: "conversation.input.left",
							id: "st-composer-menu",
							label: "Attach or run",
							order: -10,
							inject: (sessionId) => ({ sessionId }),
						},
						ComposerMenu,
					);
					return () => { dispose(); };
				});
			});
			// `conversation.input.model` is a session-scoped `single` slot
			// ui-conversation declares. The stock picker is disabled in the
			// profile, so this occupies it outright. The `inject` factory hands
			// the framework-resolved session id to the component, which reads the
			// `st-routing` view for that session.
			const disposeRoutingChip = ctx.slots.inject("conversation.input.model", () => {
				const dispose = ctx.slots.register(
					{
						name: "conversation.input.model",
						id: "st-routing-chip",
						inject: (sessionId) => ({ sessionId }),
					},
					RoutingChip,
				);
				return () => { dispose(); };
			});
			return () => {
				disposeTabTitle();
				disposeSidebarMark();
				disposeSidebarName();
				disposeHeadlineStyle();
				disposeHeroMark();
				disposeIndicator?.();
				disposeProviderDisclosure?.();
				disposeSealFootRow?.();
				disposeDrawer?.();
				disposeDenialNotice?.();
				disposeSealBand?.();
				disposeLibraryRow?.();
				disposeLibraryDrawer?.();
				for (const dispose of disposeTabs) dispose?.();
				for (const dispose of disposeToolviews) dispose?.();
				disposePlaceholders();
				stopLibraryExclusion();
				stopSovereigntyExclusion();
				disposeComposerMenu?.();
				commandDirectory = null;
				disposeInset();
				hostConnection = null;
				disposeRoutingChip?.();
				disposeRoutingView?.();
				disposeRoutingEvents?.();
				disposeEgressView?.();
				disposeEgressEvents?.();
			};
		}

		/** Cordis services this plugin needs from the client root context. */
		const inject = ["slots", "conversationEvents", "conversationViews", "sessions"];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
