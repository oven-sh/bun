import fs, { FSWatcher } from "node:fs";
import path from "path";
import { tempDirWithFiles, bunRun, bunRunAsScript } from "harness";
import { pathToFileURL } from "bun";

import { describe, expect, test } from "bun:test";
// Because macOS (and possibly other operating systems) can return a watcher
// before it is actually watching, we need to repeat the operation to avoid
// a race condition.
function repeat(fn: any) {
  const interval = setInterval(fn, 20);
  return interval;
}
const encodingFileName = `新建文夹件.txt`;
const testDir = tempDirWithFiles("watch", {
  "watch.txt": "hello",
  [encodingFileName]: "hello",
});

describe("fs.watchFile", () => {
  test("zeroed stats if does not exist", async () => {
    let entries: any = [];
    fs.watchFile(path.join(testDir, "does-not-exist"), (curr, prev) => {
      entries.push([curr, prev]);
    });

    await Bun.sleep(35);

    fs.unwatchFile(path.join(testDir, "does-not-exist"));

    expect(entries.length).toBe(1);
    expect(entries[0][0].size).toBe(0);
    expect(entries[0][0].mtimeMs).toBe(0);
    expect(entries[0][1].size).toBe(0);
    expect(entries[0][1].mtimeMs).toBe(0);
  });
  test("it watches a file", async () => {
    let entries: any = [];
    fs.watchFile(path.join(testDir, "watch.txt"), { interval: 50 }, (curr, prev) => {
      entries.push([curr, prev]);
    });
    await Bun.sleep(100);
    fs.writeFileSync(path.join(testDir, "watch.txt"), "hello2");
    await Bun.sleep(100);

    fs.unwatchFile(path.join(testDir, "watch.txt"));

    expect(entries.length).toBeGreaterThan(0);

    expect(entries[0][0].size).toBe(6);
    expect(entries[0][1].size).toBe(5);
    expect(entries[0][0].mtimeMs).toBeGreaterThan(entries[0][1].mtimeMs);
  });
  test("unicode file name", async () => {
    let entries: any = [];
    fs.watchFile(path.join(testDir, encodingFileName), { interval: 50 }, (curr, prev) => {
      entries.push([curr, prev]);
    });
    await Bun.sleep(100);
    fs.writeFileSync(path.join(testDir, encodingFileName), "hello2");
    await Bun.sleep(100);

    fs.unwatchFile(path.join(testDir, encodingFileName));

    expect(entries.length).toBeGreaterThan(0);

    expect(entries[0][0].size).toBe(6);
    expect(entries[0][1].size).toBe(5);
    expect(entries[0][0].mtimeMs).toBeGreaterThan(entries[0][1].mtimeMs);
  });
  test("bigint stats", async () => {
    let entries: any = [];
    fs.watchFile(path.join(testDir, encodingFileName), { interval: 50, bigint: true }, (curr, prev) => {
      entries.push([curr, prev]);
    });
    await Bun.sleep(100);
    fs.writeFileSync(path.join(testDir, encodingFileName), "hello2");
    await Bun.sleep(100);

    fs.unwatchFile(path.join(testDir, encodingFileName));

    expect(entries.length).toBeGreaterThan(0);

    expect(typeof entries[0][0].mtimeMs === "bigint").toBe(true);
  });
});
