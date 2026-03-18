// https://github.com/oven-sh/bun/issues/28265
// REPL output should distinguish between expression results and thrown errors
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function runRepl(input: string | string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const inputStr = Array.isArray(input) ? input.join("\n") + "\n" : input;

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
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { stdout, stderr, exitCode };
}

const stripAnsi = Bun.stripANSI;

describe("REPL thrown values should show 'Uncaught' prefix", () => {
  test("throw undefined shows 'Uncaught undefined'", async () => {
    const { stdout, exitCode } = await runRepl(["throw undefined", ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("Uncaught undefined");
    expect(exitCode).toBe(0);
  });

  test("throw null shows 'Uncaught null'", async () => {
    const { stdout, exitCode } = await runRepl(["throw null", ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("Uncaught null");
    expect(exitCode).toBe(0);
  });

  test("throw 42 shows 'Uncaught 42'", async () => {
    const { stdout, exitCode } = await runRepl(["throw 42", ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("Uncaught 42");
    expect(exitCode).toBe(0);
  });

  test("throw string shows 'Uncaught' with the string", async () => {
    const { stdout, exitCode } = await runRepl(["throw 'hello'", ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("Uncaught");
    expect(output).toContain("hello");
    expect(exitCode).toBe(0);
  });

  test("throw Error shows 'Uncaught' with the error", async () => {
    const { stdout, exitCode } = await runRepl(["throw new Error('boom')", ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("Uncaught");
    expect(output).toContain("boom");
    expect(exitCode).toBe(0);
  });

  test("normal expression result does NOT show 'Uncaught'", async () => {
    const { stdout, exitCode } = await runRepl(["undefined", ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).not.toContain("Uncaught");
    expect(exitCode).toBe(0);
  });

  test("thrown values are distinguishable from expression results", async () => {
    const { stdout, exitCode } = await runRepl(["42", "throw 42", ".exit"]);
    const output = stripAnsi(stdout);
    const lines = output.split("\n");
    // Find the lines with "42" in output (excluding input echo)
    // The plain 42 should not have "Uncaught", the thrown one should
    const resultLine = lines.find(l => l.trim() === "42");
    const thrownLine = lines.find(l => l.includes("Uncaught 42"));
    expect(resultLine).toBeDefined();
    expect(thrownLine).toBeDefined();
    expect(exitCode).toBe(0);
  });

  test("REPL continues after throwing null/undefined", async () => {
    const { stdout, exitCode } = await runRepl(["throw null", "1 + 1", ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("Uncaught null");
    expect(output).toContain("2");
    expect(exitCode).toBe(0);
  });
});
