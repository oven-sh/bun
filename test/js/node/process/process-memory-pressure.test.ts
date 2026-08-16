import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { closeSync, constants, openSync, readFileSync, writeSync } from "node:fs";

// process.on("memoryPressure") is a Bun extension. These tests drive the
// emit path synthetically via bun:internal-for-testing since real OS memory
// pressure cannot be induced reliably (and PSI trigger creation requires
// CAP_SYS_RESOURCE on Linux kernels before 6.6, which CI containers lack).
// The one test that arms a real PSI trigger first checks that this process
// is allowed to create one, and is skipped otherwise.

async function run(src: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function canArmPsiTriggerAt(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);
  } catch {
    return false;
  }
  try {
    // The trigger format from Documentation/accounting/psi.rst. The kernel
    // sample writes strlen + 1 bytes, so the NUL is part of the write.
    writeSync(fd, Buffer.from("some 150000 2000000\0"));
    return true;
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

// The same two files, in the same order, that Bun tries when a listener is
// added: the system-wide PSI file, then this process's own cgroup v2 file.
function canArmPsiTrigger(): boolean {
  if (!isLinux) return false;
  if (canArmPsiTriggerAt("/proc/pressure/memory")) return true;
  let cgroup: string;
  try {
    cgroup = readFileSync("/proc/self/cgroup", "utf8");
  } catch {
    return false;
  }
  const entry = cgroup.split("\n").find(line => line.startsWith("0::"));
  if (entry === undefined) return false;
  const rest = entry.slice("0::".length).replace(/^\//, "");
  return canArmPsiTriggerAt(`/sys/fs/cgroup/${rest}${rest ? "/" : ""}memory.pressure`);
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

  // psi_write() in kernel/sched/psi.c overwrites the last byte of the write
  // with NUL before it parses the trigger. A write without its own NUL loses
  // the last digit of the window, and the kernel rejects the trigger.
  test.skipIf(!isLinux)("the PSI trigger write ends in NUL", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const { memoryPressurePsiTrigger } = require("bun:internal-for-testing");
      process.stdout.write(memoryPressurePsiTrigger());
    `);
    expect(stderr.trim()).toBe("");
    expect(stdout).toMatch(/^(some|full) \d+ \d+\0$/);
    // The other two rules psi_trigger_create() applies to an unprivileged
    // writer: the threshold fits in the window, and the window is N * 2 s.
    const [, thresholdUs, windowUs] = stdout.slice(0, -1).split(" ").map(Number);
    expect({
      thresholdFitsWindow: thresholdUs <= windowUs,
      windowRemainderUs: windowUs % 2_000_000,
    }).toEqual({ thresholdFitsWindow: true, windowRemainderUs: 0 });
    expect(exitCode).toBe(0);
  });

  test.skipIf(!canArmPsiTrigger())("first listener arms a PSI trigger on Linux", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const { memoryPressureWatcherHasOsBackend } = require("bun:internal-for-testing");
      const h = () => {};
      const before = memoryPressureWatcherHasOsBackend();
      process.on("memoryPressure", h);
      const armed = memoryPressureWatcherHasOsBackend();
      process.off("memoryPressure", h);
      const after = memoryPressureWatcherHasOsBackend();
      process.stdout.write(JSON.stringify({ before, armed, after }));
    `);
    expect({ stdout, stderr: stderr.trim() }).toEqual({
      stdout: JSON.stringify({ before: false, armed: true, after: false }),
      stderr: "",
    });
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

// BUN_FEATURE_FLAG_EXPERIMENTAL_MEMORY_PRESSURE_HANDLER makes Bun itself react
// to the notification (sync GC + JSC shrinkFootprint + mi_collect) before the
// JS event is emitted, and keeps the OS watch armed for the whole process.
describe.concurrent("BUN_FEATURE_FLAG_EXPERIMENTAL_MEMORY_PRESSURE_HANDLER", () => {
  const handlerEnv = { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_MEMORY_PRESSURE_HANDLER: "1" };

  test("a notification collects garbage before listeners run", async () => {
    // The WeakRef referent is the deterministic signal that a full
    // synchronous collection ran inside emit(): by the time the listener is
    // called it must already be gone. Heap-size deltas are too noisy to
    // assert on. Don't deref() before the notification: per spec that would
    // add the referent to [[KeptAlive]] for the rest of this job.
    const { stdout, stderr, exitCode } = await run(
      /* js */ `
        const { emitMemoryPressure } = require("bun:internal-for-testing");
        function makeRef() { return new WeakRef({ sentinel: true }); }
        const ref = makeRef();
        const seen = [];
        process.on("memoryPressure", level => seen.push({ level, collected: ref.deref() === undefined }));
        emitMemoryPressure("critical");
        process.stdout.write(JSON.stringify(seen));
      `,
      handlerEnv,
    );
    expect({ stdout, stderr: stderr.trim() }).toEqual({
      stdout: JSON.stringify([{ level: "critical", collected: true }]),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("the watch is armed at startup and outlives the last listener", async () => {
    // exitCode 0 with the watch still armed doubles as the keep-alive check:
    // the child ends when the script does, so the watch is not ref'ing the loop.
    const { stdout, stderr, exitCode } = await run(
      /* js */ `
        const { isMemoryPressureWatcherInstalled } = require("bun:internal-for-testing");
        const installed = [isMemoryPressureWatcherInstalled()]; // armed by the flag, no listener needed
        const h = () => {};
        process.on("memoryPressure", h);
        installed.push(isMemoryPressureWatcherInstalled());
        process.off("memoryPressure", h);
        installed.push(isMemoryPressureWatcherInstalled()); // removing the last listener must not disarm it
        process.stdout.write(JSON.stringify(installed));
      `,
      handlerEnv,
    );
    expect({ stdout, stderr: stderr.trim() }).toEqual({
      stdout: JSON.stringify([true, true, true]),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});
