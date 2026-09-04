import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
