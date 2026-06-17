// StatWatcherScheduler owns a single intrusive WorkPoolTask node that
// `timer_callback` pushes into the global ThreadPool queue. If the timer is
// re-armed (via a new `fs.watchFile()` with a smaller interval reaching
// `StatWatcherScheduler::append`) while that node is still linked, the
// second push overwrites `node.next` and, with any other task interleaved
// between the two pushes, forms a cycle in the run queue.
// `Buffer::consume` then fills a worker's 256-slot ring with repeated
// copies of every node in the cycle, so an `AsyncFSTask` caught in it is
// dispatched many times and runs on freed memory after its first
// completion reaches `destroy()` on the JS thread. Observed in the wild as
// `panic: Segmentation fault at address 0x0` inside `NodeFS::rm` →
// `PathLike::slice` on the work-pool thread.
//
// The alignment required (append re-arm landing between the first push and
// its pop, with the pool saturated long enough for the 1ms interval to
// elapse) is narrow enough that this test cannot force it deterministically;
// it stresses the path hard and asserts the subprocess exits cleanly.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("fs.watchFile scheduler does not double-push its WorkPool task under interval churn + pool flood", async () => {
  const fixture = /* js */ `
    const fs = require("fs");
    const fsp = require("fs/promises");
    const path = require("path");

    const tmp = process.argv[2];
    const w0 = path.join(tmp, "w0");
    fs.writeFileSync(w0, "x");

    // Seed watcher with a larger interval so subsequent appends decrease it.
    fs.watchFile(w0, { interval: 50, persistent: false }, () => {});

    const wt = [];
    for (let i = 0; i < 12; i++) {
      const p = path.join(tmp, "wt" + i);
      fs.writeFileSync(p, "x");
      wt.push(p);
    }

    let round = 0;
    const ROUNDS = 40;
    const FLOOD = 600;

    async function oneRound() {
      round++;

      // Flood the pool so if sched.task is queued it stays buried for >1ms.
      // Mix in Buffer-path async rm (the observed crash site) so an
      // AsyncFSTask sits adjacent to the scheduler node.
      const pending = [];
      for (let i = 0; i < FLOOD; i++) {
        pending.push(
          fsp.rm(Buffer.from(path.join(tmp, "noent-" + round + "-" + i)),
            { recursive: true, force: false }).catch(() => {})
        );
      }

      // New watchers with interval=1: their InitialStatTask completions
      // reach append() on the JS thread and re-arm the scheduler timer
      // (current_interval > 1), which is the re-arm path that can race
      // the in-flight push.
      for (let k = 0; k < 5; k++) {
        const t = wt[(round + k) % wt.length];
        fs.unwatchFile(t);
        fs.watchFile(t, { interval: 1, persistent: false }, () => {});
      }

      fs.writeFileSync(w0, String(round));
      await Promise.all(pending);

      // Drop the interval=1 watchers so work_pool_callback's next run
      // raises current_interval again, keeping the append() re-arm path
      // live on subsequent rounds.
      for (let k = 0; k < 5; k++) fs.unwatchFile(wt[(round + k) % wt.length]);
      await new Promise(r => setImmediate(r));
    }

    (async () => {
      await new Promise(r => setTimeout(r, 80));
      for (let i = 0; i < ROUNDS; i++) await oneRound();
      for (const p of wt) fs.unwatchFile(p);
      fs.unwatchFile(w0);
      console.log(JSON.stringify({ ok: true, rounds: round }));
      process.exit(0);
    })();
  `;

  using dir = tempDir("watchfile-sched", {
    "stress.js": fixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "stress.js", String(dir)],
    cwd: String(dir),
    env: {
      ...bunEnv,
      // Two pool threads: easiest to saturate so the scheduler node can
      // stay queued past an interval tick.
      UV_THREADPOOL_SIZE: "2",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // stderr is included in the assertion object for diagnostics on failure
  // but not compared exactly (debug/ASAN builds may emit benign warnings).
  expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify({ ok: true, rounds: 40 }),
    exitCode: 0,
    signalCode: null,
  });
  void stderr;
}, 30_000);
