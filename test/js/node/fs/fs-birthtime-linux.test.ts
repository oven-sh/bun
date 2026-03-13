import { describe, expect, it } from "bun:test";
import { isLinux, tempDirWithFiles } from "harness";
import { chmodSync, closeSync, fstatSync, lstatSync, openSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe.skipIf(!isLinux)("birthtime", () => {
  it("should return non-zero birthtime on Linux", () => {
    const dir = tempDirWithFiles("birthtime-test", {
      "test.txt": "initial content",
    });

    const filepath = join(dir, "test.txt");
    const stats = statSync(filepath);

    // On Linux with statx support, birthtime should be > 0
    expect(stats.birthtimeMs).toBeGreaterThan(0);
    expect(stats.birthtime.getTime()).toBeGreaterThan(0);
    expect(stats.birthtime.getFullYear()).toBeGreaterThanOrEqual(2025);
  });

  it("birthtime should remain constant while other timestamps change", () => {
    const dir = tempDirWithFiles("birthtime-immutable", {});
    const filepath = join(dir, "immutable-test.txt");

    // Create file and capture birthtime
    writeFileSync(filepath, "original");
    const initialStats = statSync(filepath);
    const birthtime = initialStats.birthtimeMs;

    expect(birthtime).toBeGreaterThan(0);

    // Wait a bit to ensure timestamps would differ
    Bun.sleepSync(10);

    // Modify content (updates mtime and ctime)
    writeFileSync(filepath, "modified");
    const afterModify = statSync(filepath);

    expect(afterModify.birthtimeMs).toBe(birthtime);
    expect(afterModify.mtimeMs).toBeGreaterThan(initialStats.mtimeMs);

    // Wait again
    Bun.sleepSync(10);

    // Change permissions (updates ctime)
    chmodSync(filepath, 0o755);
    const afterChmod = statSync(filepath);

    expect(afterChmod.birthtimeMs).toBe(birthtime);
    expect(afterChmod.ctimeMs).toBeGreaterThan(afterModify.ctimeMs);
  });

  it("birthtime should work with lstat and fstat", () => {
    const dir = tempDirWithFiles("birthtime-variants", {
      "test.txt": "content",
    });

    const filepath = join(dir, "test.txt");

    const statResult = statSync(filepath);
    const lstatResult = lstatSync(filepath);
    const fd = openSync(filepath, "r");
    const fstatResult = fstatSync(fd);
    closeSync(fd);

    // All three should return the same birthtime
    expect(statResult.birthtimeMs).toBeGreaterThan(0);
    expect(lstatResult.birthtimeMs).toBe(statResult.birthtimeMs);
    expect(fstatResult.birthtimeMs).toBe(statResult.birthtimeMs);

    expect(statResult.birthtime.getTime()).toBe(lstatResult.birthtime.getTime());
    expect(statResult.birthtime.getTime()).toBe(fstatResult.birthtime.getTime());
  });

  it("birthtime should work with BigInt stats", () => {
    const dir = tempDirWithFiles("birthtime-bigint", {
      "test.txt": "content",
    });

    const filepath = join(dir, "test.txt");

    const regularStats = statSync(filepath);
    const bigintStats = statSync(filepath, { bigint: true });

    expect(bigintStats.birthtimeMs).toBeGreaterThan(0n);
    expect(bigintStats.birthtimeNs).toBeGreaterThan(0n);

    // birthtimeMs should be close (within rounding)
    const regularMs = BigInt(Math.floor(regularStats.birthtimeMs));
    expect(bigintStats.birthtimeMs).toBe(regularMs);

    // birthtimeNs should have nanosecond precision
    expect(bigintStats.birthtimeNs).toBeGreaterThanOrEqual(bigintStats.birthtimeMs * 1000000n);
  });

  it("birthtime should be less than or equal to all other timestamps on creation", () => {
    const dir = tempDirWithFiles("birthtime-ordering", {});
    const filepath = join(dir, "new-file.txt");

    writeFileSync(filepath, "new content");
    const stats = statSync(filepath);

    // birthtime should be <= all other times since it's when file was created
    expect(stats.birthtimeMs).toBeLessThanOrEqual(stats.mtimeMs);
    expect(stats.birthtimeMs).toBeLessThanOrEqual(stats.atimeMs);
    expect(stats.birthtimeMs).toBeLessThanOrEqual(stats.ctimeMs);
  });
});
