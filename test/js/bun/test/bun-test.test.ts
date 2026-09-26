import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("Bun.version", () => {
  expect(process.versions.bun).toBe(Bun.version);
  expect(process.revision).toBe(Bun.revision);
});

test("expect().not.not", () => {
  // bun supports this but jest doesn't
  expect(1).not.not.toBe(1);
  expect(1).not.not.not.toBe(2);
});

// Fuzzer-found crash: Bun.jest() without an active test runner, followed by
// misuse of the expect statics, must not crash the process. In particular,
// `new` on a matcher registered via expect.extend() used to jump to a null
// native constructor and SIGSEGV.
test("Bun.jest() expect statics do not crash on misuse", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const jestExpect = Bun.jest().expect;
jestExpect.extend({ customMatcher() { return { pass: true, message: () => "" }; } });
try { new jestExpect.customMatcher(); } catch (e) { if (!(e instanceof TypeError)) throw e; }
try { new (jestExpect(1).customMatcher)(); } catch (e) { if (!(e instanceof TypeError)) throw e; }
try { jestExpect.extend(); } catch {}
const arrayContaining = jestExpect.arrayContaining;
try { new arrayContaining(); } catch (e) { if (!(e instanceof TypeError)) throw e; }
Bun.gc(true);
console.log("OK");`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});

// toBeWithin() with one argument used to index past the argument slice and
// abort the process instead of failing the test.
test("toBeWithin() with missing or non-number arguments fails the test without crashing", async () => {
  using dir = tempDir("to-be-within-args", {
    "within.test.ts": `
      import { test, expect } from "bun:test";

      test("one argument", () => {
        expect(1).toBeWithin(0);
      });

      test("no arguments", () => {
        expect(1).toBeWithin();
      });

      test("start is not a number", () => {
        expect(1).toBeWithin("0", 2);
      });

      test("end is not a number", () => {
        expect(1).toBeWithin(0, "2");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "within.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("toBeWithin() requires 2 arguments");
  expect(stderr).toContain("toBeWithin() requires the first argument to be a number");
  expect(stderr).toContain("toBeWithin() requires the second argument to be a number");
  expect(stderr).toContain("4 fail");
  expect(exitCode).toBe(1);
});

// Printing the failure for a test or hook that rejects with a boxed primitive
// or RegExp whose own toString/Symbol.toPrimitive throws used to leave that
// second exception pending on the VM. The next test callback then aborted the
// runner, or was reported as passed without running its body.
test.concurrent("a rejection whose toString/Symbol.toPrimitive throws does not break later tests", async () => {
  using dir = tempDir("test-hostile-rejection", {
    "hostile.test.js": `
      import { test, describe, afterEach } from "bun:test";

      const hooks = { toString() { throw 1; }, [Symbol.toPrimitive]() { throw 1; } };
      class Sub extends String {}

      for (const [name, make] of [
        ["String", () => new String("q")],
        ["Number", () => new Number(1)],
        ["Boolean", () => new Boolean(true)],
        ["RegExp", () => /re/],
        ["String subclass", () => new Sub("q")],
      ]) {
        test(name, async () => {
          throw Object.assign(make(), hooks);
        });
      }

      describe("hook", () => {
        afterEach(async () => {
          throw Object.assign(new String("q"), hooks);
        });
        test("afterEach rejects", () => {});
      });

      test("runs after the rejections", () => {
        console.log("last test body ran");
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "hostile.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    last test body ran"
  `);
  expect(normalizeBunSnapshot(stderr, dir)).toMatchInlineSnapshot(`
    "hostile.test.js:
    error
    (fail) String
    error
    (fail) Number
    error
    (fail) Boolean
    error
    (fail) RegExp
    error
    (fail) String subclass
    error
    (fail) hook > afterEach rejects
    (pass) runs after the rejections

     1 pass
     6 fail
    Ran 7 tests across 1 file."
  `);
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(1);
});
