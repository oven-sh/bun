import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// The detached editor thread spawned by Bun.openInEditor must not mutate process-wide
// signal state. It used to run bun.spawnSync's signal-forwarding setup, which is only
// safe on the main thread: concurrent openInEditor calls raced on the shared
// previous_actions[] array and flipped unrelated signal dispositions process-wide
// (installing a one-shot forwarding handler, then resetting them to SIG_DFL), which can
// get the process killed by a stray signal while the GC suspend signal (SIGPWR) is in
// flight. Sample the process's caught-signal mask (SigCgt in /proc/self/status) while
// hammering openInEditor and assert it never changes.
test.skipIf(!isLinux)("concurrent Bun.openInEditor calls do not touch process signal handlers", async () => {
  const sleep = ["/usr/bin/sleep", "/bin/sleep"].find(p => existsSync(p));
  expect(sleep).toBeDefined();

  using dir = tempDir("open-in-editor-signals", {
    "storm.js": `
      const { readFileSync } = require("node:fs");
      const sleepBin = process.argv[2];
      function caughtMask() {
        const status = readFileSync("/proc/self/status", "utf8");
        const line = status.split("\\n").find(l => l.startsWith("SigCgt:"));
        return BigInt("0x" + line.slice("SigCgt:".length).trim());
      }
      // Warm-up: let any lazy one-time handler installation happen before baselining.
      try { Bun.openInEditor("0.05", { editor: sleepBin }); } catch {}
      await Bun.sleep(150);
      const baseline = caughtMask();
      let changed = 0n;
      // Each call spawns a detached editor thread that runs \`sleep 0.15\` and waits for
      // it, so dozens of editor threads overlap.
      for (let i = 0; i < 64; i++) {
        try { Bun.openInEditor("0.15", { editor: sleepBin }); } catch {}
        if ((i & 7) === 0) changed |= baseline ^ caughtMask();
      }
      // Keep sampling while the editor threads drain.
      for (let i = 0; i < 150; i++) {
        changed |= baseline ^ caughtMask();
        await Bun.sleep(5);
      }
      // Force GC (which uses SIGPWR on Linux to suspend/resume threads) to prove the
      // process still survives it.
      Bun.gc(true);
      const changedSignals = [];
      for (let sig = 1; sig <= 64; sig++) {
        if (changed & (1n << BigInt(sig - 1))) changedSignals.push(sig);
      }
      console.log("CHANGED:" + JSON.stringify(changedSignals));
      console.log("ALIVE");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "storm.js", sleep!],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("ALIVE");
  const changedLine = stdout.match(/^CHANGED:(.*)$/m);
  expect(changedLine).not.toBeNull();
  const changed = JSON.parse(changedLine![1]);
  expect(changed).toEqual([]);
  expect(stderr).toBe("");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

// On Linux, JSC uses SIGPWR to suspend/resume threads for GC and the libpas
// scavenger. Bun.openInEditor spawns a detached thread that used to go through
// bun.spawnSync, whose signal-forwarding setup must not touch SIGPWR or the
// process is terminated the next time GC/scavenger fires.
test.skipIf(!isLinux)("Bun.openInEditor does not break GC signal handling", async () => {
  const sleep = ["/usr/bin/sleep", "/bin/sleep"].find(p => existsSync(p));
  expect(sleep).toBeDefined();

  using dir = tempDir("open-in-editor-gc", {
    "run.js": `
      const a = ${JSON.stringify(sleep)};
      const b = process.argv[2];
      // Alternate absolute editor paths so the cached editor name_storage is
      // replaced each call while a detached editor thread may still be
      // reading the previous one.
      for (let i = 0; i < 8; i++) {
        try { Bun.openInEditor("0.3", { editor: i % 2 ? b : a }); } catch {}
      }
      // Wait for the detached editor threads to complete their register /
      // unregister cycle, then for the scavenger to fire SIGPWR.
      await Bun.sleep(1000);
      Bun.gc(true);
      console.log("alive");
    `,
  });
  // Second absolute path to the same binary so alternating calls take the
  // `!eql_long(prev_name, ...)` branch in open_in_editor. Keep the basename
  // `sleep` so BusyBox (Alpine) resolves the multi-call applet from argv[0].
  const sleep2 = join(String(dir), "sleep");
  symlinkSync(sleep!, sleep2);

  const runs = Array.from({ length: 5 }, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.js", sleep2],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("alive");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });

  await Promise.all(runs);
});
