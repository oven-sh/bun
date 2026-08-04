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

// Printing the failure for a test that rejects with a value whose
// toString/Symbol.toPrimitive throws used to leave that secondary exception
// pending on the VM, aborting the whole runner when the next test callback was
// invoked.
test("runner survives a rejection whose toString/Symbol.toPrimitive throws", async () => {
  using dir = tempDir("test-hostile-tostring", {
    "hostile.test.js": `
      import { test } from "bun:test";
      test("boxed string", async () => {
        throw Object.assign(new String("q"), { toString() { throw 1; }, [Symbol.toPrimitive]() { throw 1; } });
      });
      test("regexp", async () => {
        throw Object.assign(/re/, { toString() { throw 1; }, [Symbol.toPrimitive]() { throw 1; } });
      });
      test("next test still runs", () => {
        throw new Error("plain error");
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

  const output = stdout + stderr;
  expect(output).toContain("(fail) boxed string");
  expect(output).toContain("(fail) regexp");
  expect(output).toContain("(fail) next test still runs");
  expect(output).toContain("error: plain error");
  expect(output).toContain("3 fail");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(1);
});
