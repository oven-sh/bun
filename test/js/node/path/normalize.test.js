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

  // https://github.com/nodejs/node/blob/v26.3.0/lib/path.js#L438-L475
  test("win32 reserved device names", () => {
    // A reserved name is its own root and the result is made explicitly relative.
    assert.strictEqual(path.win32.normalize("CON:"), ".\\CON:.");
    assert.strictEqual(path.win32.normalize("con:"), ".\\con:.");
    assert.strictEqual(path.win32.normalize("CON:foo"), ".\\CON:foo");
    assert.strictEqual(path.win32.normalize("CON:..\\..\\foo"), ".\\CON:..\\..\\foo");
    assert.strictEqual(path.win32.normalize("AUX:/foo\\bar/baz"), ".\\AUX:foo\\bar\\baz");
    assert.strictEqual(path.win32.normalize("LPT9:"), ".\\LPT9:.");
    assert.strictEqual(path.win32.normalize("COM\u00b9:"), ".\\COM\u00b9:.");
    assert.strictEqual(path.win32.normalize("LPT\u00b3:"), ".\\LPT\u00b3:.");
    // JS `slice(0, -1)` drops the last character when there is no colon.
    assert.strictEqual(path.win32.normalize("PRNX"), ".\\PRNX");
    // Not reserved.
    assert.strictEqual(path.win32.normalize("CON"), "CON");
    assert.strictEqual(path.win32.normalize("COM10:"), ".\\COM10:");
    assert.strictEqual(path.win32.normalize("CONNINGTOWER:"), ".\\CONNINGTOWER:");
    assert.strictEqual(path.win32.normalize("C:\\COM9"), "C:\\COM9");
    // Reserved names after a UNC share are left alone.
    assert.strictEqual(path.win32.normalize("\\\\server\\share\\COM1:"), "\\\\server\\share\\COM1:");
    // Device roots.
    assert.strictEqual(path.win32.normalize("\\\\?\\COM1:"), "\\\\?\\COM1:\\");
    assert.strictEqual(path.win32.normalize("\\\\.\\PHYSICALDRIVE0"), "\\\\.\\PHYSICALDRIVE0");
  });

  // A relative path must not come back as something Windows reads as absolute.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/path.js#L455-L471 (CVE-2024-36139)
  test("win32 relative paths containing a colon", () => {
    assert.strictEqual(path.win32.normalize("foo:/bar"), ".\\foo:\\bar");
    assert.strictEqual(path.win32.normalize("foo:"), ".\\foo:");
    assert.strictEqual(path.win32.normalize("foo:bar"), "foo:bar");
    assert.strictEqual(path.win32.normalize("x:y/z"), "x:y\\z");
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
