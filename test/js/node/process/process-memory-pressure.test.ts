import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// process.on("memoryPressure") is a Bun extension. These tests drive the
// emit path synthetically via bun:internal-for-testing since real OS memory
// pressure cannot be induced reliably (and PSI trigger creation requires
// CAP_SYS_RESOURCE on Linux kernels before 6.6, which CI containers lack).

async function run(src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("process.on('memoryPressure')", () => {
  test("listener receives level argument", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const { emitMemoryPressure } = require("bun:internal-for-testing");
      const seen = [];
      process.on("memoryPressure", level => seen.push(level));
      emitMemoryPressure("warning");
      emitMemoryPressure("critical");
      process.stdout.write(JSON.stringify(seen));
    `);
    expect({ stdout, stderr: stderr.trim() }).toEqual({
      stdout: JSON.stringify(["warning", "critical"]),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("arms on first listener and disarms on last removal", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const { emitMemoryPressure, isMemoryPressureWatcherInstalled } = require("bun:internal-for-testing");
      const seen = [];
      const installed = [];
      const a = level => seen.push("a:" + level);
      const b = level => seen.push("b:" + level);
      installed.push(isMemoryPressureWatcherInstalled()); // false: no listeners yet
      process.on("memoryPressure", a);
      installed.push(isMemoryPressureWatcherInstalled()); // true: first listener armed it
      process.on("memoryPressure", b);
      installed.push(isMemoryPressureWatcherInstalled()); // true: still armed
      emitMemoryPressure("warning");
      process.off("memoryPressure", a);
      installed.push(isMemoryPressureWatcherInstalled()); // true: one listener left
      emitMemoryPressure("critical");
      process.off("memoryPressure", b);
      installed.push(isMemoryPressureWatcherInstalled()); // false: last listener removed
      // No listeners registered; emit should be a no-op.
      emitMemoryPressure("critical");
      // Re-arm and emit again to prove the watcher can be reinstalled.
      process.on("memoryPressure", a);
      installed.push(isMemoryPressureWatcherInstalled()); // true: re-armed
      emitMemoryPressure("warning");
      process.off("memoryPressure", a);
      installed.push(isMemoryPressureWatcherInstalled()); // false: disarmed again
      process.stdout.write(JSON.stringify({ seen, installed }));
    `);
    expect({ stdout, stderr: stderr.trim() }).toEqual({
      stdout: JSON.stringify({
        seen: ["a:warning", "b:warning", "b:critical", "a:warning"],
        installed: [false, true, true, true, false, true, false],
      }),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("process.once works", async () => {
    const { stdout, exitCode } = await run(/* js */ `
      const { emitMemoryPressure } = require("bun:internal-for-testing");
      const seen = [];
      process.once("memoryPressure", level => seen.push(level));
      emitMemoryPressure("critical");
      emitMemoryPressure("critical");
      process.stdout.write(JSON.stringify(seen));
    `);
    expect(stdout).toBe(JSON.stringify(["critical"]));
    expect(exitCode).toBe(0);
  });

  test("listener does not keep the event loop alive", async () => {
    const { stdout, exitCode } = await run(/* js */ `
      process.on("memoryPressure", () => {});
      process.stdout.write("done");
    `);
    expect(stdout).toBe("done");
    expect(exitCode).toBe(0);
  });

  test("removing on exit does not crash", async () => {
    const { stdout, exitCode } = await run(/* js */ `
      const h = () => {};
      process.on("memoryPressure", h);
      process.on("exit", () => {
        process.off("memoryPressure", h);
        process.stdout.write("exit");
      });
      process.stdout.write("done ");
    `);
    expect(stdout).toBe("done exit");
    expect(exitCode).toBe(0);
  });
});
