import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import cases from "./fixtures/diagnostics/cases.json";
import { lines, meets, run, supported } from "./run-fixtures";

// What the compiler refuses, and what it says: `file:line:column: error: message`, the first error only.
async function firstError(source: string) {
  using dir = tempDir("bir-diagnostic", { "test.c": source });
  return await run(String(dir), ["test.c"]);
}

describe.skipIf(!supported)("diagnostics", () => {
  cases.forEach(
    ({ about, source, line, column, message, requires }: (typeof cases)[number] & { requires?: string }, index) => {
      if (!meets(requires)) return;
      test.concurrent(`${index}: ${about}: ${message.slice(0, 60)}`, async () => {
        const { stdout, stderr, exitCode } = await firstError(source);
        expect(stderr).toContain(`test.c:${line}:${column}: error: ${message}`);
        expect(stdout).toBe("");
        expect(exitCode).not.toBe(0);
      });
    },
  );

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
  // A preprocessor asked for more than there is memory or patience for. (The parser takes tokens as they are made,
  // so each of these is in a place where it would go on accepting them.)
  const runaway: [string, string, string][] = [
    [
      "forty macros that each double the one before",
      `#define X0 1,\n${Array.from({ length: 39 }, (_, i) => `#define X${i + 1} X${i} X${i}\n`).join("")}int a[] = { X39 };\n`,
      "macro expansion produces too many tokens",
    ],
    [
      "five thousand nested invocations",
      `#define F(x) x\n${"F(".repeat(5000)}1${")".repeat(5000)}`,
      "macro expansion is nested too deeply",
    ],
    [
      "a chain of thirty thousand macros",
      `${Array.from({ length: 30000 }, (_, i) => `#define C${i} C${i + 1}\n`).join("")}C0`,
      "nested too deeply",
    ],
    ["a hundred thousand #if without #endif", "#if 1\n".repeat(100_000), "unterminated conditional directive"],
  ];
  for (const [what, source, message] of runaway) {
    test.concurrent(what, async () => {
      const { stdout, stderr, exitCode } = await firstError(source);
      expect(stderr).toContain(message);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    });
  }

  // Just under those limits is an ordinary program.
  test.concurrent("a thousand additions and two hundred parentheses compile and run", async () => {
    const source = `int printf(const char *, ...);
int chain(int x) { return x${" + x".repeat(990)}; }
int nested(void) { return ${"(".repeat(240)}7${")".repeat(240)}; }
int main(void) { printf("%d %d\\n", chain(2), nested()); return 0; }`;
    const { stdout, stderr, exitCode } = await firstError(source);
    expect(lines(stdout), stderr).toBe("1982 7\n");
    expect(exitCode).toBe(0);
  });
  for (const [what, source, message] of deep) {
    test.concurrent(`five thousand levels of ${what}`, async () => {
      const { stdout, stderr, exitCode } = await firstError(source);
      expect(stderr).toContain(message);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    });
  }
});
