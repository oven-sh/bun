import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import net from "node:net";
import { join } from "node:path";

// A client that aborts while Bun.serve is holding an upstream fetch() body
// paused for backpressure must not leave the upstream parked: on_abort has
// to cancel the ByteStream sink so the proxy tears down its connection to
// the upstream.
test("client abort while a fetch() body is backpressured cancels the upstream", async () => {
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
      join(import.meta.dir, "serve-fetch-body-abort-backpressure-fixture.ts"),
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
    if (done) throw new Error("proxy exited before reporting port");
    head += Buffer.from(value).toString("utf8");
  }
  reader.releaseLock();
  const { proxyPort } = JSON.parse(head.slice(0, head.indexOf("\n")));

  const failed = Promise.withResolvers<never>();
  proxy.exited.then(code => failed.reject(new Error(`proxy exited early (code ${code})`)));

  const socket = net.connect(proxyPort, "127.0.0.1");
  try {
    const stalled = Promise.withResolvers<void>();
    socket.on("error", e => failed.reject(e));
    socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
    socket.once("data", () => {
      socket.pause();
      stalled.resolve();
    });
    await Promise.race([stalled.promise, failed.promise]);

    // Wait until the upstream pull count stops growing (backpressure engaged)
    // or the upstream produces the whole capped body (no backpressure at all).
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
    expect(pulls).toBeLessThan(CAP_CHUNKS / 2);
  } finally {
    socket.removeAllListeners("error");
    socket.on("error", () => {});
    socket.destroy();
  }

  // The proxy's on_abort should cancel its fetch to the upstream; the
  // upstream's serve then cancels the ReadableStream. Poll for that signal.
  for (let i = 0; i < 200 && !cancelled; i++) await Bun.sleep(10);

  expect({ cancelled, pullsUnderCap: pulls < CAP_CHUNKS, pulls }).toMatchObject({
    cancelled: true,
    pullsUnderCap: true,
  });
  expect(proxy.exitCode).toBeNull();
  expect(proxy.signalCode).toBeNull();
});
