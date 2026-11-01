/**
 * @note `fs.glob` et. al. are powered by {@link Bun.Glob}, which is extensively
 * tested elsewhere. These tests check API compatibility with Node.js.
 */
import { fsGlobPlainDepth } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { isMacOS, isWindows, tempDir, tempDirWithFiles, type DirectoryTree } from "harness";
import fs from "node:fs";
import { join, relative, resolve, sep } from "node:path";

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
  return fs.promises.rm(tmp, { recursive: true, force: true });
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
    fs.glob("a/**", { cwd: tmp, exclude }, (err, paths) => {
      if (err) done(err);
      if (isWindows) {
        expect(paths.sort()).toStrictEqual(["a", "a\\bar.txt"]);
      } else {
        expect(paths.sort()).toStrictEqual(["a", "a/bar.txt"]);
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
      // @ts-expect-error
      expect(() => fs.glob("*.txt")).toThrow(TypeError);
      // @ts-expect-error
      expect(() => fs.glob("*.txt", undefined)).toThrow(TypeError);
      // @ts-expect-error
      expect(() => fs.glob("*.txt", { cwd: tmp })).toThrow(TypeError);
      // @ts-expect-error
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
    ["a/**", isWindows ? ["a", "a\\bar.txt", "a\\baz.js"] : ["a", "a/bar.txt", "a/baz.js"]],
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
    const expected = isWindows ? ["a", "a\\bar.txt"] : ["a", "a/bar.txt"];
    expect(fs.globSync("a/**", { cwd: tmp, exclude }).sort()).toStrictEqual(expected);
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

  describe("invalid arguments", () => {
    // Node's fs.promises.glob is an async generator: the iterator is always
    // returned and validation errors reject the first .next() instead of
    // throwing synchronously at the call site.
    it.each([
      ["non-string pattern", () => fs.promises.glob(1 as any)],
      ["non-object options", () => fs.promises.glob("*", 1 as any)],
      ["object pattern", () => fs.promises.glob({} as any)],
      ["non-string array element", () => fs.promises.glob(["*", 1] as any)],
      ["invalid exclude", () => fs.promises.glob("*", { exclude: "bad" as any })],
      ["invalid followSymlinks", () => fs.promises.glob("*", { followSymlinks: 1 as any })],
    ])("%s: returns iterator, first .next() rejects", async (_name, mk) => {
      let it: any;
      expect(() => (it = mk())).not.toThrow();
      expect(typeof it[Symbol.asyncIterator]).toBe("function");
      const next = it.next();
      expect(next).toBeInstanceOf(Promise);
      await expect(next).rejects.toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    });

    it("for-await catches the validation error", async () => {
      const it = fs.promises.glob("*", { exclude: "bad" as any });
      let caught: any;
      try {
        for await (const _ of it) {
        }
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TypeError);
      expect(caught.code).toBe("ERR_INVALID_ARG_TYPE");
    });
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

      const paths: string[] = [];
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
    const expected = isWindows ? ["a", "a\\bar.txt"] : ["a", "a/bar.txt"];
    const paths = await Array.fromAsync(fs.promises.glob("a/**", { cwd: tmp, exclude }));
    expect(paths.sort()).toStrictEqual(expected);
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

describe("fs.globSync exclude with withFileTypes", () => {
  it("invokes the exclude callback with Dirents when cwd differs from process.cwd()", () => {
    using dir = tempDir("glob-exclude-dirent", {
      "skip/inner.txt": "x",
      "keep/inner.txt": "y",
    });
    // The Dirents handed to exclude must be stat'ed relative to options.cwd,
    // not process.cwd() (a relative lookup would silently skip the callback).
    const seen: string[] = [];
    const results = fs.globSync("**", {
      cwd: dir,
      withFileTypes: true,
      exclude: (dirent: any) => {
        seen.push(dirent.name);
        return dirent.name === "skip";
      },
    }) as any[];
    expect(seen).toContain("skip");
    const names = results.map(d => d.name);
    expect(names).toContain("keep");
    expect(names).not.toContain("skip");
    // skip/inner.txt pruned with its directory; keep/inner.txt survives
    const inners = results.filter(d => d.name === "inner.txt");
    expect(inners).toHaveLength(1);
    expect(String(inners[0].parentPath).replaceAll("\\", "/")).toEndWith("keep");
  });
});

// The lists in the blocks below are the ones Node.js v26.12.1 returns for the same tree and the same call.

type GlobOptions = { cwd: string; followSymlinks?: boolean; exclude?: string[]; maxDepth?: number | null };

/** The lists of the three entry points, sorted, with "/" as the separator. */
async function globAll(pattern: string | string[], options: GlobOptions) {
  const normalize = (paths: string[]) => paths.map(path => path.replaceAll(sep, "/")).sort();
  const { promise, resolve, reject } = Promise.withResolvers<string[]>();
  fs.glob(pattern, options, (err, paths) => (err ? reject(err) : resolve(paths)));
  return {
    globSync: normalize(fs.globSync(pattern, options)),
    glob: normalize(await promise),
    "promises.glob": normalize(await Array.fromAsync(fs.promises.glob(pattern, options))),
  };
}

function fromAllThree(expected: string[]) {
  return { globSync: expected, glob: expected, "promises.glob": expected };
}

/**
 * Makes `link` a link to the directory `target`, which is a path below `root`.
 * A junction is the link to a directory that Windows lets a process create without a privilege. POSIX ignores the type.
 */
function linkDirectory(root: string, target: string, link: string) {
  fs.symlinkSync(join(root, target), join(root, link), "junction");
}

// https://github.com/nodejs/node/issues/62897
describe("a directory that is listed after one of its children was traversed", () => {
  const src = { src: { helpers: { "a.ts": "", "b.ts": "" }, "index.ts": "" } };
  const cases: { name: string; tree: DirectoryTree; pattern: string | string[]; expected: string[] }[] = [
    {
      // "a/**" matches "a" and every directory below it. "../*" lists the parent of each one.
      name: "'..' after '**'",
      tree: { a: { b: { c: { d: {} } }, c: { d: { c: {} } }, x: "", z: "" } },
      pattern: "a/**/../*",
      expected: ["a", "a/b", "a/b/c", "a/b/c/d", "a/c", "a/c/d", "a/c/d/c", "a/x", "a/z"],
    },
    {
      // "r.js" is the match in which "**" stands for no directory.
      name: "'..' after a '**' that matches nothing",
      tree: { "r.js": "", a: { "1.js": "", b: { "3.js": "", c: {} } } },
      pattern: "a/**/../*.js",
      expected: ["a/1.js", "a/b/3.js", "r.js"],
    },
    {
      // The "./" pattern is traversed first, then "src/*.ts" lists "src".
      // Entries are visited in sorted order, so "index.ts" comes after "helpers".
      name: "a pattern array with a './' pattern",
      tree: src,
      pattern: ["src/*.ts", "./src/helpers/*.ts"],
      expected: ["src/helpers/a.ts", "src/helpers/b.ts", "src/index.ts"],
    },
    {
      name: "a brace group with a './' alternative",
      tree: src,
      pattern: "{src/*.ts,./src/helpers/*.ts}",
      expected: ["src/helpers/a.ts", "src/helpers/b.ts", "src/index.ts"],
    },
  ];

  it.each(cases)("$name", async ({ tree, pattern, expected }) => {
    using dir = tempDir("fs-glob-seen", tree);
    expect(await globAll(pattern, { cwd: String(dir) })).toEqual(fromAllThree(expected));
  });

  it("returns the list of Node.js for a pattern array whose patterns share a tail", async () => {
    using dir = tempDir("fs-glob-seen", { src: { lib: { "c.ts": "" } } });
    const cwd = String(dir);
    // Node.js loses "src/lib/c.ts" in one order of these three patterns: its walker skips a queued pattern when one of
    // its tails is already marked for that path, and it marks the other tails without a walk.
    expect({
      firstTwo: await globAll(["./**/*.ts", "./src/**/*.ts"], { cwd }),
      otherOrder: await globAll(["./src/**/*.ts", "./**/*.ts", "src/*.ts"], { cwd }),
      thisOrder: await globAll(["./**/*.ts", "./src/**/*.ts", "src/*.ts"], { cwd }),
    }).toEqual({
      firstTwo: fromAllThree(["src/lib/c.ts"]),
      otherOrder: fromAllThree(["src/lib/c.ts"]),
      thisOrder: fromAllThree([]),
    });
  });
});

describe("a link to a directory that '**' meets", () => {
  type Row = [pattern: string, options: Omit<GlobOptions, "cwd">, expected: string[]];

  describe("a/lnk -> a/b", () => {
    const rows: Row[] = [
      // The link is listed. The part of the pattern after "**" is not matched inside the link.
      ["**/*", {}, ["a", "a/1.js", "a/b", "a/b/3.js", "a/b/c", "a/lnk", "r.js"]],
      ["**/*", { followSymlinks: false }, ["a", "a/1.js", "a/b", "a/b/3.js", "a/b/c", "a/lnk", "r.js"]],
      ["**/*/", {}, ["a", "a/b", "a/b/c"]],
      ["./**/*.js", {}, ["a/1.js", "a/b/3.js", "r.js"]],
      ["./**/c", {}, ["a/b/c"]],
      ["**/*.js", {}, ["a/1.js", "a/b/3.js", "r.js"]],
      ["**/lnk", {}, ["a/lnk"]],
      // A link that the pattern names is followed.
      ["a/lnk/*", {}, ["a/lnk/3.js", "a/lnk/c"]],
      // followSymlinks: true keeps the paths through the link.
      [
        "**/*",
        { followSymlinks: true },
        ["a", "a/1.js", "a/b", "a/b/3.js", "a/b/c", "a/lnk", "a/lnk/3.js", "a/lnk/c", "r.js"],
      ],
      ["**/*/", { followSymlinks: true }, ["a", "a/b", "a/b/c", "a/lnk", "a/lnk/c"]],
    ];

    it.each(rows)("%j %j", async (pattern, options, expected) => {
      using dir = tempDir("fs-glob-link", { "r.js": "", a: { "1.js": "", b: { "3.js": "", c: {} } } });
      linkDirectory(String(dir), "a/b", "a/lnk");
      expect(await globAll(pattern, { cwd: String(dir), ...options })).toEqual(fromAllThree(expected));
    });
  });

  // The tree and the calls of Node's test/parallel/test-fs-glob-no-follow-symlink-globstar.mjs. The other half of that
  // file needs Node's permission model, which Bun does not have, so the file is not in test/js/node/test/parallel.
  describe("a link that points outside of cwd", () => {
    const rows: Row[] = [
      ["**/*", {}, ["link", "visible.txt"]],
      ["**/*", { followSymlinks: false }, ["link", "visible.txt"]],
      ["./**/*.txt", {}, ["visible.txt"]],
      [
        "**/*",
        { followSymlinks: true },
        ["link", "link/nested", "link/nested/secret-two.txt", "link/secret-one.txt", "visible.txt"],
      ],
    ];

    it.each(rows)("%j %j", async (pattern, options, expected) => {
      using dir = tempDir("fs-glob-link-outside", {
        outside: { "secret-one.txt": "", nested: { "secret-two.txt": "" } },
        workspace: { "visible.txt": "" },
      });
      linkDirectory(String(dir), "outside", "workspace/link");
      const cwd = join(String(dir), "workspace");
      expect(await globAll(pattern, { cwd, ...options })).toEqual(fromAllThree(expected));
    });
  });

  // The layout of https://github.com/oven-sh/bun/issues/29699: packages that link to each other in a cycle.
  describe("node_modules links between packages", () => {
    const rows: Row[] = [
      ["./**/src/*.test.ts", {}, ["src/foo.test.ts"]],
      ["**/*/*.test.ts", {}, ["src/foo.test.ts"]],
      ["**/*.test.ts", {}, ["src/foo.test.ts"]],
    ];

    it.each(rows)("%j %j", async (pattern, options, expected) => {
      using dir = tempDir("fs-glob-link-packages", {
        a: { src: { "foo.test.ts": "" }, node_modules: {} },
        b: { src: { "bar.test.ts": "" }, node_modules: {} },
        c: { node_modules: {} },
      });
      linkDirectory(String(dir), "b", "a/node_modules/b");
      linkDirectory(String(dir), "c", "b/node_modules/c");
      linkDirectory(String(dir), "a", "c/node_modules/a");
      const cwd = join(String(dir), "a");
      expect(await globAll(pattern, { cwd, ...options })).toEqual(fromAllThree(expected));
    });
  });

  it("does not list a path through a link for '..' after '**'", async () => {
    // "b/a" is a link to "b". A walker that keeps every sibling but still enters the link lists "b/g.js" for "b/a/..".
    using dir = tempDir("fs-glob-link-parent", { w: { "r.js": "", b: { "g.js": "" }, x: { a: { "f.js": "" } } } });
    linkDirectory(String(dir), "w/b", "w/b/a");
    const cwd = join(String(dir), "w");
    expect(await globAll("./**/../*.js", { cwd })).toEqual(fromAllThree(["r.js"]));
  });

  // A link to a file needs a privilege on Windows.
  it.skipIf(isWindows)("followSymlinks: true does not enter a link that is not a directory", async () => {
    using dir = tempDir("fs-glob-link-file", { d: { "f.txt": "" } });
    const root = String(dir);
    fs.symlinkSync(join(root, "d", "f.txt"), join(root, "tofile"));
    fs.symlinkSync(join(root, "nowhere"), join(root, "dangling"));
    fs.symlinkSync(join(root, "d"), join(root, "todir"));
    expect(await globAll("./**/.", { cwd: root, followSymlinks: true })).toEqual(fromAllThree(["d", "todir"]));
  });
});

// Node.js matches a literal exclude pattern without case on the platforms where it matches a pattern without case.
it("a literal exclude pattern in another case excludes on macOS and Windows only", async () => {
  using dir = tempDir("fs-glob-exclude-case", { a: { "b.txt": "" } });
  const expected = isMacOS || isWindows ? [] : ["a/b.txt"];
  expect(await globAll("a/b.txt", { cwd: String(dir), exclude: ["A/B.TXT"] })).toEqual(fromAllThree(expected));
});

// The depth of a path is its number of segments below cwd: "f.txt" is 1, "d1/f.txt" is 2, cwd is 0.
describe("maxDepth", () => {
  const tree = { "f.txt": "", d1: { "f.txt": "", d2: { "f.txt": "", d3: { "f.txt": "" } } } };
  const everyFile = ["d1/d2/d3/f.txt", "d1/d2/f.txt", "d1/f.txt", "f.txt"];
  type Row = [pattern: string | string[], options: Omit<GlobOptions, "cwd">, expected: string[]];

  const rows: Row[] = [
    ["**/*.txt", { maxDepth: 0 }, []],
    ["**/*.txt", { maxDepth: 1 }, ["f.txt"]],
    ["**/*.txt", { maxDepth: 2 }, ["d1/f.txt", "f.txt"]],
    ["**/*.txt", { maxDepth: 4 }, everyFile],
    ["**", { maxDepth: 0 }, ["."]],
    ["**", { maxDepth: 1 }, [".", "d1", "f.txt"]],
    ["*", { maxDepth: 0 }, []],
    // A pattern without a wildcard has the limit too.
    ["d1/d2/f.txt", { maxDepth: 2 }, []],
    ["d1/d2/f.txt", { maxDepth: 3 }, ["d1/d2/f.txt"]],
    ["d1/*/f.txt", { maxDepth: 2 }, []],
    ["d1/d2/**", { maxDepth: 2 }, ["d1/d2"]],
    // The limit is on the path in the list, not on the directories that the pattern goes through.
    ["d1/d2/../*.txt", { maxDepth: 2 }, ["d1/f.txt"]],
    ["d1/d2/../*.txt", { maxDepth: 1 }, []],
    [["d1/d2/d3/*.txt", "*.txt"], { maxDepth: 1 }, ["f.txt"]],
    ["{d1,d1/d2}/*.txt", { maxDepth: 2 }, ["d1/f.txt"]],
    ["**/*.txt", { maxDepth: 3, exclude: ["d1/d2/**"] }, ["d1/f.txt", "f.txt"]],
    ["**/*.txt", { maxDepth: 2, exclude: ["d1/f.txt"] }, ["f.txt"]],
  ];

  it.each(rows)("%j %j", async (pattern, options, expected) => {
    using dir = tempDir("fs-glob-max-depth", tree);
    expect(await globAll(pattern, { cwd: String(dir), ...options })).toEqual(fromAllThree(expected));
  });

  it.each([Infinity, null, undefined])("%p is no limit", async maxDepth => {
    using dir = tempDir("fs-glob-max-depth", tree);
    expect(await globAll("**/*.txt", { cwd: String(dir), maxDepth })).toEqual(fromAllThree(everyFile));
  });

  it("counts from cwd, and a '..' in the path counts as a segment", async () => {
    using dir = tempDir("fs-glob-max-depth", tree);
    const cwd = join(String(dir), "d1");
    expect({
      below: await globAll("**/*.txt", { cwd, maxDepth: 1 }),
      parent: await globAll("../*.txt", { cwd, maxDepth: 2 }),
      parentOverLimit: await globAll("../*.txt", { cwd, maxDepth: 1 }),
    }).toEqual({
      below: fromAllThree(["f.txt"]),
      parent: fromAllThree(["../f.txt"]),
      parentOverLimit: fromAllThree([]),
    });
  });

  it("limits an absolute pattern by the depth below cwd", async () => {
    using dir = tempDir("fs-glob-max-depth", { root: tree, sibling: { "s.txt": "" } });
    const cwd = join(String(dir), "root");
    const absolute = (paths: string[]) => fromAllThree(paths.map(path => join(cwd, path).replaceAll(sep, "/")).sort());
    expect({
      below: await globAll(join(cwd, "**/*.txt"), { cwd, maxDepth: 2 }),
      literal: await globAll(join(cwd, "d1/d2/f.txt"), { cwd, maxDepth: 2 }),
      // The walk starts above cwd. A path beside cwd is as deep as its path from cwd, "../sibling/s.txt".
      fromAbove: await globAll(join(String(dir), "*", "*.txt"), { cwd, maxDepth: 2 }),
      beside: await globAll(join(String(dir), "sibling", "*.txt"), { cwd, maxDepth: 3 }),
    }).toEqual({
      below: absolute(["d1/f.txt", "f.txt"]),
      literal: fromAllThree([]),
      fromAbove: absolute(["f.txt"]),
      beside: absolute(["../sibling/s.txt"]),
    });
  });

  // Below cwd the walker never reaches a path past the limit, so the limit on a match is seen above and beside cwd.
  // Each pattern goes through another place in the walker that adds a match.
  it("limits every kind of match above and beside cwd", async () => {
    using dir = tempDir("fs-glob-max-depth", { "top.txt": "", root: tree, sibling: { "s.txt": "" } });
    const top = String(dir);
    const cwd = join(top, "root");
    const rows: [pattern: string, maxDepth: number, expected: string[]][] = [
      // A directory that a last ** matches.
      ["sibling/**", 1, []],
      ["sibling/**", 2, ["sibling"]],
      // An entry under a last **.
      ["**", 0, ["root"]],
      // A name after **.
      ["**/*.txt", 1, ["root/f.txt"]],
      // The directory that "**/.." matches, and its parent.
      ["**/..", 0, []],
      ["**/..", 1, ["", "root"]],
      // A last wildcard.
      ["*.txt", 1, []],
      ["*.txt", 2, ["top.txt"]],
    ];
    const actual: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [pattern, maxDepth, list] of rows) {
      // Not join(): it folds the "**/.." of a pattern.
      actual[`${pattern} at ${maxDepth}`] = await globAll(`${top.replaceAll(sep, "/")}/${pattern}`, { cwd, maxDepth });
      expected[`${pattern} at ${maxDepth}`] = fromAllThree(
        list.map(path => join(top, path).replaceAll(sep, "/")).sort(),
      );
    }
    expect(actual).toEqual(expected);
  });

  it("gives a path that leaves cwd and comes back the depth of where it ends", async () => {
    using dir = tempDir("fs-glob-max-depth", { "top.txt": "", root: tree, sibling: { "s.txt": "" } });
    const cwd = join(String(dir), "root");
    expect({
      // "../root/f.txt" is "f.txt": depth 1. The walk goes through "..", which is depth 1, so it needs 2.
      back: await globAll("../root/*.txt", { cwd, maxDepth: 2 }),
      cannotPassTheParent: await globAll("../root/*.txt", { cwd, maxDepth: 1 }),
      everywhere: await globAll("../**/*.txt", { cwd, maxDepth: 2 }),
    }).toEqual({
      back: fromAllThree(["../root/f.txt"]),
      cannotPassTheParent: fromAllThree([]),
      everywhere: fromAllThree(["../root/d1/f.txt", "../root/f.txt", "../top.txt"]),
    });
  });

  // Below cwd the depth comes from the path alone. It must be the depth that path.resolve() and path.relative() give,
  // which is the rule of Node.js v26.12.1, and -1 where only that rule can tell.
  describe("the depth of a path below cwd", () => {
    const rows: [path: string, depth: number][] = [
      [".", 0],
      ["f.txt", 1],
      ["d1/f.txt", 2],
      ["d1/d2/d3", 3],
      // "." and an empty segment add no depth.
      ["./d1", 1],
      ["d1/./d2", 2],
      ["d1//d2", 2],
      ["d1/", 1],
      // A name that only starts with dots is a name.
      ["..d1", 1],
      ["d1/..d2", 2],
      ["...", 1],
      ["d1/.d2/...", 3],
      // A ".." segment or an absolute path can leave cwd.
      ["..", -1],
      ["../", -1],
      ["../d1", -1],
      ["d1/..", -1],
      ["d1/../d2", -1],
      ["/", -1],
      ["/d1", -1],
      ...((isWindows
        ? [
            ["d1\\d2", 2],
            ["d1\\..\\d2", -1],
            ["\\d1", -1],
            ["C:\\d1", -1],
            // A name with ":" can be relative to a drive.
            ["C:d1", -1],
            ["d1\\a:b", -1],
          ]
        : [
            // "\\" and ":" are characters of a name.
            ["d1\\d2", 1],
            ["d1\\..\\d2", 1],
            ["C:d1", 1],
            ["a:b/c", 2],
          ]) as [string, number][]),
    ];

    it.each(rows)("%j is %d", (path, depth) => {
      expect(fsGlobPlainDepth(path)).toBe(depth);
      if (depth >= 0) {
        const fromCwd = relative(tmp, resolve(tmp, path));
        expect(fromCwd === "" ? 0 : fromCwd.split(sep).length).toBe(depth);
      }
    });
  });

  it("gives Dirents within the limit for withFileTypes", async () => {
    using dir = tempDir("fs-glob-max-depth", tree);
    const cwd = String(dir);
    const options = { cwd, maxDepth: 2, withFileTypes: true } as const;
    const paths = (dirents: fs.Dirent[]) =>
      dirents.map(dirent => relative(cwd, join(dirent.parentPath, dirent.name)).replaceAll(sep, "/")).sort();
    expect({
      globSync: paths(fs.globSync("**/*.txt", options)),
      "promises.glob": paths(await Array.fromAsync(fs.promises.glob("**/*.txt", options))),
    }).toEqual({ globSync: ["d1/f.txt", "f.txt"], "promises.glob": ["d1/f.txt", "f.txt"] });
  });

  // The tree of the tests below. <top> in a pattern is the directory above cwd, and <TOP> is that directory in
  // another case.
  const above = { Top: { "top.txt": "", root: tree, sibling: { "s.txt": "" } } };
  const spell = (pattern: string, dir: string) => {
    const slashes = dir.replaceAll(sep, "/");
    return pattern.replace("<top>", `${slashes}/Top`).replace("<TOP>", `${slashes}/TOP`);
  };
  // A volume that folds case reaches a directory by another spelling of its name. Windows and macOS do by default.
  const volumeFoldsCase = (() => {
    using dir = tempDir("fs-glob-max-depth", { probe: "" });
    return fs.existsSync(join(String(dir), "PROBE"));
  })();

  describe("the Dirents of an absolute or '..' pattern", () => {
    type Row = [pattern: string, maxDepth: number, expected: string[]];
    // Each pattern goes through another place in the walker that adds a match.
    const rows: Row[] = [
      // A path without a wildcard: beside cwd, below it, and below it past the limit.
      ["<top>/top.txt", 2, ["file ../top.txt"]],
      ["<top>/root/f.txt", 1, ["file f.txt"]],
      ["<top>/root/d1/d2/f.txt", 2, []],
      // The directory that a last ** matches, then an entry under it.
      ["<top>/sibling/**", 3, ["directory ../sibling", "file ../sibling/s.txt"]],
      ["<top>/root/d1/**", 2, ["directory d1", "file d1/f.txt", "directory d1/d2"]],
      // A name after **.
      ["<top>/**/*.txt", 1, ["file f.txt"]],
      // The directory that "**/.." matches, and its parent.
      ["<top>/**/..", 1, ["directory ..", "directory ."]],
      ["**/..", 2, ["directory .", "directory ..", "directory d1"]],
      ["../root/**/..", 2, ["directory .", "directory ..", "directory d1"]],
      // A last wildcard.
      ["<top>/*", 2, ["directory .", "directory ../sibling", "file ../top.txt"]],
    ];
    // These patterns name cwd, or the directory above it, in another case. Only the file system can say that it is the
    // same directory, so the async walker has to wait for it before it gives the match. Windows and macOS ask. On
    // Linux the path alone says the depth.
    const otherCaseRows: Row[] = [
      // A path without a wildcard, within the limit and past it.
      ["<top>/ROOT/f.txt", 1, ["file f.txt"]],
      ["<top>/ROOT/f.txt", 0, []],
      // The directory that a last ** matches, then an entry under it.
      ["<top>/ROOT/**", 1, ["directory .", "file f.txt", "directory d1"]],
      // A name after **.
      ["<TOP>/**/root", 4, ["directory ."]],
      // A last wildcard. Only "root" needs the file system: the two other entries are not below cwd.
      ["<TOP>/*", 4, ["directory .", "directory ../sibling", "file ../top.txt"]],
    ];

    // globSync gives the expected Dirents, and the two async entry points give the Dirents of globSync in its order.
    async function expectDirents(row: string, maxDepth: number, expected: string[]) {
      using dir = tempDir("fs-glob-max-depth", above);
      const cwd = join(String(dir), "Top", "root");
      const pattern = spell(row, String(dir));
      const options = { cwd, maxDepth, withFileTypes: true } as const;
      const list = (dirents: (fs.Dirent | null)[]) =>
        dirents.map(
          dirent =>
            dirent && {
              name: dirent.name,
              parentPath: dirent.parentPath,
              type: dirent.isDirectory() ? "directory" : dirent.isFile() ? "file" : "other",
            },
        );
      const globSync = list(fs.globSync(pattern, options));
      const { promise, resolve, reject } = Promise.withResolvers<fs.Dirent[]>();
      fs.glob(pattern, options, (err, dirents) => (err ? reject(err) : resolve(dirents)));
      expect({
        // Without case, because a pattern can name a directory in another case.
        globSync: globSync.map(
          dirent =>
            dirent &&
            `${dirent.type} ${relative(cwd.toLowerCase(), join(dirent.parentPath, dirent.name).toLowerCase()).replaceAll(sep, "/") || "."}`,
        ),
        glob: list(await promise),
        "promises.glob": list(await Array.fromAsync(fs.promises.glob(pattern, options))),
      }).toEqual({ globSync: expected, glob: globSync, "promises.glob": globSync });
    }

    it.each(rows)("%s at %d", expectDirents);
    it.skipIf(!volumeFoldsCase).each(otherCaseRows)("%s at %d", expectDirents);
  });

  // Node.js gives a match when its walker finds it, and its walker does not go on before the consumer asks for the
  // next one. So a directory that is a match comes before the walker reads that directory. The numbers are, for each
  // match, how many directories the async walker had read when it gave the match.
  describe("the time of a match of the async walker", () => {
    type Row = [patterns: string[], maxDepth: number, expected: Record<string, number>];
    const rows: Row[] = [[["<top>/root/**"], 2, { ".": 0, "f.txt": 1, "d1": 1, "d1/f.txt": 2, "d1/d2": 2 }]];
    // With cwd in another case, the walker also waits at the match for the answer of the file system.
    const otherCaseRows: Row[] = [
      [["<top>/ROOT/**"], 2, { ".": 0, "f.txt": 1, "d1": 1, "d1/f.txt": 2, "d1/d2": 2 }],
      [["<top>/ROOT/d1/**"], 3, { "d1": 0, "d1/f.txt": 1, "d1/d2": 1, "d1/d2/f.txt": 2, "d1/d2/d3": 2 }],
      // The second pattern makes the walker read two more directories after the matches of the first one.
      [
        ["<TOP>/*", "<TOP>/*/*.txt"],
        5,
        { ".": 1, "../sibling": 1, "../top.txt": 1, "../sibling/s.txt": 2, "f.txt": 3 },
      ],
      // The walker finds the match of the second pattern first. It is past the limit.
      [["<top>/sibling/s.txt", "<top>/ROOT/d1/d2/d3/f.txt"], 3, { "../sibling/s.txt": 0 }],
    ];

    async function expectReadBeforeEachMatch(patterns: string[], maxDepth: number, expected: Record<string, number>) {
      using dir = tempDir("fs-glob-max-depth", above);
      const cwd = join(String(dir), "Top", "root");
      using readdir = spyOn(fs.promises, "readdir");
      const readBefore: Record<string, number> = {};
      const spelled = patterns.map(pattern => spell(pattern, String(dir)));
      for await (const path of fs.promises.glob(spelled, { cwd, maxDepth })) {
        const fromCwd = relative(cwd.toLowerCase(), resolve(cwd, path).toLowerCase()).replaceAll(sep, "/") || ".";
        readBefore[fromCwd] = readdir.mock.calls.length;
      }
      expect(readBefore).toEqual(expected);
    }

    it.each(rows)("%j at %d", expectReadBeforeEachMatch);
    it.skipIf(!volumeFoldsCase).each(otherCaseRows)("%j at %d", expectReadBeforeEachMatch);
  });

  it("does not read a directory at the limit", async () => {
    using dir = tempDir("fs-glob-max-depth", { root: tree, sibling: { deep: { "t.txt": "" } } });
    const cwd = join(String(dir), "root");
    using readdirSync = spyOn(fs, "readdirSync");
    using readdir = spyOn(fs.promises, "readdir");
    const read = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.map(([path]) => relative(String(dir), resolve(String(path))).replaceAll(sep, "/")).sort();

    fs.globSync("**/*.txt", { cwd, maxDepth: 2 });
    await Array.fromAsync(fs.promises.glob("**/*.txt", { cwd, maxDepth: 2 }));
    expect({ globSync: read(readdirSync), "promises.glob": read(readdir) }).toEqual({
      globSync: ["root", "root/d1"],
      "promises.glob": ["root", "root/d1"],
    });

    // An absolute pattern that starts above cwd reads the directories down to cwd and nothing beside them.
    readdirSync.mockClear();
    readdir.mockClear();
    fs.globSync(join(String(dir), "**", "*.txt"), { cwd, maxDepth: 1 });
    await Array.fromAsync(fs.promises.glob(join(String(dir), "**", "*.txt"), { cwd, maxDepth: 1 }));
    expect({ globSync: read(readdirSync), "promises.glob": read(readdir) }).toEqual({
      globSync: ["", "root"],
      "promises.glob": ["", "root"],
    });

    // A ".." pattern is not an absolute pattern: it does not read the directory above cwd at the limit.
    readdirSync.mockClear();
    readdir.mockClear();
    fs.globSync("../**/*.txt", { cwd, maxDepth: 1 });
    await Array.fromAsync(fs.promises.glob("../**/*.txt", { cwd, maxDepth: 1 }));
    expect({ globSync: read(readdirSync), "promises.glob": read(readdir) }).toEqual({
      globSync: [],
      "promises.glob": [],
    });
  });

  const outOfRange = 'The value of "options.maxDepth" is out of range.';
  it.each([
    [-1, RangeError, "ERR_OUT_OF_RANGE", `${outOfRange} It must be >= 0 && <= 9007199254740991. Received -1`],
    [1.5, RangeError, "ERR_OUT_OF_RANGE", `${outOfRange} It must be an integer. Received 1.5`],
    [NaN, RangeError, "ERR_OUT_OF_RANGE", `${outOfRange} It must be an integer. Received NaN`],
    [
      "1",
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      `The "options.maxDepth" property must be of type number. Received type string ('1')`,
    ],
  ] as const)("rejects %p", async (maxDepth, constructor, code, message) => {
    const options = { cwd: tmp, maxDepth } as GlobOptions;
    const thrown = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return err as NodeJS.ErrnoException;
      }
    };
    const errors = {
      globSync: thrown(() => fs.globSync("**", options)),
      glob: thrown(() => fs.glob("**", options, () => {})),
      "promises.glob": await Array.fromAsync(fs.promises.glob("**", options)).then(
        () => undefined,
        (err: NodeJS.ErrnoException) => err,
      ),
    };
    for (const error of Object.values(errors)) expect(error).toBeInstanceOf(constructor);
    const report = (err: NodeJS.ErrnoException | undefined) => ({ code: err?.code, message: err?.message });
    expect({
      globSync: report(errors.globSync),
      glob: report(errors.glob),
      "promises.glob": report(errors["promises.glob"]),
    }).toEqual({
      globSync: { code, message },
      glob: { code, message },
      "promises.glob": { code, message },
    });
  });
});
