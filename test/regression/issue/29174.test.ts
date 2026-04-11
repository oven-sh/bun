// https://github.com/oven-sh/bun/issues/29174
//
// Bun's `fileURLToPath` was delegating to WebKit's lenient percent-decoder,
// which silently interpreted malformed sequences like `%%20` as a literal `%`
// followed by a space. Node.js throws `URIError: URI malformed` for any `%`
// that is not followed by two hex digits, via `decodeURIComponent`.
import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import { fileURLToPath } from "node:url";

describe("fileURLToPath rejects malformed percent encoding (#29174)", () => {
  const malformed = [
    "file:///tmp/%%20users.txt", // % followed by another %
    "file:///tmp/%GG.txt", // non-hex digits
    "file:///tmp/%2.txt", // single hex digit then non-hex
    "file:///tmp/%.txt", // % followed by non-hex
    "file:///tmp/%", // lone trailing %
    "file:///%", // lone % at root
  ];

  for (const input of malformed) {
    test(`string input: ${input}`, () => {
      expect(() => fileURLToPath(input)).toThrow(
        expect.objectContaining({
          name: "URIError",
          code: "ERR_INVALID_URI",
          message: "URI malformed",
        }),
      );
    });

    test(`URL input: ${input}`, () => {
      expect(() => fileURLToPath(new URL(input))).toThrow(
        expect.objectContaining({
          name: "URIError",
          code: "ERR_INVALID_URI",
          message: "URI malformed",
        }),
      );
    });
  }

  test("round-trip through `% users.txt` throws like Node", () => {
    const url = new URL("file:///tmp/%%20users.txt");
    expect(() => fileURLToPath(url)).toThrow(
      expect.objectContaining({
        name: "URIError",
        code: "ERR_INVALID_URI",
      }),
    );
  });

  // These use POSIX-shaped paths (`/tmp/...`). On Windows `fileURLToPath`
  // rejects those as non-absolute (`ERR_INVALID_FILE_URL_PATH`), so the
  // decoding assertions only make sense on posix platforms.
  test.skipIf(isWindows)("valid percent encoding still works (posix)", () => {
    expect(fileURLToPath("file:///tmp/%20space.txt")).toBe("/tmp/ space.txt");
    expect(fileURLToPath("file:///tmp/a%7Eb.txt")).toBe("/tmp/a~b.txt");
    expect(fileURLToPath("file:///tmp/%7e.txt")).toBe("/tmp/~.txt");
  });

  test.skipIf(isWindows)("paths with no percent encoding are untouched (posix)", () => {
    expect(fileURLToPath("file:///tmp/plain.txt")).toBe("/tmp/plain.txt");
  });

  test.if(isWindows)("valid percent encoding still works (windows)", () => {
    expect(fileURLToPath("file:///C:/%20space.txt")).toBe("C:\\ space.txt");
    expect(fileURLToPath("file:///C:/a%7Eb.txt")).toBe("C:\\a~b.txt");
    expect(fileURLToPath("file:///C:/%7e.txt")).toBe("C:\\~.txt");
  });

  test.if(isWindows)("paths with no percent encoding are untouched (windows)", () => {
    expect(fileURLToPath("file:///C:/plain.txt")).toBe("C:\\plain.txt");
  });

  test("encoded slash still throws ERR_INVALID_FILE_URL_PATH (unchanged)", () => {
    expect(() => fileURLToPath("file:///tmp/%2Fhack")).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_FILE_URL_PATH" }),
    );
    expect(() => fileURLToPath("file:///tmp/%2fhack")).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_FILE_URL_PATH" }),
    );
  });
});
