import { test, describe } from "bun:test";
import assert from "node:assert";
import path from "node:path";
import fixtures from "./common/fixtures.js";

const isWindows = process.platform === "win32";

describe("path.toNamespacedPath", () => {
  const emptyObj = {};

  test("platform", () => {
    assert.strictEqual(path.toNamespacedPath(""), "");
    assert.strictEqual(path.toNamespacedPath(null), null);
    assert.strictEqual(path.toNamespacedPath(100), 100);
    assert.strictEqual(path.toNamespacedPath(path), path);
    assert.strictEqual(path.toNamespacedPath(false), false);
    assert.strictEqual(path.toNamespacedPath(true), true);

    if (isWindows) {
      const relativeFixture = fixtures.path("a.js");
      const resolvedFixture = path.resolve(relativeFixture);

      assert.strictEqual(path.toNamespacedPath(relativeFixture), `\\\\?\\${resolvedFixture}`);
      assert.strictEqual(path.toNamespacedPath(`\\\\?\\${relativeFixture}`), `\\\\?\\${resolvedFixture}`);
      assert.strictEqual(
        path.toNamespacedPath("\\\\someserver\\someshare\\somefile"),
        "\\\\?\\UNC\\someserver\\someshare\\somefile",
      );
      assert.strictEqual(
        path.toNamespacedPath("\\\\?\\UNC\\someserver\\someshare\\somefile"),
        "\\\\?\\UNC\\someserver\\someshare\\somefile",
      );
      assert.strictEqual(path.toNamespacedPath("\\\\.\\pipe\\somepipe"), "\\\\.\\pipe\\somepipe");

      // These tests cause resolve() to insert the cwd, so we cannot test them from
      // non-Windows platforms (easily)
      assert.strictEqual(path.toNamespacedPath(""), "");
      assert.strictEqual(
        path.win32.toNamespacedPath("foo\\bar").toLowerCase(),
        `\\\\?\\${process.cwd().toLowerCase()}\\foo\\bar`,
      );
      assert.strictEqual(
        path.win32.toNamespacedPath("foo/bar").toLowerCase(),
        `\\\\?\\${process.cwd().toLowerCase()}\\foo\\bar`,
      );
      const currentDeviceLetter = path.parse(process.cwd()).root.substring(0, 2);
      assert.strictEqual(
        path.win32.toNamespacedPath(currentDeviceLetter).toLowerCase(),
        `\\\\?\\${process.cwd().toLowerCase()}`,
      );
      assert.strictEqual(path.win32.toNamespacedPath("C").toLowerCase(), `\\\\?\\${process.cwd().toLowerCase()}\\c`);
    }
  });

  test("alias as _makeLong", () => {
    assert.strictEqual(path._makeLong, path.toNamespacedPath);
  });

  test("win32", () => {
    assert.strictEqual(path.win32.toNamespacedPath("C:\\foo"), "\\\\?\\C:\\foo");
    assert.strictEqual(path.win32.toNamespacedPath("C:/foo"), "\\\\?\\C:\\foo");
    assert.strictEqual(path.win32.toNamespacedPath("\\\\foo\\bar"), "\\\\?\\UNC\\foo\\bar\\");
    assert.strictEqual(path.win32.toNamespacedPath("//foo//bar"), "\\\\?\\UNC\\foo\\bar\\");
    assert.strictEqual(path.win32.toNamespacedPath("\\\\?\\foo\\"), "\\\\?\\foo\\");
    assert.strictEqual(path.win32.toNamespacedPath("\\\\?\\foo"), "\\\\?\\foo\\");
    assert.strictEqual(path.win32.toNamespacedPath("\\\\?\\c:\\Windows/System"), "\\\\?\\c:\\Windows\\System");
    assert.strictEqual(path.win32.toNamespacedPath(null), null);
    assert.strictEqual(path.win32.toNamespacedPath(true), true);
    assert.strictEqual(path.win32.toNamespacedPath(1), 1);
    assert.strictEqual(path.win32.toNamespacedPath(), undefined);
    assert.strictEqual(path.win32.toNamespacedPath(emptyObj), emptyObj);
  });

  test("posix", () => {
    assert.strictEqual(path.posix.toNamespacedPath("/foo/bar"), "/foo/bar");
    assert.strictEqual(path.posix.toNamespacedPath("foo/bar"), "foo/bar");
    assert.strictEqual(path.posix.toNamespacedPath(null), null);
    assert.strictEqual(path.posix.toNamespacedPath(true), true);
    assert.strictEqual(path.posix.toNamespacedPath(1), 1);
    assert.strictEqual(path.posix.toNamespacedPath(), undefined);
    assert.strictEqual(path.posix.toNamespacedPath(emptyObj), emptyObj);
  });
});
