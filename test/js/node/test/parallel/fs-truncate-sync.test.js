//#FILE: test-fs-truncate-sync.js
//#SHA1: 6b4ccbf9b9fab199c6b258374cf0a1665b1c21fe
//-----------------
"use strict";

const path = require("path");
const fs = require("fs");
const tmpdir = require("../common/tmpdir");
const tmp = tmpdir.path;

describe("fs.truncateSync", () => {
  beforeEach(() => {
    tmpdir.refresh();
  });

  test("truncates file correctly", () => {
    const filename = path.resolve(tmp, "truncate-sync-file.txt");

    fs.writeFileSync(filename, "hello world", "utf8");

    const fd = fs.openSync(filename, "r+");

    fs.truncateSync(fd, 5);
    expect(fs.readFileSync(fd)).toEqual(Buffer.from("hello"));

    fs.closeSync(fd);
    fs.unlinkSync(filename);
  });
});

//<#END_FILE: test-fs-truncate-sync.js
