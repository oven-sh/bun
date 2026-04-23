import { describe, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

describe("Bun.resolveSync with file path as second argument", () => {
  test("resolves when 'from' is a file path", () => {
    using dir = tempDir("resolve-file-path", {
      "importer.ts": "export {}",
      "target.ts": "export const x = 1;",
    });

    // When passing a file path (like args.importer in plugin onResolve hooks),
    // Bun.resolveSync should extract the directory and resolve relative to it.
    const result = Bun.resolveSync("./target.ts", join(String(dir), "importer.ts"));
    expect(result).toBe(join(String(dir), "target.ts"));
  });

  test("resolves when 'from' is a directory path with trailing slash", () => {
    using dir = tempDir("resolve-dir-path", {
      "target.ts": "export const x = 1;",
    });

    // When passing a directory path with trailing slash, it should work as before.
    const result = Bun.resolveSync("./target.ts", String(dir) + "/");
    expect(result).toBe(join(String(dir), "target.ts"));
  });

  test("resolves when 'from' is a directory path without trailing slash", () => {
    using dir = tempDir("resolve-dir-no-slash", {
      "target.ts": "export const x = 1;",
    });

    // import.meta.dir returns a directory path without trailing slash.
    // This must continue to work as a directory, not be mistaken for a file.
    const result = Bun.resolveSync("./target.ts", String(dir));
    expect(result).toBe(join(String(dir), "target.ts"));
  });

  test("resolves newly created files when 'from' is a file path", () => {
    using dir = tempDir("resolve-new-file", {
      "importer.ts": "export {}",
    });

    // First, resolve the importer itself to prime the resolver cache
    Bun.resolveSync("./importer.ts", String(dir) + "/");

    // Create a new file after the cache is primed
    const newFilePath = join(String(dir), "new-module.ts");
    writeFileSync(newFilePath, "export const y = 2;");

    // Resolving the newly created file using a file path as 'from' should work
    const result = Bun.resolveSync("./new-module.ts", join(String(dir), "importer.ts"));
    expect(result).toBe(newFilePath);
  });

  test("resolves newly created files when 'from' is a directory path", () => {
    using dir = tempDir("resolve-new-file-dir", {
      "importer.ts": "export {}",
    });

    // Prime the resolver cache
    Bun.resolveSync("./importer.ts", String(dir) + "/");

    // Create a new file
    const newFilePath = join(String(dir), "new-module.ts");
    writeFileSync(newFilePath, "export const y = 2;");

    // Resolving the newly created file using a directory path should work
    const result = Bun.resolveSync("./new-module.ts", String(dir) + "/");
    expect(result).toBe(newFilePath);
  });

  test("resolves with directory containing dots in its name", () => {
    using dir = tempDir("resolve-dir.with.dots", {
      "target.ts": "export const x = 1;",
    });

    // A directory whose name contains dots (no trailing slash) should be
    // correctly identified as a directory via stat, not misclassified as a file.
    const result = Bun.resolveSync("./target.ts", String(dir));
    expect(result).toBe(join(String(dir), "target.ts"));
  });
});
