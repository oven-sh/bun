//#FILE: test-fs-watch-recursive-watch-file.js
//#SHA1: 1f06958f6f645cb5c80b424a24b046f107ab83ae
//-----------------
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");

const isIBMi = os.platform() === "os400";
const isAIX = os.platform() === "aix";

if (isIBMi) {
  test.skip("IBMi does not support `fs.watch()`");
}

// fs-watch on folders have limited capability in AIX.
// The testcase makes use of folder watching, and causes
// hang. This behavior is documented. Skip this for AIX.

if (isAIX) {
  test.skip("folder watch capability is limited in AIX.");
}

const platformTimeout = ms => ms * (process.platform === "win32" ? 2 : 1);

test("Watch a file (not a folder) using fs.watch", async () => {
  // Create a temporary directory for testing
  const testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "test-"));
  const rootDirectory = await fs.promises.mkdtemp(path.join(testDir, path.sep));
  const testDirectory = path.join(rootDirectory, "test-6");
  await fs.promises.mkdir(testDirectory);

  const filePath = path.join(testDirectory, "only-file.txt");
  await fs.promises.writeFile(filePath, "hello");

  let watcherClosed = false;
  let interval;

  const watcher = fs.watch(filePath, { recursive: true });

  const watchPromise = new Promise(resolve => {
    watcher.on("change", function (event, filename) {
      expect(event).toBe("change");

      if (filename === path.basename(filePath)) {
        clearInterval(interval);
        interval = null;
        watcher.close();
        watcherClosed = true;
        resolve();
      }
    });
  });

  interval = setInterval(() => {
    fs.writeFileSync(filePath, "world");
  }, platformTimeout(10));

  await watchPromise;

  expect(watcherClosed).toBe(true);
  expect(interval).toBeNull();
});

//<#END_FILE: test-fs-watch-recursive-watch-file.js
