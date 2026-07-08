/**
 * npm registry responses always carry JSON, including errors. A non-2xx
 * body is `{"error": "<human readable message>"}`; clients (npm, bun,
 * yarn, pnpm) surface that string verbatim, so tests assert on it.
 */

/**
 * A JSON response with the npm `content-type`, unless the caller set
 * one. (`init.headers` can be any `HeadersInit`, including a `Headers`
 * instance — never object-spread one, it has no own properties.)
 */
export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** The npm error envelope: `{"error": message}` with the given status. */
export function npmError(status: number, message: string, extraHeaders?: HeadersInit): Response {
  return json({ error: message }, { status, headers: extraHeaders });
}

export const notFound = (what: string) => npmError(404, `Not found: ${what}`);

/**
 * The document npm registries return for `GET /<name>` when the package
 * does not exist. The exact string matters: clients special-case it.
 */
export function packageNotFound(name: string): Response {
  return json({ error: "Not found", reason: `document not found: ${name}` }, { status: 404 });
}

/** 401 for requests that need credentials and have none (or bad ones). */
export function unauthorized(message = "unauthorized: authentication required") {
  return npmError(401, message);
}

/** 403 for authenticated requests that are not allowed to do the thing. */
export function forbidden(message: string) {
  return npmError(403, message);
}
