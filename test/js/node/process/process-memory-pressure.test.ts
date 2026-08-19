import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { closeSync, constants, existsSync, openSync, readFileSync, writeSync } from "node:fs";

// process.on("memoryPressure") is a Bun extension. Real OS memory pressure
// cannot be induced reliably, so these tests drive the emit path through
// bun:internal-for-testing. The tests that set up a real OS source first
// check that this process may use that source (a PSI trigger needs
// CAP_SYS_RESOURCE before kernel 6.4, and most CI containers deny writes to
// /proc/pressure), and are skipped otherwise.

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

// The cgroup v2 file Bun would use: the one in the cgroup named by the 0::
// line of /proc/self/cgroup, or the one at the mount root when that path is
// not visible from here (a container that shares the host's cgroup namespace).
function ownCgroupFile(name: string): string | undefined {
  if (!isLinux) return undefined;
  let cgroup: string;
  try {
    cgroup = readFileSync("/proc/self/cgroup", "utf8");
  } catch {
    return undefined;
  }
  const entry = cgroup.split("\n").find(line => line.startsWith("0::"));
  if (entry === undefined) return undefined;
  const rest = entry.slice("0::".length).replace(/^\//, "");
  const own = `/sys/fs/cgroup/${rest}${rest ? "/" : ""}${name}`;
  if (rest && existsSync(own)) return own;
  const root = `/sys/fs/cgroup/${name}`;
  return existsSync(root) ? root : undefined;
}

function canArmPsiTriggerAt(path: string | undefined): boolean {
  if (path === undefined) return false;
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
// added: the system-wide PSI file, then this process's own cgroup file.
const canArmPsiTrigger =
  isLinux && (canArmPsiTriggerAt("/proc/pressure/memory") || canArmPsiTriggerAt(ownCgroupFile("memory.pressure")));

// memory.events exists in every cgroup except the root, and reading it is
// enough: the notification comes from kernfs, not from a trigger we write.
const canReadCgroupEvents = (() => {
  const path = ownCgroupFile("memory.events");
  if (path === undefined) return false;
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
})();

// Every injected counter sits this far above anything the real file can hold.
// The real file stays polled while a test injects, so a real notification
// that lands between two steps reads as lower counts and changes nothing.
const FAR_ABOVE_REAL = 1_000_000_000_000;

function memoryEvents(
  counters: Partial<Record<"low" | "high" | "max" | "oom" | "oom_kill" | "oom_group_kill", number>>,
) {
  const all = { low: 0, high: 0, max: 0, oom: 0, oom_kill: 0, oom_group_kill: 0, ...counters };
  return Object.entries(all)
    .map(([key, value]) => `${key} ${FAR_ABOVE_REAL + value}\n`)
    .join("");
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

  // Which real OS sources the first listener sets up, and that the last
  // removal tears them down again. Each source is asserted only where this
  // test process has just confirmed the OS allows it.
  const expectedSources = [...(canArmPsiTrigger ? ["psi"] : []), ...(canReadCgroupEvents ? ["cgroup"] : [])];
  test.skipIf(expectedSources.length === 0)(`first listener arms ${expectedSources.join(" and ")}`, async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const { memoryPressureArmedSources } = require("bun:internal-for-testing");
      const h = () => {};
      const before = memoryPressureArmedSources();
      process.on("memoryPressure", h);
      const armed = memoryPressureArmedSources();
      process.off("memoryPressure", h);
      const after = memoryPressureArmedSources();
      process.stdout.write(JSON.stringify({ before, armed, after }));
    `);
    expect(stderr.trim()).toBe("");
    const { before, armed, after } = JSON.parse(stdout);
    // The child may be allowed a source this process could not probe, so
    // only the probed sources are required. Anything else must be the other
    // Linux source, at most once.
    expect({
      before,
      after,
      armed: expectedSources.filter(source => armed.includes(source)),
      unexpected: armed.filter(
        (source: string, i: number) => !["psi", "cgroup"].includes(source) || armed.indexOf(source) !== i,
      ),
    }).toEqual({ before: [], after: [], armed: expectedSources, unexpected: [] });
    expect(exitCode).toBe(0);
  });

  // The counters in memory.events only grow, and the kernel signals the file
  // on every change. The first injection replaces the counters Bun read from
  // the real file when it armed, so the real values do not matter here, and
  // the clock argument drives the 2 s holdoff, so nothing here waits.
  test.skipIf(!canReadCgroupEvents)("cgroup memory.events changes map to levels with a holdoff", async () => {
    // Each step: [file content, holdoff clock in ms, levels the listener must see].
    // The counters accumulate from step to step, as they do in the real file.
    // A null content removes and re-adds the listener, which sets up a new source.
    const steps: [string | null, number | null, string[]][] = [];
    let counters: Parameters<typeof memoryEvents>[0] = {};
    const moved = (changed: typeof counters, atMs: number, emitted: string[], extraLines = "") => {
      counters = { ...counters, ...changed };
      steps.push([extraLines + memoryEvents(counters), atMs, emitted]);
    };
    moved({ high: 5, oom_kill: 1 }, 0, []); // the counts from before the listener existed
    moved({ high: 6 }, 0, ["warning"]); // reclaim at memory.high
    moved({ high: 7 }, 0, []); // another one inside the warning holdoff
    moved({ oom: 1 }, 0, ["critical"]); // a warning does not hold off an OOM
    moved({ oom_kill: 2 }, 0, []); // another OOM inside the critical holdoff
    moved({ max: 1 }, 1000, []); // reclaim inside both holdoffs
    moved({ low: 1 }, 2000, ["warning"]); // reclaim once exactly the holdoff has passed
    moved({ oom_group_kill: 1 }, 2000, ["critical"]); // an OOM 2 s after the previous one
    moved({ oom: 2 }, 4000, ["critical"]); // an OOM 2 s after that one
    moved({ max: 2 }, 5000, []); // reclaim 3 s after the last warning, but 1 s after a critical
    moved({}, 9000, [], "some_future_counter 7\n"); // a counter Bun does not classify moved
    moved({ high: 8 }, 9000, ["warning"], "no_value\nsome_future_counter x\n"); // bad lines are skipped, the rest still counts
    steps.push([memoryEvents({ high: 1 }), 9000, []]); // a short read: below the counts already seen
    steps.push([null, 0, []]);
    steps.push([memoryEvents({}), null, []]); // the new source takes its baseline from the first injection (atMs omitted)
    steps.push([memoryEvents({ high: 1 }), 0, ["warning"]]); // and starts with no holdoff
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const { memoryPressureInjectCgroupEvents } = require("bun:internal-for-testing");
      const emitted = [];
      const listener = level => emitted.push(level);
      process.on("memoryPressure", listener);
      const results = [];
      for (const [body, atMs] of ${JSON.stringify(steps.map(([body, atMs]) => [body, atMs]))}) {
        let injected = null;
        if (body === null) {
          // No turn of the event loop between here and the next injection, so
          // the new source never polls the real file before it has its baseline.
          process.off("memoryPressure", listener);
          process.on("memoryPressure", listener);
        } else {
          injected = memoryPressureInjectCgroupEvents(body, atMs ?? undefined);
          // The source queues the event on the event loop. Let it run.
          await new Promise(resolve => setImmediate(resolve));
        }
        results.push({ injected, emitted: emitted.splice(0) });
      }
      process.stdout.write(JSON.stringify(results));
    `);
    expect(stderr.trim()).toBe("");
    expect(JSON.parse(stdout)).toEqual(
      steps.map(([body, , emitted]) => ({ injected: body === null ? null : true, emitted })),
    );
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
