import { expect, test } from "bun:test";

import { bunEnv, bunExe, normalizeBunSnapshot, tempDir, tempDirWithFiles } from "harness";
import path from "path";

test("expect.assertions causes the test to fail when it should", async () => {
  const dir = tempDirWithFiles("expect-assertions", {
    "expect-assertions.test.ts": await Bun.file(path.join(import.meta.dir, "expect-assertions-fixture.ts")).text(),
    "package.json": JSON.stringify({
      name: "expect-assertions",
      version: "0.0.0",
      scripts: {
        test: "bun test",
      },
    }),
  });

  const $$ = new Bun.$.Shell();
  $$.nothrow();
  $$.cwd(dir);
  $$.env(bunEnv);
  const result = await $$`${bunExe()} test`;

  console.log(result.stdout.toString());
  console.log(result.stderr.toString());

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("5 fail\n");
  expect(result.stderr.toString()).toContain("0 pass\n");
});

// Jest records the argument to expect.assertions(n) as-is and compares it at end-of-test,
// so an invalid count always fails the test: a try/catch in the test body cannot swallow
// it and turn it into a false pass. Non-number and missing arguments still get an eager
// TypeError (unlike Jest, which silently ignores them), but they are recorded as NaN
// first so catching that throw does not turn the test green either.
test("expect.assertions with an invalid argument fails the test even when the call is wrapped in try/catch", async () => {
  using dir = tempDir("expect-assertions-arg", {
    "assertions-arg.test.ts": `
      import { test, expect } from "bun:test";

      test("negative count swallowed by try/catch still fails", () => {
        try {
          expect.assertions(-1);
        } catch {}
        expect(1).toBe(1);
      });

      test("non-integer count swallowed by try/catch still fails", () => {
        try {
          expect.assertions(1.5);
        } catch {}
        expect(1).toBe(1);
      });

      test("NaN count swallowed by try/catch still fails", () => {
        try {
          expect.assertions(NaN);
        } catch {}
        expect(1).toBe(1);
      });

      test("Infinity count swallowed by try/catch still fails", () => {
        try {
          expect.assertions(Infinity);
        } catch {}
        expect(1).toBe(1);
      });

      test("count above u32 range swallowed by try/catch still fails", () => {
        try {
          expect.assertions(1e100);
        } catch {}
        expect(1).toBe(1);
      });

      test("negative count without a try/catch still fails", () => {
        expect.assertions(-1);
        expect(1).toBe(1);
      });

      test("matching count still passes", () => {
        expect.assertions(2);
        expect(1).toBe(1);
        expect(2).toBe(2);
      });

      test("negative zero with no assertions still passes", () => {
        expect.assertions(-0);
      });

      test("non-number argument throws and still fails the test", () => {
        expect(() => expect.assertions("2" as any)).toThrow("Expected value must be a number");
      });

      test("undefined count swallowed by try/catch still fails", () => {
        try {
          expect.assertions(undefined as any);
        } catch {}
        expect(1).toBe(1);
      });

      test("missing argument throws and still fails the test", () => {
        expect(() => (expect.assertions as any)()).toThrow("expect.assertions() takes 1 argument");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "assertions-arg.test.ts"],
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
      "exitCode": 1,
      "stderr": 
    "assertions-arg.test.ts:
    AssertionError: expected -1 assertions, but test ended with 1 assertion
    (fail) negative count swallowed by try/catch still fails
    AssertionError: expected 1.5 assertions, but test ended with 1 assertion
    (fail) non-integer count swallowed by try/catch still fails
    AssertionError: expected NaN assertions, but test ended with 1 assertion
    (fail) NaN count swallowed by try/catch still fails
    AssertionError: expected Infinity assertions, but test ended with 1 assertion
    (fail) Infinity count swallowed by try/catch still fails
    AssertionError: expected 1e+100 assertions, but test ended with 1 assertion
    (fail) count above u32 range swallowed by try/catch still fails
    AssertionError: expected -1 assertions, but test ended with 1 assertion
    (fail) negative count without a try/catch still fails
    (pass) matching count still passes
    (pass) negative zero with no assertions still passes
    AssertionError: expected NaN assertions, but test ended with 1 assertion
    (fail) non-number argument throws and still fails the test
    AssertionError: expected NaN assertions, but test ended with 1 assertion
    (fail) undefined count swallowed by try/catch still fails
    AssertionError: expected NaN assertions, but test ended with 1 assertion
    (fail) missing argument throws and still fails the test

     2 pass
     9 fail
     11 expect() calls
    Ran 11 tests across 1 file."
    ,
      "stdout": "bun test <version> (<revision>)",
    }
  `);
});
