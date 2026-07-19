/**
 * Subprocess fixture for proxy-stress-concurrent.test.ts: issue many
 * requests through a local CONNECT proxy to a local HTTPS origin, under
 * one of several modes (complete, abort-immediate, abort-after-connect,
 * concurrent-32, concurrent-32-abort, redirect), tracking RSS across the
 * run. Emits a single JSON summary line on stdout and exits 0 on clean
 * completion.
 *
 * Usage: bun proxy-stress-memory-fixture.ts <http|https> <mode> <iterations>
 */

import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";
import { tls as tlsCert } from "harness";

const [proxyScheme, mode, iterStr] = process.argv.slice(2);
const iterations = Number(iterStr ?? "600");
const isHttpsProxy = proxyScheme === "https";

type ConnectRecord = { count: number; resolveNext?: () => void };
const connectRecord: ConnectRecord = { count: 0 };

function notifyConnect() {
  connectRecord.count++;
  if (connectRecord.resolveNext) {
    const r = connectRecord.resolveNext;
    connectRecord.resolveNext = undefined;
    r();
  }
}

function waitForNextConnect(): Promise<void> {
  return new Promise<void>(resolve => {
    connectRecord.resolveNext = resolve;
  });
}

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

// A CONNECT proxy (HTTP or HTTPS outer socket). It intentionally tracks
// connects so the fixture can synchronize aborts to the CONNECT boundary.
function handleClient(client: net.Socket) {
  client.on("error", () => {});
  let head = Buffer.alloc(0);
  let upstream: net.Socket | undefined;
  client.on("close", () => upstream?.destroy());
  client.on("data", chunk => {
    if (upstream) {
      upstream.write(chunk);
      return;
    }
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf("\r\n\r\n");
    if (end === -1) return;
    notifyConnect();
    const leftover = head.subarray(end + 4);
    const firstLine = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
    const [, hostPort] = firstLine.split(" ");
    const colon = hostPort!.lastIndexOf(":");
    const host = hostPort!.slice(0, colon);
    const port = Number(hostPort!.slice(colon + 1));
    upstream = net.connect(port, host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (leftover.length) upstream!.write(leftover);
      // client → upstream relay is the outer on("data") handler above;
      // only pipe the upstream → client direction here.
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
const proxyPort = (proxy.address() as net.AddressInfo).port;
const proxyUrl = `${isHttpsProxy ? "https" : "http"}://127.0.0.1:${proxyPort}`;

const laxTls = { ca: tlsCert.cert, rejectUnauthorized: false } as const;
const originUrl = (p: string) => `https://localhost:${origin.port}${p}`;

let completed = 0;
let failed = 0;
let firstError: string | undefined;
let rssStart = 0;
let rssMax = 0;

function recordError(i: number, e: unknown) {
  failed++;
  if (firstError === undefined) {
    const any = e as { code?: unknown; name?: unknown; message?: unknown };
    firstError = `[i=${i}] ${any?.code ?? any?.name ?? "Error"}: ${any?.message ?? e}`;
  }
}

const rss = () => process.memoryUsage.rss();

async function one(i: number): Promise<void> {
  const path = mode === "redirect" ? "/start" : `/${i}`;
  const ac = new AbortController();

  if (mode === "abort-immediate") {
    queueMicrotask(() => ac.abort());
  } else if (mode === "abort-after-connect") {
    waitForNextConnect().then(() => ac.abort());
  }

  try {
    const res = await fetch(originUrl(path), {
      proxy: proxyUrl,
      keepalive: false,
      tls: laxTls,
      signal: mode.startsWith("abort") ? ac.signal : undefined,
    });
    await res.arrayBuffer();
    completed++;
  } catch (e) {
    recordError(i, e);
  }
}

async function run() {
  // Warm-up: first 20 iterations establish baseline RSS (JIT, TLS session
  // cache, first-time allocations). rssStart is sampled after.
  const WARMUP = Math.min(20, Math.floor(iterations / 4));

  if (mode === "concurrent-32" || mode === "concurrent-32-abort") {
    let i = 0;
    while (i < iterations) {
      const batch = Math.min(32, iterations - i);
      const tasks: Promise<void>[] = [];
      for (let j = 0; j < batch; j++) {
        const idx = i + j;
        if (mode === "concurrent-32-abort" && idx % 2 === 1) {
          const ac = new AbortController();
          const p = fetch(originUrl(`/${idx}`), {
            proxy: proxyUrl,
            keepalive: false,
            tls: laxTls,
            signal: ac.signal,
          })
            .then(async r => {
              await r.arrayBuffer();
              completed++;
            })
            .catch(e => {
              recordError(idx, e);
            });
          queueMicrotask(() => ac.abort());
          tasks.push(p);
        } else {
          tasks.push(one(idx));
        }
      }
      await Promise.all(tasks);
      i += batch;
      if (i >= WARMUP && rssStart === 0) {
        Bun.gc(true);
        rssStart = rss();
      }
      rssMax = Math.max(rssMax, rss());
    }
  } else {
    for (let i = 0; i < iterations; i++) {
      await one(i);
      if (i === WARMUP) {
        Bun.gc(true);
        rssStart = rss();
      }
      rssMax = Math.max(rssMax, rss());
    }
  }

  Bun.gc(true);
  const rssEnd = rss();
  console.log(JSON.stringify({ completed, failed, firstError, rssStart, rssEnd, rssMax }));
}

await run();
origin.stop(true);
proxy.close();
process.exit(0);
