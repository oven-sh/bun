/**
 * @note `fs.glob` et. al. are powered by {@link Bun.Glob}, which is extensively
 * tested elsewhere. These tests check API compatibility with Node.js.
 */
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import {
  bunEnv,
  bunExe,
  isASAN,
  isDebug,
  isMacOS,
  isWindows,
  substDrive,
  tempDir,
  tempDirWithFiles,
  type DirectoryTree,
} from "harness";
import fs from "node:fs";
import { join, parse, relative, resolve, sep } from "node:path";

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

  // The shortest absolute pattern: two parts, and the first one is empty or a drive. The walk reads the root directory.
  it("reads the directory above cwd for an absolute pattern of two parts", async () => {
    const root = parse(tmp).root;
    const cwd = join(root, tmp.slice(root.length).split(sep)[0]);
    expect(await globAll(`${root.replaceAll(sep, "/")}*`, { cwd, maxDepth: 0 })).toEqual(
      fromAllThree([cwd.replaceAll(sep, "/")]),
    );
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

  // The depth of a path through a link is the depth of the path, not the depth of the target of the link.
  describe("with followSymlinks", () => {
    it.each([
      [1, ["a", "r.js"]],
      [2, ["a", "a/1.js", "a/b", "a/lnk", "r.js"]],
      [3, ["a", "a/1.js", "a/b", "a/b/3.js", "a/b/c", "a/lnk", "a/lnk/3.js", "a/lnk/c", "r.js"]],
    ])("a/lnk -> a/b at %d", async (maxDepth, expected) => {
      using dir = tempDir("fs-glob-max-depth", { "r.js": "", a: { "1.js": "", b: { "3.js": "", c: {} } } });
      linkDirectory(String(dir), "a/b", "a/lnk");
      const options = { cwd: String(dir), followSymlinks: true, maxDepth };
      expect(await globAll("**/*", options)).toEqual(fromAllThree(expected));
    });

    it.each([
      [1, ["link", "visible.txt"]],
      [2, ["link", "link/nested", "link/secret-one.txt", "visible.txt"]],
    ])("a link that points outside of cwd at %d", async (maxDepth, expected) => {
      using dir = tempDir("fs-glob-max-depth", {
        outside: { "secret-one.txt": "", nested: { "secret-two.txt": "" } },
        workspace: { "visible.txt": "" },
      });
      linkDirectory(String(dir), "outside", "workspace/link");
      const options = { cwd: join(String(dir), "workspace"), followSymlinks: true, maxDepth };
      expect(await globAll("**/*", options)).toEqual(fromAllThree(expected));
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

  // The tree of the tests below. In a pattern, <dir> is the directory of the tree, <top> is the directory above cwd,
  // and <TOP> is that directory in another case.
  const above = { Top: { "top.txt": "", root: tree, sibling: { "s.txt": "" } } };
  const spell = (pattern: string, dir: string) => {
    const slashes = dir.replaceAll(sep, "/");
    return pattern.replace("<dir>", slashes).replace("<top>", `${slashes}/Top`).replace("<TOP>", `${slashes}/TOP`);
  };
  // A volume that folds case reaches a directory by another spelling of its name. Node.js asks the file system about
  // such a spelling of `cwd` on Windows and macOS only, where a volume folds case by default.
  const volumeFoldsCase = (() => {
    using dir = tempDir("fs-glob-max-depth", { probe: "" });
    return (isWindows || isMacOS) && fs.existsSync(join(String(dir), "PROBE"));
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
      // A name after a "[.]" part, which the walker reads as the directory that it is in.
      ["<dir>/**/Top/[.]/*.txt", 1, []],
      ["<dir>/**/Top/[.]/*.txt", 2, ["file ../top.txt"]],
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

    // "d1/.." has one empty part after minimatch. That is not an absolute pattern either.
    fs.globSync("d1/..", { cwd, maxDepth: 1 });
    await Array.fromAsync(fs.promises.glob("d1/..", { cwd, maxDepth: 1 }));
    expect({ globSync: read(readdirSync), "promises.glob": read(readdir) }).toEqual({
      globSync: [],
      "promises.glob": [],
    });

    // With followSymlinks, a link at the limit is a match and the walker does not read its target.
    linkDirectory(String(dir), "sibling", "root/link");
    fs.globSync("**/*", { cwd, maxDepth: 1, followSymlinks: true });
    await Array.fromAsync(fs.promises.glob("**/*", { cwd, maxDepth: 1, followSymlinks: true }));
    expect({ globSync: read(readdirSync), "promises.glob": read(readdir) }).toEqual({
      globSync: ["root"],
      "promises.glob": ["root"],
    });
  });

  // Node.js gives a match before its walker goes on. So a function for `exclude` sees what the consumer has received,
  // and the walker makes no call after the consumer stops. ROOT is cwd in another case (see the rows above).
  describe("the async walker and the consumer", () => {
    const patterns = ["**/*.txt", "../**/*.txt", "<top>/root/**/*.txt"];
    const otherCasePatterns = ["<top>/ROOT/**/*.txt"];

    async function expectOneMatchAtATime(row: string) {
      using dir = tempDir("fs-glob-max-depth", above);
      const cwd = join(String(dir), "Top", "root");
      const pattern = spell(row, String(dir));

      const received: string[] = [];
      for await (const path of fs.promises.glob(pattern, { cwd, maxDepth: 3, exclude: () => received.length >= 1 })) {
        received.push(path);
      }

      let calls = 0;
      let callsAtFirstMatch = -1;
      const countCalls = () => {
        calls++;
        return false;
      };
      for await (const _ of fs.promises.glob(pattern, { cwd, maxDepth: 3, exclude: countCalls })) {
        callsAtFirstMatch = calls;
        break;
      }

      expect({ received: received.length, callsAfterTheConsumerStopped: calls - callsAtFirstMatch }).toEqual({
        received: 1,
        callsAfterTheConsumerStopped: 0,
      });
    }

    it.each(patterns)("%s", expectOneMatchAtATime);
    it.skipIf(!volumeFoldsCase).each(otherCasePatterns)("%s", expectOneMatchAtATime);

    it("gets the error that a function for exclude throws", async () => {
      using dir = tempDir("fs-glob-max-depth", above);
      const cwd = join(String(dir), "Top", "root");
      const error = new Error("from exclude");
      const options = {
        cwd,
        maxDepth: 3,
        exclude: () => {
          throw error;
        },
      };
      const { promise, resolve } = Promise.withResolvers<unknown>();
      fs.glob("**/*.txt", options, err => resolve(err));
      expect({
        globSync: (() => {
          try {
            fs.globSync("**/*.txt", options);
          } catch (err) {
            return err;
          }
        })(),
        glob: await promise,
        "promises.glob": await Array.fromAsync(fs.promises.glob("**/*.txt", options)).catch(err => err),
      }).toEqual({ globSync: error, glob: error, "promises.glob": error });
    });
  });

  // The walker keeps the result of an identity call that fails, so a call that throws cannot show which one it made.
  async function expectNoSyncIdentityCall(row: string) {
    using dir = tempDir("fs-glob-max-depth", above);
    const cwd = join(String(dir), "Top", "root");
    const pattern = spell(row, String(dir));
    const fromCwd = (paths: string[]) =>
      paths.map(path => relative(cwd.toLowerCase(), path.toLowerCase()).replaceAll(sep, "/")).sort();
    using lstatSync = spyOn(fs, "lstatSync");
    using realpathSyncNative = spyOn(fs.realpathSync, "native");
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();
    fs.glob(pattern, { cwd, maxDepth: 1 }, (err, paths) => (err ? reject(err) : resolve(paths)));
    expect({
      glob: fromCwd(await promise),
      "promises.glob": fromCwd(await Array.fromAsync(fs.promises.glob(pattern, { cwd, maxDepth: 1 }))),
      lstatSync: lstatSync.mock.calls.length,
      "realpathSync.native": realpathSyncNative.mock.calls.length,
    }).toEqual({ glob: ["d1", "f.txt"], "promises.glob": ["d1", "f.txt"], lstatSync: 0, "realpathSync.native": 0 });
  }

  // Off Windows and macOS the async walk calls the sync methods of the limiter, which ask the file system nothing there.
  it("makes no sync call to the file system in the async walk", () => expectNoSyncIdentityCall("<top>/root/*"));
  it.skipIf(!volumeFoldsCase)("asks about another case of cwd with fs.promises in the async walk", () =>
    expectNoSyncIdentityCall("<top>/ROOT/*"),
  );

  // The rows above name cwd in another case in the pattern. Here the `cwd` option is in another case than the directory,
  // and the pattern is in the case of the directory.
  describe.skipIf(!volumeFoldsCase)("cwd in another case than the directory", () => {
    it.each([
      ["<top>/root/f.txt", 1, ["f.txt"]],
      ["<top>/root/d1/f.txt", 1, []],
      // The walk reads the directory above cwd: the file system says that it is above cwd.
      ["<top>/*/f.txt", 1, ["f.txt"]],
      ["<top>/root/**", 1, [".", "d1", "f.txt"]],
    ] as const)("%s at %d", async (row, maxDepth, expected) => {
      using dir = tempDir("fs-glob-max-depth", above);
      const cwd = join(String(dir), "TOP", "ROOT");
      const fromCwd = (paths: string[]) =>
        paths
          .map(path => relative(cwd.toLowerCase(), resolve(cwd, path).toLowerCase()).replaceAll(sep, "/") || ".")
          .sort();
      const found = await globAll(spell(row, String(dir)), { cwd, maxDepth });
      expect({
        globSync: fromCwd(found.globSync),
        glob: fromCwd(found.glob),
        "promises.glob": fromCwd(found["promises.glob"]),
      }).toEqual(fromAllThree([...expected]));
    });
  });

  // Node.js asks the file system about "ROOT" before it tests the `exclude` array, and its walker waits for the answer.
  // So each call about cwd comes before the walker looks at the next file.
  it.skipIf(!volumeFoldsCase)("waits for the file system at a match that the exclude array refuses", async () => {
    using dir = tempDir("fs-glob-max-depth", above);
    const cwd = join(String(dir), "Top", "root");
    const fromCwd = (path: unknown) =>
      relative(cwd.toLowerCase(), resolve(String(path)).toLowerCase()).replaceAll(sep, "/") || ".";
    const asked: string[] = [];
    const { lstat, realpath } = fs.promises;
    using _lstat = spyOn(fs.promises, "lstat").mockImplementation(((path: fs.PathLike, ...rest: []) => {
      asked.push(fromCwd(path));
      return lstat(path, ...rest);
    }) as typeof lstat);
    using _realpath = spyOn(fs.promises, "realpath").mockImplementation(((path: fs.PathLike, ...rest: []) => {
      asked.push(fromCwd(path));
      return realpath(path, ...rest);
    }) as typeof realpath);
    // The walker goes to the second pattern first. An absolute pattern asks about cwd on the way down, so these are not.
    const patterns = ["../sibling/s.txt", "../ROOT/f.txt"];
    const matches = await Array.fromAsync(fs.promises.glob(patterns, { cwd, maxDepth: 3, exclude: ["f.txt"] }));
    expect({
      matches: matches.map(match => fromCwd(resolve(cwd, match))),
      askedAboutCwdBeforeTheNextFile: asked.lastIndexOf(".") < asked.indexOf("../sibling/s.txt"),
    }).toEqual({ matches: ["../sibling/s.txt"], askedAboutCwdBeforeTheNextFile: true });
  });

  // On Windows, path.win32.relative() compares without case for ASCII only, so the limiter takes the two spellings for
  // two directories (oven-sh/bun#37305). Node.js gives the two entries.
  (!volumeFoldsCase ? it.skip : isWindows ? it.todo : it)(
    "knows cwd when a letter outside of ASCII is in another case",
    async () => {
      using dir = tempDir("fs-glob-max-depth", { "Ünï": { "f.txt": "", d1: { "f.txt": "" } } });
      const cwd = join(String(dir), "Ünï");
      const other = `${String(dir).replaceAll(sep, "/")}/ünï`;
      expect(await globAll(`${other}/*`, { cwd, maxDepth: 1 })).toEqual(
        fromAllThree([`${other}/d1`, `${other}/f.txt`]),
      );
    },
  );

  // A path on another Windows drive has no depth below cwd. It is not a match, and the walker does not read the drive.
  it.skipIf(!isWindows)("gives nothing for a pattern on another drive", async () => {
    using dir = tempDir("fs-glob-max-depth", { root: tree, other: { "o.txt": "", sub: { "p.txt": "" } } });
    const cwd = join(String(dir), "root");
    using drive = substDrive(join(String(dir), "other"));
    const root = drive.root.replaceAll(sep, "/");
    const noLimit = await globAll(`${root}**/*.txt`, { cwd });
    using readdirSync = spyOn(fs, "readdirSync");
    using readdir = spyOn(fs.promises, "readdir");
    expect({
      noLimit,
      limited: await globAll(`${root}**/*.txt`, { cwd, maxDepth: 100 }),
      readdirSync: readdirSync.mock.calls.length,
      readdir: readdir.mock.calls.length,
    }).toEqual({
      noLimit: fromAllThree([`${root}o.txt`, `${root}sub/p.txt`]),
      limited: fromAllThree([]),
      readdirSync: 0,
      readdir: 0,
    });
  });

  // JSC inlines no call into a function whose bytecode cost is over its maximumInliningCallerBytecodeCost. The body of
  // the async walker is near that limit: an `await` for `maxDepth` at each match puts it over, and then every async
  // walk is slower, with or without `maxDepth`. With nothing inlined, the DFG code of the body is smaller.
  it.skipIf(isDebug || isASAN)("JSC inlines calls into the body of the async walker", async () => {
    using dir = tempDir("fs-glob-max-depth", { root: tree, sibling: { deep: { "t.txt": "" } } });
    const source = `
      const fs = require("node:fs");
      (async () => {
        for (let i = 0; i < 100; i++) await Array.fromAsync(fs.promises.glob("**/*.txt", { cwd: ${JSON.stringify(String(dir))} }));
      })();
    `;
    async function dfgCodeOfTheBody(limit?: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", source],
        env: {
          ...bunEnv,
          BUN_JSC_useConcurrentJIT: "0",
          BUN_JSC_reportDFGCompileTimes: "1",
          ...(limit && { BUN_JSC_maximumInliningCallerBytecodeCost: limit }),
        },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      // The generator has a small wrapper of the same name. The body is the large one.
      const bytes = [...stderr.matchAll(/^Optimized #iterateSubpatterns#.* using DFG .* into (\d+) bytes/gm)].map(
        match => Number(match[1]),
      );
      // With no such line, the report itself says why.
      return { bytes: bytes.length ? Math.max(...bytes) : stderr, exitCode };
    }
    const [atTheDefaultLimit, withNothingInlined] = await Promise.all([dfgCodeOfTheBody(), dfgCodeOfTheBody("1")]);
    expect({
      atTheDefaultLimit,
      withNothingInlined,
      inlined: Number(atTheDefaultLimit.bytes) > Number(withNothingInlined.bytes),
    }).toEqual({
      atTheDefaultLimit: { bytes: expect.any(Number), exitCode: 0 },
      withNothingInlined: { bytes: expect.any(Number), exitCode: 0 },
      inlined: true,
    });
  });

  const outOfRange = 'The value of "options.maxDepth" is out of range.';
  const negative = `${outOfRange} It must be >= 0 && <= 9007199254740991. Received -1`;
  it.each([
    ["**", { maxDepth: -1 }, RangeError, "ERR_OUT_OF_RANGE", negative],
    ["**", { maxDepth: 1.5 }, RangeError, "ERR_OUT_OF_RANGE", `${outOfRange} It must be an integer. Received 1.5`],
    ["**", { maxDepth: NaN }, RangeError, "ERR_OUT_OF_RANGE", `${outOfRange} It must be an integer. Received NaN`],
    [
      "**",
      { maxDepth: 2 ** 53 },
      RangeError,
      "ERR_OUT_OF_RANGE",
      `${outOfRange} It must be >= 0 && <= 9007199254740991. Received 9_007_199_254_740_992`,
    ],
    [
      "**",
      { maxDepth: "1" },
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      `The "options.maxDepth" property must be of type number. Received type string ('1')`,
    ],
    // Node.js checks followSymlinks first, then maxDepth, then exclude, the patterns and cwd.
    [
      "**",
      { followSymlinks: 1, maxDepth: -1 },
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      `The "options.followSymlinks" property must be of type boolean. Received type number (1)`,
    ],
    ["**", { maxDepth: -1, exclude: 5 }, RangeError, "ERR_OUT_OF_RANGE", negative],
    [123, { maxDepth: -1 }, RangeError, "ERR_OUT_OF_RANGE", negative],
    ["**", { maxDepth: -1, cwd: 5 }, RangeError, "ERR_OUT_OF_RANGE", negative],
  ] as const)("rejects %p with %p", async (pattern, invalid, constructor, code, message) => {
    const options = { cwd: tmp, ...invalid } as unknown as GlobOptions;
    const thrown = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return err as NodeJS.ErrnoException;
      }
    };
    const errors = {
      globSync: thrown(() => fs.globSync(pattern as string, options)),
      glob: thrown(() => fs.glob(pattern as string, options, () => {})),
      "promises.glob": await Array.fromAsync(fs.promises.glob(pattern as string, options)).then(
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
