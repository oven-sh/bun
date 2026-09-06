/**
 * Adversarial proxy + origin infrastructure for stress-testing the HTTP
 * client's proxy code paths.
 *
 * The proxy here understands both absolute-form requests (HTTP target) and
 * CONNECT tunneling (HTTPS target), over a plain-TCP or TLS outer socket.
 * Every lifecycle stage exposes a hook so a test can close/delay/mangle at
 * that exact point; the default behavior with no hooks is a transparent
 * well-behaved proxy.
 *
 * Origins are thin wrappers around `Bun.serve` / raw `tls`/`net` servers that
 * can shape the response (content-length / chunked / close-delimited,
 * optional compression) and track what the client actually sent.
 */

import net from "node:net";
import tls from "node:tls";
import zlib from "node:zlib";
import { once } from "node:events";
import { tls as tlsCert } from "harness";

// ─────────────────────────────────────────────────────────────────────────────
// Environment hygiene: ambient HTTP_PROXY / NO_PROXY on CI hosts will reroute
// or bypass localhost fetches and silently turn every assertion here into a
// false positive. Importers of this module get the cleared env (and a
// restorer) for free.
// ─────────────────────────────────────────────────────────────────────────────

export const PROXY_ENV_KEYS = [
  "NO_PROXY",
  "no_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
] as const;

export function clearProxyEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of PROXY_ENV_KEYS) {
    saved[key] = process.env[key];
    // Assign "" rather than delete: the native env loader only observes
    // assignments. An empty value disables the proxy/bypass.
    process.env[key] = "";
  }
  return saved;
}

export function restoreProxyEnv(saved: Record<string, string | undefined>) {
  for (const key of PROXY_ENV_KEYS) {
    process.env[key] = saved[key] ?? "";
  }
}

/** Env override for subprocess fixtures: wipes every proxy-relevant key. */
export const proxyFreeEnv = {
  NO_PROXY: undefined,
  no_proxy: undefined,
  HTTP_PROXY: undefined,
  http_proxy: undefined,
  HTTPS_PROXY: undefined,
  https_proxy: undefined,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial proxy
// ─────────────────────────────────────────────────────────────────────────────

export type ProxyStage =
  /** CONNECT or absolute-form request head fully received from client. */
  | "request-received"
  /** Upstream TCP connect() succeeded (before the 200 CONNECT reply). */
  | "upstream-connected"
  /** 200 reply to CONNECT (or forwarded head for absolute-form) written. */
  | "connect-replied"
  /** First client→upstream byte after the tunnel was established (for
   *  CONNECT to an HTTPS origin this is the inner-TLS ClientHello). */
  | "first-client-byte"
  /** First upstream→client byte after the tunnel was established (for
   *  CONNECT to an HTTPS origin this is the inner-TLS ServerHello flight). */
  | "first-upstream-byte";

export interface ProxyConnectionRecord {
  /** Raw request head bytes (CONNECT line or absolute-form request line). */
  head: string;
  method: string;
  /** For CONNECT, `host:port`; for absolute-form, the absolute URL. */
  target: string;
  /** Lower-cased header name → value of the proxy request. */
  headers: Record<string, string>;
  /** Number of client→upstream bytes relayed after the tunnel was up. */
  bytesUp: number;
  /** Number of upstream→client bytes relayed after the tunnel was up. */
  bytesDown: number;
}

export interface AdversarialProxyOptions {
  /** Outer socket is TLS (i.e., an `https://` proxy). */
  tls?: boolean;
  /**
   * If set, the proxy responds to every CONNECT with this status instead of
   * dialing upstream. The body is empty unless `connectStatusBody` is set.
   * Absolute-form requests (non-CONNECT) still forward normally.
   */
  connectStatus?: number;
  /** Optional body to send with a non-200 CONNECT reply. */
  connectStatusBody?: string;
  /** Optional extra headers on the CONNECT reply (success or failure). */
  connectReplyHeaders?: Record<string, string>;
  /**
   * Split the 200 CONNECT envelope into N writes with a `setImmediate` tick
   * between each. Exercises the client's partial-CONNECT-response parser.
   */
  splitConnectReply?: number;
  /**
   * After CONNECT succeeds, relay upstream→client bytes one-byte-at-a-time.
   * Forces the inner-TLS handshake and response to arrive across hundreds of
   * distinct `on_data` callbacks.
   */
  trickleDownstream?: boolean;
  /**
   * Stage at which the proxy kills the client socket instead of proceeding.
   * The kill is an RST (`resetAndDestroy`) so the client observes an error
   * rather than a clean FIN.
   */
  killClientAt?: ProxyStage;
  /**
   * Stage at which the proxy kills the upstream socket (clean destroy).
   * The client sees whatever the upstream close translates to after being
   * relayed.
   */
  killUpstreamAt?: ProxyStage;
  /**
   * If set, the proxy requires `Proxy-Authorization: Basic <base64(user:pass)>`
   * and replies 407 if missing / 403 if wrong.
   */
  auth?: { user: string; pass: string };
}

export interface AdversarialProxy {
  server: net.Server | tls.Server;
  url: string;
  port: number;
  /** One entry per accepted client connection, in accept order. */
  connections: ProxyConnectionRecord[];
  /** Number of CONNECT requests seen. */
  connectCount(): number;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

const STATUS_TEXT: Record<number, string> = {
  200: "Connection Established",
  301: "Moved Permanently",
  302: "Found",
  307: "Temporary Redirect",
  400: "Bad Request",
  403: "Forbidden",
  407: "Proxy Authentication Required",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

function rstClient(client: net.Socket) {
  try {
    // For TLS sockets, reset the underlying TCP so the client's next write
    // fails instead of being buffered.
    const raw: net.Socket = (client as any)._parent ?? (client as any).socket ?? client;
    if (typeof raw.resetAndDestroy === "function") raw.resetAndDestroy();
    else client.destroy();
  } catch {
    client.destroy();
  }
}

async function writeSplit(socket: net.Socket, data: string, parts: number) {
  const buf = Buffer.from(data);
  if (parts <= 1 || buf.length <= 1) {
    socket.write(buf);
    return;
  }
  const chunk = Math.max(1, Math.floor(buf.length / parts));
  let off = 0;
  while (off < buf.length) {
    const end = Math.min(off + chunk, buf.length);
    socket.write(buf.subarray(off, end));
    off = end;
    if (off < buf.length) await new Promise<void>(r => setImmediate(r));
  }
}

function parseHead(head: string): { method: string; target: string; headers: Record<string, string> } {
  const lines = head.split("\r\n");
  const [method = "", target = ""] = lines[0].split(" ");
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.indexOf(":");
    if (colon > 0) {
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
  }
  return { method, target, headers };
}

export async function createAdversarialProxy(opts: AdversarialProxyOptions = {}): Promise<AdversarialProxy> {
  const connections: ProxyConnectionRecord[] = [];

  const handleClient = (client: net.Socket) => {
    client.on("error", () => {});
    let head = Buffer.alloc(0);
    let upstream: net.Socket | undefined;
    let tunneled = false;
    let sawFirstClientByte = false;
    let sawFirstUpstreamByte = false;
    let record: ProxyConnectionRecord | undefined;

    const stageHit = (stage: ProxyStage): boolean => {
      if (opts.killClientAt === stage) {
        rstClient(client);
        upstream?.destroy();
        return true;
      }
      if (opts.killUpstreamAt === stage) {
        if (upstream) {
          upstream.destroy();
        } else {
          // No upstream yet: nothing to relay the failure through, so the
          // client would otherwise hang. Behave like a real proxy and 502.
          client.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
          client.end();
        }
        return true;
      }
      return false;
    };

    // Trickle queue: when `trickleDownstream` is on, upstream→client bytes
    // are queued here and drained one-byte-per-tick. The upstream may
    // close while bytes are still queued; `upstreamEnded` records that so
    // the drain loop can FIN the client only after the last byte.
    let trickleQueue = Buffer.alloc(0);
    let trickleActive = false;
    let upstreamEnded = false;
    const pumpTrickle = () => {
      if (trickleActive) return;
      trickleActive = true;
      const step = () => {
        if (client.destroyed) {
          trickleActive = false;
          return;
        }
        if (trickleQueue.length === 0) {
          trickleActive = false;
          if (upstreamEnded) client.end();
          return;
        }
        client.write(trickleQueue.subarray(0, 1));
        trickleQueue = trickleQueue.subarray(1);
        setImmediate(step);
      };
      step();
    };

    const relayDown = (chunk: Buffer) => {
      if (record) record.bytesDown += chunk.length;
      if (!sawFirstUpstreamByte) {
        sawFirstUpstreamByte = true;
        if (stageHit("first-upstream-byte")) return;
      }
      if (opts.trickleDownstream) {
        trickleQueue = Buffer.concat([trickleQueue, chunk]);
        pumpTrickle();
      } else {
        client.write(chunk);
      }
    };

    const onData = (chunk: Buffer) => {
      if (tunneled) {
        if (record) record.bytesUp += chunk.length;
        if (!sawFirstClientByte) {
          sawFirstClientByte = true;
          if (stageHit("first-client-byte")) return;
        }
        upstream?.write(chunk);
        return;
      }
      // Head already parsed and upstream dial in flight; buffer until the
      // connect callback flips `tunneled`. The absolute-form branch re-reads
      // `head` inside the connect callback, so appended bytes are forwarded.
      // CONNECT clients wait for the 200 reply before sending more, so this
      // window is unreachable for them.
      if (record) {
        head = Buffer.concat([head, chunk]);
        return;
      }

      head = Buffer.concat([head, chunk]);
      const headerEnd = head.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const headStr = head.subarray(0, headerEnd).toString("latin1");
      const leftover = head.subarray(headerEnd + 4);
      const parsed = parseHead(headStr);
      record = {
        head: headStr,
        method: parsed.method,
        target: parsed.target,
        headers: parsed.headers,
        bytesUp: 0,
        bytesDown: 0,
      };
      connections.push(record);

      if (stageHit("request-received")) return;

      // Proxy-Authorization check.
      if (opts.auth) {
        const got = parsed.headers["proxy-authorization"];
        const want = "Basic " + Buffer.from(`${opts.auth.user}:${opts.auth.pass}`).toString("base64");
        if (!got) {
          client.write(
            'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
          );
          client.end();
          return;
        }
        if (got !== want) {
          client.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
          client.end();
          return;
        }
      }

      const isConnect = parsed.method === "CONNECT";

      // Forced CONNECT status (before dialing upstream).
      if (isConnect && opts.connectStatus && opts.connectStatus !== 200) {
        const status = opts.connectStatus;
        const body = opts.connectStatusBody ?? "";
        let reply = `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? "Error"}\r\n`;
        for (const [k, v] of Object.entries(opts.connectReplyHeaders ?? {})) reply += `${k}: ${v}\r\n`;
        reply += `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`;
        client.write(reply);
        client.end();
        return;
      }

      // Resolve upstream address.
      let host: string;
      let port: number;
      if (isConnect) {
        const colon = parsed.target.lastIndexOf(":");
        host = parsed.target.slice(0, colon);
        port = Number(parsed.target.slice(colon + 1));
      } else {
        const url = new URL(parsed.target);
        host = url.hostname;
        port = Number(url.port || "80");
      }
      // IPv6 authority-form / URL.hostname keep the brackets; net.connect
      // and getaddrinfo want the bare literal.
      if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);

      // Origins bind 127.0.0.1 but advertise `localhost`; on darwin that
      // resolves `::1` first, and v4/v6 ephemeral-port spaces are independent,
      // so dial the bound address. IPv6-literal tests pass `[::1]` explicitly.
      if (host === "localhost") host = "127.0.0.1";

      upstream = net.connect(port, host);
      let clientEnded = false;
      const endClient = () => {
        if (clientEnded || client.destroyed) return;
        clientEnded = true;
        client.end();
      };
      upstream.on("error", () => {
        if (!tunneled && !client.destroyed && !clientEnded) {
          client.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }
        endClient();
      });
      upstream.on("close", () => {
        if (opts.trickleDownstream) {
          // Let the trickle drain finish before closing the client.
          upstreamEnded = true;
          pumpTrickle();
        } else {
          endClient();
        }
      });
      client.on("close", () => upstream?.destroy());

      upstream.once("connect", async () => {
        if (stageHit("upstream-connected")) return;
        if (isConnect) {
          let reply = `HTTP/1.1 200 ${STATUS_TEXT[200]}\r\n`;
          for (const [k, v] of Object.entries(opts.connectReplyHeaders ?? {})) reply += `${k}: ${v}\r\n`;
          reply += "\r\n";
          await writeSplit(client, reply, opts.splitConnectReply ?? 1);
          tunneled = true;
          if (stageHit("connect-replied")) return;
          if (leftover.length) {
            if (record) record.bytesUp += leftover.length;
            sawFirstClientByte = true;
            if (opts.killClientAt === "first-client-byte" || opts.killUpstreamAt === "first-client-byte") {
              if (stageHit("first-client-byte")) return;
            }
            upstream!.write(leftover);
          }
          upstream!.on("data", relayDown);
        } else {
          // Absolute-form: rewrite request line to origin-form, strip
          // hop-by-hop headers (Proxy-Authorization / Proxy-Connection;
          // RFC 9110 §7.6.1), and relay the rest.
          const url = new URL(parsed.target);
          const originForm = `${parsed.method} ${url.pathname}${url.search || ""} HTTP/1.1\r\n`;
          const firstCrlf = head.indexOf("\r\n");
          const rest = head.subarray(firstCrlf + 2);
          // `rest` is "Header: v\r\nHeader: v\r\n\r\n<body...>". Split at the
          // blank line, filter proxy-* headers, reassemble.
          const hdrEnd = rest.indexOf("\r\n\r\n");
          const rawHeaders = rest
            .subarray(0, hdrEnd)
            .toString("latin1")
            .split("\r\n")
            .filter(l => {
              const name = l.slice(0, l.indexOf(":")).toLowerCase();
              return name !== "proxy-authorization" && name !== "proxy-connection";
            })
            .join("\r\n");
          const bodyStart = rest.subarray(hdrEnd + 4);
          upstream!.write(originForm);
          upstream!.write(rawHeaders + "\r\n\r\n");
          if (bodyStart.length > 0) upstream!.write(bodyStart);
          tunneled = true;
          if (stageHit("connect-replied")) return;
          upstream!.on("data", relayDown);
        }
      });
    };

    client.on("data", onData);
  };

  const server = opts.tls
    ? tls.createServer({ ...tlsCert, rejectUnauthorized: false }, handleClient)
    : net.createServer(handleClient);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;
  const url = `${opts.tls ? "https" : "http"}://127.0.0.1:${port}`;

  const close = async () => {
    server.close();
    // Do not wait for 'close' — outstanding sockets on a killed tunnel may
    // linger, and tests destroy their clients independently.
  };

  return {
    server,
    url,
    port,
    connections,
    connectCount: () => connections.filter(c => c.method === "CONNECT").length,
    close,
    [Symbol.asyncDispose]: close,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial origin
// ─────────────────────────────────────────────────────────────────────────────

export type BodyFraming = "content-length" | "chunked" | "close-delimited";
export type BodyEncoding = "identity" | "gzip" | "deflate" | "br" | "zstd";

export interface OriginRequestRecord {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Buffer;
}

export interface AdversarialOriginOptions {
  /** Origin is HTTPS. */
  tls?: boolean;
  /** Response status (default 200). */
  status?: number;
  /** Response body payload (before compression). Default "ok". */
  body?: Buffer | string;
  /** How the body length is framed on the wire. Default "content-length". */
  framing?: BodyFraming;
  /** Content-Encoding of the response. Default "identity". */
  encoding?: BodyEncoding;
  /** Extra response headers. */
  headers?: Record<string, string>;
  /** If set, origin RSTs the socket after writing exactly this many response
   *  bytes (head + body). 0 = RST immediately after receiving the request
   *  head, before writing anything. */
  killAfterBytes?: number;
  /** If set, respond with a redirect to this absolute URL instead of `body`. */
  redirectTo?: string;
  /** Echo the request body as the response body. Overrides `body`. */
  echo?: boolean;
}

export interface AdversarialOrigin {
  server: net.Server | tls.Server;
  url: string;
  port: number;
  /** One entry per complete request received, in arrival order. */
  requests: OriginRequestRecord[];
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

function encodeBody(raw: Buffer, encoding: BodyEncoding): Buffer {
  switch (encoding) {
    case "gzip":
      return zlib.gzipSync(raw);
    case "deflate":
      return zlib.deflateSync(raw);
    case "br":
      return zlib.brotliCompressSync(raw);
    case "zstd":
      return zlib.zstdCompressSync(raw);
    case "identity":
    default:
      return raw;
  }
}

function buildResponse(opts: AdversarialOriginOptions, reqBody: Buffer): Buffer {
  if (opts.redirectTo) {
    const head =
      `HTTP/1.1 302 Found\r\n` + `Location: ${opts.redirectTo}\r\n` + `Content-Length: 0\r\nConnection: close\r\n\r\n`;
    return Buffer.from(head);
  }
  const status = opts.status ?? 200;
  const rawBody = opts.echo ? reqBody : Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body ?? "ok");
  const encoding = opts.encoding ?? "identity";
  const framing = opts.framing ?? "content-length";
  const encoded = encodeBody(rawBody, encoding);

  let head = `HTTP/1.1 ${status} ${status === 200 ? "OK" : STATUS_TEXT[status] ?? "Status"}\r\n`;
  for (const [k, v] of Object.entries(opts.headers ?? {})) head += `${k}: ${v}\r\n`;
  if (encoding !== "identity") head += `Content-Encoding: ${encoding}\r\n`;

  if (framing === "content-length") {
    head += `Content-Length: ${encoded.length}\r\nConnection: close\r\n\r\n`;
    return Buffer.concat([Buffer.from(head), encoded]);
  }
  if (framing === "chunked") {
    head += `Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n`;
    // Split the body into at least two chunks to exercise the chunked parser
    // path in ProxyTunnel::on_data (stage BodyChunk).
    const mid = Math.max(1, Math.floor(encoded.length / 2));
    const c1 = encoded.subarray(0, mid);
    const c2 = encoded.subarray(mid);
    const chunks: Buffer[] = [Buffer.from(head)];
    for (const c of [c1, c2]) {
      if (c.length === 0) continue;
      chunks.push(Buffer.from(c.length.toString(16) + "\r\n"));
      chunks.push(c);
      chunks.push(Buffer.from("\r\n"));
    }
    chunks.push(Buffer.from("0\r\n\r\n"));
    return Buffer.concat(chunks);
  }
  // close-delimited
  head += `Connection: close\r\n\r\n`;
  return Buffer.concat([Buffer.from(head), encoded]);
}

export async function createAdversarialOrigin(opts: AdversarialOriginOptions = {}): Promise<AdversarialOrigin> {
  const requests: OriginRequestRecord[] = [];

  const handleClient = (sock: net.Socket) => {
    sock.on("error", () => {});
    let buf = Buffer.alloc(0);
    let headParsed = false;
    let method = "";
    let path = "";
    let headers: Record<string, string> = {};
    let bodyNeed = 0;
    let chunked = false;
    let body = Buffer.alloc(0);

    const finish = () => {
      requests.push({ method, path, headers, body });
      const resp = buildResponse(opts, body);
      if (typeof opts.killAfterBytes === "number") {
        const n = opts.killAfterBytes;
        if (n === 0) {
          rstClient(sock);
          return;
        }
        sock.write(resp.subarray(0, Math.min(n, resp.length)), () => rstClient(sock));
        return;
      }
      sock.write(resp, () => sock.end());
    };

    // Minimal chunked-request decoder (only needs to handle what fetch sends).
    const decodeChunked = (src: Buffer): { done: boolean; rest: Buffer } => {
      let off = 0;
      while (true) {
        const lineEnd = src.indexOf("\r\n", off);
        if (lineEnd === -1) return { done: false, rest: src.subarray(off) };
        const sizeHex = src.subarray(off, lineEnd).toString("latin1");
        const size = parseInt(sizeHex, 16);
        if (Number.isNaN(size)) return { done: true, rest: Buffer.alloc(0) };
        const dataStart = lineEnd + 2;
        if (size === 0) {
          // trailer section: require terminating CRLF CRLF (or CRLF after 0)
          const trailerEnd = src.indexOf("\r\n", dataStart);
          if (trailerEnd === -1) return { done: false, rest: src.subarray(off) };
          return { done: true, rest: Buffer.alloc(0) };
        }
        if (src.length < dataStart + size + 2) return { done: false, rest: src.subarray(off) };
        body = Buffer.concat([body, src.subarray(dataStart, dataStart + size)]);
        off = dataStart + size + 2;
      }
    };

    sock.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!headParsed) {
        const end = buf.indexOf("\r\n\r\n");
        if (end === -1) return;
        const headStr = buf.subarray(0, end).toString("latin1");
        const parsed = parseHead(headStr);
        method = parsed.method;
        path = parsed.target;
        headers = parsed.headers;
        headParsed = true;
        chunked = (headers["transfer-encoding"] ?? "").toLowerCase().includes("chunked");
        bodyNeed = Number(headers["content-length"] ?? "0");
        buf = buf.subarray(end + 4);
        if (typeof opts.killAfterBytes === "number" && opts.killAfterBytes === 0) {
          requests.push({ method, path, headers, body });
          rstClient(sock);
          return;
        }
      }
      if (chunked) {
        const { done, rest } = decodeChunked(buf);
        buf = rest;
        if (done) finish();
        return;
      }
      if (bodyNeed > 0) {
        if (buf.length < bodyNeed) return;
        body = buf.subarray(0, bodyNeed);
      }
      finish();
    });
  };

  const server = opts.tls
    ? tls.createServer({ ...tlsCert, rejectUnauthorized: false }, handleClient)
    : net.createServer(handleClient);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;
  const url = `${opts.tls ? "https" : "http"}://localhost:${port}`;

  const close = async () => {
    server.close();
  };

  return { server, url, port, requests, close, [Symbol.asyncDispose]: close };
}

// ─────────────────────────────────────────────────────────────────────────────
// Higher-level conveniences shared by the stress test files.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The TLS options every fetch through a self-signed proxy/origin needs.
 * `rejectUnauthorized: false` because the test cert is self-signed; tests
 * that exercise the `rejectUnauthorized: true` path build their own.
 */
export const laxTls = { ca: tlsCert.cert, rejectUnauthorized: false } as const;

/**
 * A body generator that's cheap in debug builds (Buffer.alloc, not
 * String.repeat — the latter is O(n) * extremely slow JSC debug).
 */
export function makeBody(bytes: number, fill = "A"): string {
  return Buffer.alloc(bytes, fill).toString("latin1");
}

/**
 * Spawn-friendly summary of a thrown fetch error: pulls `.code` or `.name`.
 */
export function errcode(e: unknown): string {
  const any = e as any;
  return typeof any?.code === "string" ? any.code : typeof any?.name === "string" ? any.name : String(e);
}

export interface DeadPort {
  port: number;
  [Symbol.dispose](): void;
}

/**
 * A port on 127.0.0.1 that refuses connections for as long as the returned
 * handle is alive.
 *
 * The port is held as the *local* side of a live TCP connection: bound, so
 * the kernel's ephemeral allocator will not hand it to a concurrent
 * `listen(0)`, and not listening, so `connect()` to it is refused. Do not
 * simplify to bind-then-close: that frees the port into exactly the pool
 * `listen(0)` draws from, and a sibling `test.concurrent` will take it.
 */
export async function deadPort(): Promise<DeadPort> {
  let accepted: net.Socket | undefined;
  const sink = net.createServer(s => {
    accepted = s;
    s.on("error", () => {});
  });
  sink.listen(0, "127.0.0.1");
  await once(sink, "listening");
  const holder = net.connect({ host: "127.0.0.1", port: (sink.address() as net.AddressInfo).port });
  holder.on("error", () => {});
  await once(holder, "connect");
  const port = (holder.address() as net.AddressInfo).port;
  // `sink` has served its purpose (giving `holder` something to connect to);
  // stop accepting so its listening port can be recycled. The established
  // connection — and with it `holder`'s local-port binding — survives
  // server.close().
  sink.close();
  return {
    port,
    [Symbol.dispose]() {
      holder.destroy();
      accepted?.destroy();
    },
  };
}

/**
 * Produce every combination of the input dimensions as a flat list.
 * `cartesian({a: [1,2], b: ["x","y"]})` →
 *   [{a:1,b:"x"},{a:1,b:"y"},{a:2,b:"x"},{a:2,b:"y"}]
 */
export function cartesian<T extends Record<string, readonly unknown[]>>(
  dims: T,
): Array<{ [K in keyof T]: T[K][number] }> {
  const keys = Object.keys(dims) as (keyof T)[];
  let out: Array<Record<string, unknown>> = [{}];
  for (const k of keys) {
    const next: Array<Record<string, unknown>> = [];
    for (const base of out) {
      for (const v of dims[k]) {
        next.push({ ...base, [k]: v });
      }
    }
    out = next;
  }
  return out as Array<{ [K in keyof T]: T[K][number] }>;
}

export { tlsCert };
