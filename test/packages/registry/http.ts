import { brotliCompressSync, constants as zlib } from "node:zlib";

/**
 * A failure that the registry reports to the client. The default body is `{"error": message}`, the shape that
 * `npm-registry-fetch` and bun read. Pass `body` for the endpoints that answer with another shape.
 */
export class RegistryError extends Error {
  status: number;
  body: unknown;
  headers: Record<string, string>;

  constructor(status: number, message: string, options: { body?: unknown; headers?: Record<string, string> } = {}) {
    super(message);
    this.name = "RegistryError";
    this.status = status;
    this.body = "body" in options ? options.body : { error: message };
    this.headers = options.headers ?? {};
  }
}

export const notFound = () => new RegistryError(404, "Not found");

/** The answer for a path under `/-/` that no service owns. */
export const resourceNotFound = (pathname: string) =>
  new RegistryError(404, `${pathname} does not exist`, {
    body: { code: "ResourceNotFound", message: `${pathname} does not exist` },
  });

export const methodNotAllowed = (method: string, allow: string[]) =>
  new RegistryError(405, `${method} is not allowed`, {
    body: { code: "MethodNotAllowedError", message: `${method} is not allowed` },
    headers: { allow: allow.join(", ") },
  });

export type Encoding = "br" | "gzip";

export type Bytes = Uint8Array<ArrayBuffer>;

export interface Body {
  bytes: Bytes;
  /** Hex md5 of `bytes`. The registry uses it as the entity tag. */
  md5: string;
  encoded: Partial<Record<Encoding, Bytes>>;
}

const encoder = new TextEncoder();

export function bodyOf(value: unknown): Body {
  const bytes = encoder.encode(JSON.stringify(value));
  return { bytes, md5: new Bun.CryptoHasher("md5").update(bytes).digest("hex"), encoded: {} };
}

/**
 * The registry does not encode a short body: 26 bytes came back as they are, 63 bytes came back encoded. Where
 * between the two it starts is not known. This is the value that is used here.
 */
const minimumCompressedSize = 48;

/**
 * The registry compresses with brotli when the client accepts it, else with gzip. It does not use deflate or zstd.
 */
export function negotiateEncoding(acceptEncoding: string | null): Encoding | null {
  if (!acceptEncoding) return null;
  let gzip = false;
  for (const part of acceptEncoding.split(",")) {
    const [coding, ...parameters] = part.split(";").map(piece => piece.trim().toLowerCase());
    const q = parameters.find(parameter => parameter.startsWith("q="));
    if (q !== undefined && !(Number.parseFloat(q.slice(2)) > 0)) continue;
    if (coding === "br") return "br";
    if (coding === "gzip" || coding === "x-gzip") gzip = true;
  }
  return gzip ? "gzip" : null;
}

function encode(body: Body, encoding: Encoding): Bytes {
  return (body.encoded[encoding] ??=
    encoding === "br"
      ? new Uint8Array(brotliCompressSync(body.bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: 4 } }))
      : Bun.gzipSync(body.bytes, { level: 6 }));
}

/** Weak comparison of RFC 9110 section 8.8.3.2: `W/"a"` matches `"a"`. */
export function matchesEntityTag(header: string | null, md5: string): boolean {
  if (!header) return false;
  for (const candidate of header.split(",")) {
    let tag = candidate.trim();
    if (tag === "*") return true;
    if (tag.startsWith("W/")) tag = tag.slice(2);
    if (tag === `"${md5}"`) return true;
  }
  return false;
}

export interface SendOptions {
  status?: number;
  headers?: Record<string, string>;
  /** Send the validators and answer a matching `If-None-Match` with 304. */
  conditional?: boolean;
}

/** Sends a JSON body the way the registry does: compact, compressed on request, with an md5 entity tag. */
export function send(request: Request, body: Body, options: SendOptions = {}): Response {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");

  if (options.conditional) {
    // `If-Modified-Since` has no effect on the registry. Only the entity tag selects a 304.
    if (matchesEntityTag(request.headers.get("if-none-match"), body.md5)) {
      headers.delete("content-type");
      headers.delete("vary");
      headers.set("etag", `"${body.md5}"`);
      return new Response(null, { status: 304, headers });
    }
  }

  let bytes = body.bytes;
  let encoding: Encoding | null = null;
  if (bytes.byteLength >= minimumCompressedSize) {
    encoding = negotiateEncoding(request.headers.get("accept-encoding"));
    if (encoding) {
      bytes = encode(body, encoding);
      headers.set("content-encoding", encoding);
    }
  }
  if (options.conditional) {
    headers.set("etag", encoding ? `W/"${body.md5}"` : `"${body.md5}"`);
  }
  return new Response(request.method === "HEAD" ? null : bytes, {
    status: options.status ?? 200,
    headers: request.method === "HEAD" ? withHeader(headers, "content-length", String(bytes.byteLength)) : headers,
  });
}

function withHeader(headers: Headers, name: string, value: string): Headers {
  headers.set(name, value);
  return headers;
}

export function sendJson(request: Request, value: unknown, options: SendOptions = {}): Response {
  return send(request, bodyOf(value), options);
}

export function sendError(request: Request, error: RegistryError): Response {
  return sendJson(request, error.body, { status: error.status, headers: error.headers });
}

/** Reads a JSON request body. The registry accepts `Content-Encoding: gzip`, which `npm audit` and bun use. */
export async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type");
  const mediaType = type?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new RegistryError(415, `Unsupported Media Type: expected application/json, got ${type ?? "nothing"}`);
  }
  let bytes = await request.bytes();
  const encoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  try {
    if (encoding === "gzip" || encoding === "x-gzip") bytes = Bun.gunzipSync(bytes);
    else if (encoding === "deflate") bytes = Bun.inflateSync(bytes);
    else if (encoding && encoding !== "identity") throw new Error(encoding);
  } catch {
    throw new RegistryError(400, `Bad Request: cannot decode a ${encoding} body`);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RegistryError(400, "Bad Request: the body is not valid JSON");
  }
}

const httpDate = (date: Date) => date.toUTCString();

export function lastModified(date: Date): string {
  // An HTTP date has a resolution of one second. The registry rounds up, so that the header is never older than
  // the document.
  const milliseconds = date.getTime();
  return httpDate(new Date(Math.ceil(milliseconds / 1000) * 1000));
}
