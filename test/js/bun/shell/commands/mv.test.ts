import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { isPosix } from "harness";
import {
  existsSync,
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
      for (const candidate of ["/dev/shm", "/tmp", "/run"]) {
        try {
          if (statSync(candidate).dev !== refDev) return candidate;
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

        const r = await $`mv ${srcFile} ${dstFile}`.quiet();
        expect(r.stderr.toString()).toBe("");
        expect(r.exitCode).toBe(0);
        expect(existsSync(srcFile)).toBe(false);
        expect(readFileSync(dstFile, "utf8")).toBe("payload\n");
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
        expect(existsSync(srcLink)).toBe(false);
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
  });
});
