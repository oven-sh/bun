/**
 * @note `fs.glob` et. al. are powered by {@link Bun.Glob}, which is extensively
 * tested elsewhere. These tests check API compatibility with Node.js.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { isWindows, tempDir, tempDirWithFiles } from "harness";
import fs from "node:fs";
import path from "node:path";

let tmp: string;
beforeAll(() => {
  tmp = tempDirWithFiles("fs-glob", {
    "foo.txt": "foo",
    a: {
      "bar.txt": "bar",
      "baz.js": "baz",
    },
    "folder.test": {
      "file.txt": "content",
      "another-folder": {
        "some-file.txt": "content",
      },
    },
  });
});

afterAll(() => {
  return fs.promises.rmdir(tmp, { recursive: true });
});

describe("fs.glob", () => {
  it("has a length of 3", () => {
    expect(fs).toHaveProperty("glob");
    expect(typeof fs.glob).toEqual("function");
    expect(fs.glob).toHaveLength(3);
  });

  it("is named 'glob'", () => {
    expect(fs.glob.name).toEqual("glob");
  });

  it("when successful, passes paths to the callback", done => {
    fs.glob("*.txt", { cwd: tmp }, (err, paths) => {
      expect(err).toBeNull();
      expect(paths.sort()).toStrictEqual(["foo.txt"]);
      done();
    });
  });

  it("can filter out files", done => {
    const exclude = (path: string) => path.endsWith(".js");
    fs.glob("a/*", { cwd: tmp, exclude }, (err, paths) => {
      if (err) done(err);
      if (isWindows) {
        expect(paths).toStrictEqual(["a\\bar.txt"]);
      } else {
        expect(paths).toStrictEqual(["a/bar.txt"]);
      }
      done();
    });
  });

  it("can filter out files (2)", done => {
    const exclude = ["**/*.js"];
    fs.glob("a/*", { cwd: tmp, exclude }, (err, paths) => {
      if (err) done(err);
      if (isWindows) {
        expect(paths).toStrictEqual(["a\\bar.txt"]);
      } else {
        expect(paths).toStrictEqual(["a/bar.txt"]);
      }
      done();
    });
  });

  describe("invalid arguments", () => {
    it("throws if no callback is provided", () => {
      expect(() => fs.glob("*.txt")).toThrow(TypeError);
      expect(() => fs.glob("*.txt", undefined)).toThrow(TypeError);
      expect(() => fs.glob("*.txt", { cwd: tmp })).toThrow(TypeError);
      expect(() => fs.glob("*.txt", { cwd: tmp }, undefined)).toThrow(TypeError);
    });
  });

  it("matches directories", () => {
    const paths = fs.globSync("*.test", { cwd: tmp });
    expect(paths).toContain("folder.test");
  });

  it("supports arrays of patterns", () => {
    const expected = isWindows ? ["a\\bar.txt", "a\\baz.js"] : ["a/bar.txt", "a/baz.js"];
    expect(fs.globSync(["a/bar.txt", "a/baz.js"], { cwd: tmp })).toStrictEqual(expected);
  });
}); // </fs.glob>

describe("fs.globSync", () => {
  it("has a length of 2", () => {
    expect(fs).toHaveProperty("globSync");
    expect(typeof fs.globSync).toBe("function");
    expect(fs.globSync).toHaveLength(2);
  });

  it("is named 'globSync'", () => {
    expect(fs.globSync.name).toEqual("globSync");
  });

  it.each([
    ["*.txt", ["foo.txt"]],
    ["a/**", isWindows ? ["a\\bar.txt", "a\\baz.js"] : ["a/bar.txt", "a/baz.js"]],
  ])("fs.glob(%p, { cwd: /tmp/fs-glob }) === %p", (pattern, expected) => {
    expect(fs.globSync(pattern, { cwd: tmp }).sort()).toStrictEqual(expected);
  });

  describe("when process.cwd() is set", () => {
    let oldProcessCwd: () => string;
    beforeAll(() => {
      oldProcessCwd = process.cwd;
      process.cwd = () => tmp;
    });
    afterAll(() => {
      process.cwd = oldProcessCwd;
    });

    it("respects the new cwd", () => {
      expect(fs.globSync("*.txt")).toStrictEqual(["foo.txt"]);
    });
  });

  it("can filter out files", () => {
    const exclude = (path: string) => path.endsWith(".js");
    const expected = isWindows ? ["a\\bar.txt"] : ["a/bar.txt"];
    expect(fs.globSync("a/*", { cwd: tmp, exclude })).toStrictEqual(expected);
  });
  it("can filter out files (2)", () => {
    const exclude = ["**/*.js"];
    const expected = isWindows ? ["a\\bar.txt"] : ["a/bar.txt"];
    expect(fs.globSync("a/*", { cwd: tmp, exclude })).toStrictEqual(expected);
  });

  it("works without providing options", () => {
    const oldProcessCwd = process.cwd;
    try {
      process.cwd = () => tmp;

      const paths = fs.globSync("*.txt");
      expect(paths).toContain("foo.txt");
    } finally {
      process.cwd = oldProcessCwd;
    }
  });

  it("matches directories", () => {
    const paths = fs.globSync("*.test", { cwd: tmp });
    expect(paths).toContain("folder.test");
  });

  it("supports arrays of patterns", () => {
    const expected = isWindows ? ["a\\bar.txt", "a\\baz.js"] : ["a/bar.txt", "a/baz.js"];
    expect(fs.globSync(["a/bar.txt", "a/baz.js"], { cwd: tmp })).toStrictEqual(expected);
  });
}); // </fs.globSync>

describe("fs.promises.glob", () => {
  it("has a length of 2", () => {
    expect(fs.promises).toHaveProperty("glob");
    expect(typeof fs.promises.glob).toBe("function");
    expect(fs.promises.glob).toHaveLength(2);
  });

  it("is named 'glob'", () => {
    expect(fs.promises.glob.name).toEqual("glob");
  });

  it("returns an AsyncIterable over matched paths", async () => {
    const iter = fs.promises.glob("*.txt", { cwd: tmp });
    // FIXME: .toHaveProperty does not support symbol keys
    expect(iter[Symbol.asyncIterator]).toBeDefined();
    for await (const path of iter) {
      expect(path).toMatch(/\.txt$/);
    }
  });

  it("works without providing options", async () => {
    const oldProcessCwd = process.cwd;
    try {
      process.cwd = () => tmp;

      const iter = fs.promises.glob("*.txt");
      expect(iter[Symbol.asyncIterator]).toBeDefined();

      const paths = [];
      for await (const path of iter) {
        paths.push(path);
      }

      expect(paths).toContain("foo.txt");
    } finally {
      process.cwd = oldProcessCwd;
    }
  });

  it("matches directories", async () => {
    const iter = fs.promises.glob("*.test", { cwd: tmp });
    expect(iter[Symbol.asyncIterator]).toBeDefined();
    let count = 0;
    for await (const path of iter) {
      expect(path).toBe("folder.test");
      count++;
    }
    expect(count).toBe(1);
  });

  it("can filter out files", async () => {
    const exclude = (path: string) => path.endsWith(".js");
    const expected = isWindows ? ["a\\bar.txt"] : ["a/bar.txt"];
    expect(Array.fromAsync(fs.promises.glob("a/*", { cwd: tmp, exclude }))).resolves.toStrictEqual(expected);
  });

  it("can filter out files (2)", async () => {
    const exclude = ["**/*.js"];
    const expected = isWindows ? ["a\\bar.txt"] : ["a/bar.txt"];
    expect(Array.fromAsync(fs.promises.glob("a/*", { cwd: tmp, exclude }))).resolves.toStrictEqual(expected);

    const exclude2 = ["folder.test/another-folder"];
    const expected2 = isWindows ? ["folder.test\\file.txt"] : ["folder.test/file.txt"];
    expect(
      Array.fromAsync(fs.promises.glob("folder.test/**/*", { cwd: tmp, exclude: exclude2 })),
    ).resolves.toStrictEqual(expected2);
  });

  it("supports arrays of patterns", async () => {
    const expected = isWindows ? ["a\\bar.txt", "a\\baz.js"] : ["a/bar.txt", "a/baz.js"];
    expect(Array.fromAsync(fs.promises.glob(["a/bar.txt", "a/baz.js"], { cwd: tmp }))).resolves.toStrictEqual(expected);
  });
}); // </fs.promises.glob>

// https://github.com/oven-sh/bun/issues/29699
describe.skipIf(isWindows)("does not descend into directory symlinks (matches Node)", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;

  beforeAll(() => {
    // pnpm-style symlink cycle: a/node_modules/b -> b, b/node_modules/c -> c,
    //                           c/node_modules/a -> a. If glob followed directory
    // symlinks, a `**/*.test.ts` search rooted at `a/` would loop indefinitely.
    dir = tempDir("fs-glob-symlink", {
      a: { src: { "foo.test.ts": "export {}" }, node_modules: {} },
      b: { src: { "bar.test.ts": "export {}" }, node_modules: {} },
      c: { node_modules: {} },
      // Plus a flat symlink pointing at a sibling directory (exercises the
      // non-cycle case where Node still does not descend).
      flat: { dir: { "inside.txt": "x" } },
      // A symlink pointing directly at a file (Node does match these).
      "target.txt": "t",
    });
    root = String(dir);
    fs.symlinkSync("../../b", path.join(root, "a/node_modules/b"), "dir");
    fs.symlinkSync("../../c", path.join(root, "b/node_modules/c"), "dir");
    fs.symlinkSync("../../a", path.join(root, "c/node_modules/a"), "dir");
    fs.symlinkSync("dir", path.join(root, "flat/link"), "dir");
    fs.symlinkSync("target.txt", path.join(root, "alias.txt"), "file");
  });

  afterAll(() => {
    dir[Symbol.dispose]();
  });

  it("fs.promises.glob does not loop on a pnpm-style symlink cycle", async () => {
    const matches: string[] = [];
    for await (const file of fs.promises.glob("**/*.test.ts", { cwd: path.join(root, "a") })) {
      matches.push(file);
      if (matches.length > 2) break; // guard: the bug emitted infinite matches
    }
    expect(matches).toStrictEqual(["src/foo.test.ts"]);
  });

  it("fs.globSync does not descend into a directory symlink", () => {
    expect(fs.globSync("*/*.txt", { cwd: path.join(root, "flat") }).sort()).toStrictEqual(["dir/inside.txt"]);
  });

  it("fs.globSync still matches symlinks that point at files", () => {
    expect(fs.globSync("*.txt", { cwd: root }).sort()).toStrictEqual(["alias.txt", "target.txt"]);
  });

  it("literal path segments still traverse symlinks", () => {
    // Node's nuance: *wildcard* segments don't descend into symlinks, but
    // *literal* path segments do. Dropping that distinction regresses common
    // patterns like `src/*.ts` where `src` could itself be a symlink.
    const cwd = path.join(root, "flat");
    expect(fs.globSync("link/*.txt", { cwd }).sort()).toStrictEqual(["link/inside.txt"]);
    expect(fs.globSync("link/inside.txt", { cwd }).sort()).toStrictEqual(["link/inside.txt"]);
    // But a wildcard segment that happens to match the symlink name still
    // does not descend.
    expect(fs.globSync("l*/*.txt", { cwd })).toStrictEqual([]);
  });

  it("absolute patterns with a literal prefix through a symlink", () => {
    const cwd = path.join(root, "flat");
    expect(fs.globSync(path.join(cwd, "link/*.txt"))).toStrictEqual([path.join(cwd, "link/inside.txt")]);
  });

  it("literal segments after a wildcard still traverse symlinks", () => {
    // Previously `*/link/*.txt` returned [] because the JS transform only
    // handles *leading* literal prefixes. With the walker-level fix (literal
    // matches may descend into symlinks even mid-pattern), this now matches
    // Node's behavior: `*` matches `flat` (real dir), then the literal `link`
    // descends through the symlink.
    expect(fs.globSync("*/link/*.txt", { cwd: root })).toStrictEqual(["flat/link/inside.txt"]);
    // But `**/link/*.txt` still returns [] — globstar is a wildcard, so it
    // can't cross the symlink even if the next segment is literal.
    expect(fs.globSync("**/link/*.txt", { cwd: root })).toStrictEqual([]);
  });

  it("trailing slashes match the named directory", () => {
    // `a/` is Node-idiomatic for "match directory `a`"; split-on-sep yields
    // an empty trailing segment that mustn't be fed to the matcher as an
    // empty pattern.
    expect(fs.globSync("a/", { cwd: root })).toStrictEqual(["a"]);
    expect(fs.globSync("a/src/", { cwd: root })).toStrictEqual(["a/src"]);
  });

  it("trailing slash on a wildcard pattern filters to directories", () => {
    // `a/*/` is "directories only"; the trailing separator we strip before
    // splitting must be re-appended to the remainder so Bun.Glob's
    // `trailing_sep` filter still fires.
    using dir = tempDir("glob-trail", {
      a: {
        sub1: { ".keep": "" },
        sub2: { ".keep": "" },
        "file.txt": "f",
      },
    });
    expect(fs.globSync("a/*/", { cwd: String(dir) }).sort()).toStrictEqual(["a/sub1", "a/sub2"]);
    expect(fs.globSync("a/*", { cwd: String(dir) }).sort()).toStrictEqual([
      "a/file.txt",
      "a/sub1",
      "a/sub2",
    ]);
  });

  it("literal prefix naming a regular file returns []", () => {
    // Opening `target.txt/` as a directory would throw ENOTDIR; Node returns
    // `[]` silently and so do we.
    expect(fs.globSync("target.txt/*.js", { cwd: root })).toStrictEqual([]);
  });
}); // </symlink behavior>
