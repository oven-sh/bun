// `FileRenameInformationEx`, the NT rename class bun replaces `bun.lock` with,
// is only implemented by NTFS, so exFAT and FAT32 volumes need the legacy
// `FileRenameInformation` fallback. https://github.com/oven-sh/bun/issues/10169

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

setDefaultTimeout(1000 * 60 * 5);

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
      // diskpart's text is localized, so only the exit code is asserted here;
      // `output` rides along to make a setup failure's diff readable.
      expect(created).toEqual({ exitCode: 0, output: expect.any(String) });

      // Locale-independent proof that diskpart created, formatted (FAT32, not
      // NTFS), and mounted the volume; `FileSystemType` would be the parent's
      // `NTFS` if any step silently failed. The path rides in an env var.
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
      const lockPath = join(project, "bun.lock");
      const manifest = (dependencies: Record<string, string>) =>
        JSON.stringify({ name: "fat32-project", version: "1.0.0", dependencies });
      copyFileSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(project, "bar-0.0.2.tgz"));
      copyFileSync(join(import.meta.dir, "baz-0.0.3.tgz"), join(project, "baz-0.0.3.tgz"));
      writeFileSync(join(project, "package.json"), manifest({ bar: "file:./bar-0.0.2.tgz" }));

      // The first run creates bun.lock. The second adds a dependency so bun has
      // to re-save (an unchanged install skips the save entirely) and replace
      // the existing lockfile through the same rename.
      let lockAfterCreate = "";
      for (const run of ["create", "replace"]) {
        if (run === "replace") {
          writeFileSync(
            join(project, "package.json"),
            manifest({ bar: "file:./bar-0.0.2.tgz", baz: "file:./baz-0.0.3.tgz" }),
          );
        }
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
        expect(existsSync(lockPath)).toBe(true);
        if (run === "create") lockAfterCreate = readFileSync(lockPath, "utf8");
      }

      // The second save replaced the lockfile the first one wrote.
      const lockAfterReplace = readFileSync(lockPath, "utf8");
      expect(lockAfterReplace).toContain("baz-0.0.3.tgz");
      expect(lockAfterReplace).not.toBe(lockAfterCreate);

      // The dependencies were linked onto the FAT32 volume, not just resolved.
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
