// A fetch handler that returns `new Response(sharedBuffer)` should not hold a
// private copy of the body per in-flight connection. With N stalled clients
// and an M-MB body, peak RSS used to grow by N*M MB (the body was .to_vec()'d
// at Response construction). The static-route path already served the same
// buffer at ~0 MB/conn; the fetch handler now does too.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import net from "node:net";
import path from "node:path";

const bodyMB = 16;
const clients = 24;

async function spawnServer() {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "serve-buffer-body-backpressure-fixture.ts"), String(bodyMB)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    ipc(message) {
      if (typeof message?.rss === "number") rssWaiters.shift()?.(message.rss);
    },
  });
  const rssWaiters: ((n: number) => void)[] = [];
  const rss = () =>
    new Promise<number>(r => {
      rssWaiters.push(r);
      proc.send("rss");
    });
  (async () => {
    let acc = "";
    for await (const chunk of proc.stdout) {
      acc += new TextDecoder().decode(chunk);
      const m = acc.match(/"port":(\d+)/);
      if (m) return resolve(Number(m[1]));
    }
    reject(new Error("server fixture exited without printing a port: " + acc));
  })();
  const port = await promise;
  return { proc, port, rss };
}

async function measure(pathname: string) {
  const { proc, port, rss } = await spawnServer();
  try {
    // Let the allocator settle after the startup burst.
    await rss();
    const before = await rss();

    const socks: net.Socket[] = [];
    let connected = 0;
    const allUp = Promise.withResolvers<void>();
    for (let i = 0; i < clients; i++) {
      const s = net.connect(port, "127.0.0.1");
      socks.push(s);
      s.on("connect", () => {
        s.write(`GET ${pathname} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
        s.pause();
        if (++connected === clients) allUp.resolve();
      });
      s.on("error", () => {});
    }
    await allUp.promise;

    // Poll until the server has responded to every request (pending body
    // bytes are held on the server side) and RSS has stabilised.
    let peak = before;
    let last = -1;
    for (let i = 0; i < 40; i++) {
      const r = await rss();
      peak = Math.max(peak, r);
      if (Math.abs(r - last) < 1024 * 1024 && i >= 4) break;
      last = r;
      await Bun.sleep(50);
    }

    for (const s of socks) s.destroy();
    return (peak - before) / (1024 * 1024);
  } finally {
    proc.kill(9);
    await proc.exited;
  }
}

test("Bun.serve: fetch handler returning new Response(buffer) does not copy the body per connection under backpressure", async () => {
  const deltaMB = await measure("/via-fetch");
  console.log(`fetch-handler: ${clients} stalled clients x ${bodyMB} MB body -> +${deltaMB.toFixed(1)} MB`);

  // Before: one body-sized Vec per connection => clients * bodyMB MB (384 MB here).
  // After: the shared ArrayBuffer is referenced, not cloned, so the delta is
  // bounded by socket buffers + request-context overhead. Allow generous slack
  // under ASAN/debug. The unfixed build exceeds this by more than an order of
  // magnitude.
  const bound = (isASAN || isDebug ? 3 : 1.5) * clients;
  expect(deltaMB).toBeLessThan(bound);
});

test("Bun.serve: static route with a buffered Response does not copy the body per connection under backpressure", async () => {
  const deltaMB = await measure("/static");
  console.log(`static-route: ${clients} stalled clients x ${bodyMB} MB body -> +${deltaMB.toFixed(1)} MB`);

  const bound = (isASAN || isDebug ? 3 : 1.5) * clients;
  expect(deltaMB).toBeLessThan(bound);
});

test("Bun.serve: a fetch handler returning new Response(buffer) delivers the full body", async () => {
  const { proc, port } = await spawnServer();
  try {
    const hash = Bun.hash(new Uint8Array(bodyMB * 1024 * 1024).fill(65));
    const res = await fetch(`http://127.0.0.1:${port}/via-fetch`);
    const got = await res.bytes();
    expect(got.byteLength).toBe(bodyMB * 1024 * 1024);
    expect(Bun.hash(got)).toBe(hash);
  } finally {
    proc.kill(9);
    await proc.exited;
  }
});
