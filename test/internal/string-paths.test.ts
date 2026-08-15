// `without_trailing_slash_windows_path` (src/paths/string_paths.rs) produces
// the resolver's directory cache keys: no trailing separator, except that a
// drive root keeps its one separator (`C:\`), see
// `Resolver::assert_valid_cache_key`. Its drive-letter arm only runs on
// Windows hosts, so it is bound directly through `bun:internal-for-testing`
// and pinned here on every platform.
//
// It used to stop stripping one byte past `windows_filesystem_root`, so `C:\\`
// (the root plus one more separator) came back unchanged: a second spelling of
// the root, which the cache key assertion rejects in debug builds and which
// names a cache entry nothing else reads or busts in release builds.
//
// Namespace import: on a build without the binding, `pathsInternals` is
// undefined and each test below fails, instead of the file failing to link.
import * as internals from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

function withoutTrailingSlashWindows(path: string): string {
  return internals.pathsInternals.withoutTrailingSlashWindows(path);
}

describe("without_trailing_slash_windows_path", () => {
  test.each([
    ["C:\\", "C:\\"],
    ["C:/", "C:/"],
    ["c:\\", "c:\\"],
    ["C:\\\\", "C:\\"],
    ["C://", "C:/"],
    ["C:\\/", "C:\\"],
    ["C:\\\\\\\\", "C:\\"],
  ])("%s is the drive root %s", (input, expected) => {
    expect(withoutTrailingSlashWindows(input)).toBe(expected);
  });

  test.each([
    ["C:\\foo\\", "C:\\foo"],
    ["C:\\foo\\\\", "C:\\foo"],
    ["C:/foo/", "C:/foo"],
    ["C:\\foo/\\", "C:\\foo"],
    ["C:\\a\\", "C:\\a"],
    ["C:\\foo", "C:\\foo"],
    // Only trailing separators are stripped.
    ["C:\\\\foo\\", "C:\\\\foo"],
    // Drive-relative: `C:` is the root.
    ["C:foo\\", "C:foo"],
    ["C:foo", "C:foo"],
  ])("%s below a drive root becomes %s", (input, expected) => {
    expect(withoutTrailingSlashWindows(input)).toBe(expected);
  });

  test.each([
    ["\\\\server\\share\\dir\\", "\\\\server\\share\\dir"],
    // UNC roots are keyed without the separator.
    ["\\\\server\\share\\", "\\\\server\\share"],
    ["\\dir\\", "\\dir"],
    ["dir\\", "dir"],
    ["dir/", "dir"],
    ["\\", "\\"],
    ["/", "/"],
    ["//", "/"],
    ["C:", "C:"],
    ["", ""],
  ])("%s without a drive letter becomes %s", (input, expected) => {
    expect(withoutTrailingSlashWindows(input)).toBe(expected);
  });
});
