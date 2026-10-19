// Kept separate from parallel.test.ts for the reason parallel-startup-failure.test.ts gives:
// file-level pass/fail is what the surrounding tooling checks, and that file has cases that
// depend on how fast a debug build starts its workers.

import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// With every worker in the middle of a file, nothing arrives on the coordinator's loop, and the
// poll it waits in is not ended by a signal: it retries on EINTR. A handler that only records
// the signal is then acted on when something else turns the loop, and a timer does that once a
// second. So the signal has to land just after such a turn, not just before the next one.
//
// On Linux a turn shows as a voluntary context switch of the coordinator. Other platforms do
// not show it, and a signal at a random point of that second is acted on within the limit half
// of the time with no wakeup at all: the test runs on Linux only.
async function waitForCoordinatorToPark(pid: number) {
  const switches = () =>
    Number(/voluntary_ctxt_switches:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))![1]);
  const deadline = Date.now() + 3000;
  const before = switches();
  while (switches() === before && Date.now() < deadline) await Bun.sleep(1);
  let last = switches();
  let quietSince = Date.now();
  while (Date.now() - quietSince < 100 && Date.now() < deadline) {
    await Bun.sleep(1);
    const now = switches();
    if (now !== last) {
      last = now;
      quietSince = Date.now();
    }
  }
}

test.skipIf(!isLinux).concurrent.each([
  ["SIGTERM", 143],
  ["SIGINT", 130],
] as const)("--parallel: the coordinator acts on %s at once while every worker is mid-file", async (signal, code) => {
  const fixture = `
      import { test } from "bun:test";
      import { appendFileSync } from "fs";
      test("slow", async () => {
        appendFileSync(process.env.PIDS, process.pid + "\\n");
        await Bun.sleep(60000);
      });
    `;
  using dir = tempDir("parallel-signal", { "a.test.ts": fixture, "b.test.ts": fixture });
  const pids = String(dir) + "/pids.txt";

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "--parallel-delay=0"],
    env: { ...bunEnv, PIDS: pids },
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });

  const workersRunning = () => {
    try {
      return readFileSync(pids, "utf8").split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  };
  while (workersRunning() < 2 && proc.exitCode === null) await Bun.sleep(10);
  expect(workersRunning()).toBe(2);
  await waitForCoordinatorToPark(proc.pid);

  // "Interrupted" is the first thing the coordinator prints once it has seen the signal. The
  // time up to that leaves out how long the processes take to go away.
  const stderr = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const start = performance.now();
  proc.kill(signal);
  while (!seen.includes("Interrupted")) {
    const { value, done } = await stderr.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
  }
  const reactedAfterMs = performance.now() - start;

  expect(seen).toContain("Interrupted");
  expect(reactedAfterMs).toBeLessThan(500);
  expect(await proc.exited).toBe(code);
});
