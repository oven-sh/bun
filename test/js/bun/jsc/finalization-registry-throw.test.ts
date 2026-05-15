import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe.concurrent("FinalizationRegistry", () => {
  test("throwing from cleanup callback routes to uncaughtException", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let caught;
        process.on("uncaughtException", e => { caught = e; });
        const fr = new FinalizationRegistry(() => {
          throw new TypeError("from cleanup callback");
        });
        (function register() { fr.register({ a: 1 }, "held"); })();
        let ticks = 0;
        function tick() {
          Bun.gc(true);
          if (caught) {
            console.log("CAUGHT", caught.message);
            return;
          }
          if (++ticks > 50) {
            console.log("SKIPPED");
            return;
          }
          setImmediate(tick);
        }
        tick();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("ASSERTION FAILED");
    expect(stderr).not.toContain("releaseAssertNoException");
    expect(exitCode).toBe(0);
    // GC timing is non-deterministic; if the callback ran it must have been
    // routed through uncaughtException rather than crashing the process.
    if (!stdout.includes("SKIPPED")) {
      expect(stdout).toContain("CAUGHT from cleanup callback");
    }
  });

  test("throwing from cleanup callback without handler does not crash", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fr = new FinalizationRegistry(() => { ArrayBuffer(); });
        (function register() { fr.register({ a: 1 }, "held"); })();
        let ticks = 0;
        function tick() {
          Bun.gc(true);
          if (++ticks > 50) return;
          setImmediate(tick);
        }
        tick();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("ASSERTION FAILED");
    expect(stderr).not.toContain("releaseAssertNoException");
    // Process must exit normally (not abort via signal).
    expect(exitCode).not.toBeNull();
    expect(proc.signalCode).toBeNull();
  });
});
