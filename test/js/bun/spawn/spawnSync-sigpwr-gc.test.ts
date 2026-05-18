import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, isLinux } from "harness";
import { join } from "path";
import { symlinkSync } from "fs";

// Regression: spawnSync's signal-forwarding list included SIGPWR on Linux.
// JSC uses SIGPWR to suspend/resume threads for GC. Bun.openInEditor spawns a
// detached thread per call that runs spawnSync; concurrent calls race on the
// process-wide previous-handler table and can leave SIGPWR at SIG_DFL. The
// next GC suspend then terminates the process with signal 30.
test.skipIf(!isLinux)(
  "spawnSync signal forwarding does not clobber JSC's SIGPWR handler",
  async () => {
    const sleepBin = Bun.which("sleep");
    expect(sleepBin).toBeTruthy();

    using dir = tempDir("spawnSync-sigpwr", {
      "run.js": `
for (let i = 0; i < 64; i++) {
  try { Bun.openInEditor("0.2"); } catch {}
}
let junk = [];
for (let i = 0; i < 2000; i++) {
  junk.push({ a: new Uint8Array(4096).fill(i), b: { c: i } });
}
for (let i = 0; i < 30; i++) Bun.gc(true);
console.log("ok");
`,
    });
    // Make `code` (first in the editor preference list) resolve to `sleep`, so
    // each background spawnSync holds its signal-forwarding window open long
    // enough for threads to overlap.
    symlinkSync(sleepBin!, join(String(dir), "code"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "run.js")],
      env: {
        ...bunEnv,
        PATH: String(dir),
        EDITOR: "",
        VISUAL: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(proc.signalCode).toBeNull();
    expect(stderr).not.toContain("AddressSanitizer");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  },
);
