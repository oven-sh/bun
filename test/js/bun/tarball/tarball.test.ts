import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { tempDirWithFiles } from "harness";
import { join } from "path";

describe("Bun.tarball()", () => {
  test("creates tar archive from single file", async () => {
    using dir = tempDirWithFiles("tarball", {
      "input.txt": "hello world",
    });

    const blob = await Bun.tarball({
      files: {
        "input.txt": join(dir, "input.txt"),
      },
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/x-tar");
    expect(blob.size).toBeGreaterThan(512);
  });

  test("creates tar from multiple files", async () => {
    using dir = tempDirWithFiles("tarball", {
      "file1.txt": "content 1",
      "dir/file2.txt": "content 2",
      "file3.txt": "content 3",
    });

    const blob = await Bun.tarball({
      files: {
        "file1.txt": join(dir, "file1.txt"),
        "subdir/file2.txt": join(dir, "dir/file2.txt"),
        "file3.txt": join(dir, "file3.txt"),
      },
    });

    expect(blob.size).toBeGreaterThan(512 * 3);

    const tarPath = join(dir, "output.tar");
    await Bun.write(tarPath, blob);

    const { exitCode, stdout } = Bun.spawnSync(["tar", "-tf", tarPath], { stdout: "pipe" });

    expect(exitCode).toBe(0);
    const files = new TextDecoder().decode(stdout).split("\n");
    expect(files).toContain("file1.txt");
    expect(files).toContain("subdir/file2.txt");
    expect(files).toContain("file3.txt");
  });

  test("accepts Blob inputs", async () => {
    const blob1 = new Blob(["content 1"]);
    const blob2 = new Blob(["content 2"]);

    const tarBlob = await Bun.tarball({
      files: {
        "file1.txt": blob1,
        "file2.txt": blob2,
      },
    });

    expect(tarBlob).toBeInstanceOf(Blob);
  });

  test("accepts mixed string and Blob inputs", async () => {
    using dir = tempDirWithFiles("tarball", {
      "from-disk.txt": "disk content",
    });

    const memoryBlob = new Blob(["memory content"]);

    const tarBlob = await Bun.tarball({
      files: {
        "from-disk.txt": join(dir, "from-disk.txt"),
        "from-memory.txt": memoryBlob,
      },
    });

    expect(tarBlob.size).toBeGreaterThan(0);
  });

  test("writes to file destination", async () => {
    using dir = tempDirWithFiles("tarball", {
      "input.txt": "test content",
    });

    const outputPath = join(dir, "output.tar");
    const byteCount = await Bun.tarball({
      files: {
        "input.txt": join(dir, "input.txt"),
      },
      destination: outputPath,
    });

    expect(typeof byteCount).toBe("number");
    expect(byteCount).toBeGreaterThan(0);

    const stat = await Bun.file(outputPath).exists();
    expect(stat).toBe(true);
  });

  test("compresses with gzip", async () => {
    const largeContent = "x".repeat(10000);
    const blob = new Blob([largeContent]);

    const uncompressed = await Bun.tarball({
      files: { "large.txt": blob },
    });

    const compressed = await Bun.tarball({
      files: { "large.txt": blob },
      compress: "gzip",
    });

    expect(compressed.size).toBeLessThan(uncompressed.size);
  });

  test("supports compression level 0", async () => {
    const content = "x".repeat(10000);
    const blob = new Blob([content]);

    const level0 = await Bun.tarball({
      files: { "data.txt": blob },
      compress: { type: "gzip", level: 0 },
    });

    const level6 = await Bun.tarball({
      files: { "data.txt": blob },
      compress: "gzip",
    });

    // Level 0 should be larger (less compressed) than level 6
    expect(level0.size).toBeGreaterThan(level6.size);
  });

  test("supports compression level 9", async () => {
    const content = "x".repeat(10000);
    const blob = new Blob([content]);

    const level6 = await Bun.tarball({
      files: { "data.txt": blob },
      compress: { type: "gzip", level: 6 },
    });

    const level9 = await Bun.tarball({
      files: { "data.txt": blob },
      compress: { type: "gzip", level: 9 },
    });

    expect(level9.size).toBeLessThanOrEqual(level6.size);
  });

  test("archive can be extracted correctly", async () => {
    using dir = tempDirWithFiles("tarball", {
      "original.txt": "test content\nwith multiple lines\n",
    });

    const tarBlob = await Bun.tarball({
      files: {
        "restored.txt": join(dir, "original.txt"),
      },
    });

    const tarPath = join(dir, "archive.tar");
    await Bun.write(tarPath, tarBlob);

    const extractDir = join(dir, "extracted");
    mkdirSync(extractDir);

    const { exitCode } = Bun.spawnSync(["tar", "-xf", tarPath, "-C", extractDir]);

    expect(exitCode).toBe(0);

    const extracted = await Bun.file(join(extractDir, "restored.txt")).text();
    const original = await Bun.file(join(dir, "original.txt")).text();

    expect(extracted).toBe(original);
  });

  test("compressed archive can be extracted", async () => {
    const content = "compressed content";
    const blob = new Blob([content]);

    using dir = tempDirWithFiles("tarball", {});

    const tarGzBlob = await Bun.tarball({
      files: { "file.txt": blob },
      compress: "gzip",
    });

    const tarGzPath = join(dir, "archive.tar.gz");
    await Bun.write(tarGzPath, tarGzBlob);

    const extractDir = join(dir, "extracted");
    mkdirSync(extractDir);

    const { exitCode } = Bun.spawnSync(["tar", "-xzf", tarGzPath, "-C", extractDir]);

    expect(exitCode).toBe(0);

    const extracted = await Bun.file(join(extractDir, "file.txt")).text();
    expect(extracted).toBe(content);
  });

  test("handles unicode filenames", async () => {
    const blob = new Blob(["unicode content"]);

    const tarBlob = await Bun.tarball({
      files: {
        "文件.txt": blob,
        "файл.txt": blob,
        "αρχείο.txt": blob,
      },
    });

    expect(tarBlob.size).toBeGreaterThan(0);
  });

  test("handles empty files", async () => {
    const emptyBlob = new Blob([]);

    const tarBlob = await Bun.tarball({
      files: {
        "empty.txt": emptyBlob,
      },
    });

    expect(tarBlob.size).toBeGreaterThan(512);
  });

  test("throws on missing files option", async () => {
    expect(async () => {
      await Bun.tarball({} as any);
    }).toThrow();
  });

  test("throws on empty files object", async () => {
    expect(async () => {
      await Bun.tarball({ files: {} });
    }).toThrow();
  });

  test("throws on invalid file value", async () => {
    expect(async () => {
      await Bun.tarball({ files: { "test.txt": 123 as any } });
    }).toThrow();
  });

  test("throws on invalid compression level", async () => {
    expect(async () => {
      await Bun.tarball({
        files: { "test.txt": new Blob(["test"]) },
        compress: { type: "gzip", level: 99 as any },
      });
    }).toThrow();
  });

  test("throws on negative compression level", async () => {
    expect(async () => {
      await Bun.tarball({
        files: { "test.txt": new Blob(["test"]) },
        compress: { type: "gzip", level: -1 as any },
      });
    }).toThrow();
  });

  test("throws on non-existent file", async () => {
    expect(async () => {
      await Bun.tarball({
        files: { "test.txt": "/this/does/not/exist.txt" },
      });
    }).toThrow();
  });

  test("handles large files", async () => {
    const largeContent = "x".repeat(5 * 1024 * 1024); // 5MB
    const blob = new Blob([largeContent]);

    const tarBlob = await Bun.tarball({
      files: { "large.txt": blob },
    });

    expect(tarBlob.size).toBeGreaterThan(5 * 1024 * 1024);
  });
});
