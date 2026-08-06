import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe.concurrent("console.takeHeapSnapshot", () => {
  it("prints the parsed snapshot and survives BUN_JSC_validateExceptionChecks", async () => {
    // JSONParse of the snapshot JSON can throw (out of memory building the
    // parse tree), so the binding must hand the exception back to the console
    // hook instead of releaseAssertNoException()-crashing, and the hook must
    // report it rather than leave it pending under JSC's
    // consoleProtoFuncTakeHeapSnapshot, whose scope performs no exception
    // check after the client call. validateExceptionChecks aborts on debug
    // builds if any scope is left unchecked; on release builds the option is
    // a no-op and this just exercises the snapshot path.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.takeHeapSnapshot(); console.takeHeapSnapshot("label"); console.log("done");`],
      env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const uncheckedScopes = stderr
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("This scope can throw") || line.startsWith("But the exception was unchecked"));
    expect(stdout).toContain(`type: "Inspector"`);
    expect(stdout.endsWith("done\n")).toBe(true);
    expect(uncheckedScopes).toEqual([]);
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
});
