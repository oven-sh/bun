import { expect, test } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux, isWindows, tempDir } from "harness";
import path from "path";

// Runs `source` as a test file with a default timeout of 250ms. `graceMs` is how long after its
// timeout a test may keep the event loop blocked: the default is 5000. Returns the lines that say
// how the tests and the run ended, without durations. A run that hangs is killed after 15 seconds,
// which `signalCode` shows.
async function runTestFile(source: string, { graceMs, args = [] }: { graceMs?: number; args?: string[] } = {}) {
  using dir = tempDir("test-timeout", { "a.test.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout=250", ...args, "a.test.ts"],
    env: { ...bunEnv, BUN_TEST_TIMEOUT_GRACE_MS: graceMs === undefined ? undefined : String(graceMs) },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = (stdout + stderr)
    .split("\n")
    .filter(line => /^\((pass|fail)\) |^  \^ |^error: |^note: |^ran: /.test(line))
    .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
  return { lines, signalCode: proc.signalCode, exitCode };
}

const endedTheRun = [
  "error: bun test cannot stop code that does not return to the event loop, so it ended the run.",
  "note: the tests and files after this one did not run. With --parallel, only this file ends.",
];
const blocked = (what: string) =>
  `  ^ ${what} timed out after 250ms and had not returned to the event loop 250ms later.`;

// https://github.com/oven-sh/bun/issues/21277
// https://github.com/oven-sh/bun/issues/45192
test.concurrent.each([
  ["a loop in the test", `test("blocks", () => { while (true) {} });`, "(fail) blocks", blocked("this test")],
  [
    "a loop that allocates",
    // It lets go of all but the last few thousand objects, for a build that never ends it.
    `test("blocks", () => {
       const held = [];
       for (let i = 0; ; i++) held[i % 4096] = { payload: new Array(1024).fill(1) };
     });`,
    "(fail) blocks",
    blocked("this test"),
  ],
  [
    "a loop after a timer",
    `test("blocks", async () => { await new Promise(resolve => setTimeout(resolve, 1)); while (true) {} });`,
    "(fail) blocks",
    blocked("this test"),
  ],
  [
    "a loop in a microtask of a concurrent test",
    `test.concurrent("blocks", async () => { await Promise.resolve(); while (true) {} });
     test.concurrent("beside it", async () => { await new Promise(resolve => setTimeout(resolve, 1)); });`,
    "(fail) blocks",
    blocked("this test"),
  ],
  ["a native call", `test("blocks", () => { Bun.sleepSync(60_000); });`, "(fail) blocks", blocked("this test")],
  [
    "a loop in a hook",
    `describe("outer", () => {
       beforeEach(() => { while (true) {} });
       test("blocks", () => {});
     });`,
    "(fail) outer > blocks",
    blocked("a hook of this test"),
  ],
])(
  "%s that does not return to the event loop ends the run after its timeout",
  async (_, blocks, failed, why) => {
    const run = await runTestFile(
      `import { test, describe, beforeEach } from "bun:test";
       test("before it", () => {});
       ${blocks}
       test("after it", () => {});`,
      { graceMs: 250 },
    );
    expect(run).toEqual({
      lines: ["(pass) before it", failed, why, ...endedTheRun],
      signalCode: null,
      exitCode: 1,
    });
  },
  20_000,
);

test.concurrent(
  "a test that blocks the event loop for less than 5 seconds after its timeout runs to its end, and the run goes on",
  async () => {
    const run = await runTestFile(
      `import { test } from "bun:test";
       const ran = [];
       test("overruns", () => {
         try {
           const end = performance.now() + 500;
           while (performance.now() < end) {}
           ran.push("body");
         } finally {
           ran.push("finally");
         }
       });
       test("after it", () => console.log("ran: " + ran));`,
    );
    expect(run).toEqual({
      lines: ["ran: body,finally", "(fail) overruns", "  ^ this test timed out after 250ms.", "(pass) after it"],
      signalCode: null,
      exitCode: 1,
    });
  },
  20_000,
);

// Each of them blocks the event loop for longer than the timeout of a test or hook before it, and 100ms more.
test.concurrent(
  "a timeout that is over, or that is not the test's, does not end the run",
  async () => {
    const run = await runTestFile(
      `import { test, describe, beforeEach } from "bun:test";
       const block = ms => { const end = performance.now() + ms; while (performance.now() < end) {} };
       const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
       beforeEach(() => {});
       test("has no timeout", () => block(600), 0);
       test("has a long timeout", () => block(600), 10_000);
       test("has a long timeout, in a later turn", async () => { await wait(1); block(600); }, 10_000);
       test("has a long timeout, with a done callback", done => { setTimeout(() => { block(600); done(); }, 1); }, 10_000);
       describe("concurrent", () => {
         test.concurrent("is over early", async () => { await wait(1); });
         test.concurrent("has a long timeout, in a later turn", async () => { await wait(20); block(600); }, 10_000);
       });
       test("has no timeout, in a later turn", async () => { await wait(1); block(600); }, 0);`,
      { graceMs: 100 },
    );
    expect(run).toEqual({
      lines: [
        "(pass) has no timeout",
        "(pass) has a long timeout",
        "(pass) has a long timeout, in a later turn",
        "(pass) has a long timeout, with a done callback",
        "(pass) concurrent > is over early",
        "(pass) concurrent > has a long timeout, in a later turn",
        "(pass) has no timeout, in a later turn",
      ],
      signalCode: null,
      exitCode: 0,
    });
  },
  20_000,
);

// A debugger may pause a test for longer than any timeout.
test.concurrent(
  "a test that blocks the event loop does not end the run while an inspector is enabled",
  async () => {
    const run = await runTestFile(
      `import { test } from "bun:test";
       test("overruns", () => {
         const end = performance.now() + 900;
         while (performance.now() < end) {}
         console.log("ran: to the end");
       });`,
      { graceMs: 100, args: ["--inspect=127.0.0.1:0"] },
    );
    expect(run).toEqual({
      lines: ["ran: to the end", "(fail) overruns", "  ^ this test timed out after 250ms."],
      signalCode: null,
      exitCode: 1,
    });
  },
  20_000,
);

// The child inherits stdout, so stdout only ends when the child has ended too.
test.concurrent.skipIf(isWindows)(
  "a run that a blocked event loop ends takes the child processes of its tests with it",
  async () => {
    const run = await runTestFile(
      `import { test } from "bun:test";
       test("blocks", () => {
         Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"], stdio: ["ignore", "inherit", "inherit"] });
         while (true) {}
       });`,
      { graceMs: 250 },
    );
    expect(run).toEqual({
      lines: ["(fail) blocks", blocked("this test"), ...endedTheRun],
      signalCode: null,
      exitCode: 1,
    });
  },
  20_000,
);

if (isFlaky && isLinux) {
  test.todo("processes get killed");
} else {
  test.concurrent.each([true, false])(`processes get killed (sync: %p)`, async sync => {
    const { exited, stdout, stderr } = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        path.join(import.meta.dir, sync ? "process-kill-fixture-sync.ts" : "process-kill-fixture.ts"),
      ],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
      env: bunEnv,
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    // merge outputs so that this test still works if we change which things are printed to stdout
    // and which to stderr
    const combined = out + err;
    // exit code should indicate failed tests, not abort or anything
    expect(exitCode).toBe(1);
    expect(combined).not.toContain("This should not be printed!");
    expect(combined).toContain("killed 1 dangling process");
    // we should not expose the termination exception
    expect(combined).not.toContain("Unhandled error between tests");
    expect(combined).not.toContain("JavaScript execution terminated");
    // both tests should have run with the expected result
    expect(combined).toContain("(fail) test timeout kills dangling processes");
    expect(combined).toContain("(pass) slow test after test timeout");
  });
}
