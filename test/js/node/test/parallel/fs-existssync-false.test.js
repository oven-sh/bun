//#FILE: test-fs-existssync-false.js
//#SHA1: 2c95d1c0df7ea6025cf8915f8544ba975b01e69a
//-----------------
"use strict";

const tmpdir = require("../common/tmpdir");
const fs = require("fs");
const path = require("path");

// This test ensures that fs.existsSync doesn't incorrectly return false.
// (especially on Windows)
// https://github.com/nodejs/node-v0.x-archive/issues/3739

describe("fs.existsSync", () => {
  let dir;

  beforeAll(() => {
    dir = path.resolve(tmpdir.path);

    // Make sure that the tmp directory is clean
    tmpdir.refresh();

    // Make a long path.
    for (let i = 0; i < 50; i++) {
      dir = `${dir}/1234567890`;
      try {
        fs.mkdirSync(dir, "0777");
      } catch (e) {
        if (e.code !== "EEXIST") {
          throw e;
        }
      }
    }
  });

  test("directory is accessible synchronously", () => {
    expect(fs.existsSync(dir)).toBe(true);
  });

  test("directory is accessible asynchronously", async () => {
    await expect(fs.promises.access(dir)).resolves.toBeUndefined();
  });
});

//<#END_FILE: test-fs-existssync-false.js
