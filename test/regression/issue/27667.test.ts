import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/27667
// On Linux, when the inotify read buffer overflows (>128 events in a single
// read), the read_ptr was never reset to null after consuming remaining events,
// causing the watcher to re-process the same stale events in a 100% CPU loop.
test.skipIf(!isLinux)(
  "inotify watcher does not spin at 100% CPU after event buffer overflow",
  async () => {
    using dir = tempDir("watch-27667", {});

    // The test script watches the directory, creates enough files to overflow
    // the 128-event buffer, then verifies the watcher continues to work by
    // detecting a final sentinel file write. Orchestration is condition-driven:
    // a polling write establishes watcher readiness, then the burst + sentinel
    // follow, and a promise race enforces the timeout.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];

const watcher = fs.watch(dir, { recursive: true });

// Condition-driven: resolve when sentinel is observed.
const sentinelDetected = new Promise((resolve) => {
  watcher.on("change", (event, filename) => {
    if (filename === "sentinel.txt") {
      watcher.close();
      resolve();
    }
  });
});

// Condition-driven: resolve on the first watcher event (readiness signal).
const watcherReady = new Promise((resolve) => {
  watcher.once("change", () => resolve());
});

// Poll-write a trigger file until the watcher reports readiness.
const interval = setInterval(() => {
  fs.writeFileSync(path.join(dir, "trigger.txt"), String(Date.now()));
}, 20);

await watcherReady;
clearInterval(interval);

// Burst-write files to overflow the inotify event buffer (>128 events).
for (let i = 0; i < 200; i++) {
  fs.writeFileSync(path.join(dir, "burst" + i + ".txt"), "data" + i);
}

// Yield to the event loop so pending watcher callbacks are processed before
// writing the sentinel, preventing the sentinel event from being coalesced
// with the burst events.
await new Promise((resolve) => setImmediate(resolve));

// Write the sentinel. If read_ptr is not reset after the overflow, the watcher
// is stuck re-processing stale events and will never observe this file.
fs.writeFileSync(path.join(dir, "sentinel.txt"), "done");

// Wait for sentinel detection or fail with an explicit timeout.
await Promise.race([
  sentinelDetected,
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout: sentinel not detected")), 10000)
  ),
]);

console.log("sentinel detected");
`,
        String(dir),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("sentinel detected\n");
    expect(exitCode).toBe(0);
  },
  15000,
);
