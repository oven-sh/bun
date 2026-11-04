/**
 * @note `fs.glob` et. al. are powered by {@link Bun.Glob}, which is extensively
 * tested elsewhere. These tests check API compatibility with Node.js.
 */
// A namespace import: a build without `depthFromRoot` has `undefined` for it, so its tests fail and the file still loads.
import * as internalForTesting from "bun:internal-for-testing";
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
import { basename, dirname, isAbsolute, join, parse, posix, relative, resolve, sep, win32 } from "node:path";

const { exposedInternals, depthFromRoot } = internalForTesting;

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

type PathCalls = { calls: number; below: number };
type WalkInAChild = {
  matches: ReturnType<typeof fromAllThree>;
  relative: Record<keyof ReturnType<typeof fromAllThree>, PathCalls>;
};

/**
 * Runs each walk through the three entry points in one child process. For each it counts the calls of path.relative():
 * all of them, and those with an argument below the `cwd` of the walk. The count is in place before the first walk, so
 * it sees every call of a module that loads later, as the DepthLimiter of `maxDepth` does. Node.js's test-fs-glob.mjs
 * replaces fs functions in a child process in the same way.
 */
async function walkInAChild(rows: (readonly [pattern: string | string[], options: GlobOptions])[]) {
  const source = `
    const path = require("node:path");
    const fs = require("node:fs");
    const { relative } = path;
    let counts;
    let below;
    path.relative = function (from, to) {
      counts.calls++;
      if (String(from).toLowerCase().startsWith(below) || String(to).toLowerCase().startsWith(below)) counts.below++;
      return relative.apply(this, arguments);
    };
    const walks = {
      globSync: async (pattern, options) => fs.globSync(pattern, options),
      glob: (pattern, options) =>
        new Promise((resolve, reject) => fs.glob(pattern, options, (err, paths) => (err ? reject(err) : resolve(paths)))),
      "promises.glob": (pattern, options) => Array.fromAsync(fs.promises.glob(pattern, options)),
    };
    (async () => {
      const report = [];
      for (const [pattern, options] of ${JSON.stringify(rows)}) {
        below = (path.resolve(options.cwd) + path.sep).toLowerCase();
        const row = { matches: {}, relative: {} };
        for (const [name, walk] of Object.entries(walks)) {
          counts = row.relative[name] = { calls: 0, below: 0 };
          row.matches[name] = (await walk(pattern, options)).map(match => match.replaceAll(path.sep, "/")).sort();
        }
        report.push(row);
      }
      console.log(JSON.stringify(report));
    })();
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", source], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // With no report, stderr says why.
  return exitCode === 0 && stdout ? (JSON.parse(stdout) as WalkInAChild[]) : { stderr, exitCode };
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
  // A volume that folds case reaches a directory by another spelling of its name. Node.js asks the file system about
  // such a spelling of `cwd` on Windows and macOS only, where a volume folds case by default.
  const volumeFoldsCase = (() => {
    using dir = tempDir("fs-glob-max-depth", { probe: "" });
    return (isWindows || isMacOS) && fs.existsSync(join(String(dir), "PROBE"));
  })();
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

  // What the limiter asked path.relative() about during a walk.
  type Asked = "no path" | "no path below cwd" | "a path below cwd";
  type CountRow = [pattern: string | string[], maxDepth: number, expected: string[], asked?: Asked, cwd?: string];
  const allThree = <T>(value: T) => ({ globSync: value, glob: value, "promises.glob": value });
  const askedOf = ({ calls, below }: PathCalls): Asked =>
    below > 0 ? "a path below cwd" : calls > 0 ? "no path below cwd" : "no path";

  /** The matches of each row and what its walk asked path.relative() about, or the stderr of the child. */
  async function walkRows(cwd: string, rows: CountRow[]) {
    const report = await walkInAChild(
      rows.map(([pattern, maxDepth, , , rowCwd]) => [pattern, { cwd: rowCwd ?? cwd, maxDepth }] as const),
    );
    return Array.isArray(report)
      ? report.map(({ matches, relative }) => ({
          matches,
          asked: {
            globSync: askedOf(relative.globSync),
            glob: askedOf(relative.glob),
            "promises.glob": askedOf(relative["promises.glob"]),
          },
        }))
      : report;
  }
  const expectedOf = (rows: CountRow[]) =>
    rows.map(([, , expected, asked = "no path"]) => ({ matches: allThree(expected), asked: allThree(asked) }));

  // Only the DepthLimiter calls path.relative(), and it does so where the characters of a path do not settle its depth.
  // POSIX settles every path of ASCII characters. Windows settles a path of names and a path below cwd as cwd is
  // spelled. The two last rows take the route of Node.js's text on every platform: they show that the count sees the
  // limiter.
  it("asks path.relative() only about a path that its characters do not place", async () => {
    using dir = tempDir("fs-glob-max-depth", {
      "top.txt": "",
      root: tree,
      sibling: { "s.txt": "", "日本": { "f.txt": "" } },
    });
    const top = String(dir).replaceAll(sep, "/");
    const root = `${top}/root`;
    const outsideCwd: Asked = isWindows ? "no path below cwd" : "no path";
    const throughParent: Asked = isWindows ? "a path below cwd" : "no path";
    const rows: CountRow[] = [
      ["**/*.txt", 2, ["d1/f.txt", "f.txt"]],
      ["**", 2, [".", "d1", "d1/d2", "d1/f.txt", "f.txt"]],
      ["d1/d2/f.txt", 2, []],
      [["d1/**", "*"], 2, ["d1", "d1/d2", "d1/f.txt", "f.txt"]],
      // An absolute pattern walks from the root of the volume: Windows asks about the directories above cwd.
      [`${root}/**/*.txt`, 2, [`${root}/d1/f.txt`, `${root}/f.txt`], outsideCwd],
      [`${root}/d1/*`, 2, [`${root}/d1/d2`, `${root}/d1/f.txt`], outsideCwd],
      ["../root/**/*.txt", 2, ["../root/d1/f.txt", "../root/f.txt"], throughParent],
      ["../root/*.txt", 2, ["../root/f.txt"], throughParent],
      // The entries of the directory above cwd, a directory beside cwd, and a directory above cwd by its full path.
      ["../*", 2, ["../root", "../sibling", "../top.txt"], outsideCwd],
      ["../sibling/*.txt", 3, ["../sibling/s.txt"], outsideCwd],
      ["../sibling/*.txt", 2, [], outsideCwd],
      [`${top}/*.txt`, 2, [`${top}/top.txt`], outsideCwd],
      // A path with ".." whose name needs a 16-bit string, beside cwd and below it.
      ["../sibling/日本/*.txt", 4, ["../sibling/日本/f.txt"], "no path below cwd"],
      ["../sibling/日本/*.txt", 2, ["../sibling/日本/f.txt"], "a path below cwd", join(String(dir), "sibling")],
    ];
    expect(await walkRows(join(String(dir), "root"), rows)).toEqual(expectedOf(rows));
  });

  // Each name here is like "." or "..", needs more than one byte for a character, or is one of many, and it is at the
  // limit and one level past it. The lists are those of Node.js v26.12.1.
  describe("the depth of a name below cwd", () => {
    const names: DirectoryTree = {
      "..a": { "f.txt": "" },
      ".h": { "f.txt": "" },
      "a b": { "f.txt": "" },
      "ø": { "f.txt": "" },
      "日本": { "f.txt": "", "語": { "f.txt": "" } },
      a: { a: { a: { a: { a: { a: { a: { a: { a: { "f.txt": "" } } } } } } } } },
      up: { "f.txt": "", in: { "f.txt": "" } },
      // Windows has none of these names: it drops a last ".", ":" names a drive or a stream, and "\\" is a separator.
      ...(isWindows ? {} : { "...": { "f.txt": "" }, "x:y": { "f.txt": "" }, "back\\slash": { "f.txt": "" } }),
    };
    // Windows resolves no path, so it takes a path with ".." the way of Node.js's text. A walk that the limit stops at
    // ".." asks about that directory only.
    const throughParent: Asked = isWindows ? "a path below cwd" : "no path";
    const aboveCwd: Asked = isWindows ? "no path below cwd" : "no path";
    const rows: CountRow[] = [
      ["{..a,.h}/f.txt", 2, ["..a/f.txt", ".h/f.txt"]],
      ["{..a,.h}/f.txt", 1, []],
      ["{..a,.h}/**", 1, ["..a", ".h"]],
      ["{ø,a b}/f.txt", 2, ["a b/f.txt", "ø/f.txt"]],
      ["{ø,a b}/f.txt", 1, []],
      ["日本/**", 2, ["日本", "日本/f.txt", "日本/語"]],
      ["日本/*/f.txt", 3, ["日本/語/f.txt"]],
      ["日本/*/f.txt", 2, []],
      ["a/**/f.txt", 10, ["a/a/a/a/a/a/a/a/a/f.txt"]],
      ["a/**/f.txt", 9, []],
      ["a/a/../../ø/f.txt", 2, ["ø/f.txt"]],
      ["a/a/../../ø/f.txt", 1, []],
      // "**/.." gives cwd, which is "." at depth 0, and the directory above it, which is ".." at depth 1.
      ["**/..", 1, [".", ".."], aboveCwd],
      ["**/..", 0, []],
      // Out of cwd and back into it: the depth is the one below cwd.
      ["../names/up/f.txt", 2, ["../names/up/f.txt"], throughParent],
      ["../names/up/f.txt", 1, [], aboveCwd],
      ["../names/up/*/f.txt", 3, ["../names/up/in/f.txt"], throughParent],
      ["../names/up/*/f.txt", 2, [], throughParent],
      ...((isWindows
        ? []
        : [
            [".../f.txt", 2, [".../f.txt"]],
            [".../f.txt", 1, []],
            [".../**", 1, ["..."]],
            ["x*/f.txt", 2, ["x:y/f.txt"]],
            ["x*/f.txt", 1, []],
            ["x:y", 1, ["x:y"]],
            ["x:y", 0, []],
            ["back*/f.txt", 2, ["back\\slash/f.txt"]],
            ["back*/f.txt", 1, []],
          ]) as CountRow[]),
    ];

    let report: Awaited<ReturnType<typeof walkRows>>;
    beforeAll(async () => {
      using dir = tempDir("fs-glob-max-depth", { names });
      report = await walkRows(join(String(dir), "names"), rows);
    });

    it.each(rows.map((row, index) => [row[0], row[1], index] as const))("%j at %d", (_pattern, _maxDepth, index) => {
      // With no rows, the report is the stderr of the child.
      expect(Array.isArray(report) ? report[index] : report).toEqual(expectedOf(rows)[index]);
    });
  });

  // "ROOT" beside cwd "root". A volume that does not fold case has two directories, so no compare of the limiter may
  // fold case: the file of "ROOT" is two levels deeper than the one of cwd. On a volume that folds case, "ROOT" is cwd.
  // Only the file system says which it is, so Windows and macOS take the route of Node.js's text for such a path.
  it("takes a name in another case for cwd only where the file system says that it is cwd", async () => {
    using dir = tempDir("fs-glob-max-depth", { Top: { root: { "f.txt": "", d1: { "f.txt": "" } } } });
    if (!volumeFoldsCase) {
      fs.mkdirSync(join(String(dir), "Top", "ROOT"));
      fs.writeFileSync(join(String(dir), "Top", "ROOT", "f.txt"), "");
      fs.writeFileSync(join(String(dir), "Top", "ROOT", "other.txt"), "");
    }
    const top = `${String(dir).replaceAll(sep, "/")}/Top`;
    const asked: Asked = isWindows || isMacOS ? "a path below cwd" : "no path";
    // A wildcard with "ROOT" at the limit: the walk reads "ROOT", and asks about a file in it, only where it is cwd.
    const askedAtTheLimit: Asked = volumeFoldsCase
      ? "a path below cwd"
      : isWindows || isMacOS
        ? "no path below cwd"
        : "no path";
    const rows: CountRow[] = [
      [`${top}/ROOT/f.txt`, 2, volumeFoldsCase ? [`${top}/ROOT/f.txt`] : [], asked],
      [`${top}/ROOT/f.txt`, 3, [`${top}/ROOT/f.txt`], asked],
      ["../ROOT/f.txt", 2, volumeFoldsCase ? ["../ROOT/f.txt"] : [], asked],
      ["../ROOT/*.txt", 3, volumeFoldsCase ? ["../ROOT/f.txt"] : ["../ROOT/f.txt", "../ROOT/other.txt"], asked],
      ["../ROOT/*.txt", 2, volumeFoldsCase ? ["../ROOT/f.txt"] : [], askedAtTheLimit],
      [`${top}/ROOT/*.txt`, 2, volumeFoldsCase ? [`${top}/ROOT/f.txt`] : [], askedAtTheLimit],
    ];
    expect(await walkRows(join(String(dir), "Top", "root"), rows)).toEqual(expectedOf(rows));
  });

  // The two functions that the limiter takes a depth from, one for each platform, on every platform. An answer is the
  // depth that path.resolve() and path.relative() give, or UNPLACED: then the limiter takes the route of Node.js's text.
  describe("depthFromRoot()", () => {
    const UNPLACED = -0x80000000;
    const isAscii = (text: string) => !/[^\x00-\x7f]/.test(text);
    // What pathDepth(relative(root, resolve(root, path))) of the limiter counts, and `~k` for a directory `k` levels above the root.
    const depthOf = (platform: "posix" | "win32", root: string, path: string) => {
      const { relative, resolve, isAbsolute, sep } = platform === "posix" ? posix : win32;
      const fromRoot = relative(root, resolve(root, path));
      if (fromRoot === "") return 0;
      if (isAbsolute(fromRoot)) return Infinity;
      const parts = fromRoot.split(sep);
      return parts.every(part => part === "..") ? ~parts.length : parts.length;
    };

    it("gives the depth that path.resolve() and path.relative() give, or says that the characters do not settle it", () => {
      const { posix: depthPosix, win32: depthWin32 } = depthFromRoot;
      const mismatches: unknown[] = [];
      let cases = 0;
      const segments = ["a", "b", ".", "..", "", "...", "..a", ".h", "x:y", "C:", "ø", "日本"];
      for (const platform of ["posix", "win32"] as const) {
        const { dirname, basename, parse, relative, resolve, sep } = platform === "posix" ? posix : win32;
        const seps = platform === "posix" ? ["/"] : ["\\", "/"];
        const roots =
          platform === "posix"
            ? ["/", "/root", "/vol/Top/root"]
            : ["C:\\", "C:\\root", "C:\\vol\\Top\\root", "\\\\server\\share\\dir"];
        const relativePaths = new Set<string>();
        for (const s of seps) {
          for (const a of segments) {
            for (const path of [a, s + a, a + s]) relativePaths.add(path);
            for (const b of segments) {
              relativePaths.add(a + s + b);
              if (["a", ".", "..", "", "x:y"].includes(a)) {
                relativePaths.add(a + s + b + s + "a").add(a + s + b + s + "..");
              }
            }
          }
        }
        for (const root of roots) {
          const rootAndSep = root.endsWith(sep) ? root : root + sep;
          const paths = [
            root,
            rootAndSep,
            `${root}x`,
            `${root}x${sep}a`,
            root.toUpperCase(),
            rootAndSep.toUpperCase() + "a",
          ];
          // Each directory above the root, a name in it, and the way back down from it.
          for (let above = root, back = "", ups = ""; dirname(above) !== above;) {
            back = back === "" ? basename(above) : basename(above) + sep + back;
            ups = ups === "" ? ".." : ups + sep + "..";
            above = dirname(above);
            paths.push(
              above,
              above.toUpperCase(),
              `${above}${above.endsWith(sep) ? "" : sep}x`,
              ups,
              ups + sep,
              ups + sep + "x",
            );
            paths.push(ups + sep + back, ups + sep + back + sep + "a", ups + sep + back.toUpperCase() + sep + "a");
          }
          paths.push(`..${sep}..${sep}..${sep}..${sep}..${sep}x`);
          const long = Buffer.alloc(600, "n").toString();
          paths.push(long, rootAndSep + long, `..${sep}${long}`, `.${sep}${long}`);
          // A path that resolve() has to put together, around the longest one that the function puts together itself.
          for (const extra of [-1, 0, 1, 200]) {
            paths.push(`.${sep}${Buffer.alloc(512 - root.length - 3 + extra, "n")}`);
          }
          for (const path of relativePaths) paths.push(path, rootAndSep + path, `..${sep}${path}`);

          for (const path of paths) {
            const expected = depthOf(platform, root, path);
            const ascii = isAscii(path) && isAscii(root);
            if (platform === "win32") {
              cases++;
              const actual = depthWin32(path, root, false);
              // Names alone, and the root as it is spelled and names: the count answers these.
              const names = path.startsWith(rootAndSep) ? path.slice(rootAndSep.length) : path;
              const isNames = !/^[\\/]|:|(^|[\\/])\.\.([\\/]|$)/.test(names);
              if (actual === UNPLACED ? isNames : actual !== expected) {
                mismatches.push({ platform, root, path, actual, expected });
              }
              continue;
            }
            const full = resolve(root, path);
            const fromRoot = relative(root, full);
            const isBesideRoot = fromRoot.startsWith("../") && expected > 0;
            const [shorter, longer] = [root.toLowerCase(), full.toLowerCase()].sort((a, b) => a.length - b.length);
            // In lower case the path is the root, above it or below it: on macOS the file system says which.
            const isRootInAnotherCase =
              isBesideRoot &&
              longer.startsWith(shorter) &&
              (shorter.length === longer.length || shorter === "/" || longer[shorter.length] === "/");
            // The function puts a path together in 512 characters, and needs none for one that starts with "..".
            const fits = (path.startsWith("/") ? path.length : root.length + 1 + path.length) <= 512;
            for (const foldsCase of [false, true]) {
              cases++;
              const actual = depthPosix(path, root, foldsCase);
              const mustAnswer = ascii && fits && !(foldsCase && isRootInAnotherCase);
              const mustNotAnswer = ascii && foldsCase && isRootInAnotherCase;
              if (actual === UNPLACED ? mustAnswer : mustNotAnswer || actual !== expected) {
                mismatches.push({ platform, foldsCase, root, path, actual, expected });
              }
            }
          }
        }
      }
      expect({ mismatches: mismatches.slice(0, 20), cases: cases > 10_000 }).toEqual({ mismatches: [], cases: true });
    });

    // One row for each rule of the function.
    it.each([
      // A path of names, with parts that are no names.
      ["posix", "a/b", "/vol/Top/root", false, 2],
      ["posix", "a//b/./c/", "/vol/Top/root", false, 3],
      ["posix", "", "/vol/Top/root", false, 0],
      ["posix", ".", "/vol/Top/root", false, 0],
      // At the root, below it, beside it and above it, by a full path and through "..".
      ["posix", "/vol/Top/root", "/vol/Top/root", false, 0],
      ["posix", "/vol/Top/root/a/b", "/vol/Top/root", false, 2],
      ["posix", "/vol/Top/rootx/a", "/vol/Top/root", false, 3],
      ["posix", "/vol/Top/other", "/vol/Top/root", false, 2],
      ["posix", "/vol/Top", "/vol/Top/root", false, ~1],
      ["posix", "/", "/vol/Top/root", false, ~3],
      ["posix", "../root/a", "/vol/Top/root", false, 1],
      ["posix", "../other/a", "/vol/Top/root", false, 3],
      ["posix", "../", "/vol/Top/root", false, ~1],
      ["posix", "../../../../x", "/vol/Top/root", false, 4],
      ["posix", "a/../../root/b", "/vol/Top/root", false, 1],
      ["posix", "/a", "/", false, 1],
      ["posix", "../a", "/", false, 1],
      // A path in another case than the root: another directory, or on macOS what the file system has to say.
      ["posix", "/vol/Top/ROOT/a", "/vol/Top/root", false, 3],
      ["posix", "/vol/Top/ROOT/a", "/vol/Top/root", true, UNPLACED],
      ["posix", "/vol/Top/ROOT", "/vol/Top/root", true, UNPLACED],
      ["posix", "/vol/TOP", "/vol/Top/root", true, UNPLACED],
      ["posix", "../ROOT/a", "/vol/Top/root", true, UNPLACED],
      ["posix", "/vol/TOP/x", "/vol/Top/root", true, 4],
      ["posix", "/vol/Top/other", "/vol/Top/root", true, 2],
      ["posix", "/vol/Top", "/vol/Top/root", true, ~1],
      ["posix", "/vol/Top/root/a", "/vol/Top/root", true, 1],
      // What the function does not resolve: a name that is not ASCII, and a root that resolve() would change.
      ["posix", "ø/日本", "/vol/Top/root", false, 2],
      ["posix", "/vol/Top/root/日本", "/vol/Top/root", false, 1],
      ["posix", "../root/日本", "/vol/Top/root", false, UNPLACED],
      ["posix", "../root/ø", "/vol/Top/root", false, UNPLACED],
      ["posix", "../a", "/vol/Top/root/", false, UNPLACED],
      ["posix", "../a", "vol/root", false, UNPLACED],
      // Windows counts names. A ":" can name a drive, and no path is resolved.
      ["win32", "a\\b/c", "C:\\vol\\Top\\root", false, 3],
      ["win32", "C:\\vol\\Top\\root", "C:\\vol\\Top\\root", false, 0],
      ["win32", "C:\\vol\\Top\\root\\a", "C:\\vol\\Top\\root", false, 1],
      ["win32", "C:\\a", "C:\\", false, 1],
      ["win32", "\\\\server\\share\\dir\\a", "\\\\server\\share\\dir", false, 1],
      ["win32", "C:\\vol\\Top\\ROOT\\a", "C:\\vol\\Top\\root", false, UNPLACED],
      ["win32", "C:\\vol\\Top\\rootx", "C:\\vol\\Top\\root", false, UNPLACED],
      ["win32", "C:\\vol\\Top", "C:\\vol\\Top\\root", false, UNPLACED],
      ["win32", "..\\root\\a", "C:\\vol\\Top\\root", false, UNPLACED],
      ["win32", "a\\..\\b", "C:\\vol\\Top\\root", false, UNPLACED],
      ["win32", "x:y", "C:\\vol\\Top\\root", false, UNPLACED],
      ["win32", "a\\x:y", "C:\\vol\\Top\\root", false, UNPLACED],
      ["win32", "C:\\vol\\Top\\root\\x:y", "C:\\vol\\Top\\root", false, UNPLACED],
    ] as const)("%s: %j below %j, foldsCase %p", (platform, path, root, foldsCase, expected) => {
      expect(depthFromRoot[platform](path, root, foldsCase)).toBe(expected);
    });

    // On POSIX the function puts a path that it resolves together in 512 characters. One that starts with ".." and one
    // that resolve() leaves as it is need no room.
    it("resolves a path of 512 characters, and a longer one that it does not have to put together", () => {
      const { posix: depthPosix } = depthFromRoot;
      const root = "/vol/Top/root";
      const untidy = (length: number) => `./${Buffer.alloc(length - root.length - 3, "n")}`;
      const untidyAbsolute = (length: number) => `${root}/./${Buffer.alloc(length - root.length - 3, "n")}`;
      const long = Buffer.alloc(600, "n").toString();
      expect({
        "a path to resolve of 512 characters": depthPosix(untidy(512), root, false),
        "one of 513": depthPosix(untidy(513), root, false),
        "an absolute path to resolve of 512 characters": depthPosix(untidyAbsolute(512), root, false),
        "an absolute one of 513": depthPosix(untidyAbsolute(513), root, false),
        "names alone": depthPosix(`${long}/${long}`, root, false),
        "below the root": depthPosix(`${root}/${long}`, root, false),
        "through ..": depthPosix(`../root/${long}`, root, false),
        "beside the root": depthPosix(`../${long}/${long}`, root, false),
      }).toEqual({
        "a path to resolve of 512 characters": 1,
        "one of 513": UNPLACED,
        "an absolute path to resolve of 512 characters": 1,
        "an absolute one of 513": UNPLACED,
        "names alone": 2,
        "below the root": 1,
        "through ..": 1,
        "beside the root": 3,
      });
    });
  });

  // The limiter answers from the characters of a path when it can. Each answer has to be the one that path.resolve()
  // and path.relative() give, which is the rule of Node.js, for each shape of path on each platform.
  it("gives the depth that path.resolve() and path.relative() give", async () => {
    const { DepthLimiter } = exposedInternals["internal/fs/glob-depth-limiter"];
    using dir = tempDir("fs-glob-max-depth", { Top: { root: { a: {} } } });
    // The spelling of the file system: Windows and macOS ask it whether a path in another spelling is the root.
    const root = join(fs.realpathSync.native(String(dir)), "Top", "root");
    const depthOf = (path: string) => {
      const fromRoot = relative(root, resolve(root, path));
      return fromRoot === "" ? 0 : isAbsolute(fromRoot) ? Infinity : fromRoot.split(sep).length;
    };
    const isAboveRoot = (path: string) => {
      const rootFromPath = relative(resolve(root, path), root);
      return (
        rootFromPath !== "" &&
        !isAbsolute(rootFromPath) &&
        rootFromPath !== ".." &&
        !rootFromPath.startsWith(`..${sep}`)
      );
    };

    const segments = ["a", "b", ".", "..", "", "...", "..a", ".h", "x:y", "C:", "ø", "日本"];
    const seps = isWindows ? ["\\", "/"] : ["/"];
    const relativePaths = new Set<string>();
    for (const s of seps) {
      for (const a of segments) {
        for (const path of [a, s + a, a + s]) relativePaths.add(path);
        for (const b of segments) {
          relativePaths.add(a + s + b);
          if (["a", ".", "..", "", "x:y"].includes(a)) relativePaths.add(a + s + b + s + "a").add(a + s + b + s + "..");
        }
      }
    }
    const back = join("..", basename(root));
    const paths = [root, root + sep, `${root}x`, `${root}x${sep}a`, "..", `..${sep}`, back];
    // Each directory above the root, a name in it, and the path to it through "..".
    for (let above = dirname(root), ups = ".."; ; above = dirname(above), ups += `${sep}..`) {
      paths.push(above, join(above, "x"), ups, `${ups}${sep}x`);
      if (dirname(above) === above) break;
    }
    // A path that resolve() has to put together, around the longest one that the limiter puts together itself.
    for (const extra of [-1, 0, 1, 200]) {
      paths.push(`.${sep}${Buffer.alloc(512 - root.length - 3 + extra, "n")}`);
    }
    if (isWindows) paths.push("\\\\server\\share\\x", "Z:\\x", "Z:x");
    for (const path of relativePaths) {
      // As it is, below the root as it is spelled, and below the root by way of the directory above it.
      paths.push(path, root + sep + path, back + sep + path);
    }

    const mismatches: unknown[] = [];
    let questions = 0;
    const check = (question: string, path: string, maxDepth: number, actual: unknown, expected: boolean) => {
      questions++;
      if (actual !== expected) mismatches.push({ question, path, maxDepth, actual, expected });
    };
    // One limiter for each limit: no answer may come from what another question left behind.
    const limiters = new Map<number, InstanceType<typeof DepthLimiter>>();
    const limiter = (maxDepth: number) =>
      limiters.get(maxDepth) ?? limiters.set(maxDepth, new DepthLimiter(root, maxDepth)).get(maxDepth)!;
    const ask = async (path: string) => {
      const depth = depthOf(path);
      const isAbove = isAboveRoot(path);
      // At the depth of the path, one level less and one level more: a match and a directory are then at the limit and past it.
      for (const maxDepth of Number.isFinite(depth) ? [depth - 1, depth, depth + 1] : [3]) {
        if (maxDepth < 0) continue;
        const at = limiter(maxDepth);
        check("includes", path, maxDepth, at.includes(path), depth <= maxDepth);
        check("includesNow", path, maxDepth, at.includesNow(path) ?? (await at.includesAsync(path)), depth <= maxDepth);
        check("includesAsync", path, maxDepth, await at.includesAsync(path), depth <= maxDepth);
        check("canTraverse", path, maxDepth, at.canTraverse(path, false), depth < maxDepth);
        check("canTraverse, absolute pattern", path, maxDepth, at.canTraverse(path, true), isAbove || depth < maxDepth);
        check("canTraverseAsync", path, maxDepth, await at.canTraverseAsync(path, false), depth < maxDepth);
        const absolute = await at.canTraverseAsync(path, true);
        check("canTraverseAsync, absolute pattern", path, maxDepth, absolute, isAbove || depth < maxDepth);
      }
    };
    for (const path of paths) {
      await ask(path);
      // What the walker asks after a directory: a name in it as join() writes it, and two names.
      await ask(join(path, "a"));
      await ask(path + sep + "a" + sep + "b");
      // A character that is a separator or a drive on the other platform.
      await ask(path + sep + (isWindows ? "a:b" : "a\\b"));
    }
    expect({ mismatches: mismatches.slice(0, 20), questions: questions > 40_000 }).toEqual({
      mismatches: [],
      questions: true,
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
