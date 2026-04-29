import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When S3Client.file(...).stream() fails to sign the request (e.g. missing credentials),
// the error is delivered to the ByteStream synchronously and stashed in pending.result
// as a StreamError.JSValue. That value must stay rooted until the stream is finalized.
// Previously it was stored as a raw unrooted jsc.JSValue, so a GC would sweep the error
// object while the ByteStream still held a pointer to it, and the stream's finalizer
// would then dereference a dead cell (MarkedBlock::vm() -> null).
test("S3 stream sign error survives GC until the stream is finalized", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { heapStats } = require("bun:jsc");
        const N = 300;
        const streams = [];
        for (let i = 0; i < N; i++) {
          streams.push(Bun.S3Client.file("path" + i).stream());
        }
        Bun.gc(true);
        await Bun.sleep(0);
        Bun.gc(true);
        await Bun.sleep(0);
        Bun.gc(true);
        // Each stream parked one Error instance in pending.result. Those
        // instances must survive GC as long as the stream is reachable.
        const retained = heapStats().objectTypeCounts.Error ?? 0;
        if (retained < N) {
          console.log("FAIL: only " + retained + " of " + N + " stream errors survived GC");
          process.exit(1);
        }
        // Releasing the streams must release the errors too (no leak).
        streams.length = 0;
        Bun.gc(true);
        await Bun.sleep(0);
        Bun.gc(true);
        await Bun.sleep(0);
        Bun.gc(true);
        const leaked = heapStats().objectTypeCounts.Error ?? 0;
        if (leaked > 5) {
          console.log("FAIL: " + leaked + " stream errors leaked after release");
          process.exit(1);
        }
        console.log("OK");
      `,
    ],
    env: {
      ...bunEnv,
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      S3_ACCESS_KEY_ID: "",
      S3_SECRET_ACCESS_KEY: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
