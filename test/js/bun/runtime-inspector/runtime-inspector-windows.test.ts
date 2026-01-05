import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// Windows-specific tests (file mapping mechanism) - Windows only
describe.skipIf(!isWindows)("Runtime inspector Windows file mapping", () => {
  test("inspector activates via file mapping mechanism", async () => {
    // This is the primary Windows test - verify the file mapping mechanism works
    using dir = tempDir("windows-file-mapping-test", {
      "target.js": `
        const fs = require("fs");
        const path = require("path");

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        // Keep process alive
        setInterval(() => {}, 1000);
      `,
    });

    await using targetProc = spawn({
      cmd: [bunExe(), "target.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = targetProc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    while (!output.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Use _debugProcess which uses file mapping on Windows
    await using debugProc = spawn({
      cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [debugStderr, debugExitCode] = await Promise.all([debugProc.stderr.text(), debugProc.exited]);

    expect(debugStderr).toBe("");
    expect(debugExitCode).toBe(0);

    // Wait for the debugger to start by reading stderr until we see the message
    const stderrReader = targetProc.stderr.getReader();
    const stderrDecoder = new TextDecoder();
    let targetStderr = "";
    while (!targetStderr.includes("Debugger listening")) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      targetStderr += stderrDecoder.decode(value, { stream: true });
    }
    stderrReader.releaseLock();

    targetProc.kill();
    await targetProc.exited;

    // Verify inspector actually started
    expect(targetStderr).toContain("Debugger listening on ws://127.0.0.1:6499/");
  });

  test("_debugProcess works with current process's own pid", async () => {
    // On Windows, calling _debugProcess with our own PID should work
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        setTimeout(() => process.exit(0), 300);
        // Small delay to ensure handler is installed
        setTimeout(() => {
          process._debugProcess(process.pid);
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

  test("inspector does not activate twice via file mapping", async () => {
    using dir = tempDir("windows-twice-test", {
      "target.js": `
        const fs = require("fs");
        const path = require("path");

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        setTimeout(() => process.exit(0), 500);
        setInterval(() => {}, 1000);
      `,
    });

    await using targetProc = spawn({
      cmd: [bunExe(), "target.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = targetProc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    while (!output.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    // Set up stderr reader to wait for debugger to start
    const stderrReader = targetProc.stderr.getReader();
    const stderrDecoder = new TextDecoder();
    let stderr = "";

    // Call _debugProcess twice
    await using debug1 = spawn({
      cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await debug1.exited;

    // Wait for debugger to actually start by reading stderr
    while (!stderr.includes("Debugger listening")) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderr += stderrDecoder.decode(value, { stream: true });
    }

    await using debug2 = spawn({
      cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await debug2.exited;

    // Collect any remaining stderr and wait for process to exit
    stderrReader.releaseLock();
    const remainingStderr = await targetProc.stderr.text();
    stderr += remainingStderr;
    const exitCode = await targetProc.exited;

    // Should only see one "Debugger listening" message
    const matches = stderr.match(/Debugger listening/g);
    expect(matches?.length ?? 0).toBe(1);
    expect(exitCode).toBe(0);
  });

  test("multiple Windows processes can have independent inspectors", async () => {
    using dir = tempDir("windows-multi-test", {
      "target.js": `
        const fs = require("fs");
        const path = require("path");
        const id = process.argv[2];

        fs.writeFileSync(path.join(process.cwd(), "pid-" + id), String(process.pid));
        console.log("READY-" + id);

        setTimeout(() => process.exit(0), 500);
        setInterval(() => {}, 1000);
      `,
    });

    await using target1 = spawn({
      cmd: [bunExe(), "target.js", "1"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    await using target2 = spawn({
      cmd: [bunExe(), "target.js", "2"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const decoder = new TextDecoder();

    const reader1 = target1.stdout.getReader();
    let output1 = "";
    while (!output1.includes("READY-1")) {
      const { value, done } = await reader1.read();
      if (done) break;
      output1 += decoder.decode(value, { stream: true });
    }
    reader1.releaseLock();

    const reader2 = target2.stdout.getReader();
    let output2 = "";
    while (!output2.includes("READY-2")) {
      const { value, done } = await reader2.read();
      if (done) break;
      output2 += decoder.decode(value, { stream: true });
    }
    reader2.releaseLock();

    const pid1 = parseInt(await Bun.file(join(String(dir), "pid-1")).text(), 10);
    const pid2 = parseInt(await Bun.file(join(String(dir), "pid-2")).text(), 10);

    // Activate inspector in both
    await using debug1 = spawn({
      cmd: [bunExe(), "-e", `process._debugProcess(${pid1})`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    await using debug2 = spawn({
      cmd: [bunExe(), "-e", `process._debugProcess(${pid2})`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    await Promise.all([debug1.exited, debug2.exited]);

    const [stderr1, exitCode1] = await Promise.all([target1.stderr.text(), target1.exited]);
    const [stderr2, exitCode2] = await Promise.all([target2.stderr.text(), target2.exited]);

    expect(stderr1).toContain("Debugger listening");
    expect(stderr2).toContain("Debugger listening");
    expect(exitCode1).toBe(0);
    expect(exitCode2).toBe(0);
  });
});
