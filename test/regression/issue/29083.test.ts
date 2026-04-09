import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/29083
//
// Bun.S3File.arrayBuffer() retained RSS and reached OOM because
// S3BlobDownloadTask.onS3DownloadResolved in src/bun.js/webcore/Blob.zig
// never freed the downloaded body MutableString after handing the bytes
// to the JS handler (which copies them into the JS heap via .clone).
// Every arrayBuffer()/text()/json() call leaked the entire downloaded
// payload on the native side.
//
// The fixture spawns a child process with --smol and a low JSC heap cap,
// points Bun's S3 client at a local Bun.serve() mock, and loops
// arrayBuffer() many times. Before the fix RSS grows unbounded; after it
// stays bounded.

test("S3File.arrayBuffer() does not leak native download body", async () => {
  using dir = tempDirWithFiles("issue-29083", {
    "fixture.ts": /* ts */ `
      // Chunk size and iteration count picked so that a full-download leak
      // makes RSS climb well above the baseline, while staying cheap enough
      // to finish quickly under the debug ASAN build.
      const CHUNK_MIB = 8;
      const ITERATIONS = 128;
      const payload = Buffer.alloc(CHUNK_MIB * 1024 * 1024, 0x41);

      await using server = Bun.serve({
        port: 0,
        // Any path on the mock returns the same payload. Bun's S3 client
        // signs and sends a normal HTTP GET; the mock doesn't need to
        // validate the signature.
        fetch() {
          return new Response(payload, {
            headers: {
              "content-type": "application/octet-stream",
              "content-length": String(payload.length),
              "etag": "\\"mock-etag\\"",
            },
          });
        },
      });

      const s3 = new Bun.S3Client({
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "us-east-1",
        bucket: "bucket",
        endpoint: \`http://localhost:\${server.port}\`,
      });

      const file = s3.file("leak.bin");

      // Warm up so the initial allocations / DNS / connection pool are
      // folded into the baseline.
      for (let i = 0; i < 4; i++) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength !== payload.length) {
          throw new Error(\`warmup size mismatch: \${bytes.byteLength}\`);
        }
      }
      Bun.gc(true);
      await Bun.sleep(10);
      Bun.gc(true);

      const baseline = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength !== payload.length) {
          throw new Error(\`size mismatch at \${i}: \${bytes.byteLength}\`);
        }
      }

      Bun.gc(true);
      await Bun.sleep(10);
      Bun.gc(true);

      const final = process.memoryUsage.rss();
      const growthBytes = final - baseline;
      const growthMib = growthBytes / 1024 / 1024;

      // Pre-fix: every iteration leaks CHUNK_MIB, so after 128 iterations
      // the process has leaked ~1 GiB (and would have been OOM-killed in a
      // small container). Post-fix: RSS stays within a small constant of
      // the baseline. 64 MiB = 8 * CHUNK_MIB is the budget — easily clears
      // the fix, blows up with the leak.
      const BUDGET_MIB = 64;

      console.log(JSON.stringify({
        baseline,
        final,
        growthBytes,
        growthMib,
        iterations: ITERATIONS,
        chunkMib: CHUNK_MIB,
      }));

      if (growthMib > BUDGET_MIB) {
        throw new Error(
          \`RSS grew by \${growthMib.toFixed(1)} MiB after \${ITERATIONS} \` +
            \`arrayBuffer() calls (budget: \${BUDGET_MIB} MiB). Leak regressed.\`,
        );
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", path.join(String(dir), "fixture.ts")],
    env: {
      ...bunEnv,
      // Cap the JS heap so the leak must show up on the native side as
      // RSS growth rather than getting absorbed by an oversized JS heap.
      BUN_JSC_gcMaxHeapSize: "134217728",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
  }
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
