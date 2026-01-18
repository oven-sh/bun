import { fileURLToPath, pathToFileURL } from "bun";
import { describe, expect, it } from "bun:test";
import { isWindows, tmpdirSync } from "harness";
import { join } from "path";

describe("pathToFileURL", () => {
  it("should convert a path to a file url", () => {
    expect(pathToFileURL("/path/to/file.js").href).toBe("file:///path/to/file.js");
  });
});

describe("fileURLToPath", () => {
  const absoluteErrorMessage = "File URL path must be an absolute";
  it("should convert a file url to a path", () => {
    if (isWindows) {
      expect(() => fileURLToPath("file:///path/to/file.js")).toThrow(absoluteErrorMessage);
    } else {
      expect(fileURLToPath("file:///path/to/file.js")).toBe("/path/to/file.js");
    }
  });

  it("should convert a URL to a path", () => {
    if (isWindows) {
      expect(() => fileURLToPath(new URL("file:///path/to/file.js"))).toThrow(absoluteErrorMessage);
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
});

// Regression test for #12360
describe("validatePath using fileURLToPath and pathToFileURL", () => {
  async function validatePath(path) {
    const filePath = fileURLToPath(path);

    if (await Bun.file(filePath).exists()) {
      return pathToFileURL(filePath);
    } else {
      return "";
    }
  }

  it("should return empty string for non-existent file", async () => {
    const dir = tmpdirSync();

    const filePath = join(dir, "./sample.exe");

    const newFilePath = await validatePath(pathToFileURL(filePath));

    expect(newFilePath).toBe("");
  });

  it("should return file URL for existing file", async () => {
    const dir = tmpdirSync();
    const editorPath = pathToFileURL(join(dir, "./metaeditor64.exe"));
    const terminalPath = pathToFileURL(join(dir, "./terminal64.exe"));

    await Bun.write(isWindows ? editorPath.pathname.slice(1) : editorPath.pathname, "im a editor");
    await Bun.write(isWindows ? terminalPath.pathname.slice(1) : terminalPath.pathname, "im a terminal");

    const newEditorPath = await validatePath(editorPath);
    const newTerminalPath = await validatePath(terminalPath);

    expect(newEditorPath.pathname).toBe(editorPath.pathname);
    expect(newTerminalPath.pathname).toBe(terminalPath.pathname);
  });
});
