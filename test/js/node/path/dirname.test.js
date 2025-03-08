import { describe, test } from "bun:test";
import { isWindows } from "harness";
import assert from "node:assert";
import path from "node:path";

describe("path.dirname", () => {
  test("platform", () => {
    assert.strictEqual(path.dirname(__filename).substr(-9), isWindows ? "node\\path" : "node/path");
  });

  test("win32", () => {
    assert.strictEqual(path.win32.dirname("c:\\"), "c:\\");
    assert.strictEqual(path.win32.dirname("c:\\foo"), "c:\\");
    assert.strictEqual(path.win32.dirname("c:\\foo\\"), "c:\\");
    assert.strictEqual(path.win32.dirname("c:\\foo\\bar"), "c:\\foo");
    assert.strictEqual(path.win32.dirname("c:\\foo\\bar\\"), "c:\\foo");
    assert.strictEqual(path.win32.dirname("c:\\foo\\bar\\baz"), "c:\\foo\\bar");
    assert.strictEqual(path.win32.dirname("c:\\foo bar\\baz"), "c:\\foo bar");
    assert.strictEqual(path.win32.dirname("\\"), "\\");
    assert.strictEqual(path.win32.dirname("\\foo"), "\\");
    assert.strictEqual(path.win32.dirname("\\foo\\"), "\\");
    assert.strictEqual(path.win32.dirname("\\foo\\bar"), "\\foo");
    assert.strictEqual(path.win32.dirname("\\foo\\bar\\"), "\\foo");
    assert.strictEqual(path.win32.dirname("\\foo\\bar\\baz"), "\\foo\\bar");
    assert.strictEqual(path.win32.dirname("\\foo bar\\baz"), "\\foo bar");
    assert.strictEqual(path.win32.dirname("c:"), "c:");
    assert.strictEqual(path.win32.dirname("c:foo"), "c:");
    assert.strictEqual(path.win32.dirname("c:foo\\"), "c:");
    assert.strictEqual(path.win32.dirname("c:foo\\bar"), "c:foo");
    assert.strictEqual(path.win32.dirname("c:foo\\bar\\"), "c:foo");
    assert.strictEqual(path.win32.dirname("c:foo\\bar\\baz"), "c:foo\\bar");
    assert.strictEqual(path.win32.dirname("c:foo bar\\baz"), "c:foo bar");
    assert.strictEqual(path.win32.dirname("file:stream"), ".");
    assert.strictEqual(path.win32.dirname("dir\\file:stream"), "dir");
    assert.strictEqual(path.win32.dirname("\\\\unc\\share"), "\\\\unc\\share");
    assert.strictEqual(path.win32.dirname("\\\\unc\\share\\foo"), "\\\\unc\\share\\");
    assert.strictEqual(path.win32.dirname("\\\\unc\\share\\foo\\"), "\\\\unc\\share\\");
    assert.strictEqual(path.win32.dirname("\\\\unc\\share\\foo\\bar"), "\\\\unc\\share\\foo");
    assert.strictEqual(path.win32.dirname("\\\\unc\\share\\foo\\bar\\"), "\\\\unc\\share\\foo");
    assert.strictEqual(path.win32.dirname("\\\\unc\\share\\foo\\bar\\baz"), "\\\\unc\\share\\foo\\bar");
    assert.strictEqual(path.win32.dirname("/a/b/"), "/a");
    assert.strictEqual(path.win32.dirname("/a/b"), "/a");
    assert.strictEqual(path.win32.dirname("/a"), "/");
    assert.strictEqual(path.win32.dirname(""), ".");
    assert.strictEqual(path.win32.dirname("/"), "/");
    assert.strictEqual(path.win32.dirname("////"), "/");
    assert.strictEqual(path.win32.dirname("foo"), ".");
  });

  test("posix", () => {
    assert.strictEqual(path.posix.dirname("/a/b/"), "/a");
    assert.strictEqual(path.posix.dirname("/a/b"), "/a");
    assert.strictEqual(path.posix.dirname("/a"), "/");
    assert.strictEqual(path.posix.dirname(""), ".");
    assert.strictEqual(path.posix.dirname("/"), "/");
    assert.strictEqual(path.posix.dirname("////"), "/");
    assert.strictEqual(path.posix.dirname("//a"), "//");
    assert.strictEqual(path.posix.dirname("foo"), ".");
  });
});
