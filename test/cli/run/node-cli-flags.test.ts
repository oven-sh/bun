import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";

describe("--preserve-symlinks", () => {
  test.concurrent("required symlink reports the symlink path as __filename", async () => {
    using dir = tempDir("preserve-symlinks-require", {
      "real.cjs": `module.exports = __filename;`,
      "main.cjs": `console.log(require("./link.cjs"));`,
    });
    symlinkSync(join(String(dir), "real.cjs"), join(String(dir), "link.cjs"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preserve-symlinks", "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(join(String(dir), "link.cjs"));
    expect(exitCode).toBe(0);
  });

  test.concurrent("without the flag, required symlink realpaths __filename", async () => {
    using dir = tempDir("preserve-symlinks-off", {
      "real.cjs": `module.exports = __filename;`,
      "main.cjs": `console.log(require("./link.cjs"));`,
    });
    symlinkSync(join(String(dir), "real.cjs"), join(String(dir), "link.cjs"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(join(String(dir), "real.cjs"));
    expect(exitCode).toBe(0);
  });

  test.concurrent("--preserve-symlinks-main keeps the symlink path for the entry point", async () => {
    using dir = tempDir("preserve-symlinks-main", {
      "real.cjs": `console.log(__filename);`,
    });
    symlinkSync(join(String(dir), "real.cjs"), join(String(dir), "link.cjs"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preserve-symlinks-main", "link.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(join(String(dir), "link.cjs"));
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!isPosix)("SIGUSR1 default disposition", () => {
  test.concurrent("SIGUSR1 does not terminate the process by default", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.kill(process.pid, "SIGUSR1");
         setImmediate(() => { console.log("survived"); process.exit(0); });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("survived");
    expect(exitCode).toBe(0);
    expect(proc.signalCode).toBeNull();
  });

  test.concurrent("SIGUSR1 stays inert after the last listener is removed", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const fn = () => {};
         process.on("SIGUSR1", fn);
         process.removeListener("SIGUSR1", fn);
         process.kill(process.pid, "SIGUSR1");
         setImmediate(() => { console.log("survived"); process.exit(0); });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("survived");
    expect(exitCode).toBe(0);
  });

  test.concurrent.skipIf(!isLinux)("SIGUSR1 is handled, not SIG_IGN, so exec()'d children revert to SIG_DFL", async () => {
    // Bun's own spawn path resets every signal to SIG_DFL in the child, so a
    // spawned-process probe cannot distinguish a handler from SIG_IGN. Read
    // the parent process's SigIgn mask directly instead.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const status = require("node:fs").readFileSync("/proc/self/status", "utf8");
         const sigIgn = BigInt("0x" + status.match(/^SigIgn:\\s+([0-9a-f]+)/m)[1]);
         const SIGUSR1 = require("node:os").constants.signals.SIGUSR1;
         console.log(((sigIgn >> BigInt(SIGUSR1 - 1)) & 1n).toString());`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("0");
    expect(exitCode).toBe(0);
  });
});
