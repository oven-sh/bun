// A thread that sleeps until another thread wakes it pays for the wake. So a work pool thread that is out of jobs
// waits briefly for the next one before it sleeps, and the event loop waits briefly for the result of a job it just
// gave the pool (src/threading/brief_wait.rs). In a chain of awaited jobs, neither thread sleeps between two jobs.
//
// The wait is 20 microseconds, less than a debug build takes for its turn. With BUN_DEBUG_TEST_LONG_BRIEF_WAIT the
// builds with debug assertions (debug, ASAN) wait ten seconds in its place. A release build has no such variable.
//
// A sleep is a voluntary context switch of the thread, which Linux counts in /proc/<pid>/task/<tid>/status. A thread
// that gives its processor to another one that is ready to run makes an involuntary one.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux } from "harness";

const jobs = 30;

const fixture = /* js */ `
  import { pbkdf2 } from "node:crypto";
  import fs from "node:fs";
  import { deflate } from "node:zlib";

  function sleeps() {
    const counts = { eventLoop: 0, pool: 0, poolThreads: 0 };
    for (const thread of fs.readdirSync("/proc/self/task")) {
      const status = fs.readFileSync("/proc/self/task/" + thread + "/status", "utf8");
      const count = Number(/^voluntary_ctxt_switches:\\s+(\\d+)$/m.exec(status)[1]);
      if (Number(thread) === process.pid) {
        counts.eventLoop += count;
      } else if (/^Name:\\s+Bun Pool /m.test(status)) {
        counts.pool += count;
        counts.poolThreads++;
      }
    }
    return counts;
  }

  async function sleepsOfChain(job) {
    // The first jobs start the pool's threads, and one of them becomes the thread that stays awake.
    for (let i = 0; i < 6; i++) await job();
    const before = sleeps();
    for (let i = 0; i < ${jobs}; i++) await job();
    const after = sleeps();
    return {
      eventLoop: after.eventLoop - before.eventLoop,
      pool: after.pool - before.pool,
      poolThreads: after.poolThreads,
    };
  }

  // Each job computes for about a millisecond: a thread that sleeps until the job is over has the time to fall asleep.
  const key = await crypto.subtle.importKey("raw", new Uint8Array(16), "PBKDF2", false, ["deriveBits"]);
  const algorithm = { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(16), iterations: 1000 };
  console.log(
    JSON.stringify({
      // node:crypto, node:fs and most other asynchronous work: bun_jsc::Job.
      job: await sleepsOfChain(() => new Promise(done => pbkdf2("password", "salt", 1000, 32, "sha256", done))),
      // crypto.subtle: ConcurrentCppTask.
      cppTask: await sleepsOfChain(() => crypto.subtle.deriveBits(algorithm, key, 256)),
      // node:zlib gives the pool a task of its own, as fs.cp() and N-API async work do.
      ownTask: await sleepsOfChain(() => new Promise(done => deflate("brief wait", done))),
    }),
  );
`;

test.skipIf(!isLinux || (!isDebug && !isASAN))(
  "no thread sleeps between two jobs of a chain of awaited work pool jobs",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_DEBUG_TEST_LONG_BRIEF_WAIT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const sleeps: Record<"job" | "cppTask" | "ownTask", { eventLoop: number; pool: number; poolThreads: number }> =
      JSON.parse(stdout);
    for (const carrier of ["job", "cppTask", "ownTask"] as const) {
      // Without the wait the pool's threads sleep twice a job (the thread that ran it, and the spare one that was
      // woken with it), and the event loop once.
      expect(sleeps[carrier].poolThreads).toBeGreaterThanOrEqual(1);
      expect(sleeps[carrier].pool).toBeLessThan(jobs / 4);
      expect(sleeps[carrier].eventLoop).toBeLessThan(jobs / 4);
    }
  },
);
