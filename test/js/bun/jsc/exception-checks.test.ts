import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Each snippet reaches a native code path that used to run a second JSC
// operation, or return from a ThrowScope, while an exception check was still
// pending. On a debug build BUN_JSC_validateExceptionChecks=1 aborts the
// process at that point, so the assertion is that the snippet completes and
// prints its marker. On a release build the validator is compiled out and the
// test only checks the behavior.
// A string built at run time is a rope; reading it resolves the rope under a
// ThrowScope, which is what makes the snippets below observable to the
// validator.
type Snippet = { code: string; stdout: string; env?: Record<string, string>; files?: Record<string, string> };
const snippets: Record<string, Snippet> = {
  "Bun.deepEquals with one argument": {
    code: `try { Bun.deepEquals(1); } catch (e) { console.log(e.constructor.name + ": " + e.message); }`,
    stdout: "TypeError: Expected 2 values to compare",
  },
  "process.umask with a rope string": {
    code: `const a = "0"; const b = "22"; const old = process.umask(a + b); process.umask(old); console.log(typeof old);`,
    stdout: "number",
  },
  "process.exitCode assigned a rope string": {
    code: `const a = "1"; const b = "0"; process.exitCode = a + b; console.log(process.exitCode); process.exitCode = 0;`,
    stdout: "10",
  },
  "process.kill with an unknown rope signal name": {
    code: `const a = "SIG"; const b = "BOGUS"; try { process.kill(process.pid, a + b); } catch (e) { console.log(e.code); }`,
    stdout: "ERR_UNKNOWN_SIGNAL",
  },
  // JSC's parser builds a left-deep chain without recursion and its bytecode generator recurses once per operator.
  // With the stack capped, the module parses and then fails ("Out of memory") when the link step generates its code.
  "import of a module whose code generation fails": {
    files: { "deep.mjs": `let a = 1;\nexport default a${Buffer.alloc(40_000, "-a").toString()};\n` },
    env: { BUN_JSC_maxPerThreadStackUsage: "1000000" },
    code: `try { await import("./deep.mjs"); console.log("imported"); } catch (e) { console.log(e.constructor.name + ": " + e.message); }`,
    stdout: "RangeError: Out of memory",
  },
};

for (const [name, { code, stdout: expected, env, files }] of Object.entries(snippets)) {
  test.concurrent(name, async () => {
    using dir = tempDir("exception-checks", files ?? {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: { ...bunEnv, ...env, BUN_JSC_validateExceptionChecks: "1", BUN_JSC_dumpSimulatedThrows: "1" },
      cwd: String(dir),
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
