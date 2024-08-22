//#FILE: test-fs-watch-ref-unref.js
//#SHA1: ffceabfd7f8fef655b05735b8bba7fb059609980
//-----------------
"use strict";

const fs = require("fs");

if (process.platform === "os400") {
  test.skip("IBMi does not support `fs.watch()`");
}

test("fs.watch() can be unref()ed and ref()ed", () => {
  const watcher = fs.watch(__filename, () => {
    // This callback should not be called
    expect(true).toBe(false);
  });

  watcher.unref();

  return new Promise(resolve => {
    setTimeout(
      () => {
        watcher.ref();
        watcher.unref();
        resolve();
      },
      process.platform === "win32" ? 100 : 50,
    );
  });
});

//<#END_FILE: test-fs-watch-ref-unref.js
