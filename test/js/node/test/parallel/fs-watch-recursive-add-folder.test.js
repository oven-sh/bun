//#FILE: test-fs-watch-recursive-add-folder.js
//#SHA1: 4c2908ccc8502f5f760963a9b9a6db6ddadd4c1c
//-----------------
"use strict";

const { setTimeout } = require("timers/promises");
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const isIBMi = os.platform() === "os400";
const isAIX = os.platform() === "aix";

if (isIBMi) {
  it.skip("IBMi does not support `fs.watch()`", () => {});
} else if (isAIX) {
  it.skip("folder watch capability is limited in AIX.", () => {});
} else {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"));

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("Add a folder to already watching folder", async () => {
    // Add a folder to already watching folder

    const rootDirectory = fs.mkdtempSync(path.join(testDir, "root-"));
    const testDirectory = path.join(rootDirectory, "test-2");
    fs.mkdirSync(testDirectory);

    const testFile = path.join(testDirectory, "folder-2");

    const watcher = fs.watch(testDirectory, { recursive: true });
    let watcherClosed = false;

    const watchPromise = new Promise(resolve => {
      watcher.on("change", function (event, filename) {
        expect(event).toBe("rename");

        if (filename === path.basename(testFile)) {
          watcher.close();
          watcherClosed = true;
          resolve();
        }
      });
    });

    await setTimeout(100);
    fs.mkdirSync(testFile);

    await watchPromise;

    expect(watcherClosed).toBe(true);
  });
}

//<#END_FILE: test-fs-watch-recursive-add-folder.js
