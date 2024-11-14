//#FILE: test-fs-promises-file-handle-chmod.js
//#SHA1: 50a28df8df34deeca4b2f9d7598fb596894d7541
//-----------------
"use strict";

const fs = require("fs");
const { open } = fs.promises;
const path = require("path");
const os = require("os");

const tmpDir = os.tmpdir();

beforeEach(() => {
  jest.spyOn(fs, "statSync");
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("FileHandle.chmod base functionality", async () => {
  const filePath = path.resolve(tmpDir, "tmp-chmod.txt");
  const fileHandle = await open(filePath, "w+", 0o444);

  // File created with r--r--r-- 444
  const statsBeforeMod = fs.statSync(filePath);
  expect(statsBeforeMod.mode & 0o444).toBe(0o444);

  let expectedAccess;
  const newPermissions = 0o765;

  if (process.platform === "win32") {
    // Chmod in Windows will only toggle read only/write access. The
    // fs.Stats.mode in Windows is computed using read/write
    // bits (not exec). Read-only at best returns 444; r/w 666.
    // Refer: /deps/uv/src/win/fs.cfs;
    expectedAccess = 0o664;
  } else {
    expectedAccess = newPermissions;
  }

  // Change the permissions to rwxr--r-x
  await fileHandle.chmod(newPermissions);
  const statsAfterMod = fs.statSync(filePath);
  expect(statsAfterMod.mode & expectedAccess).toBe(expectedAccess);

  await fileHandle.close();
});

//<#END_FILE: test-fs-promises-file-handle-chmod.js
