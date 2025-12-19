import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path from "path";

describe("FileSink", () => {
  describe("memory leak tests", () => {
    it(
      "Bun.spawn stdin with ReadableStream should not leak objects",
      async () => {
        // This test exercises the handleResolveStream code path in FileSink.zig
        // which was missing readable_stream.deinit() causing a leak of the
        // JSC Strong reference that held the ReadableStream alive.
        //
        // We use heapStats().objectCount to detect the leak. Without the fix,
        // objectCount grows by ~1 per iteration. With the fix, it stays stable
        // or decreases as GC properly reclaims objects.
        const dir = tempDirWithFiles("spawn-stdin-stream-leak", {
          "spawn-stdin-stream-leak-fixture.js": `
import { heapStats } from "bun:jsc";

const payload = new Uint8Array(1024).fill(65);

async function spawnWithStream() {
  const stream = new ReadableStream({
    async start(controller) {
      // Use await to prevent Bun from optimizing to Blob
      await 1;
      controller.enqueue(payload);
      controller.close();
    }
  });

  const proc = Bun.spawn(["cat"], {
    stdin: stream,
    stdout: "pipe",
    stderr: "ignore",
  });

  await proc.stdout.text();
  await proc.exited;
}

async function run() {
  // Warm up to stabilize
  for (let i = 0; i < 10; i++) {
    await spawnWithStream();
  }
  Bun.gc(true);
  await Bun.sleep(50);
  Bun.gc(true);

  const before = heapStats().objectCount;

  // Run test iterations
  const iterations = 100;
  for (let i = 0; i < iterations; i++) {
    await spawnWithStream();
  }

  Bun.gc(true);
  await Bun.sleep(50);
  Bun.gc(true);

  const after = heapStats().objectCount;
  const growth = after - before;

  console.log("Object count - before:", before, "after:", after, "growth:", growth);

  // Without the fix, we'd see growth of ~100 (1 per iteration).
  // With the fix, growth should be near zero or negative.
  // Allow up to 20 growth for noise/variance.
  const maxAllowedGrowth = 20;
  if (growth > maxAllowedGrowth) {
    throw new Error("Object count grew by " + growth + " after " + iterations + " iterations (max allowed: " + maxAllowedGrowth + "). This indicates a memory leak.");
  }

  console.log("SUCCESS: No significant object growth detected");
}

await run();
`,
        });

        const { exitCode, stderr, stdout } = Bun.spawnSync(
          [bunExe(), path.join(dir, "spawn-stdin-stream-leak-fixture.js")],
          {
            env: bunEnv,
            stderr: "pipe",
            stdout: "pipe",
            stdin: "ignore",
          },
        );

        console.log(stdout.toString());
        if (stderr.toString()) {
          console.error(stderr.toString());
        }
        expect(exitCode).toBe(0);
      },
      60 * 1000,
    );
  });
});
