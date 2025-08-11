import { fileURLToPath, pathToFileURL } from "bun";
import { describe, expect, it } from "bun:test";
import { isWindows } from "harness";

describe("pathToFileURL", () => {
  it("should convert a path to a file url", () => {
    if (isWindows) {
      const result = pathToFileURL("/path/to/file.js").href;
      expect(result).toMatch(/^file:\/\/\/[A-Z]:\/path\/to\/file\.js$/);
    } else {
      expect(pathToFileURL("/path/to/file.js").href).toBe("file:///path/to/file.js");
    }
  });
});

describe("fileURLToPath", () => {
  const absoluteErrorMessage = "File URL path must be an absolute";
  it("should convert a file url to a path", () => {
    if (isWindows) {
      // This is still invalid on Windows because it lacks a drive letter
      expect(() => fileURLToPath("file:///path/to/file.js")).toThrow(absoluteErrorMessage);
      // But a properly formed Windows file URL should work
      expect(fileURLToPath("file:///C:/path/to/file.js")).toBe("C:\\path\\to\\file.js");
    } else {
      expect(fileURLToPath("file:///path/to/file.js")).toBe("/path/to/file.js");
    }
  });

  it("should convert a URL to a path", () => {
    if (isWindows) {
      // This is still invalid on Windows because it lacks a drive letter
      expect(() => fileURLToPath(new URL("file:///path/to/file.js"))).toThrow(absoluteErrorMessage);
      // But a properly formed Windows file URL should work
      expect(fileURLToPath(new URL("file:///C:/path/to/file.js"))).toBe("C:\\path\\to\\file.js");
    } else {
      expect(fileURLToPath(new URL("file:///path/to/file.js"))).toBe("/path/to/file.js");
    }
  });

  it("should fail on non-file: URLs", () => {
    expect(() => fileURLToPath(new URL("http:///path/to/file.js"))).toThrow();
  });

  describe("should fail on non URLs", () => {
    const fuzz = [1, true, Symbol("foo"), {}, [], () => {}, null, undefined, NaN, Infinity, -Infinity, new Boolean()];
    fuzz.forEach(value => {
      it(`${String(value)}`, () => {
        expect(() => fileURLToPath(value)).toThrow();
      });
    });
  });

  it("should add absolute part to relative file (#6456)", () => {
    const url = pathToFileURL("foo.txt");
    expect(url.href).toBe(`${pathToFileURL(process.cwd())}/foo.txt`);
  });

  it("should roundtrip", () => {
    const url = pathToFileURL(import.meta.path);
    expect(fileURLToPath(url)).toBe(import.meta.path);
    expect(fileURLToPath(import.meta.url)).toBe(import.meta.path);
  });

  it("should handle Windows paths starting with / correctly", () => {
    if (isWindows) {
      // Test the specific case that was failing with SolidStart
      const testPaths = ["/test", "/@solid-refresh", "/node_modules/test"];

      for (const testPath of testPaths) {
        const url = pathToFileURL(testPath);
        // Should include drive letter
        expect(url.href).toMatch(/^file:\/\/\/[A-Z]:\//);

        // Should roundtrip correctly
        const result = fileURLToPath(url);
        expect(result).toMatch(/^[A-Z]:\\/);
        expect(result.toLowerCase()).toContain(testPath.replace(/\//g, "\\").toLowerCase());
      }
    }
  });
});
