import { pathToFileURL } from "bun";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import fs from "node:fs";
import path from "path";

import { beforeEach, describe, expect, test } from "bun:test";
// Because macOS (and possibly other operating systems) can return a watcher
// before it is actually watching, we need to repeat the operation to avoid
// a race condition.
function repeat(fn: any) {
  const interval = setInterval(fn, 20).unref();
  return interval;
}
// Write to a temp file then rename, so stat never sees a 0-byte intermediate
// state (writeFileSync uses O_TRUNC which briefly truncates the file to 0
// bytes, visible to concurrent stat on Windows).
function updateFile(filepath: string, data: string) {
  const tmp = filepath + ".tmp";
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filepath);
}
const encodingFileName = `新建文夹件.txt`;
let testDir = "";
beforeEach(() => {
  testDir = tempDirWithFiles("watch", {
    "watch.txt": "hello",
    [encodingFileName]: "hello",
    "space dir": {
      "space file.txt": "hello",
    },
  });
});

describe("fs.watchFile", () => {
  test("zeroed stats if does not exist", async () => {
    let entries: any = [];
    let { promise, resolve } = Promise.withResolvers<void>();
    fs.watchFile(path.join(testDir, "does-not-exist"), (curr, prev) => {
      entries.push([curr, prev]);
      resolve();
      resolve = () => {};
    });

    await promise;

    fs.unwatchFile(path.join(testDir, "does-not-exist"));

    expect(entries.length).toBe(1);
    expect(entries[0][0].size).toBe(0);
    expect(entries[0][0].mtimeMs).toBe(0);
    expect(entries[0][1].size).toBe(0);
    expect(entries[0][1].mtimeMs).toBe(0);
  });
  test("it watches a file", async () => {
    let { promise, resolve } = Promise.withResolvers<void>();
    let entries: any = [];
    fs.watchFile(path.join(testDir, "watch.txt"), { interval: 50 }, (curr, prev) => {
      entries.push([curr, prev]);
      resolve();
      resolve = () => {};
    });
    let increment = 0;
    const interval = repeat(() => {
      increment++;
      updateFile(path.join(testDir, "watch.txt"), "hello" + increment);
    });
    await promise;
    clearInterval(interval);

    fs.unwatchFile(path.join(testDir, "watch.txt"));

    expect(entries.length).toBeGreaterThan(0);
    console.log(entries);
    expect(entries[0][0].size).toBeGreaterThan(5);
    expect(entries[0][1].size).toBe(5);
    expect(entries[0][0].mtimeMs).toBeGreaterThan(entries[0][1].mtimeMs);
  });
  test("unicode file name", async () => {
    let entries: any = [];
    let { promise, resolve } = Promise.withResolvers<void>();
    fs.watchFile(path.join(testDir, encodingFileName), { interval: 50 }, (curr, prev) => {
      entries.push([curr, prev]);
      resolve();
      resolve = () => {};
    });

    let increment = 0;
    const interval = repeat(() => {
      increment++;
      updateFile(path.join(testDir, encodingFileName), "hello" + increment);
    });
    await promise;
    clearInterval(interval);

    fs.unwatchFile(path.join(testDir, encodingFileName));

    expect(entries.length).toBeGreaterThan(0);

    expect(entries[0][0].size).toBe(6);
    expect(entries[0][1].size).toBe(5);
    expect(entries[0][0].mtimeMs).toBeGreaterThan(entries[0][1].mtimeMs);
  });

  test("bigint stats", async () => {
    let entries: any = [];
    let { promise, resolve } = Promise.withResolvers<void>();
    fs.watchFile(path.join(testDir, encodingFileName), { interval: 50, bigint: true }, (curr, prev) => {
      entries.push([curr, prev]);
      resolve();
      resolve = () => {};
    });

    let increment = 0;
    const interval = repeat(() => {
      increment++;
      updateFile(path.join(testDir, encodingFileName), "hello" + "a".repeat(increment));
    });
    await promise;
    clearInterval(interval);

    fs.unwatchFile(path.join(testDir, encodingFileName));

    expect(entries.length).toBeGreaterThan(0);

    expect(typeof entries[0][0].mtimeMs === "bigint").toBe(true);
  });

  test.if(isWindows)("does not fire on atime-only update", async () => {
    let called = false;
    const file = path.join(testDir, "watch.txt");
    fs.watchFile(file, { interval: 50 }, () => {
      called = true;
    });
    fs.readFileSync(file);
    await Bun.sleep(100);
    fs.unwatchFile(file);
    expect(called).toBe(false);
  });

  test("should work with file: URL string containing percent-encoded spaces", async () => {
    const filepath = path.join(testDir, "space dir", "space file.txt");
    const fileUrl = pathToFileURL(filepath).href; // e.g. file:///tmp/.../space%20dir/space%20file.txt
    expect(fileUrl).toContain("%20");

    let { promise, resolve } = Promise.withResolvers<void>();
    let entries: any = [];
    fs.watchFile(fileUrl, { interval: 50 }, (curr, prev) => {
      entries.push([curr, prev]);
      resolve();
      resolve = () => {};
    });
    let increment = 0;
    const interval = repeat(() => {
      increment++;
      updateFile(filepath, "hello" + increment);
    });
    await promise;
    clearInterval(interval);

    fs.unwatchFile(fileUrl);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0][0].size).toBeGreaterThan(5);
    expect(entries[0][1].size).toBe(5);
    expect(entries[0][0].mtimeMs).toBeGreaterThan(entries[0][1].mtimeMs);
  });

  test("StatWatcherScheduler stress test (1000 watchers with random times)", async () => {
    const EventEmitter = require("events");
    let defaultMaxListeners = EventEmitter.defaultMaxListeners;
    try {
      EventEmitter.defaultMaxListeners = 1000;
      // This tests StatWatcher's scheduler for add/remove race conditions,
      // as the actual stat()ing is done on another thread using a specialized linked list implementation
      // so we're testing that here, less so that stats will properly notify js, since that code is already known to be very threadsafe.
      const set = new Set<string>();
      const { promise, resolve } = Promise.withResolvers();
      for (let i = 0; i < 1000; i++) {
        const file = path.join(testDir, i + ".txt");
        setTimeout(() => {
          let first = true;
          fs.watchFile(file, { interval: 500 }, (curr, prev) => {
            set.add(file);
            if (first) {
              first = false;
              setTimeout(() => {
                fs.unwatchFile(file);

                if (set.size === 1000) resolve();
              }, Math.random() * 2000);
            }
          });
        }, Math.random() * 2000);
      }
      await promise;

      expect(set.size).toBe(1000);
    } finally {
      EventEmitter.defaultMaxListeners = defaultMaxListeners;
    }
  }, 20000);

  // https://github.com/oven-sh/bun/issues/28027
  // The old code held a jsc.Strong (last_jsvalue) and relied on an indirect
  // chain to keep the JS wrapper alive. finalize() did not clear the Strong,
  // so when the WorkPool scheduler later called deref() -> deinit(),
  // HandleSet::deallocate() ran on a non-JS thread and corrupted the GC
  // handle linked list -> segfault in visitStrongHandles.
  //
  // The unwatchFile path cannot reproduce this: close() sets closed=true
  // before GC, so the scheduler derefs first and deinit() runs on the JS
  // thread. Only the _handle=null path (no close) forces finalize() to be
  // the one that sets closed=true, guaranteeing the WorkPool deref is last.
  //
  // Windows-only: the corruption is real UB on all platforms but was only
  // observed to manifest as a crash on Windows (20 attempts on macOS with
  // 200 watchers and 20 GC cycles never crashed).
  test.skipIf(!isWindows)("no crash when finalize() races WorkPool deinit", async () => {
    const dir = tempDirWithFiles(
      "watchfile-gc",
      Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}.txt`, `d`])),
    );

    const fixture = /* js */ `
      const fs = require("fs");
      const path = require("path");
      const dir = ${JSON.stringify(dir)};

      // unref(): release poll_ref so the fixed build can exit naturally
      // even though JSRef keeps wrappers alive and closed is never set.
      // _handle = null: disconnect the native wrapper from JS without
      // calling close(). On the broken build, finalize() is now the only
      // path that can set closed=true.
      for (let i = 0; i < 50; i++) {
        const w = fs.watchFile(path.join(dir, "f" + i + ".txt"), { interval: 5 }, () => {});
        w.unref();
        w._handle = null;
      }

      // Let initial stat tasks complete: initialStatSuccessOnMainThread
      // runs on the JS thread, allocates the Strong (last_jsvalue.set), and
      // appends the watcher to the scheduler queue (ref_count now 2:
      // construction + scheduler). Idle GC may also run during this sleep.
      await Bun.sleep(100);

      // On the broken build: finalize() sets closed=true, deref (2->1).
      // Timer fires, workPoolCallback sees closed=true, deref on WorkPool
      // (1->0), deinit() calls last_jsvalue.deinit() on the WorkPool thread.
      // On the fixed build: JSRef initStrong keeps wrappers rooted, none of
      // this runs, the GC calls below are no-ops.
      Bun.gc(true);
      await Bun.sleep(200);
      Bun.gc(true);
      await Bun.sleep(100);
      Bun.gc(true);

      console.log("OK");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });
});
