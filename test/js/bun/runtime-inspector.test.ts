import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

describe("Runtime inspector activation", () => {
  // These tests run on ALL platforms (Windows uses file mapping, POSIX uses SIGUSR1)
  describe("process._debugProcess", () => {
    test("activates inspector in target process", async () => {
      using dir = tempDir("debug-process-test", {
        "target.js": `
          const fs = require("fs");
          const path = require("path");

          // Write PID so parent can find us
          fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
          console.log("READY");

          // Keep process alive
          setInterval(() => {}, 1000);
        `,
      });

      // Start target process
      await using targetProc = spawn({
        cmd: [bunExe(), "target.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Wait for target to be ready
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

      // Use _debugProcess to activate inspector
      await using debugProc = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [debugStderr, debugExitCode] = await Promise.all([debugProc.stderr.text(), debugProc.exited]);

      expect(debugStderr).toBe("");
      expect(debugExitCode).toBe(0);

      // Give inspector time to activate and check stderr
      await Bun.sleep(100);

      // Kill target and collect its stderr
      targetProc.kill();
      const [targetStderr] = await Promise.all([targetProc.stderr.text(), targetProc.exited]);

      expect(targetStderr).toContain("Debugger listening on ws://127.0.0.1:6499/");
    });

    test("throws error for non-existent process", async () => {
      // Use a PID that definitely doesn't exist
      const fakePid = 999999999;

      await using proc = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${fakePid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Failed");
    });

    test("inspector does not activate twice", async () => {
      using dir = tempDir("debug-process-twice-test", {
        "target.js": `
          const fs = require("fs");
          const path = require("path");

          fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
          console.log("READY");

          // Keep process alive, exit after a bit
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

      // Call _debugProcess twice - inspector should only activate once
      await using debug1 = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      await debug1.exited;

      await Bun.sleep(50);

      await using debug2 = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      await debug2.exited;

      const [stderr, exitCode] = await Promise.all([targetProc.stderr.text(), targetProc.exited]);

      // Should only see one "Debugger listening" message
      const matches = stderr.match(/Debugger listening/g);
      expect(matches?.length ?? 0).toBe(1);
      expect(exitCode).toBe(0);
    });

    test("can activate inspector in multiple independent processes", async () => {
      using dir = tempDir("debug-process-multi-test", {
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

      // Start two independent target processes
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

      // Wait for both to be ready
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

      // Activate inspector in both processes
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

      // Both should have activated their inspector
      expect(stderr1).toContain("Debugger listening");
      expect(stderr2).toContain("Debugger listening");
      expect(exitCode1).toBe(0);
      expect(exitCode2).toBe(0);
    });

    test("throws when called with no arguments", async () => {
      await using proc = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess()`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("requires a pid argument");
    });
  });

  // Windows-specific tests (file mapping mechanism)
  describe.skipIf(!isWindows)("Windows file mapping", () => {
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

      await Bun.sleep(100);

      targetProc.kill();
      const [targetStderr] = await Promise.all([targetProc.stderr.text(), targetProc.exited]);

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

      // Call _debugProcess twice
      await using debug1 = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      await debug1.exited;

      await Bun.sleep(50);

      await using debug2 = spawn({
        cmd: [bunExe(), "-e", `process._debugProcess(${pid})`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      await debug2.exited;

      const [stderr, exitCode] = await Promise.all([targetProc.stderr.text(), targetProc.exited]);

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

  // POSIX-specific tests (SIGUSR1 mechanism)
  describe.skipIf(isWindows)("SIGUSR1", () => {
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
});
