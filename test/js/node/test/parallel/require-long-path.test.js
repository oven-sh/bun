//#FILE: test-require-long-path.js
//#SHA1: b4345dca840dffc80e019e0fd4f4c3be77ac248a
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

// Skip this test if not running on Windows
const isWindows = process.platform === "win32";
if (!isWindows) {
  test.skip("this test is Windows-specific.", () => {});
} else {
  let tmpdir;

  beforeEach(() => {
    // Create a temporary directory for the test
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "test-require-long-path-"));
  });

  afterEach(() => {
    // Clean up the temporary directory after each test
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test("require works with long paths", () => {
    // Make a path that is more than 260 chars long.
    const dirNameLen = Math.max(260 - tmpdir.length, 1);
    const dirName = path.resolve(tmpdir, "x".repeat(dirNameLen));
    const fullDirPath = path.resolve(dirName);

    const indexFile = path.join(fullDirPath, "index.js");
    const otherFile = path.join(fullDirPath, "other.js");

    fs.mkdirSync(fullDirPath, { recursive: true });
    fs.writeFileSync(indexFile, 'require("./other");');
    fs.writeFileSync(otherFile, "");

    // This should not throw
    expect(() => {
      require(indexFile);
    }).not.toThrow();

    // This should not throw
    expect(() => {
      require(otherFile);
    }).not.toThrow();
  });
}

//<#END_FILE: test-require-long-path.js
