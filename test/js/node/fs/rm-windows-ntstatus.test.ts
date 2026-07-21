// fs.rm({ recursive: true }) on Windows walks the tree and deletes each entry
// via NtCreateFile + NtSetInformationFile(FileDispositionInformation[Ex]).
// Real-world Windows filesystems (and especially filter drivers, AV hooks, and
// cloud-sync placeholder providers like OneDrive/Dropbox) can return NTSTATUS
// codes from those calls that were not enumerated in the internal mapping
// table. Historically an unmapped status reached an `unreachable` and crashed
// the process; after that was removed it fell through to `UNKNOWN` and
// surfaced to JS as the misleading `EFAULT`.
//
// This test asserts that the NTSTATUS -> errno mapping produces a sensible
// errno for the status codes that have been observed in Sentry crash reports,
// and that genuinely unknown codes degrade to `UNKNOWN` rather than panicking.

import { translateNtStatusToE } from "bun:internal-for-testing";
import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

test.skipIf(!isWindows)("translateNtStatusToE maps delete-related NTSTATUS codes to errno", () => {
  // Existing explicit mappings must keep working.
  expect(translateNtStatusToE(0x00000000)).toBe("SUCCESS"); // STATUS_SUCCESS
  expect(translateNtStatusToE(0xc0000022)).toBe("PERM"); // STATUS_ACCESS_DENIED
  expect(translateNtStatusToE(0xc00000ba)).toBe("ISDIR"); // STATUS_FILE_IS_A_DIRECTORY
  expect(translateNtStatusToE(0xc0000034)).toBe("NOENT"); // STATUS_OBJECT_NAME_NOT_FOUND
  expect(translateNtStatusToE(0xc0000101)).toBe("NOTEMPTY"); // STATUS_DIRECTORY_NOT_EMPTY
  expect(translateNtStatusToE(0xc0000056)).toBe("BUSY"); // STATUS_DELETE_PENDING
  expect(translateNtStatusToE(0xc0000043)).toBe("BUSY"); // STATUS_SHARING_VIOLATION

  // STATUS_CANNOT_DELETE: FILE_ATTRIBUTE_READONLY on a filesystem that rejected
  // FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE (e.g. FAT32), or a memory-mapped
  // section exists. libuv maps the equivalent Win32 error (ERROR_ACCESS_DENIED)
  // to EPERM, so fs.rm should surface EPERM, not EFAULT.
  expect(translateNtStatusToE(0xc0000121)).toBe("PERM");

  // Status codes not in the explicit table: fall through RtlNtStatusToDosError
  // to the libuv Win32->errno table. None of these should be UNKNOWN.
  // STATUS_DISK_FULL -> ERROR_DISK_FULL -> ENOSPC
  expect(translateNtStatusToE(0xc000007f)).toBe("NOSPC");
  // STATUS_NO_SUCH_FILE -> ERROR_FILE_NOT_FOUND -> ENOENT
  expect(translateNtStatusToE(0xc000000f)).toBe("NOENT");
  // STATUS_TOO_MANY_OPENED_FILES -> ERROR_TOO_MANY_OPEN_FILES -> EMFILE
  expect(translateNtStatusToE(0xc000011f)).toBe("MFILE");
  // STATUS_NOT_SUPPORTED -> ERROR_NOT_SUPPORTED -> ENOTSUP
  expect(translateNtStatusToE(0xc00000bb)).toBe("NOTSUP");
  // STATUS_MEDIA_WRITE_PROTECTED -> ERROR_WRITE_PROTECT -> EROFS
  expect(translateNtStatusToE(0xc00000a2)).toBe("ROFS");

  // RtlNtStatusToDosError collapses STATUS_NOT_IMPLEMENTED,
  // STATUS_INVALID_DEVICE_REQUEST and STATUS_ILLEGAL_FUNCTION to
  // ERROR_INVALID_FUNCTION, which libuv's Win32 table maps to EISDIR for the
  // DeleteFileW-on-a-directory case. At the NTSTATUS layer these mean the
  // driver did not implement the request, not that the target is a
  // directory; mapping to ISDIR would livelock recursive fs.rm by flipping
  // treat_as_dir. They must surface as NOTSUP.
  expect(translateNtStatusToE(0xc0000002)).toBe("NOTSUP"); // STATUS_NOT_IMPLEMENTED
  expect(translateNtStatusToE(0xc0000010)).toBe("NOTSUP"); // STATUS_INVALID_DEVICE_REQUEST
  expect(translateNtStatusToE(0xc00000af)).toBe("NOTSUP"); // STATUS_ILLEGAL_FUNCTION

  // A status that RtlNtStatusToDosError does not recognise maps to
  // ERROR_MR_MID_NOT_FOUND, which has no errno, so we still get UNKNOWN
  // (not a panic).
  expect(translateNtStatusToE(0xcfffffff)).toBe("UNKNOWN");
});

test.skipIf(isWindows)("translateNtStatusToE is a no-op off Windows", () => {
  expect(typeof translateNtStatusToE).toBe("function");
  expect(translateNtStatusToE(0xc0000121)).toBeUndefined();
});

// When NtCreateFile(DELETE) is refused with STATUS_ACCESS_DENIED during a
// recursive fs.rm, the error must surface as EPERM/EACCES, not EFAULT, and
// must not crash the process. This exercises the full fs.rm -> zigDeleteTree
// -> unlinkat -> DeleteFileBun path, not just the mapping table.
test.skipIf(!isWindows)("fs.rm recursive surfaces a permission error when delete is denied", async () => {
  using dir = tempDir("rm-ntstatus", {
    "sub/locked.txt": "x",
  });
  const root = String(dir);
  const sub = path.join(root, "sub");
  const file = path.join(sub, "locked.txt");

  // Deny DELETE on the file AND FILE_DELETE_CHILD on its parent so that
  // NtCreateFile(..., DELETE, ...) fails with STATUS_ACCESS_DENIED: Windows
  // grants DELETE on a file if either the file's SD allows it or the parent's
  // SD grants FILE_DELETE_CHILD, so both must be denied. Apply and remove the
  // ACEs from the test process so that if the child panics the temp dir can
  // still be cleaned up; this process created both and has WRITE_DAC on them.
  execFileSync("icacls", [file, "/deny", "*S-1-1-0:(D)"], { stdio: "pipe" });
  execFileSync("icacls", [sub, "/deny", "*S-1-1-0:(DC)"], { stdio: "pipe" });
  try {
    // Run in a child so that if the process panics on an unmapped NTSTATUS we
    // observe it as a non-zero exit code instead of bringing down the runner.
    const fixture = `
      const fs = require("node:fs");
      const fsp = require("node:fs/promises");
      const root = process.env.TEST_RM_ROOT;
      let sync, async_;
      try {
        fs.rmSync(root, { recursive: true });
        sync = { threw: false };
      } catch (err) {
        sync = { threw: true, code: err && err.code };
      }
      fsp.rm(root, { recursive: true }).then(
        () => ({ threw: false }),
        err => ({ threw: true, code: err && err.code }),
      ).then(r => {
        async_ = r;
        process.stdout.write(JSON.stringify({ sync, async: async_ }));
      });
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, TEST_RM_ROOT: root },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Assert the combined shape first so a child panic surfaces its stderr
    // in the failure diff instead of just "Unexpected end of JSON input".
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const result = JSON.parse(stdout) as {
      sync: { threw: boolean; code?: string };
      async: { threw: boolean; code?: string };
    };

    expect(result.sync.threw).toBe(true);
    expect(result.sync.code).not.toBe("EFAULT");
    expect(["EPERM", "EACCES", "EBUSY"]).toContain(result.sync.code);

    expect(result.async.threw).toBe(true);
    expect(result.async.code).not.toBe("EFAULT");
    expect(["EPERM", "EACCES", "EBUSY"]).toContain(result.async.code);
  } finally {
    try {
      execFileSync("icacls", [sub, "/remove:d", "*S-1-1-0"], { stdio: "pipe" });
    } catch {}
    try {
      execFileSync("icacls", [file, "/remove:d", "*S-1-1-0"], { stdio: "pipe" });
    } catch {}
  }
});

// On filesystems that do not support FileDispositionInformationEx (FAT32/exFAT,
// SMB redirectors, some ReFS variants) the POSIX-semantics delete returns an
// NTSTATUS meaning "not supported" and DeleteFileBun must fall back to the
// legacy FileDispositionInformation. That legacy call has no
// IGNORE_READONLY_ATTRIBUTE flag, so a read-only file fails with
// STATUS_CANNOT_DELETE unless the readonly bit is cleared first. libuv's
// fs__unlink_rmdir handles both the extra fallback NTSTATUS codes and the
// readonly clear; this test asserts the DeleteFileBun path (used by recursive
// fs.rm / unlinkat) does the same. Reproduced against a FAT32 VHD because
// NTFS accepts the Ex info class and so never exercises the fallback.
const fat32 = (() => {
  if (!isWindows) return null;
  const dir = tempDir("rm-fat32", {});
  const tmp = String(dir);
  const vhd = path.join(tmp, "disk.vhd");
  const mount = path.join(tmp, "mnt");
  fs.mkdirSync(mount);
  // diskpart needs an elevated token; if we are not elevated the create/attach
  // fails and we skip. diskpart in stdin mode exits 0 even when individual
  // commands fail, so the real gate is the `st_dev` check below.
  const script = [
    `create vdisk file="${vhd}" maximum=64 type=expandable`,
    `select vdisk file="${vhd}"`,
    `attach vdisk`,
    `create partition primary`,
    `format fs=fat32 quick`,
    `assign mount="${mount}"`,
  ].join("\n");
  const r = spawnSync("diskpart", [], { input: script, encoding: "utf8", timeout: 60_000 });
  const cleanup = () => {
    const detach = [`select vdisk file="${vhd}"`, `detach vdisk`].join("\n");
    spawnSync("diskpart", [], { input: detach, encoding: "utf8", timeout: 60_000 });
    try {
      dir[Symbol.dispose]();
    } catch {}
  };
  let ok = r.status === 0;
  if (ok) {
    // `mount` was created on the host NTFS volume; `assign mount=` turns it
    // into a volume mount point whose `st_dev` (volume serial) differs from
    // its parent. Without this check a silent diskpart failure would leave
    // `mount` on NTFS, where the Ex fast path deletes the readonly file and
    // the test passes without exercising the fallback.
    try {
      ok = fs.statSync(mount).dev !== fs.statSync(tmp).dev;
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    cleanup();
    return null;
  }
  return { mount, cleanup };
})();

afterAll(() => {
  fat32?.cleanup();
});

test.skipIf(!fat32)(
  "fs.rm recursive deletes a read-only file on a filesystem without POSIX delete semantics",
  async () => {
    const { mount } = fat32!;
    const root = path.join(mount, "tree");
    // Run the actual deletion in a child so the DeleteFileBun path is exercised
    // by the bun binary under test, and so a crash surfaces as a non-zero exit
    // rather than killing the runner.
    const fixture = `
    const fs = require("node:fs");
    const path = require("node:path");
    const root = process.env.TEST_RM_ROOT;
    const sub = path.join(root, "sub");
    fs.mkdirSync(sub, { recursive: true });
    const ro = path.join(sub, "readonly.txt");
    fs.writeFileSync(ro, "x");
    fs.chmodSync(ro, 0o444);
    const plain = path.join(sub, "plain.txt");
    fs.writeFileSync(plain, "y");
    let err = null;
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (e) {
      err = { code: e && e.code, message: String(e && e.message) };
    }
    process.stdout.write(JSON.stringify({
      err,
      rootExists: fs.existsSync(root),
      roExists: fs.existsSync(ro),
    }));
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, TEST_RM_ROOT: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const result = JSON.parse(stdout) as {
      err: null | { code?: string; message: string };
      rootExists: boolean;
      roExists: boolean;
    };
    expect(result).toEqual({ err: null, rootExists: false, roExists: false });
  },
);

// Non-regression: the same operation must keep working on the default
// filesystem (NTFS), where FileDispositionInformationEx succeeds directly.
test.skipIf(!isWindows)("fs.rm recursive deletes a read-only file on NTFS", () => {
  using dir = tempDir("rm-readonly-ntfs", {
    "sub/readonly.txt": "x",
    "sub/plain.txt": "y",
  });
  const root = String(dir);
  const ro = path.join(root, "sub", "readonly.txt");
  fs.chmodSync(ro, 0o444);
  fs.rmSync(root, { recursive: true, force: true });
  expect(fs.existsSync(root)).toBe(false);
});
