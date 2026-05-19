import { expect, test } from "bun:test";
import { isWindows } from "harness";
import { pathToFileURL } from "url";

test.skipIf(isWindows)("pathToFileURL percent-encodes backslashes on POSIX", () => {
  const inputPath = "\\\\?\\UNC\\server\\share\\folder\\file.txt";
  const url = pathToFileURL(inputPath);

  // On POSIX, backslash is a valid filename character, not a path separator.
  // Each backslash should be percent-encoded as %5C.
  expect(url.href).toContain("%5C%5C%3F%5CUNC%5Cserver%5Cshare%5Cfolder%5Cfile.txt");
});

test.skipIf(isWindows)("pathToFileURL percent-encodes single backslash on POSIX", () => {
  // Use absolute path for a deterministic assertion independent of CWD
  const url = pathToFileURL("/foo\\bar");
  expect(url.href).toBe("file:///foo%5Cbar");
});

test.skipIf(isWindows)("pathToFileURL resolves dot segments without trailing slash", () => {
  // Trailing .. must not produce a trailing slash (use absolute path to be CWD-independent)
  expect(pathToFileURL("/parent/child/..").href).toBe("file:///parent");

  // Interior dot segments still resolve
  expect(pathToFileURL("/foo/./bar/../baz").href).toBe("file:///foo/baz");
});

test.skipIf(isWindows)("pathToFileURL handles absolute paths with backslashes", () => {
  const url = pathToFileURL("/foo\\bar\\baz");
  // Absolute path with backslashes: backslashes should be percent-encoded
  expect(url.href).toBe("file:///foo%5Cbar%5Cbaz");
});

test.skipIf(isWindows)("pathToFileURL('') resolves to CWD without trailing slash", () => {
  expect(pathToFileURL("").href).not.toEndWith("/");
});
