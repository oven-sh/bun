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

async function runFixture(name: string, source: string) {
  using dir = tempDir(`expect-resolves-${name}`, { "sub.test.js": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "sub.test.js"],
    env: bunEnv,
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

describe("expect().resolves / .rejects on a still-pending promise", () => {
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

    expect({ timedOut, exitCode }).toEqual({ timedOut: false, exitCode: 0 });
    expect(out).toContain("8 pass");
    expect(out).toContain("0 fail");
    expect(out).not.toContain("timed out");
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

    expect({ timedOut, exitCode }).toEqual({ timedOut: false, exitCode: 1 });
    expect(out).toContain("0 pass");
    expect(out).toContain("3 fail");
    expect(out).toContain("Expected: 25");
    expect(out).toContain("Received: 99");
    expect(out).toContain("Expected promise that rejects");
    expect(out).not.toContain("timed out");
  }, 40_000);

  test("expect.assertions counts a deferred matcher exactly once", async () => {
    const { out, exitCode, timedOut } = await runFixture(
      "assertions",
      /* js */ `
        import { test, expect } from "bun:test";

        test("one deferred assertion", async () => {
          expect.assertions(1);
          let resolve;
          const assertion = expect(new Promise(r => (resolve = r))).resolves.toBe(5);
          resolve(5);
          await assertion;
        });
      `,
    );

    expect({ timedOut, exitCode }).toEqual({ timedOut: false, exitCode: 0 });
    expect(out).toContain("1 pass");
    expect(out).toContain("0 fail");
  }, 40_000);

  // https://github.com/oven-sh/bun/issues/25181
  // With the blocking `waitForPromise()`, each concurrent test's
  // `.resolves` serialized the whole group. Ten 1s-sleeps took ~10s;
  // now they overlap.
  test("does not serialize test.concurrent tests", async () => {
    const { out, exitCode, timedOut } = await runFixture(
      "concurrent",
      /* js */ `
        import { test, expect, afterAll } from "bun:test";

        const start = Date.now();

        async function slow() {
          await new Promise(r => setTimeout(r, 1000));
          return { ok: true };
        }

        test.concurrent.each([...Array(10).keys()])("concurrent %i", async () => {
          await expect(slow()).resolves.toEqual({ ok: true });
        });

        afterAll(() => {
          console.log("ELAPSED=" + (Date.now() - start));
        });
      `,
    );

    expect(timedOut).toBe(false);
    expect(out).toContain("10 pass");
    expect(out).toContain("0 fail");
    const elapsed = Number(out.match(/ELAPSED=(\d+)/)?.[1]);
    // Ten 1s-sleeps: concurrent ≈ 1s, serialized ≈ 10s. Allow generous
    // slack for slow CI — anything under 5s proves they overlapped.
    expect(elapsed).toBeGreaterThan(900);
    expect(elapsed).toBeLessThan(5000);
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
