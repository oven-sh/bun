import { describe, expect, test } from "bun:test";
import { closeSync, openSync, utimesSync } from "fs";
import { isWindows, tempDir } from "harness";
import { join } from "path";

// jsc.toJSTime previously used unchecked @intCast to u64 on sec/nsec from
// fstat mtime. A file with mtime before the Unix epoch (negative seconds)
// would trip integerOutOfBounds in the ReadFile thread-pool task when
// resolveSizeAndLastModified stored last_modified. With the fix, the
// timestamp is clamped to 0 instead of crashing.
describe.skipIf(isWindows)("Bun.file with pre-epoch mtime", () => {
  test("text() on a path-backed file with negative mtime does not crash", async () => {
    using dir = tempDir("bun-file-neg-mtime", { "neg.txt": "hello" });
    const path = join(String(dir), "neg.txt");
    utimesSync(path, new Date(-12345678), new Date(-12345678));

    const f = Bun.file(path);
    expect(await f.text()).toBe("hello");
    expect(f.lastModified).toBe(0);
  });

  test("lastModified getter on a file with negative mtime does not crash", async () => {
    using dir = tempDir("bun-file-neg-mtime", { "neg.txt": "x" });
    const path = join(String(dir), "neg.txt");
    utimesSync(path, new Date(-5000), new Date(-5000));

    expect(Bun.file(path).lastModified).toBe(0);
  });

  test("text() on an fd-backed file with negative mtime does not crash", async () => {
    using dir = tempDir("bun-file-neg-mtime", { "neg.txt": "from fd" });
    const path = join(String(dir), "neg.txt");
    utimesSync(path, new Date(-1000), new Date(-1000));

    const fd = openSync(path, "r");
    try {
      const f = Bun.file(fd);
      expect(await f.text()).toBe("from fd");
      expect(f.lastModified).toBe(0);
    } finally {
      closeSync(fd);
    }
  });

  test("normal mtime is still reported correctly", async () => {
    using dir = tempDir("bun-file-neg-mtime", { "pos.txt": "ok" });
    const path = join(String(dir), "pos.txt");
    const now = Date.now();
    utimesSync(path, new Date(now), new Date(now));

    const f = Bun.file(path);
    expect(await f.text()).toBe("ok");
    expect(Math.abs(f.lastModified - now)).toBeLessThan(2000);
  });
});
