import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// On Linux, JSC uses SIGPWR to suspend/resume threads for GC and the libpas
// scavenger. Bun.openInEditor spawns a detached thread that goes through
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

// Fuzzer-found: with no editor detectable at all, every Bun.openInEditor call
// still runs a spawn attempt on a detached thread. Thousands of such calls
// racing GC (which suspends threads with SIGPWR on Linux) must not corrupt
// process-wide signal state or take down the process.
test.skipIf(!isLinux)("Bun.openInEditor with no detectable editor survives a call storm with GC", async () => {
  const env = { ...bunEnv, PATH: "/does-not-exist" };
  delete env.EDITOR;
  delete env.VISUAL;

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function churn() {
        let junk = [];
        for (let i = 0; i < 2000; i++) junk.push({ i, s: "s" + i });
        return junk;
      }
      for (let batch = 0; batch < 30; batch++) {
        for (let i = 0; i < 50; i++) {
          try { Bun.openInEditor("/dev/null"); } catch {}
        }
        churn();
        Bun.gc(false);
      }
      Bun.gc(true);
      console.log("alive");
      `,
    ],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("alive");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});
