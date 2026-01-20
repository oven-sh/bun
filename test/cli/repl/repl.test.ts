import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Helper to run REPL with piped input and capture output
async function runRepl(input: string, timeout = 5000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn([bunExe(), "repl"], {
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Write input to stdin
  proc.stdin.write(input);
  proc.stdin.end();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("REPL timed out")), timeout);
  });

  const [stdout, stderr, exitCode] = await Promise.race([
    Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]),
    timeoutPromise,
  ]);

  return { stdout, stderr, exitCode };
}

describe.todoIf(isWindows)("bun repl", () => {
  test("exits cleanly with .exit", async () => {
    const { exitCode } = await runRepl(".exit\n");
    expect(exitCode).toBe(0);
  });

  test(".help command shows help text", async () => {
    const { stdout, exitCode } = await runRepl(".help\n.exit\n");

    expect(stdout).toContain("REPL");
    expect(stdout).toContain(".exit");
    expect(exitCode).toBe(0);
  });

  test(".q is an alias for .exit", async () => {
    const { exitCode } = await runRepl(".q\n");
    expect(exitCode).toBe(0);
  });

  test("EOF (empty input) exits the REPL", async () => {
    // Empty input (immediate EOF) should exit gracefully
    const { exitCode } = await runRepl("");
    expect(exitCode).toBe(0);
  });

  test("evaluates simple expression", async () => {
    const { stdout, exitCode } = await runRepl("1 + 1\n.exit\n");

    expect(stdout).toContain("2");
    expect(exitCode).toBe(0);
  });

  test("evaluates string expression", async () => {
    const { stdout, exitCode } = await runRepl('"hello"\n.exit\n');

    expect(stdout).toContain("hello");
    expect(exitCode).toBe(0);
  });

  test("evaluates object literal", async () => {
    const { stdout, exitCode } = await runRepl("({a: 1, b: 2})\n.exit\n");

    // Should show object representation
    expect(stdout).toMatch(/a.*:.*1/);
    expect(stdout).toMatch(/b.*:.*2/);
    expect(exitCode).toBe(0);
  });

  test("evaluates array literal", async () => {
    const { stdout, exitCode } = await runRepl("[1, 2, 3]\n.exit\n");

    expect(stdout).toContain("1");
    expect(stdout).toContain("2");
    expect(stdout).toContain("3");
    expect(exitCode).toBe(0);
  });

  test("handles console.log", async () => {
    const { stdout, exitCode } = await runRepl('console.log("hello world")\n.exit\n');

    expect(stdout).toContain("hello world");
    expect(exitCode).toBe(0);
  });

  test("persists variables across lines", async () => {
    const { stdout, exitCode } = await runRepl("const x = 42\nx * 2\n.exit\n");

    expect(stdout).toContain("84");
    expect(exitCode).toBe(0);
  });

  test("handles function definition and call", async () => {
    const { stdout, exitCode } = await runRepl("function add(a, b) { return a + b; }\nadd(2, 3)\n.exit\n");

    expect(stdout).toContain("5");
    expect(exitCode).toBe(0);
  });

  test("handles syntax errors gracefully", async () => {
    const { stdout, stderr, exitCode } = await runRepl("const x =\n.exit\n");

    // Should show error but continue
    const output = stdout + stderr;
    expect(output.toLowerCase()).toMatch(/error|parse|syntax/i);
    expect(exitCode).toBe(0);
  });

  test("handles runtime errors gracefully", async () => {
    const { stdout, stderr, exitCode } = await runRepl("throw new Error('test error')\n.exit\n");

    // Should show error but continue
    const output = stdout + stderr;
    expect(output).toContain("Error");
    expect(output).toContain("test error");
    expect(exitCode).toBe(0);
  });

  test("handles undefined variable error", async () => {
    const { stdout, stderr, exitCode } = await runRepl("undefinedVariable\n.exit\n");

    // Should show reference error
    const output = stdout + stderr;
    expect(output.toLowerCase()).toMatch(/error|not defined|undefined/i);
    expect(exitCode).toBe(0);
  });

  test("handles async/await", async () => {
    const { stdout, exitCode } = await runRepl("await Promise.resolve(42)\n.exit\n");

    expect(stdout).toContain("42");
    expect(exitCode).toBe(0);
  });

  test("Bun object is available", async () => {
    const { stdout, exitCode } = await runRepl("typeof Bun\n.exit\n");

    expect(stdout).toContain("object");
    expect(exitCode).toBe(0);
  });

  test("Bun.version is available", async () => {
    const { stdout, exitCode } = await runRepl("Bun.version\n.exit\n");

    // Should contain version number pattern
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(exitCode).toBe(0);
  });

  test("process object is available", async () => {
    const { stdout, exitCode } = await runRepl("typeof process\n.exit\n");

    expect(stdout).toContain("object");
    expect(exitCode).toBe(0);
  });

  test.todo("handles TypeScript syntax", async () => {
    // TypeScript type annotation should be stripped
    // Currently not supported in REPL
    const { stdout, exitCode } = await runRepl("const x: number = 42; x\n.exit\n");

    expect(stdout).toContain("42");
    expect(exitCode).toBe(0);
  });

  test("handles arrow functions", async () => {
    const { stdout, exitCode } = await runRepl("const double = (x) => x * 2; double(21)\n.exit\n");

    expect(stdout).toContain("42");
    expect(exitCode).toBe(0);
  });

  test("handles template literals", async () => {
    const { stdout, exitCode } = await runRepl("const name = 'world'; `hello ${name}`\n.exit\n");

    expect(stdout).toContain("hello world");
    expect(exitCode).toBe(0);
  });

  test("handles destructuring", async () => {
    const { stdout, exitCode } = await runRepl("const {a, b} = {a: 1, b: 2}; a + b\n.exit\n");

    expect(stdout).toContain("3");
    expect(exitCode).toBe(0);
  });

  test("handles spread operator", async () => {
    const { stdout, exitCode } = await runRepl("const arr = [1, 2, 3]; [...arr, 4, 5]\n.exit\n");

    expect(stdout).toContain("4");
    expect(stdout).toContain("5");
    expect(exitCode).toBe(0);
  });

  test("handles class definition", async () => {
    const { stdout, exitCode } = await runRepl("class Foo { constructor(x) { this.x = x; } }; new Foo(42).x\n.exit\n");

    expect(stdout).toContain("42");
    expect(exitCode).toBe(0);
  });

  test("handles Map and Set", async () => {
    const { stdout, exitCode } = await runRepl("const m = new Map(); m.set('a', 1); m.get('a')\n.exit\n");

    expect(stdout).toContain("1");
    expect(exitCode).toBe(0);
  });

  test("handles BigInt", async () => {
    const { stdout, exitCode } = await runRepl("1n + 2n\n.exit\n");

    expect(stdout).toContain("3n");
    expect(exitCode).toBe(0);
  });

  test("handles Symbol", async () => {
    const { stdout, exitCode } = await runRepl('const s = Symbol("test"); typeof s\n.exit\n');

    expect(stdout).toContain("symbol");
    expect(exitCode).toBe(0);
  });

  test("handles JSON operations", async () => {
    const { stdout, exitCode } = await runRepl("JSON.parse('{\"a\":1}')\n.exit\n");

    expect(stdout).toMatch(/a.*:.*1/);
    expect(exitCode).toBe(0);
  });

  test("handles fetch API availability", async () => {
    const { stdout, exitCode } = await runRepl("typeof fetch\n.exit\n");

    expect(stdout).toContain("function");
    expect(exitCode).toBe(0);
  });

  test("handles URL API", async () => {
    const { stdout, exitCode } = await runRepl('new URL("https://bun.sh").hostname\n.exit\n');

    expect(stdout).toContain("bun.sh");
    expect(exitCode).toBe(0);
  });

  test("handles TextEncoder/TextDecoder", async () => {
    const { stdout, exitCode } = await runRepl('new TextDecoder().decode(new TextEncoder().encode("hi"))\n.exit\n');

    expect(stdout).toContain("hi");
    expect(exitCode).toBe(0);
  });

  test("handles globalThis", async () => {
    const { stdout, exitCode } = await runRepl("typeof globalThis\n.exit\n");

    expect(stdout).toContain("object");
    expect(exitCode).toBe(0);
  });

  test("null result shows null", async () => {
    const { stdout, exitCode } = await runRepl("null\n.exit\n");

    expect(stdout).toContain("null");
    expect(exitCode).toBe(0);
  });

  test("boolean results", async () => {
    const { stdout, exitCode } = await runRepl("true\nfalse\n.exit\n");

    expect(stdout).toContain("true");
    expect(stdout).toContain("false");
    expect(exitCode).toBe(0);
  });

  test("handles Infinity and NaN", async () => {
    const { stdout, exitCode } = await runRepl("Infinity\nNaN\n.exit\n");

    expect(stdout).toContain("Infinity");
    expect(stdout).toContain("NaN");
    expect(exitCode).toBe(0);
  });

  test("handles regex", async () => {
    const { stdout, exitCode } = await runRepl('/test/.test("testing")\n.exit\n');

    expect(stdout).toContain("true");
    expect(exitCode).toBe(0);
  });

  test("handles Date", async () => {
    const { stdout, exitCode } = await runRepl("new Date(0).getFullYear()\n.exit\n");

    expect(stdout).toContain("1970");
    expect(exitCode).toBe(0);
  });

  test("handles Math functions", async () => {
    const { stdout, exitCode } = await runRepl("Math.max(1, 2, 3)\n.exit\n");

    expect(stdout).toContain("3");
    expect(exitCode).toBe(0);
  });

  test("handles Object methods", async () => {
    const { stdout, exitCode } = await runRepl("Object.keys({a: 1, b: 2})\n.exit\n");

    expect(stdout).toContain("a");
    expect(stdout).toContain("b");
    expect(exitCode).toBe(0);
  });

  test("handles Array methods", async () => {
    const { stdout, exitCode } = await runRepl("[1, 2, 3].map(x => x * 2)\n.exit\n");

    expect(stdout).toContain("2");
    expect(stdout).toContain("4");
    expect(stdout).toContain("6");
    expect(exitCode).toBe(0);
  });

  test("handles String methods", async () => {
    const { stdout, exitCode } = await runRepl('"hello".toUpperCase()\n.exit\n');

    expect(stdout).toContain("HELLO");
    expect(exitCode).toBe(0);
  });
});
