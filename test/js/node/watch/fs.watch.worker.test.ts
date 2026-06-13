import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// Regression test for the Windows `fs.watch` backend sharing a single
// process-global `PathWatcherManager` across all VMs.
//
// Before the fix, `win_watcher.zig` stored the manager in a plain module
// global that captured the *first* caller's `*VirtualMachine`. Every later
// `fs.watch()` — including from Worker threads — reused it, which broke in
// two ways:
//
//   (a) the `watchers` StringArrayHashMap was mutated (`getOrPut` /
//       `swapRemoveAt`) from multiple threads with no lock, and
//
//   (b) `uv_fs_event_init(manager.vm.uvLoop(), &handle)` bound the Worker's
//       libuv handle to the *main* thread's `uv_loop_t`. libuv handles are
//       not thread-safe; the Worker then called `uv_close` on that handle
//       from its own thread, corrupting the main loop's handle queue, and
//       the event callback fired on the main thread but enqueued a
//       non-thread-safe task on the Worker's event loop.
//
// The fix makes the manager per-VM (stored on `RareData`), so each Worker's
// `uv_fs_event_t` handles live on that Worker's own loop. Contrast with the
// POSIX backend, which is legitimately process-global because it owns a
// single inotify/kqueue fd and a dedicated reader thread and guards its maps
// with a mutex.
//
// On POSIX this test is a cross-platform guard that `fs.watch` works from
// Workers at all; the crash it catches is Windows-specific.
test("fs.watch from a Worker uses the Worker's own uv loop", async () => {
  using dir = tempDir("fswatch-worker", {
    "main-a.txt": "x",
    "main-b.txt": "x",
    "worker.js": /* js */ `
        const fs = require("fs");
        const path = require("path");
        const { parentPort, workerData } = require("worker_threads");
        const dir = workerData.dir;

        // Keep the Worker alive after posting "done" so the main thread's
        // terminate() always has a live thread to tear down (terminate()
        // on an already-exited Worker doesn't currently resolve).
        parentPort.on("message", () => {});

        // Churn watch/close so that, on the broken build, uv_close runs on
        // this thread against a handle that was registered on the main
        // thread's loop (→ corrupts the main loop's handle queue), and the
        // hashmap getOrPut/swapRemoveAt races the main thread's own churn.
        let i = 0;
        const iterations = 150;
        function step() {
          if (i++ >= iterations) {
            parentPort.postMessage("done");
            return;
          }
          const ws = [];
          for (let j = 0; j < 3; j++) {
            const w = fs.watch(dir, () => {});
            w.on("error", () => {});
            ws.push(w);
          }
          // Touch a file so the libuv callback path is exercised too.
          try { fs.writeFileSync(path.join(dir, "w.txt"), String(i)); } catch {}
          setImmediate(() => {
            for (const w of ws) w.close();
            setImmediate(step);
          });
        }
        setImmediate(step);
      `,
    "main.js": /* js */ `
        const fs = require("fs");
        const path = require("path");
        const { Worker } = require("worker_threads");
        const dir = process.argv[2];

        // Create a main-thread watch FIRST so the broken build's global
        // manager captures the main VM before any Worker calls fs.watch().
        const mainWatchers = [
          fs.watch(dir, () => {}),
          fs.watch(path.join(dir, "main-a.txt"), () => {}),
        ];
        for (const w of mainWatchers) w.on("error", () => {});

        const workerPath = path.join(dir, "worker.js");
        const workers = [];
        let done = 0;
        const N = ${isWindows ? 3 : 2};
        for (let k = 0; k < N; k++) {
          const w = new Worker(workerPath, { workerData: { dir } });
          w.on("message", (m) => {
            if (m === "done" && ++done === N) finish();
          });
          w.on("error", (e) => { console.error("worker error", e); process.exit(1); });
          workers.push(w);
        }

        // Churn on the main thread too so the hashmap sees concurrent
        // getOrPut/swapRemoveAt from both sides.
        let stopped = false;
        let mi = 0;
        (function mainStep() {
          if (stopped) return;
          const ws = [];
          for (let j = 0; j < 2; j++) {
            const w = fs.watch(dir, () => {});
            w.on("error", () => {});
            ws.push(w);
          }
          try { fs.writeFileSync(path.join(dir, "main-b.txt"), String(mi++)); } catch {}
          setImmediate(() => {
            for (const w of ws) w.close();
            setImmediate(mainStep);
          });
        })();

        async function finish() {
          stopped = true;
          // Keep mainWatchers open until the very end — they ref the event
          // loop. Closing them before the awaits below would let the loop
          // drain (pending promises don't ref it) and exit 0 without "OK".
          await Promise.all(workers.map((w) => w.terminate()));
          // Let a few loop ticks run so a corrupted main-loop handle queue
          // would surface now rather than on process exit.
          for (let t = 0; t < 10; t++) await new Promise((r) => setImmediate(r));
          for (const w of mainWatchers) w.close();
          console.log("OK");
          process.exit(0);
        }

        const wd = setTimeout(() => {
          process.stderr.write("HUNG\\n");
          process.exit(1);
        }, 30000);
        wd.unref();
      `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js", String(dir)],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("HUNG");
  expect(stderr).not.toContain("worker error");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 60000);

// Windows-specific: two Workers watching the *same* path. On the broken
// build both hit the same `PathWatcherManager` (owned by the main VM) and
// dedup to the *same* `PathWatcher` — so one Worker's `close()` frees the
// `uv_fs_event_t` out from under the other, and the surviving Worker's
// `FSWatcher` is driven from the main thread's callback. After the fix each
// Worker has its own manager and its own handle.
test.skipIf(!isWindows)(
  "fs.watch: two Workers watching the same path do not share a uv_fs_event_t",
  async () => {
    using dir = tempDir("fswatch-worker-shared", {
      "target.txt": "x",
      "worker.js": /* js */ `
        const fs = require("fs");
        const { parentPort, workerData } = require("worker_threads");

        let got = 0;
        const w = fs.watch(workerData.dir, () => { got++; });
        w.on("error", () => {});
        parentPort.postMessage("ready");
        // Listening keeps the Worker alive until terminate() (see first test).
        parentPort.on("message", (m) => {
          if (m === "close") {
            w.close();
            parentPort.postMessage({ got });
          }
        });
      `,
      "main.js": /* js */ `
        const fs = require("fs");
        const path = require("path");
        const { Worker } = require("worker_threads");
        const dir = process.argv[2];

        // Establish the (broken) global manager on the main VM first.
        const anchor = fs.watch(dir, () => {});
        anchor.on("error", () => {});

        const workerPath = path.join(dir, "worker.js");
        const a = new Worker(workerPath, { workerData: { dir } });
        const b = new Worker(workerPath, { workerData: { dir } });
        for (const w of [a, b]) w.on("error", (e) => { console.error("worker error", e); process.exit(1); });

        let ready = 0;
        function onReady() {
          if (++ready < 2) return;
          // Generate events, then close one Worker's watcher first, then the
          // other. On the broken build the second close() hits a freed
          // handle / wrong-thread uv_close.
          for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(dir, "target.txt"), String(i));
          setTimeout(() => {
            a.postMessage("close");
            a.once("message", () => {
              for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(dir, "target.txt"), String(i));
              setTimeout(() => {
                b.postMessage("close");
                b.once("message", async () => {
                  await Promise.all([a.terminate(), b.terminate()]);
                  for (let t = 0; t < 10; t++) await new Promise((r) => setImmediate(r));
                  anchor.close();
                  console.log("OK");
                  process.exit(0);
                });
              }, 100);
            });
          }, 100);
        }
        a.once("message", onReady);
        b.once("message", onReady);

        const wd = setTimeout(() => { process.stderr.write("HUNG\\n"); process.exit(1); }, 30000);
        wd.unref();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js", String(dir)],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("HUNG");
    expect(stderr).not.toContain("worker error");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  },
  60000,
);
