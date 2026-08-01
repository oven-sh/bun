import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/9769
// https://github.com/oven-sh/bun/issues/15857
//
// JavaScriptCore's parser unconditionally marked an arrow function scope as
// "uses eval" whenever it encountered an object-literal shorthand property
// (e.g. `(x) => ({ x })`). That made the enclosing regular function allocate
// and capture its `arguments` object in the closure's lexical environment.
//
// TypeScript's `createProgram(opts)` contains such an arrow, and its returned
// closures therefore retained `arguments[0]` (= the options object holding
// `oldProgram`), chaining every Program ever created. Under tsserver this
// leaked several MB of JS heap per file save.

describe("issue #9769 / #15857: shorthand property in arrow should not force the enclosing function to capture `arguments`", () => {
  test("closure returned from a function with `(x) => ({ x })` does not retain the call arguments", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", join(import.meta.dir, "fixture.cjs")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("PASS");
    expect(exitCode).toBe(0);
  });

  test("`arguments` still reflects the real call when the shorthand is literally `eval`", async () => {
    // Removing the unconditional setInnerArrowFunctionUsesEval() must not change
    // observable semantics: a shorthand `{ eval }` in an arrow still works, and
    // `arguments` inside a nested arrow still resolves to the enclosing function's.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          function outer(a, b) {
            const g = () => ({ eval, args: arguments.length });
            return g();
          }
          const r = outer(1, 2, 3);
          if (typeof r.eval !== "function") throw new Error("eval shorthand broken");
          if (r.args !== 3) throw new Error("arguments in arrow broken: " + r.args);
          console.log("PASS");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("PASS");
    expect(exitCode).toBe(0);
  });
});
