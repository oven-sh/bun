import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Helper to run REPL with piped stdin and capture output
async function runRepl(input: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const inputStr = input.join("\n") + "\n";

  await using proc = Bun.spawn({
    cmd: [bunExe(), "repl"],
    stdin: Buffer.from(inputStr),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...bunEnv,
      TERM: "dumb",
      NO_COLOR: "1",
    },
  });

  const exitCode = await proc.exited;
  const stdout = Bun.stripANSI(await new Response(proc.stdout).text());
  const stderr = Bun.stripANSI(await new Response(proc.stderr).text());

  return { stdout, stderr, exitCode };
}

describe("issue #27675 - REPL const/let semantics", () => {
  test("const cannot be reassigned", async () => {
    const { stdout, stderr, exitCode } = await runRepl(["const a = 42", "a = 43", ".exit"]);
    const output = stdout + stderr;
    // Should throw TypeError on assignment to const
    expect(output).toMatch(/TypeError|readonly|constant/i);
    expect(exitCode).toBe(0);
  });

  test("const cannot be redeclared", async () => {
    const { stdout, stderr, exitCode } = await runRepl(["const a = 42", "const a = 44", ".exit"]);
    const output = stdout + stderr;
    // Should throw SyntaxError on redeclaration
    expect(output).toMatch(/SyntaxError|duplicate.*variable|already.*declared/i);
    expect(exitCode).toBe(0);
  });

  test("const value persists across lines", async () => {
    const { stdout, exitCode } = await runRepl(["const a = 42", "a", ".exit"]);
    expect(stdout).toContain("42");
    expect(exitCode).toBe(0);
  });

  test("const declaration returns undefined", async () => {
    const { stdout, exitCode } = await runRepl(["const a = 42", ".exit"]);
    expect(stdout).toContain("undefined");
    expect(exitCode).toBe(0);
  });

  test("let can be reassigned", async () => {
    const { stdout, exitCode } = await runRepl(["let b = 1", "b = 2", "b", ".exit"]);
    expect(stdout).toContain("2");
    expect(exitCode).toBe(0);
  });

  test("let can be redeclared across lines", async () => {
    const { stdout, stderr, exitCode } = await runRepl(["let b = 1", "let b = 2", "b", ".exit"]);
    const output = stdout + stderr;
    // Should NOT throw - let redeclaration is allowed in REPL (like Node.js)
    expect(output).not.toMatch(/SyntaxError|duplicate.*variable|already.*declared/i);
    expect(output).toContain("2");
    expect(exitCode).toBe(0);
  });

  test("var can be reassigned and redeclared", async () => {
    const { stdout, exitCode } = await runRepl(["var c = 1", "c = 2", "var c = 3", "c", ".exit"]);
    expect(stdout).toContain("3");
    expect(exitCode).toBe(0);
  });
});
