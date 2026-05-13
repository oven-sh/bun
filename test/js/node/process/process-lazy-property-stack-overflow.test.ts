import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Lazy PropertyCallback initializers on the process object (nextTick, mainModule,
// channel, stdin/stdout/stderr, ...) call into JavaScript during reification. If
// that JS call throws (e.g. RangeError from stack exhaustion), JSC's
// setUpStaticFunctionSlot would still putDirect the bogus result and report the
// slot as found with the exception still pending, triggering
// EXCEPTION_ASSERT(!scope.exception() || !hasSlot) in JSValue::get. The
// initializers now clear the exception and return undefined, so the property
// read does not throw and the slot is reified as undefined instead of the
// Exception cell.
test("accessing lazy process properties near stack limit does not crash", async () => {
  const src = `
    function recurse() {
      try { recurse(); } catch {}
      try { process.nextTick; } catch {}
      try { process.mainModule; } catch {}
    }
    recurse();
    // process.nextTick may have been reified as undefined if its initializer
    // threw near the stack limit; use Bun.write directly for output.
    Bun.write(Bun.stdout, "type=" + typeof process.nextTick + "\\n");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toMatch(/^type=(undefined|function)\n$/);
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});
