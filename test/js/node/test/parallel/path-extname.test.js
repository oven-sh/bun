//#FILE: test-path-extname.js
//#SHA1: 29d676d507ef80d7e5795db0f2a0265dbc7baf1e
//-----------------
"use strict";
const path = require("path");

const slashRE = /\//g;

const testPaths = [
  [__filename, ".js"],
  ["", ""],
  ["/path/to/file", ""],
  ["/path/to/file.ext", ".ext"],
  ["/path.to/file.ext", ".ext"],
  ["/path.to/file", ""],
  ["/path.to/.file", ""],
  ["/path.to/.file.ext", ".ext"],
  ["/path/to/f.ext", ".ext"],
  ["/path/to/..ext", ".ext"],
  ["/path/to/..", ""],
  ["file", ""],
  ["file.ext", ".ext"],
  [".file", ""],
  [".file.ext", ".ext"],
  ["/file", ""],
  ["/file.ext", ".ext"],
  ["/.file", ""],
  ["/.file.ext", ".ext"],
  [".path/file.ext", ".ext"],
  ["file.ext.ext", ".ext"],
  ["file.", "."],
  [".", ""],
  ["./", ""],
  [".file.ext", ".ext"],
  [".file", ""],
  [".file.", "."],
  [".file..", "."],
  ["..", ""],
  ["../", ""],
  ["..file.ext", ".ext"],
  ["..file", ".file"],
  ["..file.", "."],
  ["..file..", "."],
  ["...", "."],
  ["...ext", ".ext"],
  ["....", "."],
  ["file.ext/", ".ext"],
  ["file.ext//", ".ext"],
  ["file/", ""],
  ["file//", ""],
  ["file./", "."],
  ["file.//", "."],
];

describe("path.extname", () => {
  test("should return correct extensions for various paths", () => {
    const failures = [];

    for (const testPath of testPaths) {
      const expected = testPath[1];
      const extNames = [path.posix.extname, path.win32.extname];
      for (const extname of extNames) {
        let input = testPath[0];
        let os;
        if (extname === path.win32.extname) {
          input = input.replace(slashRE, "\\");
          os = "win32";
        } else {
          os = "posix";
        }
        const actual = extname(input);
        const message = `path.${os}.extname(${JSON.stringify(input)})\n  expect=${JSON.stringify(
          expected,
        )}\n  actual=${JSON.stringify(actual)}`;
        if (actual !== expected) failures.push(`\n${message}`);
      }
      const input = `C:${testPath[0].replace(slashRE, "\\")}`;
      const actual = path.win32.extname(input);
      const message = `path.win32.extname(${JSON.stringify(input)})\n  expect=${JSON.stringify(
        expected,
      )}\n  actual=${JSON.stringify(actual)}`;
      if (actual !== expected) failures.push(`\n${message}`);
    }

    expect(failures).toHaveLength(0);
  });

  describe("Windows-specific behavior", () => {
    test("backslash is a path separator", () => {
      expect(path.win32.extname(".\\").toString()).toBe("");
      expect(path.win32.extname("..\\").toString()).toBe("");
      expect(path.win32.extname("file.ext\\").toString()).toBe(".ext");
      expect(path.win32.extname("file.ext\\\\").toString()).toBe(".ext");
      expect(path.win32.extname("file\\").toString()).toBe("");
      expect(path.win32.extname("file\\\\").toString()).toBe("");
      expect(path.win32.extname("file.\\").toString()).toBe(".");
      expect(path.win32.extname("file.\\\\").toString()).toBe(".");
    });
  });

  describe("POSIX-specific behavior", () => {
    test("backslash is a valid name component", () => {
      expect(path.posix.extname(".\\").toString()).toBe("");
      expect(path.posix.extname("..\\").toString()).toBe(".\\");
      expect(path.posix.extname("file.ext\\").toString()).toBe(".ext\\");
      expect(path.posix.extname("file.ext\\\\").toString()).toBe(".ext\\\\");
      expect(path.posix.extname("file\\").toString()).toBe("");
      expect(path.posix.extname("file\\\\").toString()).toBe("");
      expect(path.posix.extname("file.\\").toString()).toBe(".\\");
      expect(path.posix.extname("file.\\\\").toString()).toBe(".\\\\");
    });
  });
});

//<#END_FILE: test-path-extname.js
