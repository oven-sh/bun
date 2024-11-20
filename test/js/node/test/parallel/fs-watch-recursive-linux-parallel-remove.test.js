//#FILE: test-fs-watch-recursive-linux-parallel-remove.js
//#SHA1: ed10536d8d54febe24a3dcf494a26eab06bc4f66
//-----------------
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const os = require("node:os");

// Skip test if not running on Linux
if (os.platform() !== "linux") {
  test.skip("This test can run only on Linux", () => {});
} else {
  // Test that the watcher do not crash if the file "disappears" while
  // watch is being set up.

  let testDir;
  let watcher;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"));
  });

  afterEach(() => {
    if (watcher) {
      watcher.close();
    }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("fs.watch does not crash on parallel file removal", done => {
    watcher = fs.watch(testDir, { recursive: true });
    watcher.on("change", function (event, filename) {
      // This console.log makes the error happen
      // do not remove
      console.log(filename, event);
    });

    const testFile = path.join(testDir, "a");
    const child = spawn(
      process.argv[0],
      [
        "-e",
        `const fs = require('node:fs'); for (let i = 0; i < 10000; i++) { const fd = fs.openSync('${testFile}', 'w'); fs.writeSync(fd, Buffer.from('hello')); fs.rmSync('${testFile}') }`,
      ],
      {
        stdio: "inherit",
      },
    );

    child.on("exit", function () {
      watcher.close();
      done();
    });
  });
}

//<#END_FILE: test-fs-watch-recursive-linux-parallel-remove.js
