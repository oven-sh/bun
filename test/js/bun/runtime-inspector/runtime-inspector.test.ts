import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Cross-platform tests - run on ALL platforms (Windows, macOS, Linux)
// Windows uses file mapping mechanism, POSIX uses SIGUSR1
describe("Runtime inspector activation", () => {
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
});
