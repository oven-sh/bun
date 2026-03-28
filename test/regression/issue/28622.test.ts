import { expect, test } from "bun:test";
import { pathToFileURL } from "url";

test("pathToFileURL percent-encodes backslashes on POSIX", () => {
  const inputPath = "\\\\?\\UNC\\server\\share\\folder\\file.txt";
  const url = pathToFileURL(inputPath);

  // On POSIX, backslash is a valid filename character, not a path separator.
  // Each backslash should be percent-encoded as %5C.
  expect(url.href).toContain("%5C%5C%3F%5CUNC%5Cserver%5Cshare%5Cfolder%5Cfile.txt");
});

test("pathToFileURL percent-encodes single backslash on POSIX", () => {
  const url = pathToFileURL("foo\\bar");
  // The backslash should be encoded, not treated as a path separator
  expect(url.href).toContain("foo%5Cbar");
  expect(url.href).not.toContain("foo/bar");
});

test("pathToFileURL still resolves dot segments", () => {
  const url = pathToFileURL("/foo/./bar/../baz");
  // . and .. between forward slashes should still be normalized
  expect(url.href).toBe("file:///foo/baz");
});

test("pathToFileURL handles absolute paths with backslashes", () => {
  const url = pathToFileURL("/foo\\bar\\baz");
  // Absolute path with backslashes: backslashes should be percent-encoded
  expect(url.href).toBe("file:///foo%5Cbar%5Cbaz");
});
