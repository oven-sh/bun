import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { isPosix } from "harness";
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
      // OHOS sandbox: access() passes for /dev/shm but actual writes get
      // EACCES, so no second writable mount exists there.
      if (!isPosix || Bun.env.BUN_OHOS === "1") return undefined;
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
  });
});
