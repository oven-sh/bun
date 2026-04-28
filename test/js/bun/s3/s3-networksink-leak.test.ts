import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

// The NetworkSink struct backing `s3.file(...).writer()` used to leak because
// its `finalize()` only detached the MultiPartUpload task and never called
// `bun.destroy(this)`. Both owners (the JS wrapper's C++ destructor and the
// upload-completion callback) called `finalize()`, but neither freed the
// allocation, and `finalizeAndDestroy()` was dead code.
//
// This test points the writer at a local mock S3 endpoint, cycles through a
// number of writers, and asserts that every `new(NetworkSink)` is paired with
// a `destroy(NetworkSink)` in the `[alloc]` debug log. The log is only emitted
// in assertion-enabled builds, so the test is a no-op in release.

test.skipIf(!isDebug)("s3 writer() NetworkSink struct should be freed", async () => {
  // Minimal S3 mock: accept any PUT (single-part upload path).
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.arrayBuffer();
      return new Response("", { status: 200, headers: { etag: '"mock"' } });
    },
  });

  const N = 30;
  const fixture = /* js */ `
    const { S3Client } = require("bun");
    const s3 = new S3Client({
      accessKeyId: "test",
      secretAccessKey: "test",
      endpoint: process.env.MOCK_S3_ENDPOINT,
      bucket: "bucket",
      retry: 0,
    });

    async function once(i) {
      const writer = s3.file("k" + i).writer({ retry: 0 });
      writer.write("hello");
      await writer.end();
    }

    for (let i = 0; i < ${N}; i++) await once(i);

    // Drop the JS wrappers so the C++ finalizer runs.
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);
  `;

  const env: Record<string, string | undefined> = {
    ...bunEnv,
    MOCK_S3_ENDPOINT: `http://127.0.0.1:${server.port}`,
    BUN_DEBUG_QUIET_LOGS: "1",
    BUN_DEBUG_alloc: "1",
  };
  // S3 writer resolves its proxy without a hostname, so NO_PROXY is ignored.
  // Drop any ambient proxy so requests hit the local mock.
  for (const k of ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY"]) delete env[k];

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");

  // `[alloc]` scoped logs are written to stdout.
  let created = 0;
  let destroyed = 0;
  for (const line of stdout.split("\n")) {
    if (line.includes("new(NetworkSink)")) created++;
    else if (line.includes("destroy(NetworkSink)")) destroyed++;
  }

  expect(created).toBe(N);
  // Allow a tiny slack for a wrapper the final GC pass may not have reached,
  // but the bug being tested destroys zero of them.
  expect(destroyed).toBeGreaterThanOrEqual(N - 2);
  expect(destroyed).toBeLessThanOrEqual(created);
  expect(exitCode).toBe(0);
});
