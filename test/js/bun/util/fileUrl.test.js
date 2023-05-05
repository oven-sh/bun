import { expect, it, describe } from "bun:test";
import { pathToFileURL, fileURLToPath } from "bun";
describe("pathToFileURL", () => {
  it("should convert a path to a file url", () => {
    expect(pathToFileURL("/path/to/file.js").href).toBe("file:///path/to/file.js");
  });
});

describe("fileURLToPath", () => {
  it("should convert a file url to a path", () => {
    expect(fileURLToPath("file:///path/to/file.js")).toBe("/path/to/file.js");
  });
  it("should convert a URL to a path", () => {
    expect(fileURLToPath(new URL("file:///path/to/file.js"))).toBe("/path/to/file.js");
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
});
