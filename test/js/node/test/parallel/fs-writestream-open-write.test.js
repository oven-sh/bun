//#FILE: test-fs-writestream-open-write.js
//#SHA1: a4cb8508ae1f366c94442a43312a817f00b68de6
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

// Regression test for https://github.com/nodejs/node/issues/51993

let tmpdir;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "test-fs-writestream-open-write-"));
});

afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test("fs.createWriteStream opens and writes correctly", done => {
  const file = path.join(tmpdir, "test-fs-writestream-open-write.txt");

  const w = fs.createWriteStream(file);

  w.on("open", () => {
    w.write("hello");

    process.nextTick(() => {
      w.write("world");
      w.end();
    });
  });

  w.on("close", () => {
    expect(fs.readFileSync(file, "utf8")).toBe("helloworld");
    fs.unlinkSync(file);
    done();
  });
});

//<#END_FILE: test-fs-writestream-open-write.js
