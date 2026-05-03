// https://github.com/oven-sh/bun/issues/21081
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";

function getProcessVoluntaryCtxSwitches(pid: number): number {
  let total = 0;
  const taskDir = `/proc/${pid}/task`;
  let threads: string[];
  try {
    threads = readdirSync(taskDir);
  } catch (err: any) {
    if (err?.code === "ENOENT") return 0;
    throw err;
  }
  for (const tid of threads) {
    try {
      const status = readFileSync(`${taskDir}/${tid}/status`, "utf8");
      const match = status.match(/^voluntary_ctxt_switches:\s+(\d+)/m);
      if (match) total += Number.parseInt(match[1], 10);
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
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
    expect(switchesDuringIdle).toBeLessThan(100);
  },
  15000,
);
