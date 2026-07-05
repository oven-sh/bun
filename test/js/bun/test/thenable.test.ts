import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// A test or hook callback that returns a thenable (a userland `PromiseLike`, the
// kind produced by bluebird/q, older ORMs, or another realm) must be awaited like
// a native promise.

test("a returned thenable is awaited", async () => {
  using dir = tempDir("thenable-await", {
    "thenable.test.ts": `
      import { beforeEach, expect, test } from "bun:test";

      const order: string[] = [];

      beforeEach(() => ({
        then(resolve: () => void) {
          queueMicrotask(() => {
            order.push("beforeEach");
            resolve();
          });
        },
      }));

      test("a resolving thenable is awaited", () => ({
        then(resolve: () => void) {
          queueMicrotask(() => {
            order.push("test");
            resolve();
          });
        },
      }));

      test("the thenable settled before this test started", () => {
        expect(order).toEqual(["beforeEach", "test", "beforeEach"]);
      });

      // A non-thenable object is not a promise: the callback stays synchronous and
      // the runner keeps waiting for the done callback. setImmediate does not run
      // between two synchronous tests, so "done" is only recorded if it was awaited.
      test("a non-thenable object does not complete the test", done => {
        setImmediate(() => {
          order.push("done");
          done();
        });
        return { then: null };
      });

      test("the done callback ran before this test started", () => {
        expect(order).toEqual(["beforeEach", "test", "beforeEach", "beforeEach", "done", "beforeEach"]);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "thenable.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
  }).toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "stderr": 
    "thenable.test.ts:
    (pass) a resolving thenable is awaited
    (pass) the thenable settled before this test started
    (pass) a non-thenable object does not complete the test
    (pass) the done callback ran before this test started

     4 pass
     0 fail
     2 expect() calls
    Ran 4 tests across 1 file."
    ,
      "stdout": "bun test <version> (<revision>)",
    }
  `);
});

test("a rejected thenable fails the test", async () => {
  using dir = tempDir("thenable-reject", {
    "thenable.test.ts": `
      import { beforeEach, describe, test } from "bun:test";

      test("a rejected thenable fails", () => ({
        then(_resolve: () => void, reject: (err: unknown) => void) {
          reject(new Error("rejected thenable"));
        },
      }));

      test("a throwing then fails", () => ({
        then(): void {
          throw new Error("throwing then");
        },
      }));

      test("a throwing then getter fails", () => ({
        get then(): never {
          throw new Error("throwing then getter");
        },
      }));

      describe("rejected hook", () => {
        beforeEach(() => ({
          then(_resolve: () => void, reject: (err: unknown) => void) {
            reject(new Error("rejected hook"));
          },
        }));

        test("never runs", () => {
          console.log("THIS TEST SHOULD NOT RUN");
        });
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "thenable.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const err = normalizeBunSnapshot(stderr, String(dir));
  expect(err).toContain("error: rejected thenable");
  expect(err).toContain("error: throwing then\n");
  expect(err).toContain("error: throwing then getter");
  expect(err).toContain("error: rejected hook");
  expect(err).toContain(" 0 pass");
  expect(err).toContain(" 4 fail");
  expect(stdout).not.toContain("THIS TEST SHOULD NOT RUN");
  expect(exitCode).toBe(1);
});
