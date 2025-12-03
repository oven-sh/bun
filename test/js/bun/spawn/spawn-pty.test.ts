import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("Bun.spawn with PTY", () => {
  test("stdout: 'pty' makes process.stdout.isTTY true", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(process.stdout.isTTY)"],
      stdin: "ignore",
      stdout: "pty",
      stderr: "inherit",
      env: bunEnv,
    });

    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(stdout.trim()).toBe("true");
    expect(exitCode).toBe(0);
  });

  test("stdin: 'pty' and stdout: 'pty' makes both isTTY true", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log('isTTY:', process.stdout.isTTY, process.stdin.isTTY)"],
      stdin: "pty",
      stdout: "pty",
      stderr: "inherit",
      env: bunEnv,
    });

    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    // PTY adds \r\n line endings
    expect(stdout.trim()).toBe("isTTY: true true");
    expect(exitCode).toBe(0);
  });

  test("stdin: 'pty', stdout: 'pty', stderr: 'pty' all share the same PTY", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log('isTTY:', process.stdout.isTTY, process.stdin.isTTY, process.stderr.isTTY)"],
      stdin: "pty",
      stdout: "pty",
      stderr: "pty",
      env: bunEnv,
    });

    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(stdout.trim()).toBe("isTTY: true true true");
    expect(exitCode).toBe(0);
  });
});
