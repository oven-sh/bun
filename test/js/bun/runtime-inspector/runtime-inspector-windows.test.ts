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
    expect(pid).toBeGreaterThan(0);

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

    // Wait for the debugger to start by reading stderr until the full banner appears
    const stderrReader = targetProc.stderr.getReader();
    const stderrDecoder = new TextDecoder();
    let targetStderr = "";
    // Wait for the full banner (header + content + footer)
    while ((targetStderr.match(/Bun Inspector/g) || []).length < 2) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      targetStderr += stderrDecoder.decode(value, { stream: true });
    }
    stderrReader.releaseLock();

    targetProc.kill();
    await targetProc.exited;

    // Verify inspector actually started
    expect(targetStderr).toContain("Bun Inspector");
    expect(targetStderr).toContain("ws://localhost:6499/");
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

    expect(stderr).toContain("Bun Inspector");
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
    expect(pid).toBeGreaterThan(0);

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

    // Wait for the full banner (header + content + footer)
    while ((stderr.match(/Bun Inspector/g) || []).length < 2) {
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

    // Should only see one "Bun Inspector" banner (two occurrences of the text, for header and footer)
    const matches = stderr.match(/Bun Inspector/g);
    expect(matches?.length ?? 0).toBe(2);
    expect(exitCode).toBe(0);
  });

  test("multiple Windows processes can have inspectors sequentially", async () => {
    // Note: Runtime inspector uses hardcoded port 6499, so we must test
    // sequential activation (activate first, shut down, then activate second)
    // rather than concurrent activation.
    using dir = tempDir("windows-multi-test", {
      "target.js": `
        const fs = require("fs");
        const path = require("path");
        const id = process.argv[2];

        fs.writeFileSync(path.join(process.cwd(), "pid-" + id), String(process.pid));
        console.log("READY-" + id);

        setTimeout(() => process.exit(0), 5000);
        setInterval(() => {}, 1000);
      `,
    });

    const decoder = new TextDecoder();

    // First process: activate inspector, verify, then shut down
    {
      await using target1 = spawn({
        cmd: [bunExe(), "target.js", "1"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const reader1 = target1.stdout.getReader();
      let output1 = "";
      while (!output1.includes("READY-1")) {
        const { value, done } = await reader1.read();
        if (done) break;
        output1 += decoder.decode(value, { stream: true });
      }
      reader1.releaseLock();

      const pid1 = parseInt(await Bun.file(join(String(dir), "pid-1")).text(), 10);
      expect(pid1).toBeGreaterThan(0);

      await using debug1 = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid1})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(await debug1.exited).toBe(0);

      // Wait for the full banner
      const stderrReader1 = target1.stderr.getReader();
      const stderrDecoder1 = new TextDecoder();
      let stderr1 = "";
      while ((stderr1.match(/Bun Inspector/g) || []).length < 2) {
        const { value, done } = await stderrReader1.read();
        if (done) break;
        stderr1 += stderrDecoder1.decode(value, { stream: true });
      }
      stderrReader1.releaseLock();

      expect(stderr1).toContain("Bun Inspector");

      target1.kill();
      await target1.exited;
    }

    // Second process: now that first is shut down, port 6499 is free
    {
      await using target2 = spawn({
        cmd: [bunExe(), "target.js", "2"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const reader2 = target2.stdout.getReader();
      let output2 = "";
      while (!output2.includes("READY-2")) {
        const { value, done } = await reader2.read();
        if (done) break;
        output2 += decoder.decode(value, { stream: true });
      }
      reader2.releaseLock();

      const pid2 = parseInt(await Bun.file(join(String(dir), "pid-2")).text(), 10);
      expect(pid2).toBeGreaterThan(0);

      await using debug2 = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid2})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(await debug2.exited).toBe(0);

      // Wait for the full banner
      const stderrReader2 = target2.stderr.getReader();
      const stderrDecoder2 = new TextDecoder();
      let stderr2 = "";
      while ((stderr2.match(/Bun Inspector/g) || []).length < 2) {
        const { value, done } = await stderrReader2.read();
        if (done) break;
        stderr2 += stderrDecoder2.decode(value, { stream: true });
      }
      stderrReader2.releaseLock();

      expect(stderr2).toContain("Bun Inspector");

      target2.kill();
      await target2.exited;
    }
  });
});
