import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

// The NetworkSink behind s3.file(k).writer() is heap-allocated and has two
// owners: the JS wrapper (m_sinkPtr) and the MultiPartUpload's callback_context.
// Both release paths routed through NetworkSink::finalize(), which only
// detached the upload task and never reclaimed the Box. Every writer() leaked
// one ~80-byte NetworkSink on both the success and failure completion paths,
// whether finished via .end() or .close().
//
// This test spawns two subprocesses under detect_leaks=1 with N and N+20
// writers and asserts the extra 20 writers do not add a proportional number of
// leaked bytes. symbolize=0 keeps each run under a second; one-time at-exit
// allocations are constant between the two runs and cancel out in the diff.

async function runWriters(count: number, fail: boolean, finish: "end" | "close") {
  const script = `
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        await req.arrayBuffer();
        ${
          fail
            ? `return new Response(
                 '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>nope</Message></Error>',
                 { status: 403 },
               );`
            : `return new Response("", { status: 200, headers: { etag: '"e"' } });`
        }
      },
    });
    server.unref();
    const s3 = new Bun.S3Client({
      accessKeyId: "k",
      secretAccessKey: "s",
      bucket: "b",
      endpoint: \`http://127.0.0.1:\${server.port}\`,
    });
    process.once("beforeExit", () => { Bun.gc(true); console.log("done"); });
    for (let i = 0; i < ${count}; i++) {
      const w = s3.file("key-" + i).writer({ retry: 0 });
      w.write("hello");
      ${finish === "end" ? `try { await w.end(); } catch {}` : `w.close();`}
    }
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: {
      ...bunEnv,
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1", "symbolize=0"].filter(Boolean).join(":"),
      // The S3 client does not honor NO_PROXY for writer(), so an inherited
      // proxy would hijack the request to the in-process mock server.
      http_proxy: undefined,
      HTTP_PROXY: undefined,
      https_proxy: undefined,
      HTTPS_PROXY: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("done");
  return Number(/SUMMARY: AddressSanitizer: (\d+) byte\(s\) leaked/.exec(stderr)?.[1] ?? 0);
}

describe.skipIf(!isASAN)("S3 writer() NetworkSink is freed", () => {
  for (const fail of [true, false]) {
    for (const finish of ["end", "close"] as const) {
      test.concurrent(`via .${finish}() when the upload ${fail ? "fails" : "succeeds"}`, async () => {
        const small = await runWriters(2, fail, finish);
        const large = await runWriters(22, fail, finish);
        // Before the fix the diff is >= 20 * sizeof(NetworkSink) ~= 1600.
        expect(large - small).toBeLessThan(400);
      });
    }
  }
});
