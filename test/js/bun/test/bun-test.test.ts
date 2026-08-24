import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "path";

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

// Every test/describe function handed to user code (the four created with the
// bun:test module object plus one per modifier call) is a ScopeFunctions bound
// through ScopeFunctions.rs `bind`, which used to leak a WTF copy of the
// function's name each time. LSan only sees WTF allocations when Malloc=1
// routes bmalloc through the system allocator.
test.skipIf(!isASAN || isWindows)(
  "test/describe modifiers do not leak the bound function name",
  async () => {
    using dir = tempDir("scope-functions-name-leak", {
      "modifiers.test.ts": `
        import { describe, expect, test, xdescribe, xtest } from "bun:test";

        const fails = () => {
          throw new Error("expected failure");
        };

        test("test", () => {});
        xtest("xtest", () => {});
        test.skip("test.skip", () => {});
        test.todo("test.todo");
        test.failing("test.failing", fails);
        test.concurrent("test.concurrent", () => {});
        test.serial("test.serial", () => {});
        test.if(true)("test.if(true)", () => {});
        test.if(false)("test.if(false)", () => {});
        test.skipIf(true)("test.skipIf(true)", () => {});
        test.skipIf(false)("test.skipIf(false)", () => {});
        test.todoIf(true)("test.todoIf(true)", () => {});
        test.todoIf(false)("test.todoIf(false)", () => {});
        test.failingIf(true)("test.failingIf(true)", fails);
        test.failingIf(false)("test.failingIf(false)", () => {});
        test.concurrentIf(true)("test.concurrentIf(true)", () => {});
        test.concurrentIf(false)("test.concurrentIf(false)", () => {});
        test.serialIf(true)("test.serialIf(true)", () => {});
        test.serialIf(false)("test.serialIf(false)", () => {});
        test.each([1, 2])("test.each %i", i => expect(i).toBeNumber());
        test.skip.each([1])("test.skip.each %i", () => {});
        test.each([1]).skipIf(false)("test.each().skipIf(false) %i", () => {});

        describe("describe", () => test("inner", () => {}));
        xdescribe("xdescribe", () => test("inner", () => {}));
        describe.skip("describe.skip", () => test("inner", () => {}));
        describe.todo("describe.todo", () => test("inner", () => {}));
        describe.concurrent("describe.concurrent", () => test("inner", () => {}));
        describe.serial("describe.serial", () => test("inner", () => {}));
        describe.if(true)("describe.if(true)", () => test("inner", () => {}));
        describe.skipIf(true)("describe.skipIf(true)", () => test("inner", () => {}));
        describe.skipIf(false)("describe.skipIf(false)", () => test("inner", () => {}));
        describe.todoIf(false)("describe.todoIf(false)", () => test("inner", () => {}));
        describe.concurrentIf(true)("describe.concurrentIf(true)", () => test("inner", () => {}));
        describe.serialIf(true)("describe.serialIf(true)", () => test("inner", () => {}));
        describe.each([1, 2])("describe.each %i", i => test("inner", () => expect(i).toBeNumber()));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "modifiers.test.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        Malloc: "1",
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The result counts prove every modifier above registered; a leak report
    // adds LeakSanitizer lines after them and fails the exit code.
    const report = stderr
      .split("\n")
      .filter(line => /^ \d+ (pass|skip|todo|fail)$/.test(line) || /Sanitizer|leak of /.test(line));
    expect({ report, exitCode }).toEqual({ report: [" 26 pass", " 8 skip", " 3 todo", " 0 fail"], exitCode: 0 });
  },
  // LSan symbolizes stacks against the debug binary: about 5s even for a clean
  // run (the suppressed leaks still get symbolized), much longer on failure.
  90_000,
);
