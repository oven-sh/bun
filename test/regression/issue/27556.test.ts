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

describe("REPL Unicode support (#27556)", () => {
  test("evaluates Chinese characters in strings", async () => {
    const { stdout, exitCode } = await runRepl(['console.log("你好世界")', ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("你好世界");
    expect(exitCode).toBe(0);
  });

  test("evaluates Japanese characters in strings", async () => {
    const { stdout, exitCode } = await runRepl(['console.log("こんにちは")', ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("こんにちは");
    expect(exitCode).toBe(0);
  });

  test("evaluates Korean characters in strings", async () => {
    const { stdout, exitCode } = await runRepl(['console.log("안녕하세요")', ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("안녕하세요");
    expect(exitCode).toBe(0);
  });

  test("evaluates accented Latin characters", async () => {
    const { stdout, exitCode } = await runRepl(['console.log("café résumé")', ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("café résumé");
    expect(exitCode).toBe(0);
  });

  test("evaluates emoji characters", async () => {
    const { stdout, exitCode } = await runRepl(['console.log("🎉🚀")', ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("🎉🚀");
    expect(exitCode).toBe(0);
  });

  test("Unicode string concatenation works", async () => {
    const { stdout, exitCode } = await runRepl(['"你好" + " " + "世界"', ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("你好 世界");
    expect(exitCode).toBe(0);
  });

  test("Unicode string length is correct", async () => {
    const { stdout, exitCode } = await runRepl(['"__LEN__" + "你好".length', ".exit"]);
    const output = stripAnsi(stdout);
    expect(output).toContain("__LEN__2");
    expect(exitCode).toBe(0);
  });
});
