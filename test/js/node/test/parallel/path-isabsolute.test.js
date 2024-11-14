//#FILE: test-path-isabsolute.js
//#SHA1: d0ff051a7934f18aed9c435a823ff688e5f782c1
//-----------------
"use strict";

const path = require("path");

test("path.win32.isAbsolute", () => {
  expect(path.win32.isAbsolute("/")).toBe(true);
  expect(path.win32.isAbsolute("//")).toBe(true);
  expect(path.win32.isAbsolute("//server")).toBe(true);
  expect(path.win32.isAbsolute("//server/file")).toBe(true);
  expect(path.win32.isAbsolute("\\\\server\\file")).toBe(true);
  expect(path.win32.isAbsolute("\\\\server")).toBe(true);
  expect(path.win32.isAbsolute("\\\\")).toBe(true);
  expect(path.win32.isAbsolute("c")).toBe(false);
  expect(path.win32.isAbsolute("c:")).toBe(false);
  expect(path.win32.isAbsolute("c:\\")).toBe(true);
  expect(path.win32.isAbsolute("c:/")).toBe(true);
  expect(path.win32.isAbsolute("c://")).toBe(true);
  expect(path.win32.isAbsolute("C:/Users/")).toBe(true);
  expect(path.win32.isAbsolute("C:\\Users\\")).toBe(true);
  expect(path.win32.isAbsolute("C:cwd/another")).toBe(false);
  expect(path.win32.isAbsolute("C:cwd\\another")).toBe(false);
  expect(path.win32.isAbsolute("directory/directory")).toBe(false);
  expect(path.win32.isAbsolute("directory\\directory")).toBe(false);
});

test("path.posix.isAbsolute", () => {
  expect(path.posix.isAbsolute("/home/foo")).toBe(true);
  expect(path.posix.isAbsolute("/home/foo/..")).toBe(true);
  expect(path.posix.isAbsolute("bar/")).toBe(false);
  expect(path.posix.isAbsolute("./baz")).toBe(false);
});

//<#END_FILE: test-path-isabsolute.js
