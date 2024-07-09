import fs from "node:fs";
import path from "path";
import { tempDirWithFiles } from "harness";

import { beforeEach, describe, expect, test } from "bun:test";
// Because macOS (and possibly other operating systems) can return a watcher
// before it is actually watching, we need to repeat the operation to avoid
// a race condition.
function repeat(fn: any) {
  const interval = setInterval(fn, 20).unref();
  return interval;
}
const encodingFileName = `新建文夹件.txt`;
let testDir = "";
beforeEach(() => {
  testDir = tempDirWithFiles("watch", {
    "watch.txt": "hello",
    [encodingFileName]: "hello",
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
      fs.writeFileSync(path.join(testDir, "watch.txt"), "hello" + increment);
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
      fs.writeFileSync(path.join(testDir, encodingFileName), "hello" + increment);
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
      fs.writeFileSync(path.join(testDir, encodingFileName), "hello" + "a".repeat(increment));
    });
    await promise;
    clearInterval(interval);

    fs.unwatchFile(path.join(testDir, encodingFileName));

    expect(entries.length).toBeGreaterThan(0);

    expect(typeof entries[0][0].mtimeMs === "bigint").toBe(true);
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
});
