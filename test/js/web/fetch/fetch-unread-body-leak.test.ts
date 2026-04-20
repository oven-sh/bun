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
