// Exercises `Arguments.parse` with per-command flags now that the function
// takes a runtime `Command.Tag` and dispatches through `clap.RuntimeArgs`
// instead of a per-command `ComptimeClap` instantiation. Each command's
// distinctive flag must still be recognized and wired to the same option.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("Arguments.parse runtime cmd dispatch", () => {
  test("--define reaches the transpiler for AutoCommand", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--define", "FOO:123", "-e", "console.log(FOO)"],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("123\n");
    expect(code).toBe(0);
  });

  test("--silent reaches RunCommand and suppresses the command echo", async () => {
    using dir = tempDir("args-run", {
      "package.json": JSON.stringify({ name: "t", scripts: { hello: "echo loud" } }),
    });
    await using loud = Bun.spawn({
      cmd: [bunExe(), "run", "hello"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, loudErr] = await Promise.all([loud.stdout.text(), loud.stderr.text(), loud.exited]);
    expect(loudErr).toContain("$ echo loud");

    await using quiet = Bun.spawn({
      cmd: [bunExe(), "run", "--silent", "hello"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [quietOut, quietErr, quietCode] = await Promise.all([quiet.stdout.text(), quiet.stderr.text(), quiet.exited]);
    expect(quietErr).not.toContain("$ echo loud");
    expect(quietOut).toContain("loud");
    expect(quietCode).toBe(0);
  });

  test("--minify --target are BuildCommand-only and still parse", async () => {
    using dir = tempDir("args-build", { "in.ts": `export const x = 1 + 1;\n` });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--minify", "--target=node", String(dir) + "/in.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // minify folds 1+1 → 2 and drops whitespace
    expect(stdout).not.toContain("1 + 1");
    expect(stdout).toContain("=2");
    expect(code).toBe(0);
  });

  test("--bail is TestCommand-only and still parses", async () => {
    using dir = tempDir("args-test", {
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("first", () => { expect(1).toBe(2); });
        test("second", () => { expect(1).toBe(1); });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--bail=1", "a.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, code] = await Promise.all([proc.stderr.text(), proc.exited]);
    // bail=1 stops after first failure, so "second" never runs
    expect(stderr).toContain("Bailed out after 1 failure");
    expect(stderr).not.toContain("second");
    expect(code).not.toBe(0);
  });

  test("bunfig [run] section loads for RunCommand", async () => {
    using dir = tempDir("args-bunfig", {
      "bunfig.toml": `[run]\nsilent = true\n`,
      "package.json": JSON.stringify({ name: "t", scripts: { hello: "echo ran" } }),
    });
    await using run = Bun.spawn({
      cmd: [bunExe(), "run", "hello"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [runOut, runErr, runCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    // [run].silent suppresses the "$ echo ran" line
    expect(runErr).not.toContain("$ echo ran");
    expect(runOut).toContain("ran");
    expect(runCode).toBe(0);
  });

  describe.each([[], ["run"], ["build"], ["test"], ["upgrade"], ["exec"]])("`bun %s --help`", (...sub: string[]) => {
    test("renders", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...sub, "--help"],
        env: { ...bunEnv, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect((stdout + stderr).length).toBeGreaterThan(40);
      expect(code).toBe(0);
    });
  });
});
