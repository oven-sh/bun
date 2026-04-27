/**
 * `fetch()`-shaped HTTP/3 client backed by `curl --http3-only`.
 *
 * Bun has no native QUIC client yet, so HTTP/3 server tests shell out to a
 * curl built with nghttp3. The wrapper accepts the common `RequestInit`
 * subset (`method`, `headers`, `body`, `signal`) and returns a real
 * `Response`, so existing `fetch()`-based assertions can be reused unchanged
 * by swapping the function reference.
 *
 * Discovery: `CURL_HTTP3` env, then `curl-h3`, then plain `curl` if it
 * advertises `HTTP3` in `--version`. `hasFetchH3()` lets describe.each gates
 * skip the H3 iteration on machines without a capable curl.
 */
import { which } from "bun";
import { tls } from "harness";

let resolved: string | null | undefined;

function findCurlH3(): string | null {
  if (resolved !== undefined) return resolved;
  for (const candidate of [process.env.CURL_HTTP3, "curl-h3", "curl"]) {
    if (!candidate) continue;
    const bin = which(candidate);
    if (!bin) continue;
    const proc = Bun.spawnSync({ cmd: [bin, "--version"], stdout: "pipe", stderr: "ignore" });
    if (/\bHTTP3\b/.test(proc.stdout.toString())) return (resolved = bin);
  }
  return (resolved = null);
}

export function hasFetchH3(): boolean {
  return findCurlH3() !== null;
}

type Init = {
  method?: string;
  headers?: HeadersInit;
  body?: string | Uint8Array | ArrayBuffer | Blob | null;
  signal?: AbortSignal;
  redirect?: "follow" | "manual";
};

/**
 * fetch() over HTTP/3 via curl. Returns a real `Response` so callers can use
 * `.status`, `.headers.get()`, `.text()`, `.arrayBuffer()` etc. Unsupported
 * `Init` fields are ignored rather than rejected — keep tests honest by
 * only relying on what's listed above.
 */
export async function fetchH3(input: string | URL, init: Init = {}): Promise<Response> {
  const bin = findCurlH3();
  if (!bin) throw new Error("fetchH3: no HTTP/3-capable curl (set CURL_HTTP3=/path/to/curl)");

  const url = String(input);
  const method = (init.method ?? "GET").toUpperCase();

  // curl writes headers to a temp file so the body stream stays clean for
  // binary payloads; --raw stops curl from re-chunking what it receives.
  const headerFile = `/tmp/.fh3-${process.pid}-${Math.random().toString(36).slice(2)}`;

  const args: string[] = [
    "-sk",
    "--http3-only",
    "--connect-timeout",
    "10",
    "--max-time",
    "30",
    "--raw",
    "-D",
    headerFile,
  ];
  if (init.redirect !== "manual") args.push("-L");
  if (method !== "GET") args.push("-X", method);
  if (method === "HEAD") args.push("-I");

  for (const [k, v] of new Headers(init.headers ?? {})) {
    args.push("-H", `${k}: ${v}`);
  }

  let stdin: Uint8Array | "ignore" = "ignore";
  if (init.body != null) {
    const body = init.body;
    let bytes: Uint8Array;
    if (typeof body === "string") bytes = new TextEncoder().encode(body);
    else if (body instanceof Blob) bytes = new Uint8Array(await body.arrayBuffer());
    else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
    else bytes = body as Uint8Array;
    stdin = bytes;
    args.push("--data-binary", "@-");
    // curl defaults POST data to application/x-www-form-urlencoded; only
    // override when the caller didn't supply one.
    if (!new Headers(init.headers ?? {}).has("content-type")) {
      args.push("-H", "content-type: application/octet-stream");
    }
  }

  args.push(url);

  if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");

  const proc = Bun.spawn({
    cmd: [bin, ...args],
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  init.signal?.addEventListener("abort", () => proc.kill(), { once: true });

  const [bodyBytes, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);

  let headerText = "";
  try {
    headerText = await Bun.file(headerFile).text();
  } catch {}
  try {
    await Bun.file(headerFile).unlink();
  } catch {}

  if (exitCode !== 0) {
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    throw new TypeError(`fetchH3: curl exited ${exitCode}: ${stderr.trim()}`);
  }

  // With -L curl emits one header block per hop; the final response is last.
  const blocks = headerText.trimEnd().split(/\r?\n\r?\n/);
  const lastBlock = blocks[blocks.length - 1] ?? "";
  const lines = lastBlock.split(/\r?\n/);
  const statusLine = lines.shift() ?? "HTTP/3 502";
  const status = Number(statusLine.match(/HTTP\/3\s+(\d{3})/)?.[1] ?? "502");

  const headers = new Headers();
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }

  const noBody = status === 204 || status === 304 || method === "HEAD";
  return new Response(noBody ? null : new Uint8Array(bodyBytes), { status, headers });
}

/**
 * Table for `describe.each`. The H3 row is only present when a capable curl
 * exists, so suites stay green on stock toolchains.
 *
 *   for (const { protocol, fetch } of httpProtocols()) {
 *     describe(protocol, () => { ... });
 *   }
 */
export function httpProtocols(): Array<{
  protocol: "http/1.1" | "http/3";
  fetch: (url: string | URL, init?: Init) => Promise<Response>;
  /** Serve options to spread into Bun.serve() for this protocol. */
  serve: { tls?: object; h3?: boolean };
}> {
  const rows: ReturnType<typeof httpProtocols> = [
    { protocol: "http/1.1", fetch: (u, i) => fetch(u, i as RequestInit), serve: {} },
  ];
  if (hasFetchH3()) {
    rows.push({ protocol: "http/3", fetch: fetchH3, serve: { tls, h3: true } });
  }
  return rows;
}
