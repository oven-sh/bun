//#FILE: test-fs-watch-recursive-add-file.js
//#SHA1: e87d2c9f4789a6e6a83fbdca56e39683625bd0af
//-----------------
"use strict";

import { patchEmitter, tmpdirSync } from "harness";

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
  it("should detect file added to already watching folder", done => {
    const rootDirectory = tmpdirSync();
    const testDirectory = path.join(rootDirectory, "test-1");
    fs.mkdirSync(testDirectory);
    console.log("testDirectory", testDirectory);

    const testFile = path.join(testDirectory, "file-1.txt");

    const watcher = fs.watch(testDirectory, { recursive: true });
    patchEmitter(watcher, "watcher");
    let watcherClosed = false;

    watcher.on("change", function (event, filename) {
      expect(event).toBe("rename");

      if (filename === path.basename(testFile)) {
        watcher.close();
        watcherClosed = true;
        expect(watcherClosed).toBe(true);
        done();
      }
    });

    // Do the write with a delay to ensure that the OS is ready to notify us.
    setTimeout(() => {
      fs.writeFileSync(testFile, "world");
    }, 1000);
  });
}

//<#END_FILE: test-fs-watch-recursive-add-file.js
