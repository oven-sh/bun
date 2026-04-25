import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// Regression test for the fetch response-body backpressure gap (Sentry
// BUN-2V22 cluster). Before the fix, ByteStream.onData appended every incoming
// chunk to its internal buffer with no high-water-mark check, so a server that
// sends faster than JS reads (or a client that never reads) buffered the
// entire response in memory and OOMed long-running processes.
//
// The server pumps TARGET_BYTES as fast as the socket accepts. The fixture
// reads one chunk, stalls, samples RSS while yielding to the event loop, then
// drains a further 16 MB to prove the socket resumes after a pull.
test("fetch response body applies backpressure when the reader stalls", async () => {
  const CHUNK = Buffer.alloc(256 * 1024, "x");
  const TARGET_BYTES = 128 * 1024 * 1024;

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch() {
      let written = 0;
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            while (written < TARGET_BYTES) {
              await controller.write(CHUNK);
              written += CHUNK.length;
            }
            // Leave the response open so the client stays in the
            // still-receiving state for the duration of the measurement.
          },
        }),
        { headers: { "Content-Type": "application/octet-stream" } },
      );
    },
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", join(import.meta.dir, "fetch-unread-body-leak-fixture.ts")],
    env: {
      ...bunEnv,
      SERVER: server.url.href,
      TARGET_BYTES: String(TARGET_BYTES),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (stderr) console.error(stderr.trim());
  console.log(stdout.trim());

  const report = JSON.parse(stdout.trim());

  // With backpressure, the client buffers ~high-water-mark (1 MB) plus a few
  // recv-buffer-sized chunks of overshoot and allocator slack — single-digit
  // MB. Without, it buffers on the order of TARGET_BYTES. 32 MB gives wide
  // margin for debug-build/ASAN overhead while still being ~4× smaller than
  // the unfixed behaviour.
  expect(report.stalledRssGrowthMB).toBeLessThan(32);

  // Resume must work: the post-stall drain should have read past the
  // high-water mark, which is only possible if the socket resumed.
  expect(report.drainedMB).toBeGreaterThanOrEqual(16);

  expect(exitCode).toBe(0);
});

// reader.cancel() (or Response GC) while the socket is paused must release the
// pause. The drain_handler is cleared in ignoreRemainingResponseBody, so
// without an explicit release there the connection would sit paused forever
// with its idle timeout disarmed. The subprocess deliberately stays alive
// after cancel() so process exit can't close the FD and mask the regression;
// the observable is `server.pendingRequests` dropping to 0, which only
// happens once the client has drained the response (i.e. the socket resumed).
test("fetch response body backpressure is released on reader.cancel()", async () => {
  const CHUNK = Buffer.alloc(256 * 1024, "x");

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            // Small enough that, once the client resumes and ignores, the
            // response drains and completes within the test window.
            for (let i = 0; i < 32; i++) await controller.write(CHUNK);
            controller.close();
          },
        }),
      );
    },
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--smol",
      "-e",
      `
        const res = await fetch(process.env.SERVER);
        const reader = res.body.getReader();
        await reader.read();
        // Stall long enough for the buffer to cross the HWM and pause.
        for (let i = 0; i < 50; i++) await Bun.sleep(2);
        await reader.cancel();
        process.stdout.write("cancelled\\n");
        // Stay alive: process exit would close the socket regardless of
        // whether the pause was released, masking the regression. The parent
        // kills us once the server reports the response drained.
        setInterval(() => {}, 1 << 30);
      `,
    ],
    env: { ...bunEnv, SERVER: server.url.href },
    stdout: "pipe",
    stderr: "pipe",
  });

  let buffered = "";
  for await (const chunk of proc.stdout) {
    buffered += Buffer.from(chunk).toString();
    if (buffered.includes("cancelled\n")) break;
  }
  expect(buffered).toContain("cancelled");

  // The subprocess is still alive (setInterval ref), so the only way the
  // server's pending count reaches 0 is the client having resumed the paused
  // socket and drained the 8 MB to completion. If the regression recurs the
  // socket stays paused, the server can't finish sending, and this loop runs
  // until the test runner's timeout fails it.
  while (server.pendingRequests > 0) {
    await Bun.sleep(5);
  }
  expect(server.pendingRequests).toBe(0);

  proc.kill();
  await proc.exited;
});

// Accessing res.body, letting the buffer cross the HWM (pausing the socket),
// then calling res.text() takes the toBufferedValue path which sets
// buffer_action with no pull-based resume hook. toBufferedValue must release
// the pause itself; evaluateBodyBackpressure's buffer_action exemption only
// runs on new data, which can't arrive while paused.
test("fetch response body backpressure is released when .text() follows a stalled .body", async () => {
  const SIZE = 4 * 1024 * 1024;
  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch() {
      return new Response(new Blob([Buffer.alloc(SIZE, "x")]));
    },
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--smol",
      "-e",
      `
        const res = await fetch(process.env.SERVER);
        // Create the ByteStream and enable streaming.
        void res.body;
        // Let the HTTP thread buffer past the 1 MB HWM and pause.
        for (let i = 0; i < 50; i++) await Bun.sleep(2);
        // toBufferedValue path — must release the pause it can't otherwise see.
        const text = await res.text();
        if (text.length !== ${SIZE}) throw new Error("size " + text.length);
        console.log("ok");
      `,
    ],
    env: { ...bunEnv, SERVER: server.url.href },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (stderr) console.error(stderr.trim());
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

// response.clone() before any .body access creates the ByteStream via the
// Body.tee() fallback path, which must wire drain_handler the same way
// toReadableStream() does — otherwise once the buffer crosses the HWM the
// socket is paused with no resume hook.
test("fetch response body backpressure resumes after clone()-before-body-access", async () => {
  const SIZE = 8 * 1024 * 1024;
  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch() {
      return new Response(new Blob([Buffer.alloc(SIZE)]));
    },
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--smol",
      "-e",
      `
        const res = await fetch(process.env.SERVER);
        // clone() first — this is the tee() fallback that allocates a fresh
        // ByteStream.Source.
        const clone = res.clone();
        // Stall one branch so the underlying ByteStream's buffer crosses the
        // HWM and the socket pauses. Without drain_handler wired on the tee()
        // path, nothing would resume it.
        const reader = clone.body.getReader();
        const first = await reader.read();
        for (let i = 0; i < 50; i++) await Bun.sleep(2);
        // Now drain both branches; this requires the socket to resume.
        const a = await res.bytes();
        let b = first.value.byteLength;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          b += value.length;
        }
        if (a.byteLength !== ${SIZE} || b !== ${SIZE}) {
          throw new Error("size mismatch: " + a.byteLength + " / " + b);
        }
        console.log("ok");
      `,
    ],
    env: { ...bunEnv, SERVER: server.url.href },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (stderr) console.error(stderr.trim());
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
