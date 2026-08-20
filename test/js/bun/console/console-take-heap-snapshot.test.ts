import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

// Lines printed by BUN_JSC_validateExceptionChecks=1 when a throw scope is
// left unchecked (the option aborts on debug builds; release builds ignore it).
function uncheckedScopes(stderr: string): string[] {
  return stderr
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("This scope can throw") || line.startsWith("But the exception was unchecked"));
}

describe.concurrent("console.takeHeapSnapshot", () => {
  it("prints the parsed snapshot and survives BUN_JSC_validateExceptionChecks", async () => {
    // JSONParse of the snapshot JSON can throw (out of memory building the
    // parse tree), so the binding must hand the exception back to the console
    // hook instead of releaseAssertNoException()-crashing, and the hook must
    // report it rather than leave it pending under JSC's
    // consoleProtoFuncTakeHeapSnapshot, whose scope performs no exception
    // check after the client call.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.takeHeapSnapshot(); console.takeHeapSnapshot("label"); console.log("done");`],
      env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain(`type: "Inspector"`);
    expect(stdout.endsWith("done\n")).toBe(true);
    expect(uncheckedScopes(stderr)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it("propagates exceptions thrown while coercing the label", async () => {
    // The label toString runs before the snapshot is taken; the console
    // function checks for the exception and rethrows it.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `try {
          console.takeHeapSnapshot({ toString() { throw new Error("boom"); } });
          console.log("did not throw");
        } catch (e) {
          console.log("caught:", e.message);
        }`,
      ],
      env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("caught: boom\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // A real out-of-memory inside the snapshot's JSONParse cannot be staged from
  // JS (constrained memory fails the earlier WTF-side snapshot allocations
  // non-recoverably), so a debug-only fault-injection env var forces
  // generate_heap_snapshot to throw at the same seam; before the fix the same
  // pending exception aborted the process in releaseAssertNoException().
  it.skipIf(!isDebug)("reports a failed snapshot as an uncaught exception", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.takeHeapSnapshot(); console.log("after");`],
      env: { ...bunEnv, BUN_INTERNAL_FAIL_TAKE_HEAP_SNAPSHOT: "1", BUN_JSC_validateExceptionChecks: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Out of memory");
    expect(uncheckedScopes(stderr)).toEqual([]);
    // The console call does not abort or rethrow; execution continues and the
    // process exits 1 because the error went through the uncaught path.
    expect(stdout).toBe("after\n");
    expect(exitCode).toBe(1);
  });

  it.skipIf(!isDebug)("a failed snapshot error is interceptable via process.on(uncaughtException)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.on("uncaughtException", e => console.log("handled:", e.message));
         console.takeHeapSnapshot();
         console.log("after");`,
      ],
      env: { ...bunEnv, BUN_INTERNAL_FAIL_TAKE_HEAP_SNAPSHOT: "1", BUN_JSC_validateExceptionChecks: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(uncheckedScopes(stderr)).toEqual([]);
    expect(stdout).toBe("handled: Out of memory\nafter\n");
    expect(exitCode).toBe(0);
  });
});
