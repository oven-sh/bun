// Kept separate from parallel.test.ts for the reason parallel-startup-failure.test.ts gives:
// file-level pass/fail is what the surrounding tooling checks, and that file has cases that
// depend on how fast a debug build starts its workers.

import { expect, test } from "bun:test";
import { closeSync, constants, openSync, readFileSync, readSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { join } from "path";

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
  while (workersRunning() < 2 && proc.exitCode === null && proc.signalCode === null) await Bun.sleep(10);
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

// A test spawns this. It is in the worker's process group, which the coordinator signals, and it
// logs its own SIGTERM: orphaned by then, a zombie would still answer kill(pid, 0).
//
// The sleep is in the background and the shell is in `wait`, which a trapped signal ends at
// once. A shell runs a trap only after its foreground command: a SIGTERM that arrives while
// the shell starts a foreground `sleep 60` would be logged 60 s later.
const spawnedByTest = `trap 'echo terminated >> "$LOG"; kill $!; exit 0' TERM; echo spawned >> "$LOG"; while :; do sleep 60 & wait $!; done`;
const slowTestThatSpawns = `
  import { test } from "bun:test";
  import { appendFileSync } from "fs";
  test("slow", async () => {
    appendFileSync(process.env.LOG, "worker=" + process.pid + "\\n");
    Bun.spawn({
      cmd: ["sh", "-c", ${JSON.stringify(spawnedByTest)}],
      env: process.env,
      stdio: ["ignore", "ignore", "ignore"],
    });
    await Bun.sleep(60000);
  });
`;

function linesOf(log: string, prefix: string) {
  try {
    return readFileSync(log, "utf8")
      .split("\n")
      .filter(line => line.startsWith(prefix));
  } catch {
    return [];
  }
}

// Both workers are in their test, or the coordinator is gone.
async function bothSpawned(log: string, proc: Bun.Subprocess) {
  while (linesOf(log, "spawned").length < 2 && proc.exitCode === null && proc.signalCode === null) await Bun.sleep(10);
  return linesOf(log, "spawned").length === 2;
}

// What the tests spawned has logged the coordinator's SIGTERM. That takes milliseconds: the
// bound only ends a run in which the SIGTERM was never sent.
async function bothTerminated(log: string) {
  for (let i = 0; i < 80 && linesOf(log, "terminated").length < 2; i++) await Bun.sleep(25);
  return linesOf(log, "terminated").length === 2;
}

// Everything the coordinator writes to the FIFO behind `fd`, up to its exit. `fd` is
// O_NONBLOCK: a read with nothing to take fails with EAGAIN, and this looks again.
async function readUntilExit(fd: number, proc: Bun.Subprocess) {
  const chunks: Buffer[] = [];
  const chunk = Buffer.alloc(64 * 1024);
  // Only ends a run in which the coordinator never exits.
  const deadline = Date.now() + 20_000;
  for (;;) {
    // Checked before the reads: what a coordinator that has exited wrote is all in the FIFO.
    const exited = proc.exitCode !== null || proc.signalCode !== null;
    for (;;) {
      let length = 0;
      try {
        length = readSync(fd, chunk, 0, chunk.length, null);
      } catch (error: any) {
        if (error.code !== "EAGAIN") throw error;
      }
      if (length === 0) break;
      chunks.push(Buffer.from(chunk.subarray(0, length)));
    }
    const text = Buffer.concat(chunks).toString();
    if (exited) return text;
    if (Date.now() > deadline) {
      throw new Error(`the coordinator did not exit. It wrote ${text.length} bytes, at last: ${text.slice(-300)}`);
    }
    await Bun.sleep(1);
  }
}

// A run that fails leaves the workers' process groups behind.
function killWorkerGroups(log: string) {
  for (const line of linesOf(log, "worker=")) {
    try {
      process.kill(-Number(line.slice("worker=".length)), "SIGKILL");
    } catch {}
  }
}

// The ASAN lanes run every test with no-orphans on. That makes the kernel SIGKILL what a test
// spawned when its worker dies, before it can log the coordinator's SIGTERM.
const coordinatorEnv = (log: string) => ({ ...bunEnv, LOG: log, BUN_FEATURE_FLAG_NO_ORPHANS: undefined });

// A write of the coordinator can block. So the worker groups get their SIGTERM before it writes
// anything: here stderr is a FIFO that nothing reads, and the list of the files that had not
// started does not fit in it.
//
// Not concurrent: a serial test runs alone, after the cases above, which measure a time.
test.skipIf(isWindows)("--parallel: the worker groups are signalled before a write that blocks", async () => {
  // Two files run. The names of the other 400 are about 100 KB of "had not started" lines.
  const files: Record<string, string> = {};
  const longName = Buffer.alloc(240, "x").toString();
  for (let i = 0; i < 402; i++) files[`${longName}-${i}.test.ts`] = slowTestThatSpawns;
  using dir = tempDir("parallel-signal-stall", files);
  const log = join(String(dir), "log.txt");
  const fifo = join(String(dir), "stderr.fifo");
  mkfifo(fifo);
  // O_NONBLOCK: this open does not wait for a writer. With that reader there, the open of the
  // write end does not wait either. The write end blocks when the FIFO is full.
  const readEnd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  const writeEnd = openSync(fifo, constants.O_WRONLY);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "--parallel-delay=0"],
    env: coordinatorEnv(log),
    cwd: String(dir),
    // The coordinator catches SIGTERM, so the cleanup of `await using` would wait for an exit that never comes.
    killSignal: "SIGKILL",
    stdout: "ignore",
    stderr: writeEnd,
  });
  closeSync(writeEnd);
  try {
    expect(await bothSpawned(log, proc)).toBe(true);

    proc.kill("SIGINT");
    expect(await bothTerminated(log)).toBe(true);

    // The coordinator is blocked in its write, and a repeat of the signal does not cut that
    // write short. It goes on when the test reads.
    proc.kill("SIGTERM");
    const stderr = await readUntilExit(readEnd, proc);
    expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 130, signalCode: null });
    expect(stderr).toContain("400 file(s) had not started:");
    expect(stderr.split("\n").filter(line => line.includes(longName)).length).toBe(402);
  } finally {
    closeSync(readEnd);
    killWorkerGroups(log);
  }
});

// A parent that forwards signals (`bun run`, a task runner) delivers one Ctrl-C twice: the
// terminal signals the foreground process group, and the parent signals its child again. The
// second one arrives while the coordinator tears down. The JUnit outfile is a FIFO with no
// reader, so the coordinator cannot end that teardown before the test opens the read end.
test.skipIf(isWindows).concurrent.each([
  ["SIGTERM", 143],
  ["SIGINT", 130],
] as const)(
  "--parallel: a repeat of %s during the teardown does not end the coordinator early",
  async (signal, code) => {
    using dir = tempDir("parallel-signal-repeat", { "a.test.ts": slowTestThatSpawns, "b.test.ts": slowTestThatSpawns });
    const log = join(String(dir), "log.txt");
    const report = join(String(dir), "junit.fifo");
    mkfifo(report);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", "--parallel-delay=0", "--reporter=junit", `--reporter-outfile=${report}`],
      env: coordinatorEnv(log),
      cwd: String(dir),
      // The coordinator catches SIGTERM, so the cleanup of `await using` would wait for an exit that never comes.
      killSignal: "SIGKILL",
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      expect(await bothSpawned(log, proc)).toBe(true);

      const stderr = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let seen = "";
      proc.kill(signal);
      while (!seen.includes("Interrupted")) {
        const { value, done } = await stderr.read();
        if (done) break;
        seen += decoder.decode(value, { stream: true });
      }
      expect(seen).toContain("Interrupted");

      // The coordinator is in its teardown now, and cannot leave it.
      proc.kill(signal);

      // O_NONBLOCK: this open does not wait for the writer. What the coordinator writes stays in
      // the FIFO after it has exited.
      const fd = openSync(report, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        await proc.exited;
        expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: code, signalCode: null });
        expect(readFileSync(fd, "utf8")).toContain("</testsuites>");
      } finally {
        closeSync(fd);
      }
      expect(await bothTerminated(log)).toBe(true);
    } finally {
      killWorkerGroups(log);
    }
  },
);
