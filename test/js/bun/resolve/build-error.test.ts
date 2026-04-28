import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("BuildError is modifiable", async () => {
  try {
    await import("../util/inspect-error-fixture-bad.js");
    expect.unreachable();
  } catch (e) {
    var error: BuildMessage = e as BuildMessage;
    if (error.name !== "BuildMessage") {
      throw new Error("Expected BuildMessage, got " + error.name);
    }
  }

  const message = error!.message;
  // @ts-ignore
  expect(() => (error!.message = "new message")).not.toThrow();
  expect(error!.message).toBe("new message");
  expect(error!.message).not.toBe(message);
});

// BuildMessage is heap-allocated via allocator.create() in BuildMessage.create().
// finalize() must destroy the struct itself, not just the inner logger.Msg.
// Without the destroy, every transpile error leaked the native struct after GC
// collected the JS wrapper. ResolveMessage had the same bug; both are fixed.
test(
  "BuildMessage does not leak native struct",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--smol",
        "-e",
        /* js */ `
          const t = new Bun.Transpiler();
          function once() {
            try { t.transformSync("const x = ;"); } catch {}
          }
          // Warm up the JSC heap / mimalloc arenas enough to reach steady state
          // so that RSS growth below reflects actual leaks rather than heap
          // expansion.
          for (let i = 0; i < 10000; i++) once();
          Bun.gc(true);
          await Bun.sleep(10);
          Bun.gc(true);
          const before = process.memoryUsage.rss();
          for (let i = 0; i < 100000; i++) once();
          Bun.gc(true);
          await Bun.sleep(10);
          Bun.gc(true);
          const growthMB = (process.memoryUsage.rss() - before) / 1024 / 1024;
          if (growthMB > 15) throw new Error("leaked " + growthMB.toFixed(2) + "MB");
          console.log("OK", growthMB.toFixed(2) + "MB");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("OK");
    expect(exitCode).toBe(0);
  },
  180_000,
);
