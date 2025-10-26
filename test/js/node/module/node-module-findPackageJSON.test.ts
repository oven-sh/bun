import { describe, test, expect } from "bun:test";
import { findPackageJSON } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

describe("Module.findPackageJSON", () => {
  test("finds package.json from file URL", () => {
    const fileUrl = pathToFileURL(__filename).href;
    const result = findPackageJSON(fileUrl);

    expect(result).toBeDefined();
    expect(result).toContain("package.json");
    expect(result).toContain(path.resolve(import.meta.dir, "../../../.."));
  });

  test("finds package.json from directory path", () => {
    const dirUrl = pathToFileURL(import.meta.dir).href;
    const result = findPackageJSON(dirUrl);

    expect(result).toBeDefined();
    expect(result).toContain("package.json");
  });

  test("finds package.json from nested file", () => {
    const nestedPath = path.join(import.meta.dir, "../../..");
    const fileUrl = pathToFileURL(path.join(nestedPath, "some-file.js")).href;
    const result = findPackageJSON(fileUrl);

    expect(result).toBeDefined();
    expect(result).toContain("package.json");
  });

  test("returns null when no package.json found", () => {
    // Use a path that's unlikely to have a package.json
    const rootPath = path.parse(import.meta.dir).root;
    const deepPath = path.join(rootPath, "nonexistent", "deep", "path", "file.js");
    const fileUrl = pathToFileURL(deepPath).href;
    const result = findPackageJSON(fileUrl);

    // Should return null or empty when not found
    expect(result === null || result === "").toBe(true);
  });

  test("works with absolute paths as file URLs", () => {
    const absolutePath = path.resolve(import.meta.dir, "node-module-findPackageJSON.test.ts");
    const fileUrl = pathToFileURL(absolutePath).href;
    const result = findPackageJSON(fileUrl);

    expect(result).toBeDefined();
    expect(result).toContain("package.json");
  });
});
