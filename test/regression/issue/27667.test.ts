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
    // detecting a final sentinel file write.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const fs = require("fs");
const path = require("path");

const dir = process.argv[1];

const watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
  if (filename === "sentinel.txt") {
    watcher.close();
    process.exit(0);
  }
});

// Wait a moment for the watcher to be ready, then create a burst of files
// to overflow the inotify read buffer (>128 events).
setTimeout(() => {
  for (let i = 0; i < 200; i++) {
    fs.writeFileSync(path.join(dir, "file" + i + ".txt"), "data" + i);
  }

  // After the burst, write a sentinel file. If read_ptr is not reset,
  // the watcher will be stuck re-processing stale events and will never
  // see this file, causing the test to time out.
  setTimeout(() => {
    fs.writeFileSync(path.join(dir, "sentinel.txt"), "done");
  }, 500);
}, 200);

// Safety timeout - if the sentinel is not detected, the watcher is stuck.
setTimeout(() => {
  watcher.close();
  process.exit(1);
}, 10000);
`,
        String(dir),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
  15000,
);
