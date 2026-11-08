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
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      requests++;
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

// How the child lets go of each writer `w`. It records a word in `seen` as proof of the path.
const finishes = {
  // The upload callback lets go of the sink first, the collected wrapper last.
  end: `seen.add(await w.end().then(() => "resolved", () => "rejected"));`,
  // close() sends the upload and makes the wrapper let go at once. The upload callback is last.
  close: `w.close(); seen.add("closed");`,
  // The collected wrapper lets go first and fails the upload, which nothing can finish.
  collect: `registry.register(w, i);`,
};

// The bytes LeakSanitizer reports when a child that made `count` writers exits.
async function leakedBytes(count: number, finish: keyof typeof finishes, outcome: keyof typeof responses) {
  const script = `${mockS3(outcome)}
    const seen = new Set();
    let finalized = 0;
    const registry = new FinalizationRegistry(() => finalized++);
    process.once("beforeExit", () => { Bun.gc(true); console.log("done", requests, ...seen); });
    async function each(i) {
      const w = s3.file("key-" + i).writer({ retry: 0 });
      w.write("hello");
      ${finishes[finish]}
    }
    for (let i = 0; i < ${count}; i++) await each(i);
    if (${finish === "collect"}) {
      const deadline = Date.now() + 10_000;
      while (finalized < ${count} && Date.now() < deadline) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      // A writer that is not collected keeps the process alive, so "beforeExit" never comes.
      if (finalized < ${count}) {
        console.log("collected only", finalized, "of", ${count});
        process.exit(1);
      }
      seen.add("collected");
    }
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: {
      ...env,
      // symbolize=0 keeps the child fast. It also turns the suppressions off, which is fine:
      // the callers compare two runs, so what a process leaks once cancels out.
      ASAN_OPTIONS: "detect_leaks=1:symbolize=0",
      // bun test does not kill the child of a concurrent test that times out. With this, a
      // child that hangs exits when the test process does.
      BUN_FEATURE_FLAG_NO_ORPHANS: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const summary = /SUMMARY: AddressSanitizer: (\d+) byte\(s\) leaked/.exec(stderr);
  // A report makes the child exit with 1. With no report, only exit code 0 means that the scan
  // ran and found nothing: a scan that cannot run (under ptrace) also prints no summary.
  if (!summary) expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 });
  return { stdout, leaked: Number(summary?.[1] ?? 0) };
}

// The JS wrapper and the upload's completion callback both hold the heap NetworkSink behind
// `s3file.writer()`. The one that lets go last frees it (`writer_holders`).
describe.skipIf(!isASAN)("S3 writer() frees its NetworkSink", () => {
  test.concurrent.each([
    { name: "end() that resolves", finish: "end", outcome: "succeeds", seen: "resolved" },
    { name: "end() that rejects", finish: "end", outcome: "fails", seen: "rejected" },
    { name: "close() and an upload that succeeds", finish: "close", outcome: "succeeds", seen: "closed" },
    { name: "close() and an upload that fails", finish: "close", outcome: "fails", seen: "closed" },
    // A buffered write sends nothing before end(), so no request reaches the server.
    { name: "collection before end()", finish: "collect", outcome: "succeeds", seen: "collected", requests: 0 },
  ] as const)("after $name", async ({ finish, outcome, seen, requests }) => {
    const small = await leakedBytes(2, finish, outcome);
    const large = await leakedBytes(22, finish, outcome);
    expect([small.stdout, large.stdout]).toEqual([
      `done ${requests ?? 2} ${seen}\n`,
      `done ${requests ?? 22} ${seen}\n`,
    ]);
    // A sink that is never freed adds 20 * sizeof(NetworkSink), about 3000 bytes.
    expect(large.leaked - small.leaked).toBeLessThan(400);
  });
});

// On success only `Drop for MultiPartUpload` unrefs the event loop, so the sink has to drop its
// ref on the upload when the upload completes, not when the writer is collected.
// Serial on purpose: when this test times out, bun test kills the child that never exits.
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
