import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

// Appending an error's stack trace to itself made Vector::appendVector read
// from its own freed buffer once the append grew past the vector's capacity.
test("Error.appendStackTrace with the same error as source and destination", async () => {
  const code = `
    function f(n) {
      if (n > 0) return f(n - 1) + 1;
      try {
        null();
      } catch (e) {
        Error.appendStackTrace(e, e);
      }
      return 0;
    }
    f(64);
    console.log("ok");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    // Malloc=1 routes WTF allocations through the system allocator so ASan can
    // see the use-after-free. symbolize=0 keeps a failing child fast, and
    // detect_leaks=0 keeps LeakSanitizer from flagging JSC's exit-time
    // allocations. Only ASan builds can observe the bug, and Malloc=1 is not
    // safe to force on every platform's release build.
    env: isASAN
      ? {
          ...bunEnv,
          Malloc: "1",
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":"),
        }
      : bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toMatch(/(ERROR|SUMMARY): AddressSanitizer/);
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

test("Error.appendStackTrace moves the source stack trace into the destination", () => {
  function inner() {
    try {
      null();
    } catch (e) {
      return e;
    }
  }
  const src = inner();
  const dst = new Error("dst");
  (Error as any).appendStackTrace(src, dst);
  expect(dst.stack).toContain("inner");
});
