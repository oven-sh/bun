//#FILE: test-fs-watch-recursive-add-file-to-new-folder.js
//#SHA1: bc5d61f8d02079edf7e909ebfb027c9c7118fa96
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

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"));

beforeEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

test("Add a file to newly created folder to already watching folder", done => {
  const rootDirectory = fs.mkdtempSync(path.join(testDir, "root-"));
  const testDirectory = path.join(rootDirectory, "test-3");
  fs.mkdirSync(testDirectory);

  const filePath = path.join(testDirectory, "folder-3");

  const childrenFile = "file-4.txt";
  const childrenAbsolutePath = path.join(filePath, childrenFile);
  const childrenRelativePath = path.join(path.basename(filePath), childrenFile);

  const watcher = fs.watch(testDirectory, { recursive: true });
  let watcherClosed = false;

  watcher.on("change", function (event, filename) {
    expect(event).toBe("rename");
    expect(filename).toMatch(new RegExp(`^(${path.basename(filePath)}|${childrenRelativePath})$`));

    if (filename === childrenRelativePath) {
      watcher.close();
      watcherClosed = true;
      expect(watcherClosed).toBe(true);
      done();
    }
  });

  // Do the write with a delay to ensure that the OS is ready to notify us.
  setTimeout(() => {
    fs.mkdirSync(filePath);
    fs.writeFileSync(childrenAbsolutePath, "world");
  }, 200);
});

//<#END_FILE: test-fs-watch-recursive-add-file-to-new-folder.js
