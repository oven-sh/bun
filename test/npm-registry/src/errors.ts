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

/**
 * Reads a request's JSON body as a non-null, non-array object, or the
 * npm 400 envelope for anything else. `null` is valid JSON that the
 * try/catch around `req.json()` would let through, and every handler
 * immediately dereferences a property of the result.
 */
export async function readJsonObject<T extends object>(req: Request): Promise<T | Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return npmError(400, "invalid JSON body");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return npmError(400, "request body must be a JSON object");
  }
  return body as T;
}

/**
 * registry.npmjs.org's `GET /<name>` 404 body. bun never reads it (the
 * resolve path branches on the status alone at `src/install/npm.rs`,
 * and the one body-parsing consumer prints its own message); the shape
 * is for parity with other npm clients only.
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
