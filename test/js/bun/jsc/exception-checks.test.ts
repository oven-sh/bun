import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Each snippet reaches a native code path that used to run a second JSC
// operation, or return from a ThrowScope, while an exception check was still
// pending. On a debug build BUN_JSC_validateExceptionChecks=1 aborts the
// process at that point, so the assertion is that the snippet completes and
// prints its marker. On a release build the validator is compiled out and the
// test only checks the behavior.
// A string built at run time is a rope; reading it resolves the rope under a
// ThrowScope, which is what makes the snippets below observable to the
// validator.
const snippets: Record<string, { code: string; stdout: string }> = {
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
  // JSC builds a parse error's stack before it throws the error, which runs
  // the Error.prepareStackTrace hook. eval is not affected: an eval parse
  // error skips that step.
  "new Function with a syntax error": {
    code: `try { new Function("{"); } catch (e) { console.log(e.constructor.name + ": " + e.message); }`,
    stdout: "SyntaxError: Unexpected end of script",
  },
  "new Function with a syntax error and a custom Error.prepareStackTrace": {
    code: `Error.prepareStackTrace = (err, sites) => "custom:" + err.message + ":" + (sites.length > 0); try { new Function("a", "{"); } catch (e) { console.log(e.constructor.name + " " + e.stack); }`,
    stdout: "SyntaxError custom:Unexpected end of script:true",
  },
  "new Function with a syntax error and a throwing Error.prepareStackTrace": {
    code: `Error.prepareStackTrace = () => { throw new Error("boom"); }; try { new Function("{"); } catch (e) { console.log(e.constructor.name + ": " + e.message + " " + typeof e.stack); }`,
    stdout: "SyntaxError: Unexpected end of script string",
  },
  "GeneratorFunction with a syntax error": {
    code: `const GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor; try { GeneratorFunction("{"); } catch (e) { console.log(e.constructor.name + ": " + e.message); }`,
    stdout: "SyntaxError: Unexpected end of script",
  },
  "AsyncFunction with a syntax error": {
    code: `const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor; try { new AsyncFunction("{"); } catch (e) { console.log(e.constructor.name + ": " + e.message); }`,
    stdout: "SyntaxError: Unexpected end of script",
  },
  "vm.SourceTextModule with a syntax error": {
    code: `import { SourceTextModule } from "node:vm"; try { new SourceTextModule("{"); } catch (e) { console.log(e.constructor.name + ": " + e.message); }`,
    stdout: "SyntaxError: Unexpected end of script",
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
