import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

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

  test("stderr: 'pty' makes process.stderr.isTTY true", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.error(process.stderr.isTTY)"],
      stdin: "ignore",
      stdout: "inherit",
      stderr: "pty",
      env: bunEnv,
    });

    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

    expect(stderr.trim()).toBe("true");
    expect(exitCode).toBe(0);
  });

  test("stdin: 'pty' only makes process.stdin.isTTY true", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(process.stdin.isTTY, process.stdout.isTTY)"],
      stdin: "pty",
      stdout: "pipe",
      stderr: "inherit",
      env: bunEnv,
    });

    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    // stdin is PTY (true), stdout is pipe (undefined - isTTY is undefined when not a TTY)
    expect(stdout.trim()).toBe("true undefined");
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

  test("PTY object syntax with custom dimensions", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(process.stdout.columns, process.stdout.rows)"],
      stdin: "ignore",
      stdout: { type: "pty", width: 120, height: 40 },
      stderr: "inherit",
      env: bunEnv,
    });

    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(stdout.trim()).toBe("120 40");
    expect(exitCode).toBe(0);
  });

  test("PTY enables colored output from programs that detect TTY", async () => {
    // Use a simple inline script that outputs ANSI colors when stdout is a TTY
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        if (process.stdout.isTTY) {
          console.log("\\x1b[31mred\\x1b[0m");
        } else {
          console.log("no-color");
        }
      `,
      ],
      stdin: "ignore",
      stdout: "pty",
      stderr: "inherit",
      env: bunEnv,
    });

    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    // Should contain ANSI escape codes
    expect(stdout).toContain("\x1b[31m");
    expect(stdout).toContain("red");
    expect(exitCode).toBe(0);
  });

  test("multiple concurrent PTY spawns work correctly", async () => {
    const procs = Array.from({ length: 5 }, (_, i) =>
      Bun.spawn({
        cmd: [bunExe(), "-e", `console.log("proc${i}:", process.stdout.isTTY)`],
        stdin: "ignore",
        stdout: "pty",
        stderr: "inherit",
        env: bunEnv,
      }),
    );

    const results = await Promise.all(
      procs.map(async (proc, i) => {
        const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        return { stdout: stdout.trim(), exitCode, index: i };
      }),
    );

    for (const result of results) {
      expect(result.stdout).toBe(`proc${result.index}: true`);
      expect(result.exitCode).toBe(0);
    }
  });
});

describe.if(isWindows)("Bun.spawn PTY on Windows", () => {
  test("throws error when PTY is used on Windows", () => {
    expect(() => {
      Bun.spawn({
        cmd: ["echo", "test"],
        stdout: "pty",
      });
    }).toThrow("PTY is not supported on Windows");
  });
});
