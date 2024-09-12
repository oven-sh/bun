//#FILE: test-path-zero-length-strings.js
//#SHA1: 2f55f68499f5dcd0b2cbb43e7793c0f45175402f
//-----------------
"use strict";

// These testcases are specific to one uncommon behavior in path module. Few
// of the functions in path module, treat '' strings as current working
// directory. This test makes sure that the behavior is intact between commits.
// See: https://github.com/nodejs/node/pull/2106

const path = require("path");
const pwd = process.cwd();

describe("Path module zero-length strings behavior", () => {
  test("Join with zero-length strings", () => {
    expect(path.posix.join("")).toBe(".");
    expect(path.posix.join("", "")).toBe(".");
    expect(path.win32.join("")).toBe(".");
    expect(path.win32.join("", "")).toBe(".");
    expect(path.join(pwd)).toBe(pwd);
    expect(path.join(pwd, "")).toBe(pwd);
  });

  test("Normalize with zero-length strings", () => {
    expect(path.posix.normalize("")).toBe(".");
    expect(path.win32.normalize("")).toBe(".");
    expect(path.normalize(pwd)).toBe(pwd);
  });

  test("isAbsolute with zero-length strings", () => {
    expect(path.posix.isAbsolute("")).toBe(false);
    expect(path.win32.isAbsolute("")).toBe(false);
  });

  test("Resolve with zero-length strings", () => {
    expect(path.resolve("")).toBe(pwd);
    expect(path.resolve("", "")).toBe(pwd);
  });

  test("Relative with zero-length strings", () => {
    expect(path.relative("", pwd)).toBe("");
    expect(path.relative(pwd, "")).toBe("");
    expect(path.relative(pwd, pwd)).toBe("");
  });
});

//<#END_FILE: test-path-zero-length-strings.js
