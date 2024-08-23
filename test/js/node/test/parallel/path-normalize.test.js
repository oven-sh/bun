//#FILE: test-path-normalize.js
//#SHA1: 94c9aec4a962fc0737d7a88610d3c3e17a3b96b5
//-----------------
"use strict";

const path = require("path");

describe("path.normalize", () => {
  describe("win32", () => {
    test("normalizes various paths correctly", () => {
      expect(path.win32.normalize("./fixtures///b/../b/c.js")).toBe("fixtures\\b\\c.js");
      expect(path.win32.normalize("/foo/../../../bar")).toBe("\\bar");
      expect(path.win32.normalize("a//b//../b")).toBe("a\\b");
      expect(path.win32.normalize("a//b//./c")).toBe("a\\b\\c");
      expect(path.win32.normalize("a//b//.")).toBe("a\\b");
      expect(path.win32.normalize("//server/share/dir/file.ext")).toBe("\\\\server\\share\\dir\\file.ext");
      expect(path.win32.normalize("/a/b/c/../../../x/y/z")).toBe("\\x\\y\\z");
      expect(path.win32.normalize("C:")).toBe("C:.");
      expect(path.win32.normalize("C:..\\abc")).toBe("C:..\\abc");
      expect(path.win32.normalize("C:..\\..\\abc\\..\\def")).toBe("C:..\\..\\def");
      expect(path.win32.normalize("C:\\.")).toBe("C:\\");
      expect(path.win32.normalize("file:stream")).toBe("file:stream");
      expect(path.win32.normalize("bar\\foo..\\..\\")).toBe("bar\\");
      expect(path.win32.normalize("bar\\foo..\\..")).toBe("bar");
      expect(path.win32.normalize("bar\\foo..\\..\\baz")).toBe("bar\\baz");
      expect(path.win32.normalize("bar\\foo..\\")).toBe("bar\\foo..\\");
      expect(path.win32.normalize("bar\\foo..")).toBe("bar\\foo..");
      expect(path.win32.normalize("..\\foo..\\..\\..\\bar")).toBe("..\\..\\bar");
      expect(path.win32.normalize("..\\...\\..\\.\\...\\..\\..\\bar")).toBe("..\\..\\bar");
      expect(path.win32.normalize("../../../foo/../../../bar")).toBe("..\\..\\..\\..\\..\\bar");
      expect(path.win32.normalize("../../../foo/../../../bar/../../")).toBe("..\\..\\..\\..\\..\\..\\");
      expect(path.win32.normalize("../foobar/barfoo/foo/../../../bar/../../")).toBe("..\\..\\");
      expect(path.win32.normalize("../.../../foobar/../../../bar/../../baz")).toBe("..\\..\\..\\..\\baz");
      expect(path.win32.normalize("foo/bar\\baz")).toBe("foo\\bar\\baz");
    });
  });

  describe("posix", () => {
    test("normalizes various paths correctly", () => {
      expect(path.posix.normalize("./fixtures///b/../b/c.js")).toBe("fixtures/b/c.js");
      expect(path.posix.normalize("/foo/../../../bar")).toBe("/bar");
      expect(path.posix.normalize("a//b//../b")).toBe("a/b");
      expect(path.posix.normalize("a//b//./c")).toBe("a/b/c");
      expect(path.posix.normalize("a//b//.")).toBe("a/b");
      expect(path.posix.normalize("/a/b/c/../../../x/y/z")).toBe("/x/y/z");
      expect(path.posix.normalize("///..//./foo/.//bar")).toBe("/foo/bar");
      expect(path.posix.normalize("bar/foo../../")).toBe("bar/");
      expect(path.posix.normalize("bar/foo../..")).toBe("bar");
      expect(path.posix.normalize("bar/foo../../baz")).toBe("bar/baz");
      expect(path.posix.normalize("bar/foo../")).toBe("bar/foo../");
      expect(path.posix.normalize("bar/foo..")).toBe("bar/foo..");
      expect(path.posix.normalize("../foo../../../bar")).toBe("../../bar");
      expect(path.posix.normalize("../.../.././.../../../bar")).toBe("../../bar");
      expect(path.posix.normalize("../../../foo/../../../bar")).toBe("../../../../../bar");
      expect(path.posix.normalize("../../../foo/../../../bar/../../")).toBe("../../../../../../");
      expect(path.posix.normalize("../foobar/barfoo/foo/../../../bar/../../")).toBe("../../");
      expect(path.posix.normalize("../.../../foobar/../../../bar/../../baz")).toBe("../../../../baz");
      expect(path.posix.normalize("foo/bar\\baz")).toBe("foo/bar\\baz");
    });
  });
});

//<#END_FILE: test-path-normalize.js
