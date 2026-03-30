import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { readdirSync, readFileSync } from "fs";

function getProcessVoluntaryCtxSwitches(pid: number): number {
  let total = 0;
  const taskDir = `/proc/${pid}/task`;
  const threads = readdirSync(taskDir);
  for (const tid of threads) {
    const status = readFileSync(`${taskDir}/${tid}/status`, "utf8");
    const match = status.match(/^voluntary_ctxt_switches:\s+(\d+)/m);
    if (match) total += parseInt(match[1]);
  }
  return total;
}

test.skipIf(process.platform !== "linux")(
  "idle process should have minimal context switches",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "setTimeout(() => {}, 30000)"],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stdout: "ignore",
      stderr: "ignore",
    });

    const pid = proc.pid;

    // Let startup settle
    await Bun.sleep(3000);

    const before = getProcessVoluntaryCtxSwitches(pid);
    await Bun.sleep(5000);
    const after = getProcessVoluntaryCtxSwitches(pid);

    proc.kill();
    await proc.exited;

    const switchesDuringIdle = after - before;

    // Before fix: ~200+ voluntary context switches in 5 seconds across all
    // threads due to the GC repeating timer calling collectAsync() every
    // second even when the heap hasn't changed, waking 7+ HeapHelper threads.
    // After fix: single-digit context switches because collectAsync() is
    // skipped when the heap is stable.
    expect(switchesDuringIdle).toBeLessThan(100);
  },
  15000,
);
