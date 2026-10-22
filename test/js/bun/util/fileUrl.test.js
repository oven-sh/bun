import { fileURLToPath, pathToFileURL } from "bun";
import { describe, expect, it } from "bun:test";
import { isWindows } from "harness";

describe("pathToFileURL", () => {
  it("should convert a path to a file url", () => {
    expect(pathToFileURL("/path/to/file.js").href).toBe("file:///path/to/file.js");
  });

  it("should handle relative paths longer than PATH_MAX", () => {
    const long = Buffer.alloc(6000, "a").toString();
    const url = pathToFileURL(long);
    expect(url.href.endsWith("/" + long)).toBe(true);
  });

  it("should normalize long relative paths with .. segments", () => {
    const input = Buffer.alloc(14000, "abcdef/").toString() + Buffer.alloc(6000, "../").toString() + "final";
    const url = pathToFileURL(input);
    expect(url.href).toBe(`${pathToFileURL(process.cwd())}/final`);
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

  // "50%deposit.db" is a file name. In a URL its "%de" is an escape, and the byte DE is not UTF-8.
  // Not on Windows: WTF decodes such a path with U+FFFD in it there (oven-sh/WebKit#789).
  describe.skipIf(isWindows)("a path that does not percent-decode to UTF-8", () => {
    it.each(["50%deposit.db", "caf%E9.db", "%80", "%C0%AF", "%ED%A0%80", "%F4%90%80%80"])(
      "throws a URIError: %s",
      name => {
        const url = new URL(name, pathToFileURL(import.meta.dir + "/"));
        for (const input of [url, url.href]) {
          let error;
          try {
            fileURLToPath(input);
          } catch (e) {
            error = e;
          }
          expect(error).toBeInstanceOf(URIError);
          expect({ message: error.message, code: error.code }).toEqual({ message: "URI malformed", code: undefined });
        }
      },
    );
  });
});
