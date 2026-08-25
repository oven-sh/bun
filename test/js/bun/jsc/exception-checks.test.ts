import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Each snippet reaches a native code path that used to run a second JSC
// operation, or return from a ThrowScope, while an exception check was still
// pending. On a debug build BUN_JSC_validateExceptionChecks=1 aborts the
// process at that point, so the assertion is that the snippet completes and
// prints its marker. On a release build the validator is compiled out and the
// test only checks the behavior.
const snippets: Record<string, { code: string; stdout: string }> = {
  "Bun.deepEquals with one argument": {
    code: `try { Bun.deepEquals(1); } catch (e) { console.log(e.constructor.name + ": " + e.message); }`,
    stdout: "TypeError: Expected 2 values to compare",
  },
};

for (const [name, { code, stdout: expected }] of Object.entries(snippets)) {
  test.concurrent(name, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1", BUN_JSC_dumpSimulatedThrows: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The validator prints the two scopes involved before it aborts; keep
    // them in the comparison so a failure names the call site.
    const unchecked = stderr
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("This scope can throw") || line.startsWith("But the exception was unchecked"));
    expect({ stdout: stdout.trim(), unchecked, exitCode }).toEqual({ stdout: expected, unchecked: [], exitCode: 0 });
  });
}
