// `GetFinalPathNameByHandleW(VOLUME_NAME_DOS)` gets the drive letter of a
// volume from the mount manager. It fails on a volume the mount manager does
// not manage (an ImDisk RAM disk, a letter that only `DefineDosDeviceW`
// defines), and `bun install` in a project on such a volume failed (#26192).
// The fallback reads the drive letter from the DOS device namespace.
//
// A volume that fails the API takes a kernel driver or admin rights. So this
// test runs the fallback on the volume of the temp directory, where the API
// answers too, and expects the same path from both.

import { finalPathFromDriveLetters } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

function fromDriveLetters(p: string) {
  const fd = fs.openSync(p, "r");
  try {
    return finalPathFromDriveLetters(fd);
  } finally {
    fs.closeSync(fd);
  }
}

test.skipIf(!isWindows)("the drive-letter fallback composes the path GetFinalPathNameByHandle returns", () => {
  using dir = tempDir("final-path-drive-letter", { "real/nested/file.txt": "x" });
  const root = String(dir);
  fs.symlinkSync(path.join(root, "real"), path.join(root, "junction"), "junction");

  const paths = {
    file: path.join(root, "real", "nested", "file.txt"),
    throughJunction: path.join(root, "junction", "nested", "file.txt"),
    directory: path.join(root, "real", "nested"),
    volumeRoot: path.parse(root).root,
  };
  const resolveAll = (resolve: (p: string) => string | undefined) =>
    Object.fromEntries(Object.entries(paths).map(([name, p]) => [name, resolve(p)]));

  // libuv's uv_fs_realpath is GetFinalPathNameByHandleW(VOLUME_NAME_DOS).
  const fromApi = resolveAll(fs.realpathSync.native);
  expect(fromApi.throughJunction).toBe(fromApi.file);

  expect(resolveAll(fromDriveLetters)).toEqual(fromApi);
});

test.skipIf(!isWindows)("the drive-letter fallback has no answer for a device without a drive letter", () => {
  // `\\.\NUL` is `\Device\Null`.
  expect(fromDriveLetters("\\\\.\\NUL")).toBeUndefined();
});

test.skipIf(isWindows)("finalPathFromDriveLetters is a no-op off Windows", () => {
  expect(fromDriveLetters(import.meta.path)).toBeUndefined();
});
