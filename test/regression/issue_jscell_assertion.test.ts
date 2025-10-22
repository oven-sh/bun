import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.todo("nextTick inside recursive method should not cause JSCell assertion", async () => {
  // This reproduces a bug where calling process.nextTick() inside a recursive
  // method that hits the JavaScript stack limit causes:
  //   ASSERTION FAILED: isSymbol() || isHeapBigInt()
  //   vendor/WebKit/Source/JavaScriptCore/runtime/JSCell.cpp(252)
  //
  // Minimal reproducer:
  //   const obj = {
  //     o() {
  //       try { this.o(); } catch (e) {}  // Recurse until stack overflow
  //       try { process.nextTick(() => {}); } catch (e) {}
  //     },
  //   };
  //   obj.o();
  //
  // Root cause: When a stack overflow exception occurs and process.nextTick()
  // is subsequently called, the exception object or stack trace may contain
  // corrupted JSCell references. During error formatting, toString() is called
  // on these corrupted cells, triggering the assertion.
  //
  // Partial fixes applied:
  // - Added exception handling in ZigException.cpp after toWTFString() calls
  // - Added exception handling in ErrorStackTrace.cpp functionName()
  // - Added exception handling in CallSite.cpp formatAsString()
  //
  // TODO: This test is marked as .todo because the fix is incomplete. The
  // underlying issue is memory corruption that occurs before error formatting.
  // Further investigation needed into how stack overflow exceptions interact
  // with the nextTick queue and whether JSC needs additional safeguards.

  using dir = tempDir("jscell-assertion", {
    "index.js": /* js */ `
      const obj = {
        o() {
          try { this.o(); } catch (e) {}
          try { process.nextTick(() => {}); } catch (e) {}
        },
      };
      obj.o();
      console.log("SUCCESS");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not crash with assertion
  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(stderr).not.toContain("toStringSlowCase");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
});
