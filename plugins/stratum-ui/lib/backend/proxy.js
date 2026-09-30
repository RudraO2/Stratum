/**
 * `/stratum/api/*` → the Stratum backend's `/v1/*`, same origin.
 *
 * The Library drawer uploads PDFs to it, the Evidence tab loads page PNGs from
 * it, and the Facts / Topics / Metrics tabs read JSON from it. All of it goes
 * through the harness's own web server so the browser only ever talks to one
 * origin and the backend stays bound to loopback.
 *
 * Streams both ways (an upload is never buffered whole here), and is deliberately
 * narrow: GET, HEAD, POST and DELETE on paths under `/v1/`, nothing else.
 */

import { Readable } from "node:stream";
import { backendEndpoint } from "./client.js";

export const PROXY_PREFIX = "/stratum/api";

/** Request headers worth forwarding; everything else (cookies, host, origin) stays behind. */
const FORWARD_HEADERS = ["content-type", "content-length", "accept", "range", "if-none-match"];
/** Response headers worth returning. */
const RETURN_HEADERS = ["content-type", "content-length", "content-disposition", "cache-control", "etag", "x-stratum-ms"];

const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "DELETE"]);

/**
 * Map a proxied pathname to the backend path, or `null` when it is not allowed.
 * @param {string} pathname - e.g. `/stratum/api/documents/3/pages/1.png`.
 */
export function backendPathFor(pathname) {
	if (!pathname.startsWith(`${PROXY_PREFIX}/`)) return null;
	const rest = pathname.slice(PROXY_PREFIX.length);
	if (rest.includes("..") || rest.includes("\\") || rest.includes("//")) return null;
	return `/v1${rest}`;
}

/** The harness web server route handler. */
export async function proxyHandler(req, res) {
	const method = (req.method ?? "GET").toUpperCase();
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const target = backendPathFor(url.pathname);
	if (target === null || !ALLOWED_METHODS.has(method)) {
		res.writeHead(target === null ? 404 : 405, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: target === null ? "not a Stratum API path" : "method not allowed" }));
		return;
	}

	const headers = {};
	for (const name of FORWARD_HEADERS) {
		const value = req.headers[name];
		if (typeof value === "string") headers[name] = value;
	}
	const hasBody = method === "POST" || method === "DELETE";
	let upstream;
	try {
		upstream = await fetch(`${backendEndpoint()}${target}${url.search}`, {
			method,
			headers,
			body: hasBody ? Readable.toWeb(req) : undefined,
			duplex: hasBody ? "half" : undefined,
			signal: AbortSignal.timeout(15 * 60_000),
		});
	} catch (error) {
		res.writeHead(502, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: "the Stratum backend is not reachable", detail: error instanceof Error ? error.message : String(error) }));
		return;
	}

	const out = {};
	for (const name of RETURN_HEADERS) {
		const value = upstream.headers.get(name);
		if (value !== null) out[name] = value;
	}
	res.writeHead(upstream.status, out);
	if (method === "HEAD" || upstream.body === null) {
		res.end();
		return;
	}
	Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
}
