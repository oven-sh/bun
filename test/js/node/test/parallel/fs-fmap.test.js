//#FILE: test-fs-fmap.js
//#SHA1: e43c52ee1e1cc13409716f93c9b273d6fb9d10cc
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const { O_CREAT = 0, O_RDONLY = 0, O_TRUNC = 0, O_WRONLY = 0, UV_FS_O_FILEMAP = 0 } = fs.constants;

// Helper function to create a temporary directory
const createTempDir = () => {
  const tempDir = path.join(os.tmpdir(), "jest-test-fs-fmap");
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
};

describe("File Memory Mapping", () => {
  let tmpdir;
  let filename;
  const text = "Memory File Mapping Test";

  beforeEach(() => {
    tmpdir = createTempDir();
    filename = path.resolve(tmpdir, "fmap.txt");
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test("should write and read file using memory mapping flags", () => {
    const mw = UV_FS_O_FILEMAP | O_TRUNC | O_CREAT | O_WRONLY;
    const mr = UV_FS_O_FILEMAP | O_RDONLY;

    fs.writeFileSync(filename, text, { flag: mw });
    const r1 = fs.readFileSync(filename, { encoding: "utf8", flag: mr });
    expect(r1).toBe(text);
  });
});

//<#END_FILE: test-fs-fmap.js
