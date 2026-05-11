// https://github.com/oven-sh/bun/issues/3657
// fs.watch on a directory should emit 'change' events for files created after the watch is established

import { describe, expect, test } from "bun:test";
import { isLinux, tempDirWithFiles } from "harness";
import fs from "node:fs";
import path from "node:path";

describe.skipIf(!isLinux)("GitHub Issue #3657", () => {
  test("fs.watch on directory emits 'change' events for files created after watch starts", async () => {
    const testDir = tempDirWithFiles("issue-3657", {});
    const testFile = path.join(testDir, "test.txt");

    const events: Array<{ eventType: string; filename: string | null }> = [];
    let resolver: () => void;
    const promise = new Promise<void>(resolve => {
      resolver = resolve;
    });

    const watcher = fs.watch(testDir, { signal: AbortSignal.timeout(5000) }, (eventType, filename) => {
      events.push({ eventType, filename: filename as string | null });
      // We expect at least 2 events: one rename (create) and one change (modify)
      if (events.length >= 2) {
        resolver();
      }
    });

    // Give the watcher time to initialize
    await Bun.sleep(100);

    // Create the file - should emit 'rename' event
    fs.writeFileSync(testFile, "hello");

    // Wait a bit for the event to be processed
    await Bun.sleep(100);

    // Modify the file - should emit 'change' event
    fs.appendFileSync(testFile, " world");

    try {
      await promise;
    } finally {
      watcher.close();
    }

    // Verify we got at least one event for "test.txt"
    const testFileEvents = events.filter(e => e.filename === "test.txt");
    expect(testFileEvents.length).toBeGreaterThanOrEqual(2);

    // Verify we got a 'rename' event (file creation)
    const renameEvents = testFileEvents.filter(e => e.eventType === "rename");
    expect(renameEvents.length).toBeGreaterThanOrEqual(1);

    // Verify we got a 'change' event (file modification)
    const changeEvents = testFileEvents.filter(e => e.eventType === "change");
    expect(changeEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("fs.watch emits multiple 'change' events for repeated modifications", async () => {
    const testDir = tempDirWithFiles("issue-3657-multi", {});
    const testFile = path.join(testDir, "multi.txt");

    const events: Array<{ eventType: string; filename: string | null }> = [];
    let resolver: () => void;
    const promise = new Promise<void>(resolve => {
      resolver = resolve;
    });

    const watcher = fs.watch(testDir, { signal: AbortSignal.timeout(5000) }, (eventType, filename) => {
      events.push({ eventType, filename: filename as string | null });
      // We expect 1 rename (create) + 3 change events = 4 total
      if (events.length >= 4) {
        resolver();
      }
    });

    // Give the watcher time to initialize
    await Bun.sleep(100);

    // Create the file - should emit 'rename' event
    fs.writeFileSync(testFile, "line1\n");
    await Bun.sleep(100);

    // Multiple modifications - should emit 'change' events
    fs.appendFileSync(testFile, "line2\n");
    await Bun.sleep(100);

    fs.appendFileSync(testFile, "line3\n");
    await Bun.sleep(100);

    fs.appendFileSync(testFile, "line4\n");

    try {
      await promise;
    } finally {
      watcher.close();
    }

    // Verify we got events for "multi.txt"
    const testFileEvents = events.filter(e => e.filename === "multi.txt");
    expect(testFileEvents.length).toBeGreaterThanOrEqual(4);

    // Verify we got a 'rename' event (file creation)
    const renameEvents = testFileEvents.filter(e => e.eventType === "rename");
    expect(renameEvents.length).toBeGreaterThanOrEqual(1);

    // Verify we got multiple 'change' events (file modifications)
    const changeEvents = testFileEvents.filter(e => e.eventType === "change");
    expect(changeEvents.length).toBeGreaterThanOrEqual(3);
  });
});
