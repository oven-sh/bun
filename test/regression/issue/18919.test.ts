import { expect, it } from "bun:test";
import { mkdirSync, rmSync, watch, writeFileSync } from "fs";
import { tmpdirSync } from "harness";
import { join } from "path";
import { setImmediate } from "timers/promises";

// https://github.com/oven-sh/bun/issues/18919
it("fs.watch() properly triggers, closes and re-runs", async () => {
  const testDir = tmpdirSync();
  const testFile = join(testDir, "test.txt");

  // Make sure there is an empty directory to work with
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });

  let firstTriggerCount = 0;
  let secondTriggerCount = 0;

  writeFileSync(testFile, "A");

  // First watcher
  {
    const watcher_first = watch(testFile, () => {
      firstTriggerCount++;
      watcher_first.close();
    });
  }

  // Trigger the first watcher
  writeFileSync(testFile, "B");
  // Give watchers time to react
  await setImmediate();

  // Second watcher
  {
    const watcher_second = watch(testFile, () => {
      secondTriggerCount++;
      watcher_second.close();
    });
  }

  // Trigger the second watcher
  writeFileSync(testFile, "C");
  // Give watchers time to react
  await setImmediate();

  // Nobody should care about this
  writeFileSync(testFile, "D");
  // Give watchers time to react
  await setImmediate();

  expect(firstTriggerCount, "first watcher did not trigger exactly once").toBe(1);
  expect(secondTriggerCount, "second watcher did not trigger exactly once").toBe(1);
});
