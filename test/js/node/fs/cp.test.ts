import { describe, expect, jest, test } from "bun:test";
import fs from "fs";
import {
  bunEnv,
  bunExe,
  type DirectoryTree,
  isLinux,
  isMacOS,
  isPosix,
  isWindows,
  tempDir,
  unprivilegedSpawnOptions,
} from "harness";
import { mkfifo } from "mkfifo";
import { basename, isAbsolute, join, sep } from "path";

const impls = [
  ["cpSync", fs.cpSync],
  ["cp", fs.promises.cp],
] as const;

function listTree(root: string, rel = ""): string[] {
  return fs
    .readdirSync(join(root, rel), { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap(entry =>
      entry.isDirectory()
        ? [`${rel}${entry.name}/`, ...listTree(root, `${rel}${entry.name}/`)]
        : [`${rel}${entry.name}`],
    );
}

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

    test.skipIf(isWindows)("recursive - FIFO inside the tree is rejected with ERR_FS_CP_FIFO_PIPE", async () => {
      await using basename = tempDir("cp", {
        "from/a.txt": "a",
      });
      mkfifo(join(basename, "from", "pipe"), 0o666);
      expect(fs.lstatSync(join(basename, "from", "pipe")).isFIFO()).toBe(true);

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

      const filter = jest.fn<(src: string, dest: string) => boolean>((src: string) => true);

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

    // The walker must never copy a directory it is writing into. The layouts
    // below reach the copy's own output through a second name that the
    // path-string guard cannot see. Without the identity check each one nests
    // copies until ENAMETOOLONG.
    describe("copy into its own output", () => {
      // Long enough that an unguarded copy runs out of path after a few levels.
      const deep = Buffer.alloc(isWindows ? 100 : 200, "d").toString();

      test("dest through a symlink to a source subdirectory", async () => {
        using dir = tempDir("cp-own-alias", { "src/sub": {} });
        const base = String(dir);
        const src = join(base, "src");
        fs.symlinkSync(join(src, "sub"), join(base, "alias"), "junction");

        const err = await copyShouldThrow(src, join(base, "alias", deep), { recursive: true });
        expect(err.code).toBe("ERR_FS_CP_EINVAL");
        // macOS takes the native route here, which is refused before it starts.
        expect(listTree(join(src, "sub"))).toEqual(isMacOS ? [] : [`${deep}/`, `${deep}/sub/`]);
      });

      test("dest through a relative symlink, walked in JS on every platform", async () => {
        using dir = tempDir("cp-own-alias-rel", { "src/sub": {} });
        const base = String(dir);
        const src = join(base, "src");
        fs.symlinkSync(join("src", "sub"), join(base, "alias"), "junction");

        const err = await copyShouldThrow(src, join(base, "alias", deep), { recursive: true, force: false });
        expect(err.code).toBe("ERR_FS_CP_EINVAL");
        expect(listTree(join(src, "sub"))).toEqual([`${deep}/`, `${deep}/sub/`]);
      });

      test("dest through a symlink, with missing parent directories", async () => {
        using dir = tempDir("cp-own-alias-deep", { "src/sub": {} });
        const base = String(dir);
        const src = join(base, "src");
        fs.symlinkSync(join(src, "sub"), join(base, "alias"), "junction");

        const err = await copyShouldThrow(src, join(base, "alias", "a", "b", deep), { recursive: true });
        expect(err.code).toBe("ERR_FS_CP_EINVAL");
        expect(listTree(join(src, "sub"))).toEqual(
          isMacOS
            ? []
            : ["a/", "a/b/", `a/b/${deep}/`, `a/b/${deep}/sub/`, `a/b/${deep}/sub/a/`, `a/b/${deep}/sub/a/b/`],
        );
      });

      // On Windows ".." is resolved as text, so this spelling names a sibling of src there.
      test.skipIf(isWindows)("dest whose parent resolves to src through a symlink and '..'", async () => {
        using dir = tempDir("cp-own-dotdot", { "src/sub": {} });
        const base = String(dir);
        const src = join(base, "src");
        fs.symlinkSync(join(src, "sub"), join(base, "alias"));

        const err = await copyShouldThrow(src, `${base}/alias/../${deep}`, { recursive: true });
        expect(err.code).toBe("ERR_FS_CP_EINVAL");
        expect(listTree(src)).toEqual(["sub/"]);
      });

      // The system resolves the parent only once the copy made `new`. Its text names a directory in src now.
      test.skipIf(isWindows)("dest through a symlink, after a name that does not exist yet", async () => {
        using dir = tempDir("cp-own-alias-new", { "src/sub": {} });
        const base = String(dir);
        const src = join(base, "src");
        fs.symlinkSync(join(src, "sub"), join(base, "alias"));

        const err = await copyShouldThrow(src, `${base}/new/../alias/${deep}`, { recursive: true });
        expect(err.code).toBe("ERR_FS_CP_EINVAL");
        // macOS takes the native route here, which is refused before it starts.
        expect(listTree(base)).toEqual(
          isMacOS
            ? ["alias", "src/", "src/sub/"]
            : ["alias", "new/", "src/", "src/sub/", `src/sub/${deep}/`, `src/sub/${deep}/sub/`],
        );
      });

      // The parent resolves only once the copy made `new`.
      test.skipIf(isWindows)("dest whose parent resolves to src after a name that does not exist yet", async () => {
        using dir = tempDir("cp-own-dotdot-new", { "src/sub": {} });
        const base = String(dir);
        const src = join(base, "src");
        fs.symlinkSync(join(src, "sub"), join(base, "alias"));

        const err = await copyShouldThrow(src, `${base}/new/../alias/../${deep}`, { recursive: true });
        expect(err.code).toBe("ERR_FS_CP_EINVAL");
        expect(listTree(base)).toEqual(["alias", "new/", "src/", "src/sub/"]);
      });

      test.skipIf(isWindows)("an existing dest whose parent resolves to src through a symlink and '..'", async () => {
        using dir = tempDir("cp-own-dotdot-merge", { "src": { "sub": {}, [deep]: {} } });
        const base = String(dir);
        const src = join(base, "src");
        fs.symlinkSync(join(src, "sub"), join(base, "alias"));

        const err = await copyShouldThrow(src, `${base}/alias/../${deep}`, { recursive: true });
        expect(err.code).toBe("ERR_FS_CP_EINVAL");
        expect(listTree(base)).toEqual(["alias", "src/", `src/${deep}/`, "src/sub/"]);
      });

      test("dereference: a symlink inside an existing dest points into src", async () => {
        using dir = tempDir("cp-own-deref-dest", { "src/sub": { [deep]: {} }, "dest": {} });
        const base = String(dir);
        const src = join(base, "src");
        fs.symlinkSync(join(src, "sub", deep), join(base, "dest", "sub"), "junction");

        const err = await copyShouldThrow(src, join(base, "dest"), { recursive: true, dereference: true });
        expect(err.code).toBe("ERR_FS_CP_EINVAL");
        expect(listTree(src)).toEqual(["sub/", `sub/${deep}/`]);
      });

      test("dereference: a symlink inside src points at the directory being created", async () => {
        using dir = tempDir("cp-own-deref-src", { "src": { [deep]: {} } });
        const base = String(dir);
        const src = join(base, "src");
        const link = Buffer.alloc(isWindows ? 50 : 200, "l").toString();
        fs.symlinkSync(join(base, "dest", deep), join(src, deep, link), "junction");

        const err = await copyShouldThrow(src, join(base, "dest"), { recursive: true, dereference: true });
        expect(err.code).toBe("ERR_FS_CP_EINVAL");
        expect(listTree(join(base, "dest"))).toEqual([`${deep}/`]);
      });

      // A directory this copy made and already finished is ordinary input again.
      test("dereference: a symlink to an already copied sibling is still copied", async () => {
        using dir = tempDir("cp-own-deref-sibling", { "src": { "p": {}, "q": {} } });
        const base = String(dir);
        const src = join(base, "src");
        const order: string[] = [];
        if (name === "cpSync") order.push(...fs.readdirSync(src));
        else for await (const dirent of await fs.promises.opendir(src)) order.push(dirent.name);
        const [first, second] = order;
        fs.writeFileSync(join(src, first, "f.txt"), "payload");
        fs.symlinkSync(join(base, "dest", first), join(src, second, "link"), "junction");

        await copy(src, join(base, "dest"), { recursive: true, dereference: true });
        expect(listTree(join(base, "dest")).sort()).toEqual(
          [`${first}/`, `${first}/f.txt`, `${second}/`, `${second}/link/`, `${second}/link/f.txt`].sort(),
        );
      });

      test("dereference: src is a symlink to the directory that holds dest", async () => {
        using dir = tempDir("cp-own-deref-self", { "P/file.txt": "payload" });
        const base = String(dir);
        const src = join(base, "P", "self");
        fs.symlinkSync(join(base, "P"), src, "junction");

        const err = await copyShouldThrow(src, join(base, "P", deep), { recursive: true, dereference: true });
        expect(err.code).toBe("ERR_FS_CP_EINVAL");
        expect(listTree(join(base, "P"))).toEqual(["file.txt", "self"]);
      });

      test("dereference: a filter that skips the output keeps a copy made inside src legal", async () => {
        using dir = tempDir("cp-own-deref-self-filter", { "P/file.txt": "payload" });
        const base = String(dir);
        const src = join(base, "P", "self");
        fs.symlinkSync(join(base, "P"), src, "junction");

        await copy(src, join(base, "P", "out"), {
          recursive: true,
          dereference: true,
          filter: (s: string) => s === src || !["out", "self"].includes(basename(s)),
        });
        expect(listTree(join(base, "P"))).toEqual(["file.txt", "out/", "out/file.txt", "self"]);
      });

      // The walk is out of its output again when the filter ended the copy of the first link.
      test("dereference: a filter that prunes below two links to dest keeps the copy legal", async () => {
        using dir = tempDir("cp-own-deref-two", { "src": { "a": {}, "b": {} }, "out": {} });
        const base = String(dir);
        fs.symlinkSync(join(base, "out"), join(base, "src", "a", "l1"), "junction");
        fs.symlinkSync(join(base, "out"), join(base, "src", "b", "l2"), "junction");

        await copy(join(base, "src"), join(base, "out"), {
          recursive: true,
          dereference: true,
          filter: (s: string) => !/[\\/]l[12][\\/]/.test(s.slice(base.length)),
        });
        expect(listTree(join(base, "out"))).toEqual(["a/", "a/l1/", "b/", "b/l2/"]);
      });

      // The filter is asked first, so a copy that skips its own output still succeeds, as in Node.js.
      test("a filter that skips the output directory keeps the copy legal", async () => {
        using dir = tempDir("cp-own-filter", { "src/file.txt": "payload", "src/sub": {} });
        const base = String(dir);
        const src = join(base, "src");
        fs.symlinkSync(join(src, "sub"), join(base, "alias"), "junction");

        await copy(src, join(base, "alias", "copy"), { recursive: true, filter: (s: string) => !s.endsWith("copy") });
        expect(listTree(join(src, "sub"))).toEqual(["copy/", "copy/file.txt", "copy/sub/"]);
      });

      test("a filter that prunes everything below the output ends the copy, as in Node.js", async () => {
        using dir = tempDir("cp-own-filter-prune", { "src/file.txt": "payload", "src/sub": {} });
        const base = String(dir);
        const src = join(base, "src");
        fs.symlinkSync(join(src, "sub"), join(base, "alias"), "junction");

        const filter = (s: string) => !s.includes(`${sep}out${sep}`);
        await copy(src, join(base, "alias", "out"), { recursive: true, filter });
        expect(listTree(join(src, "sub"))).toEqual(["out/", "out/file.txt", "out/sub/", "out/sub/out/"]);
      });

      test("a filter that keeps everything cannot make the copy re-enter its output", async () => {
        using dir = tempDir("cp-own-filter-all", { "src/sub": {} });
        const base = String(dir);
        const src = join(base, "src");
        fs.symlinkSync(join(src, "sub"), join(base, "alias"), "junction");

        const err = await copyShouldThrow(src, join(base, "alias", deep), { recursive: true, filter: () => true });
        expect(err.code).toBe("ERR_FS_CP_EINVAL");
        expect(listTree(join(src, "sub"))).toEqual([
          `${deep}/`,
          `${deep}/sub/`,
          `${deep}/sub/${deep}/`,
          `${deep}/sub/${deep}/sub/`,
        ]);
      });

      test("dest through a symlink that leads outside src is copied", async () => {
        using dir = tempDir("cp-alias-outside", { "src/file.txt": "payload", "other": {} });
        const base = String(dir);
        fs.symlinkSync(join(base, "other"), join(base, "alias"), "junction");

        await copy(join(base, "src"), join(base, "alias", "copy"), { recursive: true });
        expect(listTree(join(base, "other"))).toEqual(["copy/", "copy/file.txt"]);
      });

      // dirname() of this dest is src, and the directory that holds dest is not.
      test("a source spelled 'dir/.' is copied into 'dir/..'", async () => {
        using dir = tempDir("cp-into-parent", { "P/src/file.txt": "payload" });
        const base = String(dir);

        await copy(`${base}/P/src/.`, `${base}/P/src/..`, { recursive: true });
        expect(listTree(join(base, "P"))).toEqual(["file.txt", "src/", "src/file.txt"]);
      });

      test("dest through a symlink to the parent of src is copied as a sibling", async () => {
        using dir = tempDir("cp-alias-sibling", { "src/file.txt": "payload" });
        const base = fs.realpathSync(String(dir));
        fs.symlinkSync(base, join(base, "plink"), "junction");

        await copy(join(base, "src"), join(base, "plink", "pcopy"), { recursive: true });
        expect(listTree(join(base, "pcopy"))).toEqual(["file.txt"]);
        expect(listTree(join(base, "src"))).toEqual(["file.txt"]);
      });
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

test("fs.cp reports a copy into its own output to the callback", async () => {
  using dir = tempDir("cp-own-callback", { "src/sub": {} });
  const base = String(dir);
  const src = join(base, "src");
  fs.symlinkSync(join(src, "sub"), join(base, "alias"), "junction");
  const deep = Buffer.alloc(isWindows ? 100 : 200, "d").toString();

  const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException | null>();
  fs.cp(src, join(base, "alias", deep), { recursive: true, force: false }, resolve);
  expect((await promise)?.code).toBe("ERR_FS_CP_EINVAL");
  expect(listTree(join(src, "sub"))).toEqual([`${deep}/`, `${deep}/sub/`]);
});

// A bind mount gives a directory a second name that no path resolution sees through.
const canBindMount =
  isLinux &&
  (() => {
    try {
      const probe = "mount -t tmpfs tmpfs /tmp && mkdir /tmp/a /tmp/b && mount -o bind /tmp/a /tmp/b";
      return (
        Bun.spawnSync({ cmd: ["unshare", "-Urm", "sh", "-c", probe], stdout: "ignore", stderr: "ignore" }).exitCode ===
        0
      );
    } catch {
      return false;
    }
  })();

describe.skipIf(!canBindMount)("copy into its own output through a bind mount", () => {
  test.concurrent.each([
    ["cpSync", `fs.cpSync("a/sub", "b/t", { recursive: true })`],
    ["promises.cp", `await fs.promises.cp("a/sub", "b/t", { recursive: true })`],
  ])("%s", async (_, call) => {
    using dir = tempDir("cp-own-bind", { "a": {}, "b": {} });
    // The inode limit ends an unguarded copy quickly.
    const script = [
      "set -e",
      "mount -t tmpfs -o nr_inodes=64,size=1m tmpfs a",
      "mkdir -p a/sub/inner",
      "mount -o bind a/sub/inner b",
      'exec "$BUN_EXE" -e "$CP_FIXTURE"',
    ].join("\n");
    const fixture = `
      const fs = require("fs");
      const list = (rel) => fs.readdirSync(rel, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))
        .flatMap(entry => (entry.isDirectory() ? [rel + "/" + entry.name, ...list(rel + "/" + entry.name)] : []));
      (async () => {
        let code = "none";
        try {
          ${call};
        } catch (e) {
          code = e.code;
        }
        console.log(JSON.stringify({ code, dirs: list("a") }));
      })();
    `;
    await using proc = Bun.spawn({
      cmd: ["unshare", "-Urm", "sh", "-c", script],
      env: { ...bunEnv, BUN_EXE: bunExe(), CP_FIXTURE: fixture },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      code: "ERR_FS_CP_EINVAL",
      dirs: ["a/sub", "a/sub/inner", "a/sub/inner/t", "a/sub/inner/t/inner"],
    });
    expect(exitCode).toBe(0);
  });
});

// `app/cur` is a symlink to `releases/v2`. For the system `app/cur/..` is
// `releases`. As text (path.join, path.resolve) it is `app`. On Windows the
// system cancels `cur/..` as text too, so the two never differ there.
describe.skipIf(isWindows)("a root that holds <symlink>/..", () => {
  const impls = [
    [
      "cpSync",
      async (src: fs.PathLike, dest: string, opts?: fs.CopySyncOptions) => fs.cpSync(src as string, dest, opts),
    ],
    [
      "promises.cp",
      (src: fs.PathLike, dest: string, opts?: fs.CopyOptions) => fs.promises.cp(src as string, dest, opts),
    ],
  ] as const;
  const apis = impls.map(([api]) => api);

  // `below`: the directory in the temporary directory that gets the tree, with a "/" at the end.
  function fixture(below = "") {
    const dir = tempDir("cp-dotdot", {
      [`${below}app/config.json`]: "text twin",
      [`${below}releases/config.json`]: "live",
      [`${below}releases/v2/inner.txt`]: "inner",
      [`${below}from/a.txt`]: "a",
      [`${below}from/sub/b.txt`]: "b",
    });
    fs.symlinkSync("../releases/v2", join(dir, below, "app", "cur"));
    return dir;
  }

  // Every entry below `root`: the content of a file, the target of a link, or "dir".
  function tree(root: string, prefix = "", out: Record<string, string> = {}) {
    for (const entry of fs.readdirSync(join(root, prefix), { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) {
        out[path] = "dir";
        tree(root, path + "/", out);
      } else {
        out[path] = entry.isSymbolicLink()
          ? "-> " + fs.readlinkSync(join(root, path))
          : fs.readFileSync(join(root, path), "utf8");
      }
    }
    return out;
  }

  // `entries` below the directory `name`, in the form that tree() gives.
  const below = (name: string, entries: Record<string, string>) =>
    Object.fromEntries([[name, "dir"], ...Object.entries(entries).map(([path, value]) => [`${name}/${path}`, value])]);

  const releases = { "config.json": "live", "v2": "dir", "v2/inner.txt": "inner" };
  const from = { "a.txt": "a", "sub": "dir", "sub/b.txt": "b" };

  const ignoresCase = (() => {
    using dir = tempDir("cp-case", { "name": "" });
    return fs.existsSync(join(dir, "NAME"));
  })();

  const subdirOfSelf = (src: string, dest: string) => ({
    code: "ERR_FS_CP_EINVAL",
    path: dest,
    message: `Invalid src or dest: cp returned EINVAL (cannot copy ${src} to a subdirectory of self ${dest}) ${dest}`,
  });

  // For a copy of `src` to `dest` (both below `dir`) that starts, and that the walk stops. `parent` is the directory
  // that the copy makes for its output, `<parent>/copy`. The walk throws when it comes to that output as an entry of
  // the source. Before that it made one level: the name of `parent`, in the output. What else it copied depends on
  // the order of readdir.
  async function refusedAtOutput(
    copyError: (src: string, dest: string) => Promise<unknown>,
    dir: string,
    src: string,
    dest: string,
    parent: string,
  ) {
    const name = basename(parent);
    const before = tree(dir);
    expect(await copyError(`${dir}/${src}`, `${dir}/${dest}`)).toEqual(
      subdirOfSelf(`${dir}/${src}/${name}/copy`, `${dir}/${dest}/${name}/copy`),
    );
    const after = tree(dir);
    for (const path of Object.keys(after)) {
      if (path.startsWith(`${parent}/copy/`) && !`${path}/`.startsWith(`${parent}/copy/${name}/`)) delete after[path];
    }
    expect(after).toEqual({ ...before, [parent]: "dir", [`${parent}/copy`]: "dir", [`${parent}/copy/${name}`]: "dir" });
  }

  // Makes each copy of `cases` with each API, in a child with the working directory `cwd`. A "%" in a destination is
  // the name of the API. `lock` is a directory that the child gives a mode for the time of the copies: a child that
  // starts below a directory it cannot search does not know its working directory on macOS. `wrap` is a command
  // that runs the child, with shell to run first.
  async function copyInChild(
    cwd: string,
    cases: [src: string, dest: string, outcome: string][],
    { lock, wrap, ...options }: { lock?: [path: string, mode: number]; wrap?: [cmd: string[], shell: string] } & object,
  ) {
    const fixture = `
      const fs = require("node:fs");
      const apis = {
        "cpSync": async (src, dest) => fs.cpSync(src, dest, { recursive: true }),
        "promises.cp": (src, dest) => fs.promises.cp(src, dest, { recursive: true }),
      };
      (async () => {
        const lock = ${JSON.stringify(lock ?? null)};
        const results = {};
        if (lock) fs.chmodSync(lock[0], lock[1]);
        try {
          for (const [src, dest] of ${JSON.stringify(cases)}) {
            for (const api in apis) {
              results[api + ": " + src + " -> " + dest] = await apis[api](src, dest.replace("%", api)).then(
                () => "copied",
                err => err.code,
              );
            }
          }
        } finally {
          if (lock) fs.chmodSync(lock[0], 0o755);
        }
        console.log(JSON.stringify(results));
      })();
    `;
    await using proc = Bun.spawn({
      cmd: wrap
        ? [...wrap[0], "sh", "-c", `set -e\n${wrap[1]}\nexec "$BUN_EXE" -e "$CP_FIXTURE"`]
        : [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_EXE: bunExe(), CP_FIXTURE: fixture },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      ...options,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(JSON.parse(stdout)).toEqual(
      Object.fromEntries(
        cases.flatMap(([src, dest, outcome]) => apis.map(api => [`${api}: ${src} -> ${dest}`, outcome])),
      ),
    );
  }

  test("a relative root that starts above the working directory", async () => {
    using dir = fixture();
    await copyInChild(`${dir}/from/sub`, [["../../app/cur/..", "../../out-%", "copied"]], {});
    expect(Object.fromEntries(apis.map(api => [api, tree(`${dir}/out-${api}`)]))).toEqual(
      Object.fromEntries(apis.map(api => [api, releases])),
    );
  });

  // On Linux the real path of a directory comes from /proc/self/fd. The child keeps the process id of the shell.
  test.skipIf(!canBindMount)("copies when the system gives no real path", async () => {
    using dir = fixture();
    fs.symlinkSync("config.json", `${dir}/releases/link`);
    await copyInChild(`${dir}`, [["app/cur/..", "out-%", "copied"]], {
      wrap: [["unshare", "-Urm"], "mount -t tmpfs tmpfs /proc/$$/fd"],
    });
    // The relative link then resolves against the text of its directory, as in node's JS walk.
    expect(Object.fromEntries(apis.map(api => [api, tree(`${dir}/out-${api}`)]))).toEqual(
      Object.fromEntries(apis.map(api => [api, { ...releases, "link": `-> ${dir}/app/config.json` }])),
    );
  });

  test("fs.cp copies the entries of the source that the system resolves", async () => {
    using dir = fixture();
    const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException | null>();
    fs.cp(`${dir}/app/cur/..`, `${dir}/out`, { recursive: true }, resolve);
    expect(await promise).toBeNull();
    expect(tree(`${dir}/out`)).toEqual(releases);
  });

  // In a child, because root ignores permission bits (the harness then runs the child as a user that they apply
  // to) and because the working directory is one for the process.
  describe("with a directory that the copy cannot list or cannot search", () => {
    // Serial: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
    test.serial("does not need read permission on a directory above the destination", async () => {
      using dir = fixture();
      using unprivileged = unprivilegedSpawnOptions(`${dir}`);
      try {
        // The path goes through `app`, which the copy can search but not list.
        await copyInChild(`${dir}`, [[`${dir}/from`, `${dir}/app/cur/../copy-%`, "copied"]], {
          lock: [`${dir}/app`, 0o311],
          ...unprivileged,
        });
      } finally {
        fs.chmodSync(`${dir}/app`, 0o755);
      }
      expect(tree(`${dir}/releases`)).toEqual(
        Object.assign({ ...releases }, ...apis.map(api => below(`copy-${api}`, from))),
      );
      expect(tree(`${dir}/app`)).toEqual({ "config.json": "text twin", "cur": "-> ../releases/v2" });
    });

    // No root has `..` here. As on main, the first lookup through the destination is for an entry of the source.
    test.serial("does not need search permission on a destination that gets no entry", async () => {
      using dir = tempDir("cp-dest-locked", { "empty": {}, "one/f": "f", "dest": {} });
      using unprivileged = unprivilegedSpawnOptions(`${dir}`);
      try {
        await copyInChild(
          `${dir}`,
          [
            ["empty", "dest", "copied"],
            ["one", "dest", "EACCES"],
          ],
          { lock: ["dest", 0o000], ...unprivileged },
        );
      } finally {
        fs.chmodSync(`${dir}/dest`, 0o755);
      }
      expect(tree(`${dir}/dest`)).toEqual({});
    });

    test.serial("does not need search permission on a directory above the working directory", async () => {
      using dir = fixture("locked/work/t/");
      using unprivileged = unprivilegedSpawnOptions(`${dir}`);
      const work = `${dir}/locked/work`;
      try {
        // For the child, `..` is `locked`. With no search permission on it, no absolute path reaches the tree.
        await copyInChild(
          work,
          [
            // No name is a link, so main copies this one too. Each root has a directory part, because
            // path.resolve(".") asks the system for the working directory, which macOS refuses here.
            ["t/from", "t/from/../plain-%", "copied"],
            // As on main: checkParentPaths() stats the absolute parent of a destination that is not beside the
            // source.
            ["t/app/cur/..", "t/out-%", "EACCES"],
          ],
          { lock: ["..", 0o000], ...unprivileged },
        );
      } finally {
        fs.chmodSync(`${dir}/locked`, 0o755);
      }
      expect(tree(`${work}/t`)).toEqual(
        Object.assign(
          below("app", { "config.json": "text twin", "cur": "-> ../releases/v2" }),
          below("from", from),
          below("releases", releases),
          ...apis.map(api => below(`plain-${api}`, from)),
        ),
      );
    });
  });

  describe.concurrent.each(impls)("fs.%s", (_, copy) => {
    async function copyError(src: string, dest: string, opts: fs.CopySyncOptions = {}) {
      try {
        await copy(src, dest, { recursive: true, ...opts });
      } catch (e: any) {
        return { code: e.code, path: e.path, message: e.message };
      }
      return "copied";
    }

    test.each([
      ["app/cur/..", releases],
      ["app/cur/../", releases],
      ["app/cur/../v2", { "inner.txt": "inner" }],
      // The target of `abs` is absolute.
      ["app/abs/..", releases],
    ])("copies the entries of the source that the system resolves: %s", async (src, expected) => {
      using dir = fixture();
      fs.symlinkSync(`${dir}/releases/v2`, `${dir}/app/abs`);
      await copy(`${dir}/${src}`, `${dir}/out`, { recursive: true });
      expect(tree(`${dir}/out`)).toEqual(expected);
    });

    // Unlike node with a `filter`: its JS walk joins, gives the filter `app/config.json` and throws ENOENT.
    // https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/cp/cp-sync.js#L173
    test.each(["", "/"])("gives the filter paths that name the entries: app/cur/..%s", async slash => {
      using dir = fixture();
      const src = `${dir}/app/cur/..`;
      const dest = `${dir}/out`;
      const seen: string[][] = [];
      await copy(src + slash, dest, {
        recursive: true,
        filter: (from, to) => {
          seen.push([from, to, fs.statSync(from).isDirectory() ? "dir" : fs.readFileSync(from, "utf8")]);
          return true;
        },
      });
      // The filter gets the root first, as given. The order below it is the order of readdir.
      expect(seen.shift()).toEqual([src + slash, dest, "dir"]);
      expect(seen.sort()).toEqual([
        [`${src}/config.json`, `${dest}/config.json`, "live"],
        [`${src}/v2`, `${dest}/v2`, "dir"],
        [`${src}/v2/inner.txt`, `${dest}/v2/inner.txt`, "inner"],
      ]);
      expect(tree(dest)).toEqual(releases);
    });

    test.each([
      ["copy", "releases/copy", {}, true],
      ["copy", "releases/copy", {}, false],
      ["n1/n2/copy", "releases/n1/n2/copy", {}, false],
      ["copy", "releases/copy", { preserveTimestamps: true }, true],
      ["copy", "releases/copy", { dereference: true }, true],
    ])(
      "writes into the destination that the system resolves: app/cur/../%s -> %s %j",
      async (dest, real, opts, twin) => {
        using dir = fixture();
        // The text twin of the destination. Nothing may land in it.
        if (twin) fs.mkdirSync(`${dir}/app/copy`);
        await copy(`${dir}/from`, `${dir}/app/cur/../${dest}`, { recursive: true, ...opts });
        expect(tree(`${dir}/${real}`)).toEqual(from);
        if (twin) expect(tree(`${dir}/app/copy`)).toEqual({});
      },
    );

    test("merges into a destination that exists", async () => {
      using dir = fixture();
      fs.writeFileSync(`${dir}/releases/a.txt`, "old");
      await copy(`${dir}/from`, `${dir}/app/cur/..`, { recursive: true });
      expect(tree(`${dir}/releases`)).toEqual({ ...releases, ...from });
      expect(tree(`${dir}/app`)).toEqual({ "config.json": "text twin", "cur": "-> ../releases/v2" });
    });

    test("gives the filter the two roots as given when both hold the link", async () => {
      using dir = fixture();
      const src = `${dir}/app/cur/../v2`;
      const dest = `${dir}/app/cur/../out`;
      const seen: string[][] = [];
      await copy(src, dest, { recursive: true, filter: (from, to) => (seen.push([from, to]), true) });
      expect(seen).toEqual([
        [src, dest],
        [`${src}/inner.txt`, `${dest}/inner.txt`],
      ]);
      expect(tree(`${dir}/releases/out`)).toEqual({ "inner.txt": "inner" });
    });

    test("keeps the strings of path.join when the text is the same directory", async () => {
      using dir = fixture();
      // `cur` is a directory, then a link to a directory beside it, then a link out of `app`. Only that changes the
      // strings, and only for a root that the text does not name: a second `..` leads back to `app`.
      const seen: string[][] = [];
      const filter = (from: string) => (seen.push([from]), true);
      const src = `${dir}/app/cur/..`;

      fs.unlinkSync(`${dir}/app/cur`);
      fs.mkdirSync(`${dir}/app/cur`);
      await copy(src, `${dir}/out1`, { recursive: true, filter });
      fs.rmdirSync(`${dir}/app/cur`);
      fs.mkdirSync(`${dir}/app/real`);
      fs.symlinkSync("real", `${dir}/app/cur`);
      await copy(src, `${dir}/out2`, { recursive: true, filter });
      fs.unlinkSync(`${dir}/app/cur`);
      fs.symlinkSync("../releases/v2", `${dir}/app/cur`);
      await copy(src, `${dir}/out3`, { recursive: true, filter });
      await copy(`${src}/../app`, `${dir}/out4`, { recursive: true, filter });

      expect(seen.flat().sort()).toEqual(
        [
          src,
          `${dir}/app/config.json`,
          `${dir}/app/cur`,
          src,
          `${dir}/app/config.json`,
          `${dir}/app/cur`,
          `${dir}/app/real`,
          src,
          `${src}/config.json`,
          `${src}/v2`,
          `${src}/v2/inner.txt`,
          `${src}/../app`,
          `${dir}/app/config.json`,
          `${dir}/app/cur`,
          `${dir}/app/real`,
        ].sort(),
      );
    });

    // No name is a link. `mkdir -p` makes `new`, so `new/..` is what the text says.
    test("keeps the strings of path.join for a destination through a name that does not exist", async () => {
      using dir = fixture();
      const seen: string[] = [];
      const dest = `${dir}/new/../out`;
      await copy(`${dir}/from/sub`, dest, { recursive: true, filter: (_, to) => (seen.push(to), true) });
      expect(seen).toEqual([dest, `${dir}/out/b.txt`]);
      expect(tree(`${dir}/out`)).toEqual({ "b.txt": "b" });
    });

    test.each([
      // main gives ENOENT for the first two, and leaves a directory in the source.
      ["the destination is inside the source", "releases", "app/cur/../copy"],
      ["the target of the link is absolute", "releases", "app/abs/../copy"],
      // The same as main and node: the text of the roots says the same, or no name is a link.
      ["both roots hold the link", "app/cur/..", "app/cur/../v2/copy"],
      ["no name is a link", "releases/v2/..", "releases/v2/../new/copy"],
      ["a name that does not exist, no link", "from", "new/../from/x"],
      ["the destination is the parent of the source", "releases/v2", "releases/v2/.."],
      ["the destination is the parent of the source, through the link", "releases/v2", "app/cur/.."],
      ["the text of the destination is inside the source", "app", "app/cur/../copy"],
      // Node's cpSync copies this one. Its fs.cp and fs.promises.cp compare the text, as main does:
      // https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/cp/cp.js#L113
      ["only the text of the source holds the destination", "app/cur/..", "app/out"],
      // checkParentPaths() finds the source above the destination, and names the directory below it, as in node:
      // https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/cp/cp.js#L175-L184
      ["the source holds the link", "app/cur/..", "releases/v2/copy", "releases/v2"],
    ])("refuses to copy a directory into itself: %s", async (_, src, dest, named = dest) => {
      using dir = fixture();
      fs.symlinkSync(`${dir}/releases/v2`, `${dir}/app/abs`);
      const before = tree(`${dir}`);
      expect(await copyError(`${dir}/${src}`, `${dir}/${dest}`)).toEqual(
        subdirOfSelf(`${dir}/${src}`, `${dir}/${named}`),
      );
      expect(tree(`${dir}`)).toEqual(before);
    });

    // No check on the roots climbs from a parent that does not exist, so these copies start. The walk throws when
    // it comes to its output, `new/copy`. Before that it made `new` in the output. What else it copied depends on the
    // order of readdir.
    test.each([
      ["the destination holds the link", "releases", "app/cur/../new/copy"],
      ["the source holds the link", "app/cur/..", "releases/new/copy"],
    ])("stops a copy into itself below a parent that does not exist: %s", async (_, src, dest) => {
      using dir = fixture();
      await refusedAtOutput(copyError, `${dir}`, src, dest, "releases/new");
    });

    // The filter is asked before the walk looks at an entry, as for a root without the link.
    test("copies into the source when the filter skips the output", async () => {
      using dir = fixture();
      await copy(`${dir}/app/cur/..`, `${dir}/releases/new/copy`, {
        recursive: true,
        filter: (from: string) => basename(from) !== "new",
      });
      expect(tree(`${dir}/releases/new/copy`)).toEqual(releases);
    });

    // `alias/d` is in the source, and no parent of its text is.
    test.each([
      ["ERR_FS_CP_EEXIST", { errorOnExist: true, force: false }],
      ["ERR_FS_EISDIR", { recursive: false }],
    ])("gives %s for a destination in the source, as for a source without the link", async (code, opts) => {
      using dir = fixture();
      fs.mkdirSync(`${dir}/releases/v2/d`);
      fs.symlinkSync("releases/v2", `${dir}/alias`);
      const before = tree(`${dir}`);
      const results = [
        await copyError(`${dir}/app/cur/..`, `${dir}/alias/d`, opts),
        await copyError(`${dir}/releases`, `${dir}/alias/d`, opts),
      ];
      expect(results.map(result => (result === "copied" ? result : result.code))).toEqual([code, code]);
      expect(tree(`${dir}`)).toEqual(before);
    });

    test("refuses a destination in the source that resolves only when a name before the link exists", async () => {
      using dir = fixture();
      const before = tree(`${dir}`);
      const dest = `${dir}/new/../app/cur/../copy`;
      expect(await copyError(`${dir}/releases`, dest)).toEqual(subdirOfSelf(`${dir}/releases`, dest));
      // `mkdir -p` of the parent made `new`. Before that the system does not resolve the parent.
      expect(tree(`${dir}`)).toEqual({ ...before, new: "dir" });
    });

    test("copies to a destination beside the source that climbs out of a name that does not exist", async () => {
      using dir = fixture();
      // `new` is below the source. The destination is `releases/out`, beside it.
      await copy(`${dir}/releases/v2`, `${dir}/app/cur/new/../../out`, { recursive: true });
      // `mkdir -p` of the parent made `new` in the source, before the walk listed the source.
      expect(tree(`${dir}/releases/out`)).toEqual({ "inner.txt": "inner", "new": "dir" });
    });

    test("with dereference, refuses when the text of the destination is inside the source", async () => {
      using dir = fixture();
      const before = tree(`${dir}`);
      const result = await copyError(`${dir}/app`, `${dir}/app/cur/../v2/copy`, { dereference: true });
      expect(result).toEqual(subdirOfSelf(`${dir}/app`, `${dir}/app/cur/../v2/copy`));
      expect(tree(`${dir}`)).toEqual(before);
    });

    // Node's cpSync gives these targets (its C++ walk). Its JS walk resolves against the text of the directory.
    test("resolves a relative link target against the directory that holds the link", async () => {
      using dir = fixture();
      fs.symlinkSync("config.json", `${dir}/releases/link`);
      fs.symlinkSync("../config.json", `${dir}/releases/v2/up`);

      await copy(`${dir}/app/cur/..`, `${dir}/out`, { recursive: true });
      expect(tree(`${dir}/out`)).toEqual({
        ...releases,
        "link": `-> ${dir}/releases/config.json`,
        "v2/up": `-> ${dir}/releases/config.json`,
      });
    });

    test("a link that is the root resolves against the text of its directory, as in node", async () => {
      using dir = fixture();
      fs.symlinkSync("config.json", `${dir}/releases/link`);
      await copy(`${dir}/app/cur/../link`, `${dir}/out-link`);
      expect(fs.readlinkSync(`${dir}/out-link`)).toBe(`${dir}/app/config.json`);
    });

    // `current` in the destination is a relative link. Its directory is `releases`, which the destination names
    // through the link.
    test.each([
      // `from/current` and `releases/current` lead to one directory.
      ["refuses a link over a link to the same directory", "v2", "releases/v2", "ERR_FS_CP_EINVAL"],
      // As text `releases/current` is `app/x`, where `from/current` leads. They are two directories.
      ["replaces a link whose target is not its text twin", "x", "app/x", "copied"],
    ])("%s", async (_, target, srcTarget, expected) => {
      using dir = fixture();
      fs.mkdirSync(`${dir}/app/x`);
      fs.mkdirSync(`${dir}/releases/x`);
      fs.symlinkSync(`${dir}/${srcTarget}`, `${dir}/from/current`);
      fs.symlinkSync(target, `${dir}/releases/current`);
      const result = await copyError(`${dir}/from`, `${dir}/app/cur/..`);
      expect(result === "copied" ? result : result.code).toBe(expected);
      expect(fs.readlinkSync(`${dir}/releases/current`)).toBe(expected === "copied" ? `${dir}/${srcTarget}` : target);
    });

    test("a file in the way of the text form does not stop the copy", async () => {
      using dir = fixture();
      // `app/v2` is the text form of `app/cur/../v2`. Here it is a file.
      fs.writeFileSync(`${dir}/app/v2`, "in the way");
      fs.symlinkSync("../config.json", `${dir}/releases/v2/up`);

      await copy(`${dir}/app/cur/..`, `${dir}/out`, { recursive: true });
      expect(tree(`${dir}/out`)).toEqual({ ...releases, "v2/up": `-> ${dir}/releases/config.json` });

      await copy(`${dir}/from`, `${dir}/app/cur/../v2/copy`, { recursive: true });
      expect(tree(`${dir}/releases/v2/copy`)).toEqual(from);

      await copy(`${dir}/from`, `${dir}/app/cur/../v2/two/levels`, { recursive: true });
      expect(tree(`${dir}/releases/v2/two/levels`)).toEqual(from);
    });

    // The same as main and node: the text check of node does not ask whether `app/sub` exists.
    test.each([false, true])(
      "refuses when the text of the destination is inside the source, with its text twin: %p",
      async twin => {
        using dir = fixture();
        fs.mkdirSync(`${dir}/releases/sub`);
        if (twin) fs.mkdirSync(`${dir}/app/sub`);
        const before = tree(`${dir}`);
        expect(await copyError(`${dir}/app`, `${dir}/app/cur/../sub/copy`)).toEqual(
          subdirOfSelf(`${dir}/app`, `${dir}/app/cur/../sub/copy`),
        );
        expect(tree(`${dir}`)).toEqual(before);
      },
    );

    test("resolves a link target below a link that has the name of its target directory", async () => {
      using dir = fixture();
      // `app/same/../same` and its text form `app/same` are one directory. Its parent is `releases`, not `app`.
      fs.mkdirSync(`${dir}/releases/same`);
      fs.symlinkSync("../releases/same", `${dir}/app/same`);
      fs.symlinkSync("../config.json", `${dir}/releases/same/up`);

      await copy(`${dir}/app/same/..`, `${dir}/out`, { recursive: true });
      expect(fs.readlinkSync(`${dir}/out/same/up`)).toBe(`${dir}/releases/config.json`);
    });

    test("a Buffer root with <symlink>/.. throws as a Buffer root without it does", async () => {
      using dir = fixture();
      const code = async (src: string) => {
        try {
          await copy(Buffer.from(src), `${dir}/out`, { recursive: true });
        } catch (e: any) {
          return e.code;
        }
        return "copied";
      };
      expect([await code(`${dir}/app/cur/..`), await code(`${dir}/releases`)]).toEqual([
        "ERR_INVALID_ARG_TYPE",
        "ERR_INVALID_ARG_TYPE",
      ]);
    });
  });

  // One directory has two real paths: through a bind mount, and on a volume that ignores case (the default on
  // macOS). `app/self/..` is `app` and `app/other/..` is `releases`. The links name them `APP` and `RELEASES`.
  describe("a link that names a directory by a second real path", () => {
    // Source, destination, and for a copy that the walk stops: the directory that the copy makes for its output.
    const cases: [src: string, dest: string, parent: string][] = [
      // The text of this source holds the destination, so no copy starts, as on main.
      ["app/self/..", "app/new/out-%", ""],
      ["app/other/..", "releases/new2-%/copy", "releases/new2-%"],
      ["releases", "app/other/../new3-%/copy", "releases/new3-%"],
    ];
    function fixtureWithLinks() {
      const dir = fixture();
      fs.mkdirSync(`${dir}/app/v1`);
      fs.symlinkSync("../APP/v1", `${dir}/app/self`);
      fs.symlinkSync("../RELEASES/v2", `${dir}/app/other`);
      return dir;
    }

    test.skipIf(!canBindMount)("through bind mounts: refuses to copy a directory into itself", async () => {
      using dir = fixtureWithLinks();
      fs.mkdirSync(`${dir}/out`);
      const before = tree(`${dir}`);
      await copyInChild(
        `${dir}`,
        [
          ...cases.map(([src, dest]): [string, string, string] => [src, dest, "ERR_FS_CP_EINVAL"]),
          // `out/in-%` is not below the source for any check on the roots: the source holds a second name of `out`.
          ["app/cur/..", "out/in-%", "ERR_FS_CP_EINVAL"],
        ],
        {
          wrap: [
            ["unshare", "-Urm"],
            "mkdir APP RELEASES releases/m\nmount -o bind app APP\nmount -o bind releases RELEASES\nmount -o bind out releases/m",
          ],
        },
      );
      // The mounts went away with the child. Each walk that started made one level of its output in that output,
      // and nothing in it.
      const after = tree(`${dir}`);
      const stopped = apis.flatMap(api => [`releases/new2-${api}`, `releases/new3-${api}`]);
      expect(stopped.map(parent => tree(`${dir}/${parent}/copy/${basename(parent)}`))).toEqual(stopped.map(() => ({})));
      for (const path of Object.keys(after)) if (/^(out|releases\/new[23]-[^/]+)\//.test(path)) delete after[path];
      expect(after).toEqual({
        ...before,
        "APP": "dir",
        "RELEASES": "dir",
        "releases/m": "dir",
        ...Object.fromEntries(stopped.map(parent => [parent, "dir"])),
      });
    });

    describe.skipIf(!ignoresCase)("on a volume that ignores case", () => {
      describe.concurrent.each(impls)("fs.%s", (api, copy) => {
        const copyError = (src: string, dest: string) =>
          copy(src, dest, { recursive: true }).then(
            () => "copied" as const,
            (e: any) => ({ code: e.code, path: e.path, message: e.message }),
          );
        test.each(cases)("refuses to copy a directory into itself: %s -> %s", async (src, dest, parent) => {
          using dir = fixtureWithLinks();
          dest = dest.replace("%", api);
          if (parent) {
            await refusedAtOutput(copyError, `${dir}`, src, dest, parent.replace("%", api));
          } else {
            const before = tree(`${dir}`);
            expect(await copyError(`${dir}/${src}`, `${dir}/${dest}`)).toEqual(
              subdirOfSelf(`${dir}/${src}`, `${dir}/${dest}`),
            );
            expect(tree(`${dir}`)).toEqual(before);
          }
        });
      });
    });
  });
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
    const files: DirectoryTree = {};
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
