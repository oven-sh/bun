//#FILE: test-fs-link.js
//#SHA1: 255940f3f953a4bd693b3e475bc466d5f759875f
//-----------------
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmpdir = {
  refresh: () => {
    // Implement a simple tmpdir.refresh() function
    const testDir = path.join(os.tmpdir(), "test-fs-link");
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
    return testDir;
  },
  resolve: filename => path.join(tmpdir.refresh(), filename),
};

test("Test creating and reading hard link", done => {
  const srcPath = tmpdir.resolve("hardlink-target.txt");
  const dstPath = tmpdir.resolve("link1.js");
  fs.writeFileSync(srcPath, "hello world");

  fs.link(srcPath, dstPath, err => {
    expect(err).toBeFalsy();
    const dstContent = fs.readFileSync(dstPath, "utf8");
    expect(dstContent).toBe("hello world");
    done();
  });
});

test("test error outputs", () => {
  [false, 1, [], {}, null, undefined].forEach(i => {
    expect(() => fs.link(i, "", () => {})).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
      }),
    );

    expect(() => fs.link("", i, () => {})).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
      }),
    );

    expect(() => fs.linkSync(i, "")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
      }),
    );

    expect(() => fs.linkSync("", i)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
      }),
    );
  });
});

//<#END_FILE: test-fs-link.js
