import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// POSIX-specific tests (SIGUSR1 mechanism) - macOS and Linux only
describe.skipIf(isWindows)("Runtime inspector SIGUSR1 activation", () => {
  test("activates inspector when no user listener", async () => {
    using dir = tempDir("sigusr1-activate-test", {
      "test.js": `
        const fs = require("fs");
        const path = require("path");

        // Write PID so parent can send signal
        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        // Keep process alive
        setInterval(() => {}, 1000);
      `,
    });

    await using proc = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    let output = "";
    while (!output.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Send SIGUSR1
    process.kill(pid, "SIGUSR1");

    // Give inspector time to activate
    await Bun.sleep(100);

    // Kill process and check stderr
    proc.kill();
    const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Debugger listening on ws://127.0.0.1:6499/");
  });

  test("user SIGUSR1 listener takes precedence over inspector activation", async () => {
    using dir = tempDir("sigusr1-user-test", {
      "test.js": `
        const fs = require("fs");
        const path = require("path");

        process.on("SIGUSR1", () => {
          console.log("USER_HANDLER_CALLED");
          setTimeout(() => process.exit(0), 100);
        });

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        setInterval(() => {}, 1000);
      `,
    });

    await using proc = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    let output = "";
    while (!output.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    process.kill(pid, "SIGUSR1");

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(output).toContain("USER_HANDLER_CALLED");
    expect(stderr).not.toContain("Debugger listening");
    expect(exitCode).toBe(0);
  });

  test("inspector does not activate twice via SIGUSR1", async () => {
    using dir = tempDir("sigusr1-twice-test", {
      "test.js": `
        const fs = require("fs");
        const path = require("path");

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        // Keep process alive, exit after a bit
        setTimeout(() => process.exit(0), 500);
        setInterval(() => {}, 1000);
      `,
    });

    await using proc = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    let output = "";
    while (!output.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Send SIGUSR1 twice - inspector should only activate once
    process.kill(pid, "SIGUSR1");
    await Bun.sleep(50);
    process.kill(pid, "SIGUSR1");

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // Should only see one "Debugger listening" message
    const matches = stderr.match(/Debugger listening/g);
    expect(matches?.length ?? 0).toBe(1);
    expect(exitCode).toBe(0);
  });

  test("SIGUSR1 to self activates inspector", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        setTimeout(() => process.exit(0), 300);
        // Small delay to ensure handler is installed
        setTimeout(() => {
          process.kill(process.pid, "SIGUSR1");
        }, 50);
        setInterval(() => {}, 1000);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Debugger listening");
    expect(exitCode).toBe(0);
  });
});
