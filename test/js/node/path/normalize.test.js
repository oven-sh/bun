import { describe, test } from "bun:test";
import assert from "node:assert";
import path from "node:path";

describe("path.normalize", () => {
  test("win32", () => {
    assert.strictEqual(path.win32.normalize("./fixtures///b/../b/c.js"), "fixtures\\b\\c.js");
    assert.strictEqual(path.win32.normalize("/foo/../../../bar"), "\\bar");
    assert.strictEqual(path.win32.normalize("a//b//../b"), "a\\b");
    assert.strictEqual(path.win32.normalize("a//b//./c"), "a\\b\\c");
    assert.strictEqual(path.win32.normalize("a//b//."), "a\\b");
    assert.strictEqual(path.win32.normalize("//server/share/dir/file.ext"), "\\\\server\\share\\dir\\file.ext");
    assert.strictEqual(path.win32.normalize("/a/b/c/../../../x/y/z"), "\\x\\y\\z");
    assert.strictEqual(path.win32.normalize("C:"), "C:.");
    assert.strictEqual(path.win32.normalize("C:..\\abc"), "C:..\\abc");
    assert.strictEqual(path.win32.normalize("C:..\\..\\abc\\..\\def"), "C:..\\..\\def");
    assert.strictEqual(path.win32.normalize("C:\\."), "C:\\");
    assert.strictEqual(path.win32.normalize("file:stream"), "file:stream");
    assert.strictEqual(path.win32.normalize("bar\\foo..\\..\\"), "bar\\");
    assert.strictEqual(path.win32.normalize("bar\\foo..\\.."), "bar");
    assert.strictEqual(path.win32.normalize("bar\\foo..\\..\\baz"), "bar\\baz");
    assert.strictEqual(path.win32.normalize("bar\\foo..\\"), "bar\\foo..\\");
    assert.strictEqual(path.win32.normalize("bar\\foo.."), "bar\\foo..");
    assert.strictEqual(path.win32.normalize("..\\foo..\\..\\..\\bar"), "..\\..\\bar");
    assert.strictEqual(path.win32.normalize("..\\...\\..\\.\\...\\..\\..\\bar"), "..\\..\\bar");
    assert.strictEqual(path.win32.normalize("../../../foo/../../../bar"), "..\\..\\..\\..\\..\\bar");
    assert.strictEqual(path.win32.normalize("../../../foo/../../../bar/../../"), "..\\..\\..\\..\\..\\..\\");
    assert.strictEqual(path.win32.normalize("../foobar/barfoo/foo/../../../bar/../../"), "..\\..\\");
    assert.strictEqual(path.win32.normalize("../.../../foobar/../../../bar/../../baz"), "..\\..\\..\\..\\baz");
    assert.strictEqual(path.win32.normalize("foo/bar\\baz"), "foo\\bar\\baz");
  });

  test("win32 names with a colon", () => {
    const { join, normalize } = path.win32;
    const wide = text => ("\u65e5" + text).slice(1);
    const long = Buffer.alloc(600, "n").toString();
    for (const [input, expected] of [
      ["ab:", ".\\ab:"],
      ["ab:/c", ".\\ab:\\c"],
      ["ab:c", "ab:c"],
      ["ab:c/d:", ".\\ab:c\\d:"],
      ["ab:/../c", "c"],
      ["../ab:", "..\\ab:"],
      ["..a/ab:", ".\\..a\\ab:"],
      ["./C:a", ".\\C:a"],
      ["CON:", ".\\CON:"],
      ["con:/a", ".\\con:\\a"],
      ["COM1:./a", ".\\COM1:.\\a"],
      ["CON::", ".\\CON::"],
      ["./NUL:a", ".\\NUL:a"],
      ["a\\\\NUL:b", "a\\NUL:b"],
      ["c:COM1:", "c:COM1:"],
      ["C:\\a\\.\\NUL:", "C:\\a\\NUL:"],
      ["\\a\\LPT1:", "\\a\\LPT1:"],
      ["\\\\a\\b\\COM1:\\c", "\\\\a\\b\\COM1:\\c"],
      ["\\\\.\\COM1:", "\\\\.\\COM1:"],
      ["\\\\?\\COM1:a", "\\\\?\\COM1:a"],
    ]) {
      for (const form of [input, wide(input), expected]) {
        assert.strictEqual(normalize(form), expected);
        assert.strictEqual(join(form), expected);
      }
      assert.strictEqual(join("x", input), normalize(`x\\${input}`));
      assert.strictEqual(join(input, long), normalize(`${input}\\${long}`));
    }
  });

  test("win32 reserved names", () => {
    const numbered = digits => [...digits].flatMap(digit => ["COM" + digit, "LPT" + digit]);
    for (const [names, prefix] of [
      [["CON", "PRN", "AUX", "NUL", ...numbered("123456789\xb9\xb2\xb3")], ".\\"],
      [["CO", "CONN", "COM", "COM10", "\u0143ON", ...numbered("0\xb0\u2074\u0131")], ""],
    ]) {
      for (const name of names.flatMap(name => [name, name.toLowerCase()])) {
        assert.strictEqual(path.win32.normalize(`${name}:a`), `${prefix}${name}:a`);
        for (const suffix of ["", "f", ".txt"]) assert.strictEqual(path.win32.normalize(name + suffix), name + suffix);
      }
    }
  });

  test("win32 server names", () => {
    const { dirname, join, normalize, parse, resolve } = path.win32;
    for (const [input, expected] of [
      ["//a/b/c", ["//a/b/", "//a/b/", "\\\\a\\b\\c", "\\\\a\\b\\c"]],
      ["//.../b/c", ["//.../b/", "//.../b/", "\\\\...\\b\\c", "\\\\...\\b\\c"]],
      ["//..a/b/c", ["//..a/b/", "//..a/b/", "\\\\..a\\b\\c", "\\\\..a\\b\\c"]],
      ["//./b/c", ["//./b/", "//./b/", "\\\\.\\b\\c", "\\\\.\\b\\c"]],
      ["///b/c", ["/", "///b", "\\b\\c", "C:\\b\\c"]],
      ["//../b/c", ["/", "//../b", "\\b\\c", "C:\\b\\c"]],
      ["\\\\..\\b", ["\\", "\\\\..", "\\b", "C:\\b"]],
    ]) {
      for (const form of [input, ("\u65e5" + input).slice(1)]) {
        assert.deepStrictEqual([parse(form).root, dirname(form), normalize(form), resolve("C:\\x", form)], expected);
        assert.strictEqual(join(form), normalize(form));
      }
    }
    assert.deepStrictEqual([join("//a", "b"), join("//..", "b")], ["\\\\a\\b\\", "\\b"]);
  });

  test("posix", () => {
    assert.strictEqual(path.posix.normalize("./fixtures///b/../b/c.js"), "fixtures/b/c.js");
    assert.strictEqual(path.posix.normalize("/foo/../../../bar"), "/bar");
    assert.strictEqual(path.posix.normalize("a//b//../b"), "a/b");
    assert.strictEqual(path.posix.normalize("a//b//./c"), "a/b/c");
    assert.strictEqual(path.posix.normalize("a//b//."), "a/b");
    assert.strictEqual(path.posix.normalize("/a/b/c/../../../x/y/z"), "/x/y/z");
    assert.strictEqual(path.posix.normalize("///..//./foo/.//bar"), "/foo/bar");
    assert.strictEqual(path.posix.normalize("bar/foo../../"), "bar/");
    assert.strictEqual(path.posix.normalize("bar/foo../.."), "bar");
    assert.strictEqual(path.posix.normalize("bar/foo../../baz"), "bar/baz");
    assert.strictEqual(path.posix.normalize("bar/foo../"), "bar/foo../");
    assert.strictEqual(path.posix.normalize("bar/foo.."), "bar/foo..");
    assert.strictEqual(path.posix.normalize("../foo../../../bar"), "../../bar");
    assert.strictEqual(path.posix.normalize("../.../.././.../../../bar"), "../../bar");
    assert.strictEqual(path.posix.normalize("../../../foo/../../../bar"), "../../../../../bar");
    assert.strictEqual(path.posix.normalize("../../../foo/../../../bar/../../"), "../../../../../../");
    assert.strictEqual(path.posix.normalize("../foobar/barfoo/foo/../../../bar/../../"), "../../");
    assert.strictEqual(path.posix.normalize("../.../../foobar/../../../bar/../../baz"), "../../../../baz");
    assert.strictEqual(path.posix.normalize("foo/bar\\baz"), "foo/bar\\baz");
  });

  test("first segment of exactly 4 chars ending in '..' followed by '..'", () => {
    // normalizeString's lastSegmentLength for the FIRST segment must be `i`
    // (Node's lastSlash starts at -1), not `i - 2`: a 4-char first segment
    // ending in ".." was misrecorded as a literal ".." and never popped.
    assert.strictEqual(path.posix.normalize("bb../../x"), "x");
    assert.strictEqual(path.win32.normalize("bb..\\..\\x"), "x");
    assert.strictEqual(path.win32.normalize("bb../../x"), "x");
    assert.strictEqual(path.posix.normalize("..../../x"), "x");
    assert.strictEqual(path.posix.normalize("bb../.."), ".");
    assert.strictEqual(path.posix.normalize("bb../../"), "./");
    assert.strictEqual(path.posix.join("bb..", "..", "x"), "x");
    assert.strictEqual(path.win32.join("bb..", "..", "x"), "x");
    // Other first-segment shapes are unaffected.
    assert.strictEqual(path.posix.normalize("b../../x"), "x");
    assert.strictEqual(path.posix.normalize("abc../../x"), "x");
    assert.strictEqual(path.posix.normalize("abcd/../x"), "x");
    // A real ".." first segment still can't be popped, and absolute paths
    // never start a segment at lastSlash === -1.
    assert.strictEqual(path.posix.normalize("../../x"), "../../x");
    assert.strictEqual(path.posix.normalize("/bb../../x"), "/x");
  });

  test("very long paths", () => {
    // Regression test: buffer overflow with paths longer than PATH_SIZE
    // This used to panic with "index out of bounds" because the buffer
    // didn't account for the null terminator
    for (const len of [4096, 10000, 50000, 98340, 100000]) {
      const longPath = "a".repeat(len);
      assert.strictEqual(path.normalize(longPath), longPath);
      assert.strictEqual(path.normalize(longPath).length, len);
    }
  });
});
