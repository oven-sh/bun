import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix } from "harness";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  type Stats,
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

    function crossDevicePair(name: string, roots: [string, string] = [tmp, other!]): [src: string, dst: string] {
      const base = `bun-mv-xdev-${process.pid}-${name}`;
      const a = join(roots[0], base);
      const b = join(roots[1], base);
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

    test.skipIf(skip)("directory and file modes are kept across devices", async () => {
      const [src, dst] = crossDevicePair("modes");
      try {
        const srcDir = join(src, "tree");
        mkdirSync(srcDir);
        writeFileSync(join(srcDir, "f.txt"), "F\n");
        chmodSync(join(srcDir, "f.txt"), 0o604);
        chmodSync(srcDir, 0o750);

        const r = await $`mv ${srcDir} ${dst}`.quiet();
        expect(r.stderr.toString()).toBe("");
        expect(r.exitCode).toBe(0);
        expect({
          tree: (statSync(join(dst, "tree")).mode & 0o7777).toString(8),
          file: (statSync(join(dst, "tree", "f.txt")).mode & 0o7777).toString(8),
        }).toEqual({ tree: "750", file: "604" });
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    // The FIFO stops the move partway, which shows the mode the copy has while the move runs.
    test.skipIf(skip)("a directory in flight across devices is private to the mover", async () => {
      const [src, dst] = crossDevicePair("in-flight");
      try {
        const srcDir = join(src, "tree");
        mkdirSync(srcDir);
        chmodSync(srcDir, 0o755);
        const { exitCode: mk } = Bun.spawnSync({ cmd: ["mkfifo", join(srcDir, "pipe")] });
        expect(mk).toBe(0);

        const r = await $`mv ${srcDir} ${dst}`.quiet();
        expect(r.stderr.toString()).toContain("not supported");
        expect(r.exitCode).not.toBe(0);
        expect((statSync(join(dst, "tree")).mode & 0o7777).toString(8)).toBe("700");
        expect(lstatSync(join(srcDir, "pipe")).isFIFO()).toBe(true);
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    const nobody = 65534;
    // `nobody` runs the move and cannot enter the harness TMPDIR (mode 0700).
    const publicRoots: [string, string] = ["/tmp", "/dev/shm"];
    const publicRootsDiffer = (() => {
      try {
        return statSync(publicRoots[0]).dev !== statSync(publicRoots[1]).dev;
      } catch {
        return false;
      }
    })();

    function ownerAndMode(root: string, names: string[]) {
      return Object.fromEntries(
        names.map(name => {
          const { uid, mode } = statSync(join(root, name));
          return [name, `${(mode & 0o7777).toString(8)} uid=${uid}`];
        }),
      );
    }

    function canAccess(path: string, mode: number) {
      try {
        accessSync(path, mode);
        return true;
      } catch {
        return false;
      }
    }

    // Only root can create a set-id file that another user owns, so the non-root case moves one the system has.
    const foreignSetId = (() => {
      // macOS protects /usr/bin, so the rename can fail before it reports EXDEV.
      if (!isLinux || isRoot) return undefined;
      const mover = process.getuid!();
      for (const path of ["/usr/bin/passwd", "/usr/bin/sudo", "/bin/su", "/usr/bin/chsh", "/usr/bin/gpasswd"]) {
        // `lstat`: `mv` copies a symlink as a symlink, and Alpine links these names to busybox.
        let st: Stats;
        try {
          st = lstatSync(path);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;
        const { uid, dev } = st;
        const mode = st.mode & 0o7777;
        // `fchown` fails only for an owner that this user cannot set.
        if ((mode & (0o4000 | 0o2000)) === 0 || uid === mover) continue;
        if (!canAccess(path, constants.R_OK)) continue;
        // A writable parent would let `mv` delete the system file.
        if (canAccess(join(path, ".."), constants.W_OK)) continue;
        for (const root of [other, "/dev/shm", tmp]) {
          if (root === undefined) continue;
          try {
            if (statSync(root).dev === dev) continue;
          } catch {
            continue;
          }
          if (canAccess(root, constants.W_OK | constants.X_OK)) return { path, uid, mode, root };
        }
      }
      return undefined;
    })();

    test.skipIf(!foreignSetId)("set-uid is dropped across devices for a file that another user owns", async () => {
      const { path, uid, mode, root } = foreignSetId!;
      const dst = join(root, `bun-mv-xdev-${process.pid}-foreign`);
      rmSync(dst, { recursive: true, force: true });
      mkdirSync(dst, { recursive: true });
      try {
        const r = await $`mv ${path} ${join(dst, "copy")}`.quiet();
        // `mv` copies first and removes last, so the failed removal leaves the copy.
        expect(r.stderr.toString()).toBe(`mv: ${path}: Permission denied\n`);
        expect(r.exitCode).toBe(13);
        expect(ownerAndMode(dst, ["copy"])).toEqual({
          copy: `${(mode & ~(0o4000 | 0o2000)).toString(8)} uid=${process.getuid!()}`,
        });
        expect(ownerAndMode(join(path, ".."), [path.slice(path.lastIndexOf("/") + 1)])).toEqual({
          [path.slice(path.lastIndexOf("/") + 1)]: `${mode.toString(8)} uid=${uid}`,
        });
      } finally {
        rmSync(dst, { recursive: true, force: true });
      }
    });

    // Root only: no other user can create a file that someone else owns.
    test.skipIf(!isRoot || !publicRootsDiffer)(
      "set-uid and set-gid are dropped across devices when the owner cannot be kept",
      async () => {
        const [src, dst] = crossDevicePair("setid", publicRoots);
        try {
          writeFileSync(join(src, "suid"), "suid");
          chmodSync(join(src, "suid"), 0o4755);
          writeFileSync(join(src, "sgid"), "sgid");
          chmodSync(join(src, "sgid"), 0o2755);
          mkdirSync(join(src, "dir"));
          writeFileSync(join(src, "dir", "suid"), "dir/suid");
          chmodSync(join(src, "dir", "suid"), 0o4755);
          // `nobody` removes the sources and creates the copies, so it needs write access.
          chmodSync(join(src, "dir"), 0o2777);
          chmodSync(src, 0o777);
          chmodSync(dst, 0o777);
          expect(ownerAndMode(src, ["suid", "sgid", "dir", "dir/suid"])).toEqual({
            "suid": "4755 uid=0",
            "sgid": "2755 uid=0",
            "dir": "2777 uid=0",
            "dir/suid": "4755 uid=0",
          });

          // `own` belongs to the mover, so its owner is kept and its bits must be too.
          const script = `
            import { $ } from "bun";
            import { chmodSync, writeFileSync } from "node:fs";
            const [src, dst] = ${JSON.stringify([src, dst])};
            writeFileSync(src + "/own", "own");
            chmodSync(src + "/own", 0o6755);
            const r = await $\`mv \${src}/suid \${src}/sgid \${src}/own \${src}/dir \${dst}\`.nothrow();
            process.exit(r.exitCode);
          `;
          await using proc = Bun.spawn({
            cmd: [bunExe(), "-e", script],
            env: bunEnv,
            cwd: "/",
            uid: nobody,
            gid: nobody,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });

          expect(ownerAndMode(dst, ["suid", "sgid", "dir", "dir/suid", "own"])).toEqual({
            "suid": `755 uid=${nobody}`,
            "sgid": `755 uid=${nobody}`,
            "dir": `777 uid=${nobody}`,
            "dir/suid": `755 uid=${nobody}`,
            "own": `6755 uid=${nobody}`,
          });
          expect(readdirSync(src)).toEqual([]);
        } finally {
          rmSync(src, { recursive: true, force: true });
          rmSync(dst, { recursive: true, force: true });
        }
      },
    );
  });
});
