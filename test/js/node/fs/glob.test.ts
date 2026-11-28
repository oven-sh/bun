/**
 * @note `fs.glob` et. al. are powered by {@link Bun.Glob}, which is extensively
 * tested elsewhere. These tests check API compatibility with Node.js.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { isMacOS, isWindows, tempDir, tempDirWithFiles, type DirectoryTree } from "harness";
import fs from "node:fs";
import { join, sep } from "node:path";

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

type GlobOptions = { cwd: string; followSymlinks?: boolean; exclude?: string[] };

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
