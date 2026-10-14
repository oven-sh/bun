import { $ } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, isPosix, tempDir } from "harness";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "path";
import { createTestBuilder } from "../test_builder";
import { sortedShellOutput } from "../util";
const TestBuilder = createTestBuilder(import.meta.path);
const isRoot = process.getuid?.() === 0;

$.nothrow();

describe("mv", async () => {
  TestBuilder.command`echo foo > a; mv a b`.ensureTempDir().fileEquals("b", "foo\n").runAsTest("move file -> file");

  TestBuilder.command`touch a; mkdir foo; mv a foo; ls foo`
    .ensureTempDir()
    .stdout("a\n")
    .doesNotExist("a")
    .runAsTest("move single file into a directory");

  TestBuilder.command`mkdir d; mv a b c d/; ls d/`
    .stdout(str => expect(sortedShellOutput(str)).toEqual(["a", "b", "c"]))
    .ensureTempDir()
    .file("a", "file")
    .file("b", "file")
    .file("c", "file")
    .doesNotExist("a")
    .doesNotExist("b")
    .doesNotExist("c")
    .runAsTest("move multiple files into a directory");

  TestBuilder.command`mv file1.txt file2.txt does_not_exist/`
    .exitCode(1)
    .stderr("mv: does_not_exist/: No such file or directory\n")
    .ensureTempDir()
    .file("file1.txt", "hi")
    .file("file1.txt", "hello")
    .runAsTest("fails if destination folder does not exist");

  TestBuilder.command`mkdir -p foo; mkdir -p bar; echo hi > foo/inside_foo; echo hi > bar/inside_bar; mv foo bar; ls -R bar`
    .ensureTempDir()
    .stdout(str =>
      expect(sortedShellOutput(str)).toEqual(
        sortedShellOutput(["inside_bar", "foo", join("bar", "foo") + ":", "inside_foo"]),
      ),
    )
    .runAsTest("move dir -> dir");

  TestBuilder.command`touch a; mkdir -p foo; mv foo/ a`
    .ensureTempDir()
    .exitCode(20 /* ENOTDIR */)
    .stderr("mv: a: Not a directory\n")
    .runAsTest("move dir -> file fails");

  // POSIX `mv` must fall back to copy+unlink when `rename()` returns EXDEV
  // (source and destination on different filesystems). Requires a writable
  // mount on a different device from the harness temp dir.
  describe("cross-device (EXDEV)", () => {
    const tmp = tmpdir();
    function findCrossDeviceDir(): string | undefined {
      if (!isPosix) return undefined;
      const refDev = statSync(tmp).dev;
      for (const candidate of ["/dev/shm", "/tmp"]) {
        try {
          if (statSync(candidate).dev === refDev) continue;
          accessSync(candidate, constants.W_OK | constants.X_OK);
          return candidate;
        } catch {}
      }
      return undefined;
    }
    const other = findCrossDeviceDir();
    const skip = other === undefined;

    function crossDevicePair(name: string): [src: string, dst: string] {
      const base = `bun-mv-xdev-${process.pid}-${name}`;
      const a = join(tmp, base);
      const b = join(other!, base);
      for (const d of [a, b]) {
        rmSync(d, { recursive: true, force: true });
        mkdirSync(d, { recursive: true });
      }
      return [a, b];
    }

    test.skipIf(skip)("file -> file across devices", async () => {
      const [src, dst] = crossDevicePair("file");
      try {
        const srcFile = join(src, "f.txt");
        const dstFile = join(dst, "f.txt");
        writeFileSync(srcFile, "payload\n");
        chmodSync(srcFile, 0o640);

        const r = await $`mv ${srcFile} ${dstFile}`.quiet();
        expect(r.stderr.toString()).toBe("");
        expect(r.exitCode).toBe(0);
        expect(existsSync(srcFile)).toBe(false);
        expect(readFileSync(dstFile, "utf8")).toBe("payload\n");
        expect(statSync(dstFile).mode & 0o777).toBe(0o640);
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip)("file -> directory across devices", async () => {
      const [src, dst] = crossDevicePair("into-dir");
      try {
        const srcFile = join(src, "g.txt");
        writeFileSync(srcFile, "into-dir\n");

        const r = await $`mv ${srcFile} ${dst}`.quiet();
        expect(r.stderr.toString()).toBe("");
        expect(r.exitCode).toBe(0);
        expect(existsSync(srcFile)).toBe(false);
        expect(readFileSync(join(dst, "g.txt"), "utf8")).toBe("into-dir\n");
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip)("symlink across devices", async () => {
      const [src, dst] = crossDevicePair("symlink");
      try {
        const srcLink = join(src, "link");
        symlinkSync("does-not-exist", srcLink);

        const r = await $`mv ${srcLink} ${dst}`.quiet();
        expect(r.stderr.toString()).toBe("");
        expect(r.exitCode).toBe(0);
        expect(lstatSync(srcLink, { throwIfNoEntry: false })).toBeUndefined();
        expect(readlinkSync(join(dst, "link"))).toBe("does-not-exist");
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip)("directory tree across devices", async () => {
      const [src, dst] = crossDevicePair("tree");
      try {
        const srcDir = join(src, "tree");
        mkdirSync(join(srcDir, "sub"), { recursive: true });
        writeFileSync(join(srcDir, "a.txt"), "A\n");
        writeFileSync(join(srcDir, "sub", "b.txt"), "B\n");

        const r = await $`mv ${srcDir} ${dst}`.quiet();
        expect(r.stderr.toString()).toBe("");
        expect(r.exitCode).toBe(0);
        expect(existsSync(srcDir)).toBe(false);
        expect(readFileSync(join(dst, "tree", "a.txt"), "utf8")).toBe("A\n");
        expect(readFileSync(join(dst, "tree", "sub", "b.txt"), "utf8")).toBe("B\n");
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip)("directory to a new path across devices", async () => {
      const [src, dst] = crossDevicePair("tree-new-path");
      try {
        const srcDir = join(src, "tree");
        const dstDir = join(dst, "renamed");
        mkdirSync(join(srcDir, "sub"), { recursive: true });
        writeFileSync(join(srcDir, "a.txt"), "A\n");
        writeFileSync(join(srcDir, "sub", "b.txt"), "B\n");

        const r = await $`mv ${srcDir} ${dstDir}`.quiet();
        expect(r.stderr.toString()).toBe("");
        expect(r.exitCode).toBe(0);
        expect(existsSync(srcDir)).toBe(false);
        expect(readFileSync(join(dstDir, "a.txt"), "utf8")).toBe("A\n");
        expect(readFileSync(join(dstDir, "sub", "b.txt"), "utf8")).toBe("B\n");
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip)("directory onto non-empty directory across devices fails", async () => {
      const [src, dst] = crossDevicePair("notempty");
      try {
        const srcDir = join(src, "d");
        mkdirSync(srcDir);
        writeFileSync(join(srcDir, "f.txt"), "new\n");
        mkdirSync(join(dst, "d"));
        writeFileSync(join(dst, "d", "f.txt"), "precious\n");

        const r = await $`mv ${srcDir} ${dst}`.quiet();
        expect(r.stderr.toString()).toContain("not empty");
        expect(r.exitCode).not.toBe(0);
        expect(readFileSync(join(dst, "d", "f.txt"), "utf8")).toBe("precious\n");
        expect(readFileSync(join(srcDir, "f.txt"), "utf8")).toBe("new\n");
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip || isRoot)(
      "unreadable directory across devices fails without creating the destination",
      async () => {
        const [src, dst] = crossDevicePair("unreadable");
        const srcDir = join(src, "tree");
        try {
          mkdirSync(srcDir);
          writeFileSync(join(srcDir, "a.txt"), "A\n");
          chmodSync(srcDir, 0o000);

          const r = await $`mv ${srcDir} ${dst}`.quiet();
          expect(r.stderr.toString()).toBe(`mv: ${join(dst, "tree")}: Permission denied\n`);
          expect(lstatSync(join(dst, "tree"), { throwIfNoEntry: false })).toBeUndefined();
          chmodSync(srcDir, 0o700);
          expect(readFileSync(join(srcDir, "a.txt"), "utf8")).toBe("A\n");
          expect(r.exitCode).toBe(13);
        } finally {
          if (existsSync(srcDir)) chmodSync(srcDir, 0o700);
          rmSync(src, { recursive: true, force: true });
          rmSync(dst, { recursive: true, force: true });
        }
      },
    );

    test.skipIf(skip)("FIFO across devices fails fast", async () => {
      const [src, dst] = crossDevicePair("fifo");
      try {
        const fifo = join(src, "pipe");
        const { exitCode: mk } = Bun.spawnSync({ cmd: ["mkfifo", fifo] });
        expect(mk).toBe(0);

        const r = await $`mv ${fifo} ${dst}`.quiet();
        expect(r.stderr.toString()).toContain("not supported");
        expect(r.exitCode).not.toBe(0);
        expect(lstatSync(fifo).isFIFO()).toBe(true);
        expect(lstatSync(join(dst, "pipe"), { throwIfNoEntry: false })).toBeUndefined();
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    // These layouts need mounts, so a fixture makes them in a private mount namespace: as root, or in a user namespace.
    describe("with mounts", () => {
      function findUnshare(): string[] | undefined {
        const unshare = isLinux ? Bun.which("unshare") : null;
        if (!unshare) return undefined;
        using probe = tempDir("mv-unshare-probe", { a: {}, b: {} });
        const mounts = 'mount -t tmpfs -o size=1m tmpfs "$1" && mount --bind "$1" "$2"';
        for (const namespaces of ["-Urm", "-m"]) {
          const cmd = [unshare, namespaces, "--propagation", "private"];
          const { exitCode } = Bun.spawnSync({
            cmd: [...cmd, "sh", "-c", mounts, "sh", join(String(probe), "a"), join(String(probe), "b")],
            stdout: "ignore",
            stderr: "ignore",
          });
          if (exitCode === 0) return cmd;
        }
        return undefined;
      }
      const unshare = findUnshare();

      async function runFixture(...layout: string[]) {
        using dir = tempDir("mv-with-mounts", {});
        await using proc = Bun.spawn({
          cmd: [...unshare!, bunExe(), join(import.meta.dir, "mv-into-itself-fixture.ts"), String(dir), ...layout],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const results: Record<string, unknown> = Object.fromEntries(
          stdout
            .split("\n")
            .filter(Boolean)
            .map(line => JSON.parse(line)),
        );
        return { results, fixture: { stderr, exitCode } };
      }

      let results: Record<string, unknown> = {};
      let fixture = {};
      beforeAll(async () => {
        if (unshare) ({ results, fixture } = await runFixture());
      });

      test.skipIf(!unshare)("the fixture makes every layout", () => {
        expect(fixture).toEqual({ stderr: "", exitCode: 0 });
      });

      // rename(2) refuses to move a directory into itself, but only when both paths are on one mount.
      // Across two mounts the copy must refuse it: it would copy its own output without end.
      describe("directory into itself", () => {
        // Refused before anything is made: the directory the copy would be made in is the source or is below it.
        test.skipIf(!unshare).each([
          ["into the source on a second mount", "secondMount", "b/sub/sub", ["sub", "sub/file"]],
          ["to a new path in the source on a second mount", "secondMountNewPath", "a/sub", ["sub", "sub/file"]],
          [
            "a mount point among the operands of `mv * out/`",
            "mountPointOperand",
            "out/out",
            ["out", "out/f1", "out/f2"],
          ],
          ["a mount point to a new path inside itself", "mountPointNewPath", "vol", ["vol", "vol/file"]],
          [
            "into a mount point inside the source",
            "mountInside",
            "proj/cache/proj",
            ["proj", "proj/cache", "proj/src", "proj/src/main", "proj/top"],
          ],
          [
            "to a new path on a file system mounted inside the source",
            "mountInsideNewPath",
            "a/sub",
            ["sub", "sub/mnt", "sub/top"],
          ],
          [
            "to a file system mounted on a child of the source under a second mount",
            "mountUnderSecondMount",
            "a/sub",
            ["sub", "sub/file", "sub/p1"],
          ],
        ])("%s", (_, layout, path, tree) => {
          expect(results[layout]).toEqual({ stderr: `mv: ${path}: Invalid argument\n`, exitCode: 22, tree });
        });

        // Refused during the walk, when it reaches the directory the copy is made in.
        // As in any cross-device move that fails midway, the entries walked before that are already moved.
        // The order of the directory listing decides which ones. The copy stops and no file is lost.
        test.skipIf(!unshare)("into a mount of a child of the source", () => {
          expect(results.mountOfChild).toEqual({
            stderr: "mv: b/sub: Invalid argument\n",
            exitCode: 22,
            // `sub`, `sub/inner`, `kept` in one of two places, and the new `sub/inner/sub`
            dirs: 4,
            files: ["deep: a/sub/inner/deep", "k: a/sub/kept/k", "top: a/sub/top"],
          });
        });
      });

      test.skipIf(!unshare)("directory between two mounts of one file system", () => {
        expect(results.betweenTwoMounts).toEqual({
          stderr: "",
          exitCode: 0,
          tree: ["x", "x/sub", "x/sub/deep", "x/sub/deep/file", "x/sub/file"],
        });
      });

      // Only a debug build comes to the end of its stack before it runs out of open files.
      test.skipIf(!unshare || !isDebug)("directory tree deeper than the stack", async () => {
        expect(await runFixture("deepTree", "1000")).toEqual({
          results: { deepTree: { stderr: "mv: b/top: File name too long\n", exitCode: 36 } },
          fixture: { stderr: "", exitCode: 0 },
        });
      });
    });
  });
});
