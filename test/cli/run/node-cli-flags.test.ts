import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, isWindows, tempDir } from "harness";
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

  test.concurrent("child processes do not inherit an ignored SIGUSR1", async () => {
    // Node.js installs a handler (reset to SIG_DFL on exec), not SIG_IGN
    // (which would be inherited). A spawned `sh` must still be killable by
    // SIGUSR1.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { spawnSync } = require("node:child_process");
         const r = spawnSync("sh", ["-c", "kill -USR1 $$; sleep 5"]);
         console.log(r.signal);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("SIGUSR1");
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(isWindows)("--heapsnapshot-signal", () => {
  // V8 heap snapshot generation under a debug+ASAN build is slow.
  test.concurrent(
    "writes a heap snapshot when the signal is received",
    async () => {
      using dir = tempDir("heapsnapshot-signal", {});
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--heapsnapshot-signal=SIGUSR2",
          "-e",
          `process.kill(process.pid, "SIGUSR2");
           // The snapshot is written from a signal listener on the next tick;
           // give the event loop one turn, then exit.
           setImmediate(() => setImmediate(() => { console.log("survived"); process.exit(0); }));`,
        ],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("survived");
      expect(exitCode).toBe(0);
      expect(proc.signalCode).toBeNull();

      const files = Array.from(new Bun.Glob("Heap-*.heapsnapshot").scanSync({ cwd: String(dir) }));
      expect(files.length).toBe(1);
      const stat = await Bun.file(join(String(dir), files[0])).stat();
      expect(stat.size).toBeGreaterThan(0);
    },
    30_000,
  );

  test.concurrent("--heapsnapshot-signal appears in process.execArgv", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--heapsnapshot-signal", "SIGUSR2", "-e", `console.log(JSON.stringify(process.execArgv));`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // Node.js includes the space-separated value as its own element, and
    // also includes -e and its script in execArgv.
    expect(JSON.parse(stdout).slice(0, 2)).toEqual(["--heapsnapshot-signal", "SIGUSR2"]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("rejects an unknown signal name", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--heapsnapshot-signal=NOTREAL", "-e", `0`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Unknown signal: NOTREAL");
    expect(exitCode).not.toBe(0);
  });
});
