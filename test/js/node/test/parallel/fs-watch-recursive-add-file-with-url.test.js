//#FILE: test-fs-watch-recursive-add-file-with-url.js
//#SHA1: e6498ea80abdf69cb66d888bbd7d631931970c0a
//-----------------
"use strict";

const { setTimeout } = require("timers/promises");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const os = require("os");

const isIBMi = process.platform === "os400";
const isAIX = process.platform === "aix";

if (isIBMi) {
  it.skip("IBMi does not support `fs.watch()`", () => {});
} else if (isAIX) {
  it.skip("folder watch capability is limited in AIX.", () => {});
} else {
  it("should watch for file changes using URL as path", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"));

    // Add a file to already watching folder, and use URL as the path
    const rootDirectory = fs.mkdtempSync(path.join(testDir, path.sep));
    const testDirectory = path.join(rootDirectory, "test-5");
    fs.mkdirSync(testDirectory);

    const filePath = path.join(testDirectory, "file-8.txt");
    const url = pathToFileURL(testDirectory);

    const watcher = fs.watch(url, { recursive: true });
    let watcherClosed = false;

    const watchPromise = new Promise(resolve => {
      watcher.on("change", function (event, filename) {
        expect(event).toBe("rename");

        if (filename === path.basename(filePath)) {
          watcher.close();
          watcherClosed = true;
          resolve();
        }
      });
    });

    await setTimeout(100);
    fs.writeFileSync(filePath, "world");

    await watchPromise;

    expect(watcherClosed).toBe(true);
  }, 10000); // Increase timeout to 10 seconds
}

//<#END_FILE: test-fs-watch-recursive-add-file-with-url.js
