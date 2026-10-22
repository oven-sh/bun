/**
 * Subprocess fixture for the "memory probe" block of proxy-stress-concurrent.test.ts.
 *
 * Sends <iterations> requests through a local CONNECT proxy to a local https
 * origin in one of the modes below, and prints one JSON line:
 *
 *   completed       requests that returned 200 with the expected body
 *   failed          requests that rejected or returned something else
 *   errors          `failed`, counted by error code (or error name)
 *   connects        CONNECT requests the proxy received
 *   sslCtxGrowth    live SSL_CTX count at the end minus the count after the
 *                   warm-up. Every tunnel owns one SSL_CTX, so a leaked tunnel
 *                   adds one per request.
 *   sslCtxInFlight  highest live SSL_CTX count sampled with tunnels in flight
 *                   minus the lowest sampled with none. Above 0 proves that
 *                   `sslCtxGrowth` can see a leaked tunnel.
 *   rssGrowth       RSS at the end minus RSS after the warm-up, in bytes
 *
 * The first quarter of the iterations is the warm-up.
 *
 * Usage: bun proxy-stress-memory-fixture.ts <http|https> <mode> <iterations>
 * Env:   TLS_CERT, TLS_KEY. Importing "harness" for them would cost each child
 *        about a second of start-up in a debug build.
 */

import { sslCtxLiveCount } from "bun:internal-for-testing";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";

const [proxyScheme, mode, iterStr] = process.argv.slice(2);
const iterations = Number(iterStr);
const isHttpsProxy = proxyScheme === "https";
const tlsCert = { cert: process.env.TLS_CERT!, key: process.env.TLS_KEY! };

type Abort = "never" | "microtask" | "after-connect";
const MODES: Record<string, { concurrency: number; abort: (i: number) => Abort }> = {
  // Let every request finish.
  "complete": { concurrency: 1, abort: () => "never" },
  // Abort on the microtask after fetch() returns: races the HTTP thread's connect.
  "abort-immediate": { concurrency: 1, abort: () => "microtask" },
  // Abort as soon as the proxy has read the CONNECT head.
  "abort-after-connect": { concurrency: 1, abort: () => "after-connect" },
  // 32 in flight at once, all complete.
  "concurrent-32": { concurrency: 32, abort: () => "never" },
  // 32 in flight at once, the odd ones aborted on the next microtask.
  "concurrent-32-abort": { concurrency: 32, abort: i => (i % 2 === 1 ? "microtask" : "never") },
  // The origin redirects once per request, so every iteration opens two tunnels.
  "redirect": { concurrency: 1, abort: () => "never" },
};
const { concurrency, abort } = MODES[mode];

// HTTPS origin. Optionally redirects once (for mode=redirect).
const origin = Bun.serve({
  port: 0,
  tls: tlsCert,
  fetch(req) {
    const url = new URL(req.url);
    if (mode === "redirect" && url.pathname === "/start") {
      return Response.redirect(`https://localhost:${origin.port}/final`, 302);
    }
    return new Response("ok-" + url.pathname);
  },
});

let connects = 0;
let onNextConnect: (() => void) | undefined;

// Sampling starts after the warm-up, so contexts created lazily during it don't count as tunnels.
let sslCtxStart = -1;
let sslCtxIdleMin = Infinity;
let sslCtxBusyMax = -Infinity;

// A CONNECT proxy (plain or TLS outer socket). It counts CONNECT heads so the
// test can check that every request went through it, and so "after-connect"
// aborts can wait for the CONNECT.
function handleClient(client: net.Socket) {
  client.on("error", () => {});
  let head = Buffer.alloc(0);
  let upstream: net.Socket | undefined;
  client.on("close", () => upstream?.destroy());
  client.on("data", (chunk: Buffer) => {
    if (upstream) {
      upstream.write(chunk);
      return;
    }
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf("\r\n\r\n");
    if (end === -1) return;
    const requestLine = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
    const [method, target] = requestLine.split(" ");
    if (method === "CONNECT") {
      connects++;
      onNextConnect?.();
      onNextConnect = undefined;
    }
    const leftover = head.subarray(end + 4);
    // Dial 127.0.0.1 instead of resolving the target's `localhost`.
    const port = Number(target.slice(target.lastIndexOf(":") + 1));
    upstream = net.connect(port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (leftover.length) upstream!.write(leftover);
      // The first upstream byte is the origin's ServerHello, so the client's tunnel owns its SSL_CTX by now.
      upstream!.once("data", () => {
        if (sslCtxStart !== -1) sslCtxBusyMax = Math.max(sslCtxBusyMax, sslCtxLiveCount());
      });
      // The "data" handler above relays client → upstream.
      upstream!.pipe(client);
    });
    upstream.on("error", () => client.destroy());
    upstream.on("close", () => client.destroy());
  });
}

const proxy = isHttpsProxy
  ? tls.createServer({ ...tlsCert, rejectUnauthorized: false }, handleClient)
  : net.createServer(handleClient);
proxy.listen(0, "127.0.0.1");
await once(proxy, "listening");
const proxyUrl = `${proxyScheme}://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;

const laxTls = { ca: tlsCert.cert, rejectUnauthorized: false } as const;

let completed = 0;
let failed = 0;
const errors: Record<string, number> = {};

function recordFailure(key: string) {
  failed++;
  errors[key] = (errors[key] ?? 0) + 1;
}

function errorKey(e: unknown): string {
  const any = e as { code?: unknown; name?: unknown };
  return typeof any?.code === "string" ? any.code : typeof any?.name === "string" ? any.name : String(e);
}

async function one(i: number): Promise<void> {
  const path = mode === "redirect" ? "/start" : `/${i}`;
  const expectedBody = mode === "redirect" ? "ok-/final" : `ok-${path}`;
  let signal: AbortSignal | undefined;
  const when = abort(i);
  if (when !== "never") {
    const ac = new AbortController();
    signal = ac.signal;
    if (when === "microtask") queueMicrotask(() => ac.abort());
    else new Promise<void>(resolve => (onNextConnect = resolve)).then(() => ac.abort());
  }

  try {
    const res = await fetch(`https://localhost:${origin.port}${path}`, {
      proxy: proxyUrl,
      keepalive: false,
      tls: laxTls,
      signal,
    });
    const body = await res.text();
    if (res.status === 200 && body === expectedBody) {
      completed++;
    } else {
      recordFailure(`unexpected response ${res.status} ${JSON.stringify(body)}`);
    }
  } catch (e) {
    recordFailure(errorKey(e));
  }
}

const rss = process.memoryUsage.rss;

const warmup = Math.floor(iterations / 4);
let rssStart = -1;

for (let done = 0; done < iterations; ) {
  const batch = Math.min(concurrency, iterations - done);
  await Promise.all(Array.from({ length: batch }, (_, j) => one(done + j)));
  done += batch;
  // Nothing is in flight here.
  if (rssStart === -1 && done >= warmup) {
    Bun.gc(true);
    rssStart = rss();
    sslCtxStart = sslCtxLiveCount();
  }
  if (sslCtxStart !== -1) sslCtxIdleMin = Math.min(sslCtxIdleMin, sslCtxLiveCount());
}

Bun.gc(true);
const rssEnd = rss();

// The HTTP thread frees the last request's tunnel shortly after it delivers the response.
// A leak keeps the count up until the deadline and still gets reported.
const deadline = Date.now() + 5_000;
while (sslCtxLiveCount() > sslCtxStart && Date.now() < deadline) {
  await Bun.sleep(5);
}
const sslCtxEnd = sslCtxLiveCount();
sslCtxIdleMin = Math.min(sslCtxIdleMin, sslCtxEnd);

console.log(
  JSON.stringify({
    completed,
    failed,
    errors,
    connects,
    sslCtxGrowth: sslCtxEnd - sslCtxStart,
    sslCtxInFlight: sslCtxBusyMax === -Infinity ? 0 : sslCtxBusyMax - sslCtxIdleMin,
    rssGrowth: rssEnd - rssStart,
  }),
);

origin.stop(true);
proxy.close();
process.exit(0);
