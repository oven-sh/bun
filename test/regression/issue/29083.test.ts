import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/29083
//
// Bun.S3File.arrayBuffer() / .text() / .json() retained RSS and reached
// OOM because S3BlobDownloadTask.onS3DownloadResolved in
// src/bun.js/webcore/Blob.zig never freed the downloaded body
// MutableString after handing the bytes to the JS handler. Every call
// leaked the entire downloaded payload on the native side.
//
// The fix takes ownership of the downloaded body as a default_allocator
// slice and passes it to the handler with the `.temporary` lifetime —
// matching how ReadFile feeds local files through the same handler
// chain. Each handler then transfers ownership to JSC via a
// mimalloc-backed external string / ArrayBuffer (zero-copy) or frees
// the slice after synchronous consumption (JSON.parse, FormData).
//
// Each test spawns a child process with a capped JS heap so the leak
// cannot be absorbed by bun's heap, loops one of the read methods many
// times against a local Bun.serve() mock, and fails if RSS growth
// exceeds the budget.

// Child builds ~512 MiB of cumulative traffic over localhost (64 × 8
// MiB). Well under a debug ASAN build's 2-minute budget in practice
// but far above the 5-second bun:test default.
setDefaultTimeout(120_000);

type Method = "arrayBuffer" | "text" | "json" | "formData";

async function runLeakFixture(method: Method, contentType: string, bodyLiteral: string) {
  using dir = tempDir(`issue-29083-${method}`, {
    "fixture.ts": /* ts */ `
      const CHUNK_MIB = 8;
      const ITERATIONS = 64;
      const payload = ${bodyLiteral};
      const expectedLength = Buffer.byteLength(payload);

      await using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(payload, {
            headers: {
              "content-type": ${JSON.stringify(contentType)},
              "content-length": String(expectedLength),
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

      async function pullOnce() {
        const value = await file.${method}();
        if (${
          method === "arrayBuffer"
            ? "value.byteLength"
            : method === "text"
              ? "value.length"
              : method === "json"
                ? "JSON.stringify(value).length"
                : "[...value.keys()].length"
        } === 0) {
          throw new Error("empty ${method}() result");
        }
        // Touch the contents to force JSC to materialise the lazy
        // external string / ArrayBuffer copy. Without this, a
        // use-after-free in the downloaded buffer might be hidden
        // because no JS code ever reads the memory.
        ${
          method === "arrayBuffer"
            ? "new Uint8Array(value).at(-1);"
            : method === "text"
              ? "value.charCodeAt(value.length - 1); value.length;"
              : method === "json"
                ? "void JSON.stringify(value).length;"
                : "const fd_entry = value.get('payload'); if (typeof fd_entry === 'string') { fd_entry.charCodeAt(fd_entry.length - 1); } else { void fd_entry.size; }"
        }
      }

      // Warm up so DNS / connection pool / JIT tier-up are folded into
      // the baseline.
      for (let i = 0; i < 4; i++) await pullOnce();
      Bun.gc(true);
      await Bun.sleep(10);
      Bun.gc(true);

      const baseline = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) await pullOnce();

      Bun.gc(true);
      await Bun.sleep(10);
      Bun.gc(true);

      const final = process.memoryUsage.rss();
      const growthBytes = final - baseline;
      const growthMib = growthBytes / 1024 / 1024;

      // Pre-fix: every iteration leaks the full download
      // (8 MiB arrayBuffer / ~8 MiB text / ~8 MiB json), so after 64
      // iterations the process has leaked ~0.5 GiB. Post-fix: RSS stays
      // within a small constant of the baseline.
      const BUDGET_MIB = 64;

      console.log(JSON.stringify({
        method: ${JSON.stringify(method)},
        baseline,
        final,
        growthBytes,
        growthMib,
        iterations: ITERATIONS,
      }));

      if (growthMib > BUDGET_MIB) {
        throw new Error(
          \`RSS grew by \${growthMib.toFixed(1)} MiB after \${ITERATIONS} \` +
            \`${method}() calls (budget: \${BUDGET_MIB} MiB). Leak regressed.\`,
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
      // Bun's S3 client calls getHttpProxy(true, null, null) — passing
      // null hostname bypasses NO_PROXY — so even a localhost endpoint
      // is routed through $HTTP_PROXY. Unset every proxy env var the
      // child might inherit so the mock server at 127.0.0.1:port is
      // reached directly.
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      NO_PROXY: "*",
      no_proxy: "*",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
  }
  // The fixture prints a JSON line with baseline/final/growth RSS on
  // success — its presence is the actual "the loop finished within
  // budget" signal. Don't assert stderr is empty because ASAN-enabled
  // debug builds can emit warnings there that aren't failures.
  expect(stdout).toContain('"growthMib"');
  expect(exitCode).toBe(0);
}

// The reported bug is Linux-specific (OOM in a capped Linux container).
// On Windows the child-process RSS sampling is flakier (different memory
// model, larger page granularity) and localhost port 0 + process.env
// HTTP_PROXY semantics diverge from POSIX, so keep the regression scoped
// to POSIX where the original issue actually reproduces.
describe.skipIf(isWindows)("S3File body read lifetimes (#29083)", () => {
  test("arrayBuffer() does not leak native download body", async () => {
    await runLeakFixture("arrayBuffer", "application/octet-stream", "Buffer.alloc(8 * 1024 * 1024, 0x41)");
  });

  test("text() does not leak or UAF native download body", async () => {
    // Pure ASCII content exercises the toStringWithBytes(.temporary)
    // ASCII branch that creates a JSC external string pointing into
    // the downloaded buffer without copying and transfers ownership
    // via free_global_string. ASAN catches any lifetime mismatch once
    // the child process touches the returned string.
    await runLeakFixture("text", "text/plain", "Buffer.alloc(8 * 1024 * 1024, 0x41).toString()");
  });

  test("json() does not leak native download body", async () => {
    await runLeakFixture(
      "json",
      "application/json",
      "JSON.stringify({ data: Buffer.alloc(8 * 1024 * 1024 - 32, 0x41).toString() })",
    );
  });

  test("formData() does not leak native download body", async () => {
    // Exercises the synchronous parse-and-free codepath in
    // toFormDataWithBytes(). The bodyLiteral builds a single
    // multipart/form-data field whose value is an 8 MiB ASCII block.
    const boundary = "bun29083";
    const bodyLiteral = `(() => {
    const boundary = ${JSON.stringify(boundary)};
    const value = Buffer.alloc(8 * 1024 * 1024, 0x41).toString();
    return (
      "--" + boundary + "\\r\\n" +
      'Content-Disposition: form-data; name="payload"\\r\\n' +
      "\\r\\n" +
      value + "\\r\\n" +
      "--" + boundary + "--\\r\\n"
    );
  })()`;
    await runLeakFixture("formData", `multipart/form-data; boundary=${boundary}`, bodyLiteral);
  });
});
