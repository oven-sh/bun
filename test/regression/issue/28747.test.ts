import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("piping JavaScript to bun via stdin", () => {
  test("executes code piped to stdin with no arguments", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe()],
      stdin: new TextEncoder().encode('console.log("hello from stdin");\n'),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("hello from stdin\n");
    expect(exitCode).toBe(0);
  });

  test("child_process.spawn with piped stdin executes code", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { execFileSync } = require('child_process');
        const result = execFileSync(process.execPath, [], {
          input: 'console.log("hello from child");\\n',
          encoding: 'utf8',
        });
        process.stdout.write(result);
      `,
      ],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("hello from child\n");
    expect(exitCode).toBe(0);
  });

  test("empty stdin exits with code 0", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe()],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    proc.stdin.end();

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  test("multiline script from stdin", async () => {
    const script = ["const x = 42;", "const y = 58;", "console.log(x + y);"].join("\n");

    await using proc = Bun.spawn({
      cmd: [bunExe()],
      stdin: new TextEncoder().encode(script),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("100\n");
    expect(exitCode).toBe(0);
  });
});
