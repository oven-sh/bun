//#FILE: test-fs-watch-close-when-destroyed.js
//#SHA1: f062b7243d0c42722a289a6228d4c2c1a503be1b
//-----------------
"use strict";

// This tests that closing a watcher when the underlying handle is
// already destroyed will result in a noop instead of a crash.

const fs = require("fs");
const path = require("path");
const os = require("os");

// fs-watch on folders have limited capability in AIX.
// The testcase makes use of folder watching, and causes
// hang. This behavior is documented. Skip this for AIX.

if (process.platform === "aix") {
  it.skip("folder watch capability is limited in AIX.");
} else if (process.platform === "os400") {
  it.skip("IBMi does not support `fs.watch()`");
} else {
  let root;

  beforeEach(() => {
    root = path.join(os.tmpdir(), "watched-directory-" + Math.random().toString(36).slice(2));
    fs.mkdirSync(root);
  });

  afterEach(() => {
    try {
      fs.rmdirSync(root);
    } catch (error) {
      // Ignore errors, directory might already be removed
    }
  });

  it("should not crash when closing watcher after handle is destroyed", done => {
    const watcher = fs.watch(root, { persistent: false, recursive: false });

    // The following listeners may or may not be invoked.

    watcher.addListener("error", () => {
      setTimeout(
        () => {
          watcher.close();
        }, // Should not crash if it's invoked
        10,
      );
    });

    watcher.addListener("change", () => {
      setTimeout(() => {
        watcher.close();
      }, 10);
    });

    fs.rmdirSync(root);
    // Wait for the listener to hit
    setTimeout(done, 100);
  });
}

//<#END_FILE: test-fs-watch-close-when-destroyed.js
