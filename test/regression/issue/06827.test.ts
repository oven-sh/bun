import { describe, expect, test } from "bun:test";
import fs from "fs";
import { tempDir } from "harness";
import path from "path";

describe("issue #6827 - Bun.write from empty Response doesn't create any file", () => {
  test("Bun.write with empty Response creates file", async () => {
    using dir = tempDir("issue-6827", {});
    const filePath = path.join(String(dir), "ok.txt");

    // Should create an empty file
    const bytesWritten = await Bun.write(filePath, new Response(""));

    expect(bytesWritten).toBe(0);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(await Bun.file(filePath).text()).toBe("");
  });

  test("Bun.write with empty Blob creates file", async () => {
    using dir = tempDir("issue-6827-blob", {});
    const filePath = path.join(String(dir), "ok.txt");

    // Should create an empty file
    const bytesWritten = await Bun.write(filePath, new Blob([]));

    expect(bytesWritten).toBe(0);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(await Bun.file(filePath).text()).toBe("");
  });

  test("Bun.write with empty Response truncates existing file", async () => {
    using dir = tempDir("issue-6827-truncate", {});
    const filePath = path.join(String(dir), "existing.txt");

    // First write some content
    await Bun.write(filePath, "hello world");
    expect(await Bun.file(filePath).text()).toBe("hello world");

    // Now write empty Response - should truncate
    const bytesWritten = await Bun.write(filePath, new Response(""));

    expect(bytesWritten).toBe(0);
    expect(await Bun.file(filePath).text()).toBe("");
  });

  test("Bun.write with empty string still works (baseline)", async () => {
    using dir = tempDir("issue-6827-baseline", {});
    const filePath = path.join(String(dir), "ok.txt");

    // This should work (and already does)
    const bytesWritten = await Bun.write(filePath, "");

    expect(bytesWritten).toBe(0);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(await Bun.file(filePath).text()).toBe("");
  });

  test("Bun.write with empty Response and createPath: false should still create the file (not the dir)", async () => {
    using dir = tempDir("issue-6827-createpath", {});
    const filePath = path.join(String(dir), "newfile.txt");

    // createPath: false should only prevent creating parent directories, not the file itself
    const bytesWritten = await Bun.write(filePath, new Response(""), { createPath: false });

    expect(bytesWritten).toBe(0);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(await Bun.file(filePath).text()).toBe("");
  });

  test("Bun.write with empty Response and createPath: false should error when parent dir missing", async () => {
    using dir = tempDir("issue-6827-nodir", {});
    const filePath = path.join(String(dir), "nonexistent", "subdir", "file.txt");

    // Should fail because parent directory doesn't exist and createPath is false
    await expect(Bun.write(filePath, new Response(""), { createPath: false })).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
