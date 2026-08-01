import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// The server runs in its own subprocess: when node:http2's event loop shares a
// process with the test's Bun.spawn() pipe-reading, the server intermittently
// leaves a few streams unanswered under load (macOS 14 / aarch64 Linux). That's
// a node:http2-server-side issue unrelated to the H2 client lifetimes this test
// is measuring; isolating the server removes it.
let serverProc: ReturnType<typeof Bun.spawn>;
let url: string;

beforeAll(async () => {
  serverProc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fetch-http2-leak-server.ts")],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = serverProc.stdout.getReader();
  let line = "";
  while (!line.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("server exited before printing URL");
    line += Buffer.from(value).toString();
  }
  reader.releaseLock();
  url = line.trim();
});

afterAll(() => {
  serverProc.kill();
});

async function runFixture(scenario: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", join(import.meta.dir, "fetch-http2-leak-fixture.ts")],
    env: { ...bunEnv, SERVER: url, SCENARIO: scenario, COUNT: "200", BATCH: "8" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("--pass--");
  expect(exitCode).toBe(0);
}

test("h2 ClientSession/Stream do not leak across batched GETs", () => runFixture("get"));
test("h2 ClientSession/Stream do not leak across batched POSTs", () => runFixture("post"));
test("h2 ClientSession/Stream do not leak across aborted requests", () => runFixture("abort"));
test("h2 ClientSession/Stream do not leak across streamed-response reads", () => runFixture("stream-response"));
test("h2 ClientSession/Stream do not leak across streamed-request uploads", () => runFixture("stream-request"));
test("h2 ClientSession/Stream do not leak across same-origin redirects", () => runFixture("redirect"));
test("h2 ClientSession/Stream do not leak across gzip-encoded responses", () => runFixture("gzip"));
