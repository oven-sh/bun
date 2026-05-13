// https://github.com/oven-sh/bun/issues/14950
//
// `expect(promise).resolves.<matcher>()` used to synchronously spin the
// event loop (`waitForPromise`) until the promise settled. If the only
// thing that could settle it was JS still sitting above the matcher on
// the call stack, the test hung at 100% CPU — not even the test-level
// timeout could interrupt it.
//
// All of the hang-prone cases are exercised in a subprocess so that this
// file fails (rather than hangs) on a build without the fix.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runFixture(name: string, source: string, extraEnv: Record<string, string> = {}) {
  using dir = tempDir(`expect-resolves-${name}`, { "sub.test.js": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "sub.test.js"],
    env: { ...bunEnv, ...extraEnv },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // On a build without the fix the subprocess hangs, so bound the wait.
  const timedOut = await Promise.race([proc.exited.then(() => false), Bun.sleep(20_000).then(() => true)]);
  if (timedOut) {
    proc.kill("SIGKILL");
    await proc.exited;
  }

  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  return { out: stdout + stderr, exitCode: proc.exitCode, timedOut };
}

describe.concurrent("expect().resolves / .rejects on a still-pending promise", () => {
  // Exact reproduction from #14950, plus the .rejects mirror and several
  // matcher variants.
  test("does not hang when the promise is settled after the matcher call", async () => {
    const { out, exitCode, timedOut } = await runFixture(
      "pass",
      /* js */ `
        import { test, expect } from "bun:test";

        test("resolves.toBe, resolved after matcher (no await)", () => {
          let resolve;
          expect(new Promise(r => (resolve = r))).resolves.toBe(25);
          resolve(25);
        });

        test("rejects.toBe, rejected after matcher (no await)", () => {
          let reject;
          expect(new Promise((_, r) => (reject = r))).rejects.toBe("err");
          reject("err");
        });

        test("resolves.toBe awaited", async () => {
          let resolve;
          const assertion = expect(new Promise(r => (resolve = r))).resolves.toBe(42);
          if (!(assertion instanceof Promise)) {
            throw new Error("expected .resolves matcher to return a Promise for a pending input");
          }
          resolve(42);
          await assertion;
        });

        test("rejects.toThrow awaited", async () => {
          let reject;
          const assertion = expect(new Promise((_, r) => (reject = r))).rejects.toThrow("boom");
          reject(new Error("boom"));
          await assertion;
        });

        test("resolves.not.toBe awaited", async () => {
          let resolve;
          const assertion = expect(new Promise(r => (resolve = r))).resolves.not.toBe(100);
          resolve(99);
          await assertion;
        });

        test("resolves.toEqual awaited", async () => {
          let resolve;
          const assertion = expect(new Promise(r => (resolve = r))).resolves.toEqual({ a: 1 });
          resolve({ a: 1 });
          await assertion;
        });

        test("resolves resolved in a later task", async () => {
          let resolve;
          const prom = new Promise(r => (resolve = r));
          setImmediate(() => resolve(7));
          await expect(prom).resolves.toBe(7);
        });

        expect.extend({
          toBeFoo(received) {
            return {
              pass: received === "foo",
              message: () => "expected " + received + ' to be "foo"',
            };
          },
        });

        test("custom matcher via expect.extend", async () => {
          let resolve;
          const assertion = expect(new Promise(r => (resolve = r))).resolves.toBeFoo();
          resolve("foo");
          await assertion;
        });
      `,
    );

    expect(timedOut).toBe(false);
    expect(out).toContain("8 pass");
    expect(out).toContain("0 fail");
    expect(out).not.toContain("timed out");
    expect(exitCode).toBe(0);
  }, 40_000);

  test("a failing deferred assertion still fails the test", async () => {
    const { out, exitCode, timedOut } = await runFixture(
      "fail",
      /* js */ `
        import { test, expect } from "bun:test";

        test("resolves.toBe mismatch (awaited)", async () => {
          let resolve;
          const assertion = expect(new Promise(r => (resolve = r))).resolves.toBe(25);
          resolve(99);
          await assertion;
        });

        test("rejects on a promise that resolves (awaited)", async () => {
          let resolve;
          const assertion = expect(new Promise(r => (resolve = r))).rejects.toBe(25);
          resolve(25);
          await assertion;
        });

        test("resolves.toBe mismatch (not awaited)", () => {
          let resolve;
          expect(new Promise(r => (resolve = r))).resolves.toBe(25);
          resolve(99);
        });
      `,
    );

    expect(timedOut).toBe(false);
    expect(out).toContain("0 pass");
    expect(out).toContain("3 fail");
    expect(out).toContain("Expected: 25");
    expect(out).toContain("Received: 99");
    expect(out).toContain("Expected promise that rejects");
    expect(out).not.toContain("timed out");
    expect(exitCode).toBe(1);
  }, 40_000);

  // Matchers are inconsistent about whether they call
  // `incrementExpectCallCounter()` before or after `getValue()`. Both
  // orderings must count exactly once through the deferred path.
  test("expect.assertions counts a deferred matcher exactly once", async () => {
    const { out, exitCode, timedOut } = await runFixture(
      "assertions",
      /* js */ `
        import { test, expect } from "bun:test";

        expect.extend({
          toBeBar(received) {
            return { pass: received === "bar", message: () => "expected bar" };
          },
        });

        test("toBe: increments before getValue", async () => {
          expect.assertions(1);
          let resolve;
          const assertion = expect(new Promise(r => (resolve = r))).resolves.toBe(5);
          resolve(5);
          await assertion;
        });

        test("toBeTruthy: increments after getValue", async () => {
          expect.assertions(1);
          let resolve;
          const assertion = expect(new Promise(r => (resolve = r))).resolves.toBeTruthy();
          resolve("x");
          await assertion;
        });

        test("custom matcher: increments after maybeDeferMatcher", async () => {
          expect.assertions(1);
          let resolve;
          const assertion = expect(new Promise(r => (resolve = r))).resolves.toBeBar();
          resolve("bar");
          await assertion;
        });

        // The counted_expect_call flag is per-Expect-instance; each
        // matcher call on a reused instance must still count, including
        // when the first is a custom matcher (applyCustomMatcher path).
        test("multiple matchers on the same expect() each count", () => {
          expect.assertions(2);
          const e = expect(5);
          e.toBe(5);
          e.toBeGreaterThan(0);
        });

        test("custom then built-in on the same expect() each count", () => {
          expect.assertions(2);
          const e = expect("bar");
          e.toBeBar();
          e.toBe("bar");
        });
      `,
    );

    expect(timedOut).toBe(false);
    expect(out).toContain("5 pass");
    expect(out).toContain("0 fail");
    expect(exitCode).toBe(0);
  }, 40_000);

  // On the deferred re-run the user's frame is gone from the stack, so
  // `inlineSnapshot()` has to use the source location captured on the
  // first call. Only the write path reads the source location, so this
  // exercises it by creating a new snapshot (hence `CI: "false"`).
  test("toMatchInlineSnapshot writes from the deferred re-run", async () => {
    const { out, exitCode, timedOut } = await runFixture(
      "inline-snapshot",
      /* js */ `
        import { test, expect } from "bun:test";

        test("pending", async () => {
          await expect(Bun.sleep(1).then(() => ({ a: 1 }))).resolves.toMatchInlineSnapshot();
        });
      `,
      { CI: "false" },
    );

    expect(timedOut).toBe(false);
    expect(out).toContain("1 pass");
    expect(out).toContain("0 fail");
    expect(out).toContain("+1 added");
    expect(out).not.toContain("must be called from the test file");
    expect(exitCode).toBe(0);
  }, 40_000);

  // https://github.com/oven-sh/bun/issues/25181
  // With the blocking `waitForPromise()`, each concurrent test's
  // `.resolves` serialized the whole group. Assert overlap directly
  // via an in-flight counter rather than wall-clock timing.
  test("does not serialize test.concurrent tests", async () => {
    const { out, exitCode, timedOut } = await runFixture(
      "concurrent",
      /* js */ `
        import { test, expect, afterAll } from "bun:test";

        let inFlight = 0;
        let maxInFlight = 0;

        async function slow() {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise(r => setTimeout(r, 500));
          inFlight--;
          return { ok: true };
        }

        test.concurrent.each([...Array(10).keys()])("concurrent %i", async () => {
          await expect(slow()).resolves.toEqual({ ok: true });
        });

        afterAll(() => {
          console.log("MAX_INFLIGHT=" + maxInFlight);
        });
      `,
    );

    expect(timedOut).toBe(false);
    expect(out).toContain("10 pass");
    expect(out).toContain("0 fail");
    // If `.resolves` blocks, each test runs to completion before the
    // next starts and maxInFlight stays at 1. With the deferred path
    // all ten are in flight at once.
    expect(out).toContain("MAX_INFLIGHT=10");
    expect(exitCode).toBe(0);
  }, 40_000);
});

// Already-settled promises took the synchronous path before and after the
// fix, so these are safe to run inline.
describe("expect().resolves / .rejects on an already-settled promise", () => {
  test("resolves.toBe", async () => {
    await expect(Promise.resolve(99)).resolves.toBe(99);
  });

  test("rejects.toBe", async () => {
    await expect(Promise.reject(99)).rejects.toBe(99);
  });

  test("resolves on a rejected promise throws", async () => {
    let caught: unknown;
    try {
      await expect(Promise.reject(1)).resolves.toBe(1);
    } catch (e) {
      caught = e;
    }
    expect(String(caught)).toContain("Expected promise that resolves");
  });
});
