import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// On Linux, JSC's GC uses SIGPWR to suspend/resume threads for conservative
// stack scanning. Bun.openInEditor spawns a detached thread that runs the
// internal sync-spawn path, which installs a temporary signal-forwarding
// handler for the signals it knows about. If SIGPWR is in that set,
// concurrent register/unregister races on the shared previous_actions[]
// array leave the SIGPWR disposition as SIG_DFL, and the next GC suspend
// terminates the process with SIGPWR.
test.skipIf(process.platform !== "linux")(
  "sync-spawn signal forwarding does not override the GC's SIGPWR handler",
  async () => {
    const script = `
      for (let i = 0; i < 100; i++) {
        try { Bun.openInEditor("/tmp/__nonexistent__"); } catch {}
      }
      await Bun.sleep(200);
      for (let g = 0; g < 100; g++) {
        new Array(10000).fill({ x: g });
        Bun.gc(true);
      }
      process.exit(0);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      // Empty PATH / no EDITOR so auto-detect picks Editor::None and the
      // background thread's posix_spawn fails immediately instead of
      // launching a real editor.
      env: { ...bunEnv, PATH: "", EDITOR: "", VISUAL: "" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(proc.signalCode).not.toBe("SIGPWR");
    expect(proc.signalCode).toBeNull();
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
);
