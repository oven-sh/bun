import { expect, test } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux, tempDir } from "harness";
import path from "path";

// Runs `source` as a test file with a default timeout of 250ms. Returns the result lines without
// their durations. A run that hangs is killed, which `signalCode` shows.
async function runTestFile(prefix: string, source: string) {
  using dir = tempDir(prefix, { "spin.test.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout=250", "spin.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const results = (stdout + stderr)
    .split("\n")
    .filter(line => /^\((pass|fail)\) |^  \^ |^killed |^ran: /.test(line))
    .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
  return { results, signalCode: proc.signalCode, exitCode };
}

// https://github.com/oven-sh/bun/issues/21277
test.concurrent(
  "a test that never returns to the event loop times out",
  async () => {
    const run = await runTestFile(
      "timeout-sync-loop",
      `
        import { test } from "bun:test";
        const ran = [];
        test("spins", () => {
          while (true) {}
        });
        test("cannot catch it", () => {
          try {
            while (true) {}
          } catch {
            ran.push("catch");
          } finally {
            ran.push("finally");
          }
          ran.push("after");
        });
        test("spins in a microtask", async () => {
          await Promise.resolve();
          while (true) {}
        });
        test("spins in a tick", async () => {
          process.nextTick(() => {
            while (true) {}
          });
          await Promise.resolve();
        });
        test("spins with a child process", () => {
          Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"], stdio: ["ignore", "ignore", "ignore"] });
          while (true) {}
        });
        test("runs after them", async () => {
          await Promise.resolve();
          ran.push("microtask");
          await new Promise(resolve => process.nextTick(resolve));
          ran.push("tick");
          console.log("ran: " + ran);
        });
      `,
    );
    expect(run).toEqual({
      results: [
        "ran: microtask,tick",
        "(fail) spins",
        "  ^ this test timed out after 250ms.",
        "(fail) cannot catch it",
        "  ^ this test timed out after 250ms.",
        "(fail) spins in a microtask",
        "  ^ this test timed out after 250ms.",
        "(fail) spins in a tick",
        "  ^ this test timed out after 250ms.",
        "killed 1 dangling process",
        "(fail) spins with a child process",
        "  ^ this test timed out after 250ms.",
        "(pass) runs after them",
      ],
      signalCode: null,
      exitCode: 1,
    });
  },
  20_000,
);

test.concurrent(
  "a hook that never returns to the event loop times out",
  async () => {
    const run = await runTestFile(
      "timeout-sync-loop-hook",
      `
        import { test, beforeEach, afterAll } from "bun:test";
        let calls = 0;
        beforeEach(() => {
          if (calls++ === 0) while (true) {}
        });
        afterAll(() => {
          while (true) {}
        });
        test("first", () => {});
        test("second", () => {});
      `,
    );
    expect(run).toEqual({
      results: [
        "(fail) first",
        "  ^ a beforeEach/afterEach hook timed out for this test.",
        "(pass) second",
        "(fail) (unnamed)",
        "  ^ a beforeEach/afterEach hook timed out for this test.",
      ],
      signalCode: null,
      exitCode: 1,
    });
  },
  20_000,
);

test.concurrent(
  "every kind of test that never returns to the event loop times out at its own timeout",
  async () => {
    const run = await runTestFile(
      "timeout-sync-loop-kinds",
      `
        import { test } from "bun:test";
        test.failing("failing", () => {
          while (true) {}
        });
        test("done", done => {
          while (true) {}
        });
        test("own timeout", () => {
          while (true) {}
        }, 100);
        let attempts = 0;
        test("retried", () => {
          if (attempts++ === 0) while (true) {}
        }, { retry: 1 });
        test.each([1, 2])("each %d", () => {
          while (true) {}
        });
        test("no timeout", () => {
          const end = performance.now() + 750;
          while (performance.now() < end) {}
        }, 0);
      `,
    );
    expect(run).toEqual({
      results: [
        "(fail) failing",
        "  ^ this test timed out after 250ms.",
        "(fail) done",
        "  ^ this test timed out after 250ms, before its done callback was called. If a done callback was not intended, remove the last parameter from the test callback function",
        "(fail) own timeout",
        "  ^ this test timed out after 100ms.",
        "(pass) retried (attempt 2)",
        "(fail) each 1",
        "  ^ this test timed out after 250ms.",
        "(fail) each 2",
        "  ^ this test timed out after 250ms.",
        "(pass) no timeout",
      ],
      signalCode: null,
      exitCode: 1,
    });
  },
  20_000,
);

test.concurrent(
  "the timeout of a test ends a node:vm run inside it, and the run's own timeout still ends only the run",
  async () => {
    const run = await runTestFile(
      "timeout-sync-loop-vm",
      `
        import { test, expect } from "bun:test";
        import vm from "node:vm";
        test("run with its own timeout", () => {
          expect(() => vm.runInNewContext("while (true) {}", {}, { timeout: 25 })).toThrow(
            expect.objectContaining({ code: "ERR_SCRIPT_EXECUTION_TIMEOUT" }),
          );
        });
        test("run without a timeout", () => {
          vm.runInThisContext("while (true) {}");
        });
        test("run with a longer timeout", () => {
          try {
            vm.runInNewContext("while (true) {}", {}, { timeout: 60_000 });
          } catch {}
          console.log("ran: after the run");
        });
        test("module", async () => {
          const module = new vm.SourceTextModule("while (true) {}");
          await module.link(() => {});
          await module.evaluate();
        });
        test("runs after them", () => {});
      `,
    );
    expect(run).toEqual({
      results: [
        "(pass) run with its own timeout",
        "(fail) run without a timeout",
        "  ^ this test timed out after 250ms.",
        "(fail) run with a longer timeout",
        "  ^ this test timed out after 250ms.",
        "(fail) module",
        "  ^ this test timed out after 250ms.",
        "(pass) runs after them",
      ],
      signalCode: null,
      exitCode: 1,
    });
  },
  20_000,
);

// The report of a failure runs user code (here a `message` getter) with no script on the stack, where a
// termination would stop the whole VM. So the report is not under the callback's deadline, and the test
// only counts as timed out once the report is done.
test.concurrent(
  "the timeout does not end the report of a failure",
  async () => {
    const run = await runTestFile(
      "timeout-slow-error-message",
      `
        import { test, expect } from "bun:test";
        test("throws", () => {
          const error = new Error("boom");
          let spun = false;
          Object.defineProperty(error, "message", {
            get() {
              if (!spun) {
                spun = true;
                const end = performance.now() + 750;
                while (performance.now() < end) {}
              }
              return "boom";
            },
          });
          throw error;
        });
        test("fails on its own assertion", () => {
          expect(1).toBe(2);
        });
      `,
    );
    expect(run).toEqual({
      results: ["(fail) throws", "  ^ this test timed out after 250ms.", "(fail) fails on its own assertion"],
      signalCode: null,
      exitCode: 1,
    });
  },
  20_000,
);

test.concurrent(
  "a concurrent test that never returns to the event loop times out, and the others in its group finish",
  async () => {
    const run = await runTestFile(
      "timeout-sync-loop-concurrent",
      `
        import { test } from "bun:test";
        test.concurrent("spins", () => {
          while (true) {}
        });
        test.concurrent("waits", async () => {
          await Promise.resolve();
          await new Promise(resolve => setTimeout(resolve, 1));
        });
        test.concurrent("returns", () => {});
      `,
    );
    expect(run).toEqual({
      results: ["(fail) spins", "  ^ this test timed out after 250ms.", "(pass) returns", "(pass) waits"],
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
