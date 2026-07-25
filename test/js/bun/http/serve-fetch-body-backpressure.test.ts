import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import net from "node:net";
import { join } from "node:path";

// Bun.serve returning `fetch(upstream)` to a slow client must propagate
// backpressure from the client socket to the upstream fetch. Before the fix,
// the ByteStream pipe path resumed the upstream unconditionally after every
// chunk, so the proxy read the entire upstream body into the uWS send buffer
// as fast as the origin could produce it.
test(
  "Bun.serve proxying a fetch() body applies client backpressure to the upstream",
  async () => {
    const CHUNK = 256 * 1024;
    const CAP_CHUNKS = 256; // 64 MiB runaway cap
    const BODY_BYTES = CHUNK * CAP_CHUNKS;

    let pulls = 0;
    let producedEverything = false;

    await using upstream = Bun.serve({
      port: 0,
      idleTimeout: 255,
      fetch() {
        return new Response(
          new ReadableStream({
            async pull(controller) {
              controller.enqueue(new Uint8Array(CHUNK));
              pulls++;
              if (pulls >= CAP_CHUNKS) {
                producedEverything = true;
                controller.close();
                return;
              }
              if (pulls % 32 === 0) await Bun.sleep(0);
            },
          }),
          { headers: { "content-length": String(BODY_BYTES) } },
        );
      },
    });

    await using proxy = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "serve-fetch-body-backpressure-fixture.ts"),
        `http://127.0.0.1:${upstream.port}/`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    const reader = proxy.stdout.getReader();
    let head = "";
    while (!head.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("proxy exited before reporting ports");
      head += Buffer.from(value).toString("utf8");
    }
    reader.releaseLock();
    const { proxyPort, controlPort } = JSON.parse(head.slice(0, head.indexOf("\n")));

    const rss = async () => (await fetch(`http://127.0.0.1:${controlPort}/`).then(r => r.json())).rss as number;
    const baselineRss = await rss();

    const failed = Promise.withResolvers<never>();
    proxy.exited.then(code => failed.reject(new Error(`proxy exited early (code ${code})`)));

    // Raw client: send the request, read the response head + a little body,
    // then stall so TCP backpressure propagates back to the proxy socket.
    const socket = net.connect(proxyPort, "127.0.0.1");
    const stalled = Promise.withResolvers<void>();
    let received = 0;
    socket.on("error", e => failed.reject(e));
    socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
    socket.on("data", chunk => {
      received += chunk.length;
    });
    socket.once("data", () => {
      socket.pause();
      stalled.resolve();
    });

    try {
      await Promise.race([stalled.promise, failed.promise]);

      // Wait until the upstream pull count stops growing (backpressure engaged)
      // or the upstream produces the whole capped body (the bug).
      let lastPulls = -1;
      let stableTurns = 0;
      while (!producedEverything && stableTurns < 12) {
        await Bun.sleep(25);
        if (pulls === lastPulls) {
          stableTurns++;
        } else {
          stableTurns = 0;
          lastPulls = pulls;
        }
      }

      const peakRss = await rss();
      const deltaMB = (peakRss - baselineRss) / (1024 * 1024);
      const bodyMB = BODY_BYTES / (1024 * 1024);

      // Without backpressure the proxy buffers the whole body in its uWS send
      // buffer while the client is stalled: RSS grows by ~bodyMB and the
      // upstream runs to CAP_CHUNKS. With backpressure the upstream parks after
      // a few socket-buffer-sized chunks and the proxy's RSS barely moves.
      const limitMB = bodyMB / (isASAN || isDebug ? 1.5 : 2);
      expect({ producedEverything, pulls, deltaMB: Math.round(deltaMB) }).toEqual({
        producedEverything: false,
        pulls: expect.any(Number),
        deltaMB: expect.any(Number),
      });
      expect(pulls).toBeLessThan(CAP_CHUNKS / 2);
      expect(deltaMB).toBeLessThan(limitMB);

      // Drain the rest of the body at full speed so we also prove the resume
      // path: once the client reads again the upstream must be unpaused and the
      // whole body delivered.
      const drained = Promise.withResolvers<void>();
      socket.on("close", () => drained.resolve());
      socket.resume();
      await Promise.race([drained.promise, failed.promise]);

      expect(received).toBeGreaterThanOrEqual(BODY_BYTES);
      expect(producedEverything).toBe(true);
    } finally {
      socket.destroy();
      proxy.kill();
    }
  },
  20_000,
);

// A client that aborts while the proxy is holding the upstream paused must not
// leave the upstream fetch parked forever: on_abort cancels the piped stream
// so the proxy tears down its connection to the upstream.
test(
  "client abort while backpressured cancels the upstream fetch",
  async () => {
    const CHUNK = 256 * 1024;
    const CAP_CHUNKS = 256;

    let pulls = 0;
    let cancelled = false;

    await using upstream = Bun.serve({
      port: 0,
      idleTimeout: 255,
      fetch() {
        return new Response(
          new ReadableStream({
            async pull(controller) {
              controller.enqueue(new Uint8Array(CHUNK));
              pulls++;
              if (pulls >= CAP_CHUNKS) return controller.close();
              if (pulls % 32 === 0) await Bun.sleep(0);
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-length": String(CHUNK * CAP_CHUNKS) } },
        );
      },
    });

    await using proxy = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "serve-fetch-body-backpressure-fixture.ts"),
        `http://127.0.0.1:${upstream.port}/`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    const reader = proxy.stdout.getReader();
    let head = "";
    while (!head.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("proxy exited before reporting ports");
      head += Buffer.from(value).toString("utf8");
    }
    reader.releaseLock();
    const { proxyPort } = JSON.parse(head.slice(0, head.indexOf("\n")));

    const socket = net.connect(proxyPort, "127.0.0.1");
    const stalled = Promise.withResolvers<void>();
    socket.on("error", () => {});
    socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
    socket.once("data", () => {
      socket.pause();
      stalled.resolve();
    });
    await stalled.promise;

    let lastPulls = -1;
    let stableTurns = 0;
    while (pulls < CAP_CHUNKS && stableTurns < 12) {
      await Bun.sleep(25);
      if (pulls === lastPulls) stableTurns++;
      else {
        stableTurns = 0;
        lastPulls = pulls;
      }
    }
    const pullsAtStall = pulls;
    expect(pullsAtStall).toBeLessThan(CAP_CHUNKS / 2);

    socket.destroy();

    // The proxy's on_abort should cancel its fetch to the upstream; the
    // upstream's serve then cancels the ReadableStream. Poll for that signal.
    for (let i = 0; i < 200 && !cancelled; i++) await Bun.sleep(10);

    try {
      expect({ cancelled, pulls }).toEqual({ cancelled: true, pulls: expect.any(Number) });
      expect(pulls).toBeLessThan(CAP_CHUNKS);
    } finally {
      proxy.kill();
    }
  },
  20_000,
);
