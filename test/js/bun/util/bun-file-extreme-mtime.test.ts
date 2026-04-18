import { describe, expect, test } from "bun:test";
import fs from "fs";
import { isLinux, tempDir } from "harness";
import { join } from "path";

// Files can have modification times large enough that converting the
// timespec to milliseconds overflows a 64-bit integer. Reading such a
// file through Bun.file() should not panic.
//
// tmpfs on Linux accepts arbitrary 64-bit mtimes via futimens(), which
// lets us construct a file whose mtime.sec * 1000 exceeds i64 max. Other
// filesystems clamp the value before it reaches fstat(), so this test is
// limited to Linux.
describe.skipIf(!isLinux)("Bun.file() with extreme mtime", () => {
  test("reading a file with a huge mtime does not crash", async () => {
    const shmDir = "/dev/shm";
    if (!fs.existsSync(shmDir)) return;

    let dir: string;
    try {
      dir = fs.mkdtempSync(join(shmDir, "bun-mtime-"));
    } catch {
      return;
    }

    const path = join(dir, "file");
    try {
      fs.writeFileSync(path, "hello");
      const fd = fs.openSync(path, "r");
      try {
        // 1e16 seconds * 1000 ms/s = 1e19 ms, which exceeds the i64 range.
        fs.futimesSync(fd, 1e16, 1e16);

        const file = Bun.file(fd);
        expect(Number.isFinite(file.lastModified)).toBe(true);
        // Must not collide with the internal "unresolved" sentinel (maxInt(u52)).
        expect(file.lastModified).not.toBe(2 ** 52 - 1);
        expect(await file.text()).toBe("hello");

        // fs.fstatSync with bigint: true goes through a separate ms
        // conversion (Stat.zig toTimeMS) that had the same overflow.
        const st = fs.fstatSync(fd, { bigint: true });
        expect(typeof st.mtimeMs).toBe("bigint");
      } finally {
        fs.closeSync(fd);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reading a file via path with a huge mtime does not crash", async () => {
    const shmDir = "/dev/shm";
    if (!fs.existsSync(shmDir)) return;

    let dir: string;
    try {
      dir = fs.mkdtempSync(join(shmDir, "bun-mtime-"));
    } catch {
      return;
    }

    const path = join(dir, "file");
    try {
      fs.writeFileSync(path, "hello");
      const fd = fs.openSync(path, "r");
      try {
        fs.futimesSync(fd, 1e16, 1e16);
      } finally {
        fs.closeSync(fd);
      }

      const file = Bun.file(path);
      expect(Number.isFinite(file.lastModified)).toBe(true);
      expect(file.lastModified).not.toBe(2 ** 52 - 1);
      expect(await file.text()).toBe("hello");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// On filesystems that clamp mtimes, we can still exercise the code path
// with whatever value the filesystem allows. This won't trigger the
// original overflow but ensures the read path keeps working everywhere.
test("Bun.file() handles large mtime without crashing", async () => {
  using dir = tempDir("bun-file-extreme-mtime", { file: "world" });
  const path = join(String(dir), "file");
  const fd = fs.openSync(path, "r");
  try {
    try {
      fs.futimesSync(fd, 1e16, 1e16);
    } catch {}

    const file = Bun.file(fd);
    expect(Number.isFinite(file.lastModified)).toBe(true);
    expect(await file.text()).toBe("world");
  } finally {
    fs.closeSync(fd);
  }
});
