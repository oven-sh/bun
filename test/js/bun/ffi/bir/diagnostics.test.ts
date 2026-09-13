import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import cases from "./fixtures/diagnostics/cases.json";
import { run, supported } from "./run-fixtures";

// What the compiler refuses, and what it says: `file:line:column: error: message`, the first error only.
async function firstError(source: string) {
  using dir = tempDir("bir-diagnostic", { "test.c": source });
  return await run(String(dir), ["test.c"]);
}

describe.skipIf(!supported)("diagnostics", () => {
  cases.forEach(({ about, source, line, column, message }, index) => {
    test.concurrent(`${index}: ${about}: ${message.slice(0, 60)}`, async () => {
      const { stdout, stderr, exitCode } = await firstError(source);
      expect(stderr).toContain(`test.c:${line}:${column}: error: ${message}`);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    });
  });

  // Input nested far deeper than any program is: an error, not a stack overflow.
  const deep: [string, string, string][] = [
    ["parentheses", `int f(void) { return ${"(".repeat(5000)}1${")".repeat(5000)}; }`, "nesting is too deep"],
    ["blocks", `void f(void) { ${"{".repeat(5000)} ${"}".repeat(5000)} }`, "nesting is too deep"],
    ["unary operators", `int f(int x) { return ${"-".repeat(5000)}x; }`, "nesting is too deep"],
    ["declarators", `int ${"(*".repeat(5000)}x${")".repeat(5000)};`, "nesting is too deep"],
    ["initializers", `int x = ${"{".repeat(5000)}1${"}".repeat(5000)};`, "nesting is too deep"],
    ["a chain of additions", `int f(int x) { return x${" + x".repeat(5000)}; }`, "expression is nested too deeply"],
    ["else if", `int f(int x) { ${"if (x) return 1; else ".repeat(5000)} return 0; }`, "nesting is too deep"],
  ];
  for (const [what, source, message] of deep) {
    test.concurrent(`five thousand levels of ${what}`, async () => {
      const { stdout, stderr, exitCode } = await firstError(source);
      expect(stderr).toContain(message);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    });
  }
});
