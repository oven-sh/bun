// `bun install` replaces `bun.lock` through `NtSetInformationFile` with the
// `FileRenameInformationEx` information class. That class (and
// `FILE_RENAME_POSIX_SEMANTICS`) is only implemented by NTFS: exFAT and FAT32
// volumes (external drives, USB sticks, cloud and VeraCrypt mounts) reject it
// with `STATUS_INVALID_PARAMETER`, so saving the lockfile failed with
// "EINVAL: Failed to replace old lockfile with new lockfile on disk" and
// aborted every `bun install` / `bun add` in a project on such a volume.
// Bun now retries through the legacy `FileRenameInformation` class, mirroring
// the fallback `DeleteFileBun` already had for `FileDispositionInformationEx`.
// https://github.com/oven-sh/bun/issues/10169
//
// Creating and formatting a FAT32 volume requires elevation, so the suite
// skips where diskpart cannot run; the elevated Windows lanes exercise it.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// `net session` exits non-zero with "Access is denied" unless the process is
// elevated; diskpart's `create vdisk` / `attach vdisk` need elevation too.
const isElevatedWindows =
  isWindows && Bun.spawnSync({ cmd: ["net", "session"], stdio: ["ignore", "ignore", "ignore"] }).exitCode === 0;

function diskpart(root: string, name: string, lines: string[]) {
  const scriptPath = join(root, name);
  writeFileSync(scriptPath, lines.join("\r\n") + "\r\n");
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: ["diskpart", "/s", scriptPath],
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { exitCode, output: `${stdout}${stderr}` };
}

describe.skipIf(!isElevatedWindows)("bun install on a non-NTFS Windows volume", () => {
  test("saves and replaces bun.lock in a project on a FAT32 volume", async () => {
    using dir = tempDir("install-fat32", {});
    const root = String(dir);
    // diskpart's `assign mount=` needs an existing, empty NTFS directory.
    const mount = join(root, "volume");
    mkdirSync(mount);
    const vhd = join(root, "fat32.vhd");

    // 64 MB keeps the FAT32 formatter above its ~33 MB floor while the
    // expandable backing file stays a few MB on disk.
    const created = diskpart(root, "create.txt", [
      `create vdisk file="${vhd}" maximum=64 type=expandable`,
      `select vdisk file="${vhd}"`,
      `attach vdisk`,
      `create partition primary`,
      `format fs=fat32 quick`,
      `assign mount="${mount}"`,
    ]);
    try {
      expect(created).toEqual({ exitCode: 0, output: expect.stringContaining("successfully") });

      // The bug is filesystem-dependent, so prove the mounted volume really is
      // FAT32 rather than trusting that diskpart honored `fs=fat32`. The path
      // rides in an env var so it never has to be quoted into the command.
      const fsinfo = Bun.spawnSync({
        cmd: [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "(Get-Volume -FilePath $env:BUN_TEST_MOUNT).FileSystemType",
        ],
        env: { ...bunEnv, BUN_TEST_MOUNT: mount },
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(fsinfo.stdout.toString().trim()).toBe("FAT32");

      // Match every report on the issue: install cache on NTFS, project (and
      // therefore bun.lock and node_modules) on the non-NTFS volume.
      const cache = join(root, "cache");
      mkdirSync(cache);
      const project = join(mount, "project");
      mkdirSync(project);
      copyFileSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(project, "bar-0.0.2.tgz"));
      writeFileSync(
        join(project, "package.json"),
        JSON.stringify({ name: "fat32-project", version: "1.0.0", dependencies: { bar: "file:./bar-0.0.2.tgz" } }),
      );

      // The first run creates bun.lock; the second must replace the existing
      // one. Both go through the same NtSetInformationFile rename.
      for (const run of ["create", "replace"]) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "install"],
          cwd: project,
          env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cache },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ run, exitCode, stdout, stderr }).toEqual({
          run,
          exitCode: 0,
          stdout: expect.any(String),
          stderr: expect.any(String),
        });
        expect(existsSync(join(project, "bun.lock"))).toBe(true);
      }

      // The dependency was linked onto the FAT32 volume, not just resolved.
      expect(JSON.parse(readFileSync(join(project, "node_modules", "bar", "package.json"), "utf8"))).toEqual({
        name: "bar",
        version: "0.0.2",
      });
    } finally {
      // The vdisk has to be detached before `dir`'s disposal can remove the
      // mount point and the backing .vhd; failures here are non-actionable.
      diskpart(root, "detach.txt", [`select vdisk file="${vhd}"`, `detach vdisk`]);
    }
  });
});
