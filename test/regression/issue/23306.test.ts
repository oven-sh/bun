import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/23306
// Bug 1: When watching a directory and the directory is deleted, Bun should emit a `rename` event with the directory's name
// Bug 3: After closing a watcher on a deleted directory and then recreating the directory and creating a new watcher,
//        the new watcher should emit events for file changes in the recreated directory

// Helper to poll for a condition with timeout
async function waitFor(condition: () => boolean, timeoutMs: number = 3000, intervalMs: number = 10): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return true;
    await Bun.sleep(intervalMs);
  }
  return condition();
}

describe("issue #23306", () => {
  test.skipIf(isWindows)("emits rename event when watched directory is deleted", async () => {
    using dir = tempDir("issue-23306-bug1", {});
    const folderToWatch = path.join(String(dir), "watched-folder");
    fs.mkdirSync(folderToWatch);

    const events: { event: string; filename: string | null }[] = [];

    const watcher = fs.watch(folderToWatch, (event, filename) => {
      events.push({ event, filename: filename as string | null });
    });

    // Brief delay for watcher thread to initialize
    await Bun.sleep(50);

    // Delete the watched folder
    fs.rmdirSync(folderToWatch);

    // Wait for rename event to be delivered (poll instead of fixed sleep)
    const gotRenameEvent = await waitFor(() =>
      events.some(e => e.event === "rename" && e.filename === "watched-folder"),
    );

    watcher.close();

    // Should have received a rename event for the deleted directory
    expect(gotRenameEvent).toBe(true);
    expect(events.some(e => e.event === "rename")).toBe(true);
    expect(events.some(e => e.filename === "watched-folder")).toBe(true);
  });

  test.skipIf(isWindows)("new watcher works after folder recreation", async () => {
    using dir = tempDir("issue-23306-bug3", {});
    const folderToWatch = path.join(String(dir), "watched-folder");
    fs.mkdirSync(folderToWatch);

    // First watcher
    const events1: { event: string; filename: string | null }[] = [];

    const watcher1 = fs.watch(folderToWatch, (event, filename) => {
      events1.push({ event, filename: filename as string | null });
    });

    // Brief delay for watcher thread to initialize
    await Bun.sleep(50);

    // Delete the folder
    fs.rmdirSync(folderToWatch);

    // Wait for watcher1 to receive the delete event (poll instead of fixed sleep)
    await waitFor(() => events1.length > 0);

    // Close first watcher
    watcher1.close();

    // Recreate folder
    fs.mkdirSync(folderToWatch);

    // Second watcher
    const events2: { event: string; filename: string | null }[] = [];

    const watcher2 = fs.watch(folderToWatch, (event, filename) => {
      events2.push({ event, filename: filename as string | null });
    });

    // Brief delay for watcher thread to initialize
    await Bun.sleep(50);

    // Create a file in the recreated folder
    fs.writeFileSync(path.join(folderToWatch, "test.txt"), "test content");

    // Wait for event to be delivered (poll instead of fixed sleep)
    const gotTestFileEvent = await waitFor(() => events2.some(e => e.filename === "test.txt"));

    watcher2.close();

    // Second watcher should have received an event for the new file
    expect(gotTestFileEvent).toBe(true);
    expect(events2.some(e => e.filename === "test.txt")).toBe(true);
  });
});
