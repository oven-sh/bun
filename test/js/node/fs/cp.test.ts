import { describe, expect, jest, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isLinux, isPosix, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { isAbsolute, join } from "path";

const impls = [
  ["cpSync", fs.cpSync],
  ["cp", fs.promises.cp],
] as const;

for (const [name, copy] of impls) {
  async function copyShouldThrow(...args: Parameters<typeof copy>) {
    try {
      await (copy as any)(...args);
    } catch (e: any) {
      if (e?.code?.toUpperCase() === "TODO") {
        throw new Error("Expected " + name + "() to throw non TODO error");
      }
      return e;
    }
    throw new Error("Expected " + name + "() to throw");
  }

  function assertContent(path: string, content: string) {
    expect(fs.readFileSync(path, "utf8")).toBe(content);
  }

  describe("fs." + name, () => {
    test("single file", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
      });

      await copy(basename + "/from/a.txt", basename + "/to.txt");

      expect(fs.readFileSync(basename + "/to.txt", "utf8")).toBe("a");
    });

    test("refuse to copy directory with 'recursive: false'", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
      });

      const e = await copyShouldThrow(basename + "/from", basename + "/result");
      expect(e.code).toBe("ERR_FS_EISDIR");
      // The path field echoes the caller's string verbatim (node does not
      // resolve or normalize it), so expect the same concatenation we passed.
      expect(e.path).toBe(basename + "/from");
    });

    test("recursive directory structure - no destination", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
        "from/b/e.txt": "e",
        "from/c.txt": "c",
        "from/w/y/x/z.txt": "z",
      });

      await copy(basename + "/from", basename + "/result", { recursive: true });

      assertContent(basename + "/result/a.txt", "a");
      assertContent(basename + "/result/b/e.txt", "e");
      assertContent(basename + "/result/c.txt", "c");
      assertContent(basename + "/result/w/y/x/z.txt", "z");
    });

    test("recursive directory structure - overwrite existing files by default", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
        "from/b/e.txt": "e",
        "from/c.txt": "c",
        "from/w/y/x/z.txt": "z",

        "result/a.txt": "fail",
        "result/w/y/x/z.txt": "lose",
        "result/w/y/v.txt": "keep this",
      });

      await copy(basename + "/from", basename + "/result", { recursive: true });

      assertContent(basename + "/result/a.txt", "a");
      assertContent(basename + "/result/b/e.txt", "e");
      assertContent(basename + "/result/c.txt", "c");
      assertContent(basename + "/result/w/y/x/z.txt", "z");
      assertContent(basename + "/result/w/y/v.txt", "keep this");
    });

    test("recursive directory structure - 'force: false' does not overwrite existing files", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "lose",
        "from/b/e.txt": "e",
        "from/c.txt": "c",
        "from/w/y/x/z.txt": "lose",

        "result/a.txt": "win",
        "result/w/y/x/z.txt": "win",
        "result/w/y/v.txt": "keep this",
      });

      await copy(basename + "/from", basename + "/result", { recursive: true, force: false });

      assertContent(basename + "/result/a.txt", "win");
      assertContent(basename + "/result/b/e.txt", "e");
      assertContent(basename + "/result/c.txt", "c");
      assertContent(basename + "/result/w/y/x/z.txt", "win");
      assertContent(basename + "/result/w/y/v.txt", "keep this");
    });

    test("'force: false' on a single file doesn't override", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "lose",
        "result/a.txt": "win",
      });

      await copy(basename + "/from/a.txt", basename + "/result/a.txt", { force: false });

      assertContent(basename + "/result/a.txt", "win");
    });

    test("'force: true' on a single file does override", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "win",
        "result/a.txt": "lose",
      });

      await copy(basename + "/from/a.txt", basename + "/result/a.txt", { force: true });

      assertContent(basename + "/result/a.txt", "win");
    });

    test("'force: false' + 'errorOnExist: true' can throw", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "lose",
        "result/a.txt": "win",
      });

      const e = await copyShouldThrow(basename + "/from/a.txt", basename + "/result/a.txt", {
        force: false,
        errorOnExist: true,
      });
      expect(e.code).toBe("ERR_FS_CP_EEXIST");
      // As above, the path field carries the caller's string verbatim.
      expect(e.path).toBe(basename + "/result/a.txt");

      assertContent(basename + "/result/a.txt", "win");
    });

    test("symlinks - single file", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
      });

      fs.symlinkSync(basename + "/from/a.txt", basename + "/from/a_symlink.txt");

      await copy(basename + "/from/a_symlink.txt", basename + "/result.txt");
      await copy(basename + "/from/a_symlink.txt", basename + "/result2.txt", { recursive: false });

      const stats = fs.lstatSync(basename + "/result.txt");
      expect(stats.isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(basename + "/result.txt", "utf8")).toBe("a");

      const stats2 = fs.lstatSync(basename + "/result2.txt");
      expect(stats2.isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(basename + "/result2.txt", "utf8")).toBe("a");
    });

    test("symlinks - single file recursive", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
      });

      fs.symlinkSync(basename + "/from/a.txt", basename + "/from/a_symlink.txt");

      await copy(basename + "/from/a_symlink.txt", basename + "/result.txt", { recursive: true });

      const stats = fs.lstatSync(basename + "/result.txt");
      expect(stats.isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(basename + "/result.txt", "utf8")).toBe("a");
    });

    test("symlinks - directory recursive", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
        "from/b.txt": "b",
        "from/dir/c.txt": "c",
      });

      fs.symlinkSync(basename + "/from/a.txt", basename + "/from/a_symlink.txt");
      fs.symlinkSync(basename + "/from/dir", basename + "/from/dir_symlink");

      await copy(basename + "/from", basename + "/result", { recursive: true });

      const statsFile = fs.lstatSync(basename + "/result/a_symlink.txt");
      expect(statsFile.isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(basename + "/result/a_symlink.txt", "utf8")).toBe("a");

      const statsDir = fs.lstatSync(basename + "/result/dir_symlink");
      expect(statsDir.isSymbolicLink()).toBe(true);
      expect(fs.readdirSync(basename + "/result/dir_symlink")).toEqual(["c.txt"]);
    });

    test("symlinks - directory recursive 2", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
        "from/b.txt": "b",
        "from/dir/c.txt": "c",
      });

      fs.symlinkSync(basename + "/from/a.txt", basename + "/from/a_symlink.txt");
      fs.symlinkSync(basename + "/from/dir", basename + "/from/dir_symlink");
      fs.mkdirSync(basename + "/result");

      await copy(basename + "/from", basename + "/result", { recursive: true });

      const statsFile = fs.lstatSync(basename + "/result/a_symlink.txt");
      expect(statsFile.isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(basename + "/result/a_symlink.txt", "utf8")).toBe("a");

      const statsDir = fs.lstatSync(basename + "/result/dir_symlink");
      expect(statsDir.isSymbolicLink()).toBe(true);
      expect(fs.readdirSync(basename + "/result/dir_symlink")).toEqual(["c.txt"]);
    });

    test("symlinks - copied link target is the original target, not the source link path", async () => {
      // Previously the ELOOP fallback on Linux/FreeBSD called symlink(src, dest),
      // so the copied link's target string was the path of the *source* symlink
      // and every copied link pointed back into the source tree.
      await using basename = tempDir("cp", {
        "target.txt": "hello",
        "from/keep": "",
      });

      const origTarget = join(basename, "target.txt");

      // Absolute target — exercises the isAbsolute fast path.
      const srcAbs = join(basename, "from", "abs_link");
      fs.symlinkSync(origTarget, srcAbs);

      // Relative target — exercises the dirname(src) resolve path.
      const srcRel = join(basename, "from", "rel_link");
      fs.symlinkSync(join("..", "target.txt"), srcRel);

      await copy(basename + "/from", basename + "/to", { recursive: true });

      for (const [which, srcLink] of [
        ["abs_link", srcAbs],
        ["rel_link", srcRel],
      ] as const) {
        const copiedLink = join(basename, "to", which);
        expect(fs.lstatSync(copiedLink).isSymbolicLink()).toBe(true);

        // The copied link's target string must not be the path of the source
        // symlink. With the bug, readlink(copiedLink) returned srcLink.
        expect(fs.readlinkSync(copiedLink)).not.toBe(srcLink);
        expect(fs.realpathSync(copiedLink)).toBe(fs.realpathSync(origTarget));
      }

      // Deleting the source tree must not break the absolute link, since its
      // target lives outside the source tree. With the bug, the copied link
      // pointed at from/abs_link and would dangle once from/ was removed.
      fs.rmSync(join(basename, "from"), { recursive: true, force: true });
      expect(fs.readFileSync(join(basename, "to", "abs_link"), "utf8")).toBe("hello");
    });

    test("symlinks - relative target inside the tree is resolved against the source tree", async () => {
      // node resolves a relative link target against the directory of the
      // source link and writes the absolute result into the copy. A verbatim
      // copy of the link (e.g. a whole-tree clonefile) would keep "../a.txt".
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
        "from/sub/keep.txt": "keep",
      });
      fs.symlinkSync(join("..", "a.txt"), join(basename, "from", "sub", "link"));

      await copy(join(basename, "from"), join(basename, "result"), { recursive: true });

      const copiedLink = join(basename, "result", "sub", "link");
      expect(fs.lstatSync(copiedLink).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(copiedLink)).toBe(join(basename, "from", "a.txt"));
      expect(fs.readFileSync(copiedLink, "utf8")).toBe("a");
    });

    test.skipIf(isWindows)("recursive - file and directory modes are preserved into a fresh destination", async () => {
      await using basename = tempDir("cp", {
        "from/d/f.txt": "x",
      });
      fs.chmodSync(join(basename, "from", "d", "f.txt"), 0o600);
      fs.chmodSync(join(basename, "from", "d"), 0o700);

      await copy(join(basename, "from"), join(basename, "result"), { recursive: true });

      expect({
        dirMode: fs.statSync(join(basename, "result", "d")).mode & 0o777,
        fileMode: fs.statSync(join(basename, "result", "d", "f.txt")).mode & 0o777,
        content: fs.readFileSync(join(basename, "result", "d", "f.txt"), "utf8"),
      }).toEqual({
        dirMode: 0o700,
        fileMode: 0o600,
        content: "x",
      });
    });

    test.skipIf(isWindows)("recursive - an existing empty destination keeps its mode", async () => {
      // node only sets the mode of a directory it creates (verified against
      // fs.promises.cp in node v26.3.0).
      await using basename = tempDir("cp", {
        "from/d/f.txt": "x",
      });
      fs.chmodSync(join(basename, "from", "d"), 0o700);
      fs.chmodSync(join(basename, "from"), 0o700);
      fs.mkdirSync(join(basename, "result"));
      fs.chmodSync(join(basename, "result"), 0o755);

      await copy(join(basename, "from"), join(basename, "result"), { recursive: true });

      expect({
        destMode: fs.statSync(join(basename, "result")).mode & 0o777,
        dirMode: fs.statSync(join(basename, "result", "d")).mode & 0o777,
        content: fs.readFileSync(join(basename, "result", "d", "f.txt"), "utf8"),
      }).toEqual({
        destMode: 0o755,
        dirMode: 0o700,
        content: "x",
      });
    });

    test.skipIf(isWindows)(
      "recursive - a source directory without write permission is copied with its mode",
      async () => {
        // node sets a directory's mode after it copies the entries. Setting it
        // first would make the copy into the directory fail with EACCES.
        await using basename = tempDir("cp", {
          "from/ro/a.txt": "a",
          "from/ro/sub/b.txt": "b",
        });
        const readOnlyDirs = ["from", "result"].flatMap(root => [
          join(basename, root, "ro", "sub"),
          join(basename, root, "ro"),
        ]);
        fs.chmodSync(join(basename, "from", "ro", "sub"), 0o555);
        fs.chmodSync(join(basename, "from", "ro"), 0o555);
        try {
          await copy(join(basename, "from"), join(basename, "result"), { recursive: true });

          expect({
            roMode: fs.statSync(join(basename, "result", "ro")).mode & 0o777,
            subMode: fs.statSync(join(basename, "result", "ro", "sub")).mode & 0o777,
            a: fs.readFileSync(join(basename, "result", "ro", "a.txt"), "utf8"),
            b: fs.readFileSync(join(basename, "result", "ro", "sub", "b.txt"), "utf8"),
          }).toEqual({
            roMode: 0o555,
            subMode: 0o555,
            a: "a",
            b: "b",
          });
        } finally {
          // tempDir cannot remove the entries of a directory it cannot write to.
          for (const dir of readOnlyDirs) {
            if (fs.existsSync(dir)) fs.chmodSync(dir, 0o755);
          }
        }
      },
    );

    // root reads any file, so the copy cannot fail this way. macOS does not
    // copy file by file: it clones the whole tree with one clonefile().
    test.skipIf(!isLinux || process.getuid?.() === 0)(
      "a file that cannot be read fails as a copyfile error",
      async () => {
        await using basename = tempDir("cp", {
          "from/d/secret.txt": "secret",
        });
        const secret = join(basename, "from", "d", "secret.txt");
        fs.chmodSync(secret, 0o000);

        const inTree = await copyShouldThrow(join(basename, "from"), join(basename, "result"), { recursive: true });
        const alone = await copyShouldThrow(secret, join(basename, "out.txt"));

        // node copies each file with copyFile (verified against fs.promises.cp
        // in node v26.3.0).
        const shape = (e: any) => ({ code: e.code, syscall: e.syscall, path: e.path, dest: e.dest });
        expect({ inTree: shape(inTree), alone: shape(alone) }).toEqual({
          inTree: {
            code: "EACCES",
            syscall: "copyfile",
            path: secret,
            dest: join(basename, "result", "d", "secret.txt"),
          },
          alone: { code: "EACCES", syscall: "copyfile", path: secret, dest: join(basename, "out.txt") },
        });
      },
    );

    test.skipIf(!isLinux || process.getuid?.() === 0)(
      "recursive - a file in a directory without search permission fails at lstat",
      async () => {
        // readdir only needs read permission, so the directory lists its file.
        // node stats the entry before it copies it (verified against
        // fs.promises.cp in node v26.3.0).
        await using basename = tempDir("cp", {
          "from/locked/f.txt": "x",
        });
        const locked = join(basename, "from", "locked");
        fs.chmodSync(locked, 0o600);
        try {
          const e = await copyShouldThrow(join(basename, "from"), join(basename, "result"), { recursive: true });
          expect({ code: e.code, syscall: e.syscall, path: e.path, dest: e.dest }).toEqual({
            code: "EACCES",
            syscall: "lstat",
            path: join(locked, "f.txt"),
            dest: undefined,
          });
        } finally {
          fs.chmodSync(locked, 0o700);
        }
      },
    );

    test.skipIf(isWindows)(
      "symlinks - relative target with a trailing slash is resolved like path.resolve",
      async () => {
        await using basename = tempDir("cp", {
          "from/sub/keep.txt": "keep",
        });
        fs.symlinkSync("sub/", join(basename, "from", "link"));

        await copy(join(basename, "from"), join(basename, "result"), { recursive: true });

        // Verified against node v26.3.0: no trailing separator.
        expect(fs.readlinkSync(join(basename, "result", "link"))).toBe(join(basename, "from", "sub"));
      },
    );

    test.skipIf(isWindows)("recursive - FIFO inside the tree is rejected with ERR_FS_CP_FIFO_PIPE", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
      });
      mkfifo(join(basename, "from", "pipe"), 0o666);
      expect(fs.lstatSync(join(basename, "from", "pipe")).isFIFO()).toBe(true);

      const e = await copyShouldThrow(join(basename, "from"), join(basename, "result"), { recursive: true });
      expect(e.code).toBe("ERR_FS_CP_FIFO_PIPE");
    });

    test.skipIf(isWindows)("recursive - FIFO in one of many sibling directories is rejected", async () => {
      // More directories on one level than the source scan reads at a time.
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
      });
      for (let d = 0; d < 130; d++) fs.mkdirSync(join(basename, "from", `dir-${d}`));
      mkfifo(join(basename, "from", "dir-129", "pipe"), 0o666);

      const e = await copyShouldThrow(join(basename, "from"), join(basename, "result"), { recursive: true });
      expect(e.code).toBe("ERR_FS_CP_FIFO_PIPE");
    });

    test("filter - works", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
        "from/b.txt": "b",
      });

      await copy(basename + "/from", basename + "/result", {
        filter: (src: string) => {
          // cp joins child paths with the platform separator, so on Windows
          // the filter sees backslash-separated paths; normalize for the
          // assertion.
          src = src.replaceAll("\\", "/");
          return src.endsWith("/from") || src.includes("a.txt");
        },
        recursive: true,
      });

      expect(fs.existsSync(basename + "/result/a.txt")).toBe(true);
      expect(fs.existsSync(basename + "/result/b.txt")).toBe(false);
    });

    test("filter - paths given are correct and relative", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
        "from/b.txt": "b",
      });

      const filter = jest.fn((src: string) => true);

      let prev = process.cwd();
      process.chdir(String(basename));

      await copy(join(basename, "from"), join(basename, "result"), {
        filter,
        recursive: true,
      });

      process.chdir(prev);

      expect(filter.mock.calls.sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
        [join(basename, "from"), join(basename, "result")],
        [join(basename, "from", "a.txt"), join(basename, "result", "a.txt")],
        [join(basename, "from", "b.txt"), join(basename, "result", "b.txt")],
      ]);
    });

    test("trailing slash", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
        "from/b.txt": "b",
      });

      await copy(basename + "/from/", basename + "/result/", { recursive: true });

      assertContent(basename + "/result/a.txt", "a");
      assertContent(basename + "/result/b.txt", "b");
    });

    test("copy directory will ensure directory exists", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
        "from/b.txt": "b",
      });

      fs.mkdirSync(basename + "/result/");

      await copy(basename + "/from/", basename + "/hello/world/", { recursive: true });

      assertContent(basename + "/hello/world/a.txt", "a");
      assertContent(basename + "/hello/world/b.txt", "b");
    });

    test("relative paths for directories", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
        "from/b.txt": "b",
        "from/a.dir": { "c.txt": "c" },
      });

      const filter = jest.fn((src: string) => true);

      let prev = process.cwd();
      process.chdir(String(basename));

      await copy("from", "result", {
        recursive: true,
      });

      process.chdir(prev);

      assertContent(basename + "/result/a.dir/c.txt", "c");
    });

    test.if(process.platform === "win32")("should not throw EBUSY when copying the same file on windows", async () => {
      await using basename = tempDir("cp", {
        "hey": "hi",
      });

      // node rejects copying a file onto itself with ERR_FS_CP_EINVAL;
      // the regression this guards against is throwing EBUSY instead.
      let err: any;
      try {
        await copy(basename + "/hey", basename + "/hey");
      } catch (e) {
        err = e;
      }
      expect(err?.code).toBe("ERR_FS_CP_EINVAL");
    });
  });
}

test("cp with missing callback throws", () => {
  expect(() => {
    // @ts-expect-error
    fs.cp("a", "b" as any);
  }).toThrow(/"cb"/);
});

// On Windows, _copySingleFileSync's reparse-point branch opens a handle to the
// source symlink to resolve its target via GetFinalPathNameByHandleW. Previously
// that handle was never closed, leaking one OS handle per symlink copied. Over a
// large tree (e.g. node_modules with junctions) this eventually exhausts the
// process handle table.
test.skipIf(!isWindows)("cpSync over symlinks does not leak Windows handles", () => {
  const { dlopen } = require("bun:ffi");
  const k32 = dlopen("kernel32.dll", {
    GetCurrentProcess: { args: [], returns: "ptr" },
    GetProcessHandleCount: { args: ["ptr", "ptr"], returns: "i32" },
  });
  const out = new Uint32Array(1);
  const handleCount = () => {
    if (k32.symbols.GetProcessHandleCount(k32.symbols.GetCurrentProcess(), out) === 0) {
      throw new Error("GetProcessHandleCount failed");
    }
    return out[0];
  };

  const N = 64;
  using basename = tempDir("cp-symlink-leak", {
    "from/target.txt": "hello",
  });
  for (let i = 0; i < N; i++) {
    fs.symlinkSync(join(basename, "from", "target.txt"), join(basename, "from", `link${i}.txt`));
  }

  // Warm up once so any lazy init (thread pool, path buffers, etc.) doesn't
  // count against the measured delta.
  fs.cpSync(join(basename, "from"), join(basename, "warmup"), { recursive: true });

  const before = handleCount();
  fs.cpSync(join(basename, "from"), join(basename, "result"), { recursive: true });
  const after = handleCount();

  // Without the fix every symlink leaks a handle, so `after - before` is >= N.
  // With the fix the delta is ~0; allow generous slack for unrelated background
  // activity while still catching a per-symlink leak.
  expect(after - before).toBeLessThan(N / 2);
});

// Junctions are the one link type Windows lets unprivileged processes create, so
// node_modules trees from npm/pnpm/bun contain them. cpSync must copy them as
// links (Node's dereference:false default), and creating the copied link must not
// require symlink privilege (junction fallback).
test.skipIf(!isWindows)("cpSync recursive copies a junction as a link to the original target", () => {
  using basename = tempDir("cp-junction", {
    "from/real/inner.txt": "inner",
  });
  fs.symlinkSync(join(basename, "from", "real"), join(basename, "from", "junction"), "junction");

  fs.cpSync(join(basename, "from"), join(basename, "result"), { recursive: true });

  const copied = join(basename, "result", "junction");
  expect(fs.lstatSync(copied).isSymbolicLink()).toBe(true);
  // Pin the stored link target, not just that creation succeeded: a relative or
  // otherwise wrong target still produces a link that lstat reports as a symlink.
  const copiedTarget = fs.readlinkSync(copied);
  expect(isAbsolute(copiedTarget)).toBe(true);
  expect(fs.realpathSync(copiedTarget)).toBe(fs.realpathSync(join(basename, "from", "real")));
  expect(fs.realpathSync(copied)).toBe(fs.realpathSync(join(basename, "from", "real")));
  expect(fs.readFileSync(join(copied, "inner.txt"), "utf8")).toBe("inner");
});

// `GetFinalPathNameByHandleW(VOLUME_NAME_DOS)` spells targets on a network share as
// `\\?\UNC\server\share\...`. The copied link's target must come out as the absolute
// `\\server\share\...` form (libuv `fs__realpath_handle`), not a dangling relative path.
test.skipIf(!isWindows)("cpSync recursive copies a directory symlink to a UNC target as a working link", () => {
  using basename = tempDir("cp-unc-link", {
    "from/keep.txt": "keep",
    "real/inner.txt": "inner",
  });
  // Administrative-share spelling of `real`, like the "windows path handling"
  // suite in fs.test.ts relies on.
  const real = fs.realpathSync(join(basename, "real"));
  const uncReal = `\\\\localhost\\${real[0]}$\\${real.slice(3)}`;
  expect(fs.readFileSync(join(uncReal, "inner.txt"), "utf8")).toBe("inner");
  fs.symlinkSync(uncReal, join(basename, "from", "link"), "dir");

  fs.cpSync(join(basename, "from"), join(basename, "result"), { recursive: true });

  const copied = join(basename, "result", "link");
  expect(fs.lstatSync(copied).isSymbolicLink()).toBe(true);
  const copiedTarget = fs.readlinkSync(copied);
  expect(isAbsolute(copiedTarget)).toBe(true);
  expect(copiedTarget).toStartWith("\\\\");
  expect(fs.readFileSync(join(copied, "inner.txt"), "utf8")).toBe("inner");
});

// On Windows the OS path buffer is 32768 wide chars, which is impractical to exceed
// with on-disk directories, so this test targets POSIX where MAX_PATH_BYTES is small
// enough to reach via relative mkdir + chdir.
describe.skipIf(isWindows).each(["cp", "cpSync"] as const)(
  "fs.%s recursive returns ENAMETOOLONG instead of overflowing path buffer",
  which => {
    test(which, async () => {
      using dir = tempDir("cp-enametoolong", { s: {}, d: {} });
      const base = String(dir);
      const src = join(base, "s");
      const dst = join(base, "d");

      // Build a directory tree whose full path exceeds MAX_PATH_BYTES by creating each
      // level with a short relative path from a shell; the kernel never sees the whole
      // path so it never rejects it. We do this in /bin/sh rather than via process.chdir
      // so the test process's cwd is unaffected.
      //
      // The same tree is mirrored under dst so that on macOS — where both cpSyncInner and
      // _cpAsyncDirectory retry clonefile() at every recursion level — clonefile hits
      // EEXIST at every level and falls through to the manual iteration path containing
      // the bounds check (clonefile would otherwise clone the whole subtree at the vnode
      // level without ever building interior path strings).
      const seg = Buffer.alloc(200, "a").toString();
      for (const root of [src, dst]) {
        await using mktree = Bun.spawn({
          cmd: [
            "/bin/sh",
            "-c",
            `cd "$1" && i=0 && while [ $i -lt 64 ]; do mkdir "$2" && cd "$2" || exit 0; i=$((i+1)); done`,
            "sh",
            root,
            seg,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        await mktree.exited;
      }

      // Run the cp in a subprocess: before the fix this corrupts the stack and segfaults.
      const script = `
        const fs = require("fs");
        const src = ${JSON.stringify(src)};
        const dst = ${JSON.stringify(dst)};
        const done = e => {
          if (e && e.code === "ENAMETOOLONG") {
            console.log("ENAMETOOLONG");
          } else if (e) {
            console.log("ERR:" + (e.code || e.message));
          } else {
            console.log("OK");
          }
        };
        if (${JSON.stringify(which)} === "cpSync") {
          try { fs.cpSync(src, dst, { recursive: true }); done(); } catch (e) { done(e); }
        } else {
          fs.promises.cp(src, dst, { recursive: true }).then(() => done(), done);
        }
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("ENAMETOOLONG");
      expect(exitCode).toBe(0);
    });
  },
);

// fs.promises.cp recursive: when one SingleTask copy fails while siblings are
// still in flight on the thread pool, the parent AsyncCpTask must not be
// destroyed until every subtask has dropped its reference. Before the fix,
// the failing subtask enqueued runFromJSThread immediately and the JS thread
// freed the parent while other subtasks were still dereferencing it
// (heap-use-after-free under ASAN).
//
// POSIX-only: uses a pre-existing directory at the destination path of one
// file so that its SingleTask fails with EISDIR. This works even when running
// as root. On macOS the pre-existing dst/ makes clonefile() fail with EEXIST
// and fall through to the per-file SingleTask path being tested.
test.skipIf(!isPosix)(
  "fs.promises.cp recursive does not free parent task while subtasks are in flight after an error",
  async () => {
    const files: Record<string, string | object> = {};
    // Enough siblings so several SingleTasks are running on the thread pool
    // when the failing one errors.
    for (let i = 0; i < 32; i++) files[`src/f${i}.txt`] = "x";
    files["src/000-bad.txt"] = "x";
    // The destination for 000-bad.txt is a directory → copying into it fails.
    files["dst/000-bad.txt"] = { ".keep": "" };
    using dir = tempDir("cp-uaf", files);
    const base = String(dir);

    // Run the copy in a subprocess: before the fix this is a
    // heap-use-after-free that ASAN aborts on. The subprocess loops to make
    // the race reliable. It must reject with EISDIR each iteration and exit 0.
    const script = `
      const fs = require("fs");
      const path = require("path");
      const base = ${JSON.stringify(base)};
      const src = path.join(base, "src");
      const dst = path.join(base, "dst");
      (async () => {
        for (let i = 0; i < 20; i++) {
          try {
            await fs.promises.cp(src, dst, { recursive: true });
            console.log("UNEXPECTED-SUCCESS");
            process.exit(1);
          } catch (e) {
            if (e?.code !== "ERR_FS_CP_NON_DIR_TO_DIR") {
              console.log("UNEXPECTED-ERROR:" + (e?.code ?? e?.message));
              process.exit(1);
            }
          }
        }
        console.log("ok");
      })();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  },
);

test("fs.promises.cp with errorOnExist and without force rejects an existing empty destination", async () => {
  // Verified against node v26.3.0. Nothing has to be merged, but node checks
  // the destination directory itself.
  using dir = tempDir("cp-error-on-exist", {
    "from/d/f.txt": "x",
  });
  fs.mkdirSync(join(String(dir), "result"));

  await expect(
    fs.promises.cp(join(String(dir), "from"), join(String(dir), "result"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    }),
  ).rejects.toMatchObject({ code: "ERR_FS_CP_EEXIST" });
});

// The node-ported walker copies one entry at a time and awaits several thread
// pool round trips for each. The native copy runs the file copies on the thread
// pool in parallel, so a copy it does exactly like node must not go through the
// walker. The walker binds copyFile/copyFileSync when it first loads, so a
// fresh process can count how many files it copied.
describe.concurrent("recursive cp takes the JS walker only when the native copy can differ from node", () => {
  // `options` is source text for the child process.
  type Case = {
    label: string;
    options?: string;
    withSymlink?: boolean;
    destExists?: boolean;
    depth?: number;
    walker?: boolean;
    mayFail?: boolean;
    skip: boolean;
  };
  const cases: Case[] = [
    // Windows keeps the walker: the native copy there stops at MAX_PATH.
    { label: "default options", skip: isWindows },
    { label: "destination is an empty directory", destExists: true, skip: isWindows },
    // `force` and `errorOnExist` only matter for an entry that exists at the
    // destination, and the native copy ignores `mode` like a plain copy does.
    { label: "force: false", options: "{ force: false }", skip: isWindows },
    { label: "errorOnExist without force", options: "{ errorOnExist: true, force: false }", skip: isWindows },
    { label: "mode: COPYFILE_FICLONE", options: "{ mode: fs.constants.COPYFILE_FICLONE }", skip: isWindows },
    // macOS keeps the walker: clonefile() copies a relative link target as
    // written, and node rewrites it against the source tree.
    { label: "tree contains a relative symlink", withSymlink: true, skip: !isLinux },
    // The copy has to fail where a clone is not possible. Only copyFile does
    // that, so only the route is checked.
    {
      label: "mode: COPYFILE_FICLONE_FORCE",
      options: "{ mode: fs.constants.COPYFILE_FICLONE_FORCE }",
      walker: true,
      mayFail: true,
      skip: false,
    },
    { label: "filter", options: "{ filter: () => true }", walker: true, skip: false },
    // The native copy recurses once per directory level on a thread stack.
    { label: "tree deeper than 64 levels", depth: 70, walker: true, skip: false },
  ];
  const forms = ["cpSync", "cp", "promises.cp"];
  for (const {
    label,
    options = "{}",
    withSymlink = false,
    destExists = false,
    depth = 0,
    walker = false,
    mayFail = false,
    skip,
  } of cases) {
    test.skipIf(skip)(label, async () => {
      const files: Record<string, string> = {};
      for (let d = 0; d < 4; d++) {
        for (let f = 0; f < 4; f++) files[`from/dir-${d}/file-${f}.txt`] = `${d}-${f}`;
      }
      using dir = tempDir("cp-native-path", files);
      if (depth) {
        const levels = Array.from({ length: depth }, () => "n");
        fs.mkdirSync(join(String(dir), "from", ...levels), { recursive: true });
        fs.writeFileSync(join(String(dir), "from", ...levels, "deep.txt"), "deep");
      }
      if (withSymlink) fs.symlinkSync(join("dir-0", "file-0.txt"), join(String(dir), "from", "link"));
      if (destExists) {
        for (const form of forms) fs.mkdirSync(join(String(dir), "to-" + form));
      }

      const script = `
        import fs from "node:fs";
        let walkerCopies = 0;
        const { copyFileSync } = fs;
        const { copyFile } = fs.promises;
        fs.copyFileSync = function () { walkerCopies++; return copyFileSync.apply(this, arguments); };
        fs.promises.copyFile = function () { walkerCopies++; return copyFile.apply(this, arguments); };
        const options = { recursive: true, ...${options} };
        const copies = {
          "cpSync": dest => fs.cpSync("from", dest, options),
          "cp": dest => new Promise((resolve, reject) => fs.cp("from", dest, options, err => (err ? reject(err) : resolve()))),
          "promises.cp": dest => fs.promises.cp("from", dest, options),
        };
        const result = {};
        for (const form in copies) {
          walkerCopies = 0;
          let error = null;
          try { await copies[form]("to-" + form); } catch (e) { error = e.code; }
          const copied = fs.existsSync("to-" + form)
            ? fs.readdirSync("to-" + form, { recursive: true }).filter(name => name.endsWith(".txt")).length
            : 0;
          result[form] = { tookWalker: walkerCopies > 0, copied, error };
        }
        console.log(JSON.stringify(result));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const result = JSON.parse(stdout);
      if (mayFail) {
        expect(forms.map(form => [form, result[form].tookWalker])).toEqual(forms.map(form => [form, walker]));
      } else {
        const copied = depth ? 17 : 16;
        expect(result).toEqual(
          Object.fromEntries(forms.map(form => [form, { tookWalker: walker, copied, error: null }])),
        );
      }
      expect(exitCode).toBe(0);
      if (withSymlink) {
        // The child resolves the link against its working directory.
        const cwd = fs.realpathSync(String(dir));
        for (const form of forms) {
          expect(fs.readlinkSync(join(cwd, "to-" + form, "link"))).toBe(join(cwd, "from", "dir-0", "file-0.txt"));
        }
      }
    });
  }
});

test.skipIf(!isLinux)("fs.cp and fs.copyFile create the destination with the source file's mode", async () => {
  using dir = tempDir("cp-dest-mode", {});
  const destNames = ["dest-copyFile.bin", "dest-cp.bin"];
  const src = join(String(dir), "src.bin");
  fs.writeFileSync(src, "", { mode: 0o600 });
  fs.truncateSync(src, 1 << 26);
  fs.chmodSync(src, 0o600);

  const modeAtCreation = new Map<string, string>();
  const { promise: allCreated, resolve: onAllCreated, reject: onWatchError } = Promise.withResolvers<void>();
  const watcher = fs.watch(String(dir), (_event, filename) => {
    if (typeof filename !== "string" || !filename.startsWith("dest-") || modeAtCreation.has(filename)) {
      return;
    }
    try {
      modeAtCreation.set(filename, (fs.statSync(join(String(dir), filename)).mode & 0o777).toString(8));
    } catch (err) {
      onWatchError(err);
      return;
    }
    if (modeAtCreation.size === destNames.length) {
      onAllCreated();
    }
  });
  using _watcher = { [Symbol.dispose]: () => watcher.close() };
  watcher.on("error", onWatchError);

  const script = `
    const fs = require("node:fs");
    process.umask(0o022);
    fs.copyFileSync("src.bin", "dest-copyFile.bin");
    fs.cpSync("src.bin", "dest-cp.bin");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: {
      ...bunEnv,
      BUN_CONFIG_DISABLE_ioctl_ficlonerange: "1",
      BUN_CONFIG_DISABLE_COPY_FILE_RANGE: "1",
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
    allCreated,
  ]);
  const finalMode = (name: string) => (fs.statSync(join(String(dir), name)).mode & 0o777).toString(8);
  expect({
    atCreation: Object.fromEntries(modeAtCreation),
    final: Object.fromEntries(destNames.map(name => [name, finalMode(name)])),
  }).toEqual({
    atCreation: { "dest-copyFile.bin": "600", "dest-cp.bin": "600" },
    final: { "dest-copyFile.bin": "600", "dest-cp.bin": "600" },
  });
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});
