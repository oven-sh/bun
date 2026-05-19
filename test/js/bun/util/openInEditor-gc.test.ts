import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Bun.openInEditor spawns a detached thread that runs sync::spawn, which
// installs signal-forwarding handlers. On Linux the forwarding list used to
// include SIGPWR, which JSC uses for GC thread suspend/resume. Overlapping
// register/unregister calls from multiple editor threads could leave the
// SIGPWR disposition at SIG_DFL, so the next GC-driven SIGPWR killed the
// process with signal 30.
test.skipIf(process.platform !== "linux")(
  "Bun.openInEditor does not clobber the GC thread-suspend signal handler",
  async () => {
    const script = `
      for (let i = 0; i < 30; i++) {
        try { Bun.openInEditor("/tmp/bun-open-in-editor-gc-" + i); } catch {}
      }
      await Bun.sleep(50);
      for (let i = 0; i < 100; i++) {
        new Uint8Array(10000);
        Bun.gc(true);
      }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, PATH: "/nonexistent" },
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await proc.exited;
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  },
);
