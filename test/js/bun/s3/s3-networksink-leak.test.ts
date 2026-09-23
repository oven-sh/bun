import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

// An inherited proxy would take the requests meant for the mock server.
const env = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
  ALL_PROXY: undefined,
  all_proxy: undefined,
};

const responses = {
  succeeds: `return new Response("", { status: 200, headers: { etag: '"e"' } });`,
  fails: `return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>nope</Message></Error>',
    { status: 403 },
  );`,
};

const mockS3 = (outcome: keyof typeof responses) => `
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.arrayBuffer();
      ${responses[outcome]}
    },
  });
  server.unref();
  const s3 = new Bun.S3Client({
    accessKeyId: "k",
    secretAccessKey: "s",
    bucket: "b",
    endpoint: \`http://127.0.0.1:\${server.port}\`,
  });
`;

// The bytes LeakSanitizer reports when a child that made `count` writers exits.
async function leakedBytes(count: number, finish: "end" | "close", outcome: keyof typeof responses) {
  const script = `${mockS3(outcome)}
    process.once("beforeExit", () => { Bun.gc(true); console.log("done"); });
    for (let i = 0; i < ${count}; i++) {
      const w = s3.file("key-" + i).writer({ retry: 0 });
      w.write("hello");
      ${finish === "end" ? `try { await w.end(); } catch {}` : `w.close();`}
    }
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    // symbolize=0 keeps the child fast. It also turns the suppressions off, which is fine:
    // the callers compare two runs, so what a process leaks once cancels out.
    env: { ...env, ASAN_OPTIONS: "detect_leaks=1:symbolize=0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("done\n");
  return Number(/SUMMARY: AddressSanitizer: (\d+) byte\(s\) leaked/.exec(stderr)?.[1] ?? 0);
}

// The JS wrapper and the upload's completion callback both hold the heap NetworkSink behind
// `s3file.writer()`. The one that lets go last frees it (`writer_holders`).
describe.skipIf(!isASAN)("S3 writer() frees its NetworkSink", () => {
  test.concurrent.each([
    { finish: "end", outcome: "succeeds" },
    { finish: "end", outcome: "fails" },
    { finish: "close", outcome: "succeeds" },
    { finish: "close", outcome: "fails" },
  ] as const)("via .$finish() when the upload $outcome", async ({ finish, outcome }) => {
    const small = await leakedBytes(2, finish, outcome);
    const large = await leakedBytes(22, finish, outcome);
    // A sink that is never freed adds 20 * sizeof(NetworkSink), about 3000 bytes.
    expect(large - small).toBeLessThan(400);
  });
});

// On success only `Drop for MultiPartUpload` unrefs the event loop, so the sink has to drop its
// ref on the upload when the upload completes, not when the writer is collected.
test("S3 writer() lets the process exit once end() resolves, even if the writer is retained", async () => {
  const script = `${mockS3("succeeds")}
    const w = s3.file("k").writer({ retry: 0 });
    w.write("hi");
    await w.end();
    globalThis.keep = w;
    process.once("beforeExit", () => console.log("beforeExit"));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "beforeExit\n", stderr: "", exitCode: 0 });
});
