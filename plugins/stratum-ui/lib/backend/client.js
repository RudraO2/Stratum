/**
 * The host half's one way to reach the Stratum backend (FastAPI, `127.0.0.1:8642`).
 *
 * Loopback only, enforced here rather than trusted to configuration: the claim this
 * product rests on is that nothing leaves the machine, and "the endpoint is
 * whatever the profile says" would make that a hope. A non-loopback endpoint is
 * refused at configuration time and the default stays in force.
 *
 * The browser never calls the backend directly. It goes through the same-origin
 * proxy in `./proxy.js`, so the backend never has to listen beyond loopback and
 * the page never makes a cross-origin request.
 */

export const DEFAULT_BACKEND_ENDPOINT = "http://127.0.0.1:8642";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

let endpoint = (process.env.STRATUM_BACKEND || DEFAULT_BACKEND_ENDPOINT).replace(/\/+$/, "");

/** Whether `value` is an http(s) URL whose host is this machine. */
export function isLoopbackUrl(value) {
	try {
		const url = new URL(value);
		return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname);
	} catch {
		return false;
	}
}

/**
 * Point the client at a backend. Anything that is not loopback is ignored with a
 * warning, so a mistyped profile cannot turn this into an outbound connection.
 * @param {unknown} value - `config.backend.endpoint` from the profile row.
 */
export function configureBackend(value) {
	if (typeof value !== "string" || value.trim() === "") return;
	if (!isLoopbackUrl(value)) {
		console.warn(`@stratum/dsh-client-ui-base: backend endpoint ${JSON.stringify(value)} is not loopback — ignored, keeping ${endpoint}`);
		return;
	}
	endpoint = value.trim().replace(/\/+$/, "");
}

/** The backend base URL currently in force. */
export function backendEndpoint() {
	return endpoint;
}

/** A failure talking to the backend, carrying the HTTP status when there was one. */
export class BackendError extends Error {
	constructor(message, { status, detail } = {}) {
		super(message);
		this.name = "BackendError";
		this.status = status;
		this.detail = detail;
	}
}

/**
 * Call a backend JSON endpoint.
 * @param {string} path - e.g. `/v1/ask`.
 * @param {{ method?: string, body?: unknown, timeoutMs?: number, fetchImpl?: typeof fetch }} [options]
 */
export async function backendJson(path, { method = "GET", body, timeoutMs = 10 * 60_000, fetchImpl = globalThis.fetch } = {}) {
	let response;
	try {
		response = await fetchImpl(`${endpoint}${path}`, {
			method,
			headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		throw new BackendError(
			`The Stratum backend at ${endpoint} is not reachable — start it with run.bat (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	const text = await response.text();
	let parsed;
	try {
		parsed = text === "" ? null : JSON.parse(text);
	} catch {
		parsed = null;
	}
	if (!response.ok) {
		const detail = parsed?.detail ?? parsed?.error ?? text.slice(0, 300);
		const reason = typeof detail === "string" ? detail : JSON.stringify(detail);
		throw new BackendError(`The Stratum backend answered ${response.status}: ${reason}`, { status: response.status, detail });
	}
	return parsed;
}
