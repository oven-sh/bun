import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// ECMA-262 §16.2.1.1: duplicate entries in the ExportedNames and
// LexicallyDeclaredNames of a Module are Syntax Errors. Top-level function
// declarations are lexically declared in a Module (unlike in a function body),
// so two `function foo` at module scope must be rejected.

const js = new Bun.Transpiler({ loader: "js" });
const ts = new Bun.Transpiler({ loader: "ts" });

function transpileError(code: string, t = js): string {
  try {
    t.transformSync(code);
  } catch (e: any) {
    const err = e instanceof AggregateError ? e.errors[0] : e;
    return String(err.message);
  }
  throw new Error("expected a parse error for:\n" + code);
}

function transpiles(code: string, t = js): string {
  return t.transformSync(code);
}

describe("duplicate function declarations", () => {
  describe("rejected at module scope in ESM", () => {
    test("export function + export function", () => {
      expect(transpileError("export function foo() { return 1 }\n" + "export function foo() { return 2 }")).toMatch(
        /"foo" has already been declared|Multiple exports with the same name "foo"/,
      );
    });

    test("export async function + export async function", () => {
      expect(
        transpileError("export async function foo() { return 1 }\n" + "export async function foo() { return 2 }"),
      ).toMatch(/"foo" has already been declared|Multiple exports with the same name "foo"/);
    });

    test("function + export function", () => {
      expect(transpileError("function foo() { return 1 }\n" + "export function foo() { return 2 }")).toContain(
        '"foo" has already been declared',
      );
    });

    test("export function + function", () => {
      expect(transpileError("export function foo() { return 1 }\n" + "function foo() { return 2 }")).toContain(
        '"foo" has already been declared',
      );
    });

    test("two non-exported functions in a module (via export {})", () => {
      expect(transpileError("function foo() { return 1 }\n" + "function foo() { return 2 }\n" + "export {}")).toContain(
        '"foo" has already been declared',
      );
    });

    test("two non-exported functions in a module (via import)", () => {
      expect(
        transpileError("import 'x'\n" + "function foo() { return 1 }\n" + "function foo() { return 2 }"),
      ).toContain('"foo" has already been declared');
    });
  });

  describe("rejected inside a block in strict mode", () => {
    test('explicit "use strict"', () => {
      expect(
        transpileError("'use strict'\n" + "{ function foo() { return 1 }\n" + "function foo() { return 2 } }"),
      ).toContain('"foo" has already been declared');
    });

    test("implicit via ESM", () => {
      expect(
        transpileError("{ function foo() { return 1 }\n" + "function foo() { return 2 } }\n" + "export {}"),
      ).toContain('"foo" has already been declared');
    });
  });

  describe("allowed", () => {
    test("in a script with no ESM syntax", () => {
      // Top-level of a script is like a function body; last declaration wins.
      expect(() => transpiles("function foo() { return 1 }\n" + "function foo() { return 2 }")).not.toThrow();
    });

    test("inside a function body (even in ESM)", () => {
      expect(() =>
        transpiles("function outer() { function foo() {}\n" + "function foo() {} }\n" + "export {}"),
      ).not.toThrow();
    });

    test("inside a block in sloppy mode", () => {
      expect(() => transpiles("{ function foo() { return 1 }\n" + "function foo() { return 2 } }")).not.toThrow();
    });

    test("TypeScript overload signatures", () => {
      // Forward declarations have no body and are discarded before symbol
      // declaration, so they must not trip the duplicate check.
      expect(() =>
        transpiles(
          "export function foo(x: number): number\n" +
            "export function foo(x: string): string\n" +
            "export function foo(x: any): any { return x }",
          ts,
        ),
      ).not.toThrow();
    });

    test("var + var at module scope", () => {
      expect(() => transpiles("var foo = 1\n" + "var foo = 2\n" + "export {}")).not.toThrow();
    });
  });
});

describe("duplicate function declarations at runtime", () => {
  // The runtime module loader must surface the parse error instead of silently
  // executing the last declaration.
  test.concurrent("duplicate export function in .mjs is a SyntaxError", async () => {
    using dir = tempDir("dup-export-fn", {
      "dup.mjs": "export function foo() { return 1 }\n" + "export function foo() { return 2 }\n" + "console.log(foo())",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "dup.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toMatch(/"foo" has already been declared|Multiple exports with the same name "foo"/);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  test.concurrent("duplicate top-level function in .mjs is a SyntaxError", async () => {
    // No import/export/TLA: the .mjs extension alone must be enough for the
    // parser to treat the top level as a Module.
    using dir = tempDir("dup-fn", {
      "dup.mjs": "function foo() { return 1 }\n" + "function foo() { return 2 }\n" + "console.log(foo())",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "dup.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('"foo" has already been declared');
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });
});
