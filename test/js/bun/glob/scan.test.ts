// Portions of this file are derived from works under the MIT License:
//
// Copyright (c) Denis Malinochkin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import { Glob, GlobScanOptions } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fg from "fast-glob";
import * as path from "path";
import { tempFixturesDir, createTempDirectoryWithBrokenSymlinks, prepareEntries } from "./util";
import { tempDirWithFiles, tmpdirSync } from "harness";
import * as os from "node:os";
import * as fs from "node:fs";

let origAggressiveGC = Bun.unsafe.gcAggressionLevel();
let tempBrokenSymlinksDir: string;
beforeAll(() => {
  process.chdir(path.join(import.meta.dir, "../../../"));
  tempFixturesDir();
  tempBrokenSymlinksDir = createTempDirectoryWithBrokenSymlinks();
  Bun.unsafe.gcAggressionLevel(0);
});

afterAll(() => {
  Bun.unsafe.gcAggressionLevel(origAggressiveGC);
});

const followSymlinks = true;

const bunGlobOpts = {
  followSymlinks: followSymlinks,
  onlyFiles: false,
  // absolute: true,
} satisfies GlobScanOptions;

type FgOpts = NonNullable<Parameters<typeof fg.glob>[1]>;
const fgOpts = {
  followSymbolicLinks: followSymlinks,
  onlyFiles: false,
  // absolute: true,
} satisfies FgOpts;

describe("glob.match", async () => {
  const timeout = 30 * 1000;
  function testWithOpts(namePrefix: string, bunGlobOpts: GlobScanOptions, fgOpts: FgOpts) {
    test(
      `${namePrefix} recursively search node_modules`,
      async () => {
        const pattern = "**/node_modules/**/*.js";
        const glob = new Glob(pattern);
        const filepaths = prepareEntries(await Array.fromAsync(glob.scan(bunGlobOpts)));
        const fgFilepths = await fg.glob(pattern, fgOpts);

        // console.error(filepaths);
        expect(filepaths.length).toEqual(fgFilepths.length);

        const bunfilepaths = new Set(filepaths);
        for (const filepath of fgFilepths) {
          if (!bunfilepaths.has(filepath)) console.error("Missing:", filepath);
          expect(bunfilepaths.has(filepath)).toBeTrue();
        }
      },
      timeout,
    );

    test(
      `${namePrefix} recursive search js files`,
      async () => {
        const pattern = "**/*.js";
        const glob = new Glob(pattern);
        const filepaths = prepareEntries(await Array.fromAsync(glob.scan(bunGlobOpts)));
        const fgFilepths = await fg.glob(pattern, fgOpts);

        expect(filepaths.length).toEqual(fgFilepths.length);

        const bunfilepaths = new Set(filepaths);
        for (const filepath of fgFilepths) {
          if (!bunfilepaths.has(filepath)) console.error("Missing:", filepath);
          expect(bunfilepaths.has(filepath)).toBeTrue();
        }
      },
      timeout,
    );

    test(
      `${namePrefix} recursive search ts files`,
      async () => {
        const pattern = "**/*.ts";
        const glob = new Glob(pattern);
        const filepaths = prepareEntries(await Array.fromAsync(glob.scan(bunGlobOpts)));
        const fgFilepths = await fg.glob(pattern, fgOpts);

        expect(filepaths.length).toEqual(fgFilepths.length);

        const bunfilepaths = new Set(filepaths);
        for (const filepath of fgFilepths) {
          if (!bunfilepaths.has(filepath)) console.error("Missing:", filepath);
          expect(bunfilepaths.has(filepath)).toBeTrue();
        }
      },
      timeout,
    );

    test(
      `${namePrefix} glob not freed before matching done`,
      async () => {
        const promise = (async () => {
          const glob = new Glob("**/node_modules/**/*.js");
          const result = Array.fromAsync(glob.scan(bunGlobOpts));
          Bun.gc(true);
          const result2 = await result;
          return result2;
        })();
        Bun.gc(true);
        const values = await promise;
        Bun.gc(true);
      },
      timeout,
    );
  }

  testWithOpts("non-absolute", bunGlobOpts, fgOpts);
  testWithOpts("absolute", { ...bunGlobOpts, absolute: true }, { ...fgOpts, absolute: true });

  test("invalid surrogate pairs", async () => {
    const pattern = `**/*.{md,\uD83D\uD800}`;
    const cwd = import.meta.dir;

    const glob = new Glob(pattern);
    const entries = prepareEntries(await Array.fromAsync(glob.scan({ cwd })));

    expect(entries.sort()).toEqual(
      [
        "fixtures/file.md",
        "fixtures/second/file.md",
        "fixtures/second/nested/file.md",
        "fixtures/second/nested/directory/file.md",
        "fixtures/third/library/b/book.md",
        "fixtures/third/library/a/book.md",
        "fixtures/first/file.md",
        "fixtures/first/nested/file.md",
        "fixtures/first/nested/directory/file.md",
      ].sort(),
    );
  });

  test("bad options", async () => {
    const glob = new Glob("lmaowtf");
    expect(returnError(() => glob.scan())).toBeUndefined();
    // @ts-expect-error
    expect(returnError(() => glob.scan(123456))).toBeDefined();
    expect(returnError(() => glob.scan({}))).toBeUndefined();
    expect(returnError(() => glob.scan({ cwd: "" }))).toBeUndefined();
    // @ts-expect-error
    expect(returnError(() => glob.scan({ cwd: true }))).toBeDefined();
    // @ts-expect-error
    expect(returnError(() => glob.scan({ cwd: 123123 }))).toBeDefined();

    function returnError(cb: () => any): Error | undefined {
      try {
        cb();
      } catch (err) {
        // @ts-expect-error
        return err;
      }
      return undefined;
    }
  });
});

// From fast-glob regular.e2e.tes
const regular = {
  regular: [
    "fixtures/*",
    "fixtures/**",
    "fixtures/**/*",

    "fixtures/*/nested",
    "fixtures/*/nested/*",
    "fixtures/*/nested/**",
    "fixtures/*/nested/**/*",
    "fixtures/**/nested/*",
    "fixtures/**/nested/**",
    "fixtures/**/nested/**/*",

    "fixtures/{first,second}",
    "fixtures/{first,second}/*",
    "fixtures/{first,second}/**",
    "fixtures/{first,second}/**/*",

    // The @(pattern) syntax not supported so we don't include that here
    // "@(fixtures)/{first,second}",
    // "@(fixtures)/{first,second}/*",

    "fixtures/*/{first,second}/*",
    "fixtures/*/{first,second}/*/{nested,file.md}",
    "fixtures/**/{first,second}/**",
    "fixtures/**/{first,second}/{nested,file.md}",
    "fixtures/**/{first,second}/**/{nested,file.md}",

    "fixtures/{first,second}/{nested,file.md}",
    "fixtures/{first,second}/*/nested/*",
    "fixtures/{first,second}/**/nested/**",

    "fixtures/*/{nested,file.md}/*",
    "fixtures/**/{nested,file.md}/*",

    "./fixtures/*",
  ],
  cwd: [
    { pattern: "*", cwd: "fixtures" },
    { pattern: "**", cwd: "fixtures" },
    { pattern: "**/*", cwd: "fixtures" },
    { pattern: "*/nested", cwd: "fixtures" },
    { pattern: "*/nested/*", cwd: "fixtures" },
    { pattern: "*/nested/**", cwd: "fixtures" },
    { pattern: "*/nested/**/*", cwd: "fixtures" },
    { pattern: "**/nested/*", cwd: "fixtures" },
    { pattern: "**/nested/**", cwd: "fixtures" },
    { pattern: "**/nested/**/*", cwd: "fixtures" },
    { pattern: "{first,second}", cwd: "fixtures" },
    { pattern: "{first,second}/*", cwd: "fixtures" },
    { pattern: "{first,second}/**", cwd: "fixtures" },
    { pattern: "{first,second}/**/*", cwd: "fixtures" },
    { pattern: "*/{first,second}/*", cwd: "fixtures" },
    { pattern: "*/{first,second}/*/{nested,file.md}", cwd: "fixtures" },
    { pattern: "**/{first,second}/**", cwd: "fixtures" },
    { pattern: "**/{first,second}/{nested,file.md}", cwd: "fixtures" },
    { pattern: "**/{first,second}/**/{nested,file.md}", cwd: "fixtures" },
    { pattern: "{first,second}/{nested,file.md}", cwd: "fixtures" },
    { pattern: "{first,second}/*/nested/*", cwd: "fixtures" },
    { pattern: "{first,second}/**/nested/**", cwd: "fixtures" },
    { pattern: "*/{nested,file.md}/*", cwd: "fixtures" },
    { pattern: "**/{nested,file.md}/*", cwd: "fixtures" },
  ],
  relativeCwd: [
    { pattern: "./*" },
    { pattern: "./*", cwd: "fixtures" },
    { pattern: "./**", cwd: "fixtures" },
    { pattern: "./**/*", cwd: "fixtures" },
    { pattern: "../*", cwd: "fixtures/first" },
    { pattern: "../**", cwd: "fixtures/first", issue: 47 },
    { pattern: "../../*", cwd: "fixtures/first/nested" },
    { pattern: "../{first,second}", cwd: "fixtures/first" },
    { pattern: "./../*", cwd: "fixtures/first" },
  ],
};

// From fast-glob absolute.e2e.ts
const absolutePatterns = {
  regular: ["fixtures/*", "fixtures/**", "fixtures/**/*", "fixtures/../*"],
  cwd: [
    {
      pattern: "*",
      cwd: "fixtures",
    },
    {
      pattern: "**",
      cwd: "fixtures",
    },
    {
      pattern: "**/*",
      cwd: "fixtures",
    },
  ],
};

// From fast-glob only-files.e2e.ts
const onlyFilesPatterns = {
  regular: ["fixtures/*", "fixtures/**", "fixtures/**/*"],
  cwd: [
    {
      pattern: "*",
      cwd: "fixtures",
    },
    {
      pattern: "**",
      cwd: "fixtures",
    },
    {
      pattern: "**/*",
      cwd: "fixtures",
    },
  ],
};

/**
 * These are the e2e tests from fast-glob, with some omitted because we don't support features like ignored patterns
 * The snapshots are generated by running fast-glob on them first
 * There are slight discrepancies in the returned matches when there is a `./` in front of the pattern.
 * Bun.Glob is consistent with the Unix bash shell style, which always adds the `./`
 * fast-glob will randomly add it or omit it.
 * In practice this discrepancy makes no difference, so the snapshots were changed accordingly to match Bun.Glob / Unix bash shell style.
 */
describe("fast-glob e2e tests", async () => {
  let absolute_pattern_dir: string = "";
  // beforeAll(() => {
  tempFixturesDir();
  absolute_pattern_dir = tmpdirSync();
  // add some more directories so patterns like ../**/* don't break
  absolute_pattern_dir = path.join(absolute_pattern_dir, "ooga/booga");
  fs.mkdirSync(absolute_pattern_dir, { recursive: true })!;
  tempFixturesDir(absolute_pattern_dir);
  // });

  let buildsnapshot = false;
  const absoluteCwd = process.cwd();
  const cwd = import.meta.dir;
  console.log("CWD IS", cwd);
  const stripAbsoluteDir = (path: string): string => path.slice(absolute_pattern_dir.length);
  // const stripAbsoluteDir = (path: string): string => path;

  regular.regular.forEach(pattern => {
    // console.log("ABSOLUTE PATTERN DIR", absolute_pattern_dir);
    const absolutePattern = path.join(absolute_pattern_dir, pattern);
    test(`(absolute) patterns regular ${pattern}`, () => {
      let entries = buildsnapshot
        ? prepareEntries(fg.globSync(absolutePattern, { cwd }))
        : prepareEntries(Array.from(new Glob(absolutePattern).scanSync({ cwd, followSymlinks: true })));

      // console.log("PATTERN", absolutePattern, entries);
      expect(entries.map(stripAbsoluteDir)).toMatchSnapshot(`absolute: ${pattern}`);
    });

    test(`patterns regular ${pattern}`, () => {
      let entries = buildsnapshot
        ? prepareEntries(fg.globSync(pattern, { cwd }))
        : prepareEntries(Array.from(new Glob(pattern).scanSync({ cwd, followSymlinks: true })));

      expect(entries).toMatchSnapshot(pattern);
    });
  });

  regular.cwd.forEach(({ pattern, cwd: secondHalf }) => {
    const absolutePattern = path.join(absolute_pattern_dir, pattern);
    test(`(absolute) patterns regular cwd ${pattern}`, () => {
      const testCwd = path.join(cwd, secondHalf);
      let entries = buildsnapshot
        ? prepareEntries(fg.globSync(absolutePattern, { cwd: testCwd }))
        : prepareEntries(Array.from(new Glob(absolutePattern).scanSync({ cwd: testCwd, followSymlinks: true })));

      // let entries = ;
      expect(entries.map(stripAbsoluteDir)).toMatchSnapshot(`absolute: ${pattern}`);
    });

    test(`patterns regular cwd ${pattern}`, () => {
      const testCwd = path.join(cwd, secondHalf);
      let entries = buildsnapshot
        ? prepareEntries(fg.globSync(pattern, { cwd: testCwd }))
        : prepareEntries(Array.from(new Glob(pattern).scanSync({ cwd: testCwd, followSymlinks: true })));
      expect(entries).toMatchSnapshot(pattern);
    });
  });

  regular.relativeCwd.forEach(({ pattern, cwd: secondHalf }) => {
    const absolutePattern = path.join(absolute_pattern_dir, pattern);
    test(`(absolute) patterns regular relative cwd ${pattern}`, () => {
      const testCwd = secondHalf ? path.join(cwd, secondHalf) : cwd;
      let entries = buildsnapshot
        ? prepareEntries(fg.globSync(absolutePattern, { cwd: testCwd }))
        : prepareEntries(Array.from(new Glob(absolutePattern).scanSync({ cwd: testCwd, followSymlinks: true })));

      // let entries =
      expect(entries.map(stripAbsoluteDir)).toMatchSnapshot(`absolute: ${pattern}`);
    });

    test(`patterns regular relative cwd ${pattern}`, () => {
      const testCwd = secondHalf ? path.join(cwd, secondHalf) : cwd;
      let entries = buildsnapshot
        ? prepareEntries(fg.globSync(pattern, { cwd: testCwd }))
        : prepareEntries(Array.from(new Glob(pattern).scanSync({ cwd: testCwd, followSymlinks: true })));

      // let entries =
      expect(entries).toMatchSnapshot(pattern);
    });
  });

  absolutePatterns.cwd.forEach(({ pattern, cwd: secondHalf }) => {
    const absolutePattern = path.join(absolute_pattern_dir, pattern);
    test(`(absolute) patterns absolute cwd ${pattern}`, () => {
      const testCwd = secondHalf ? path.join(cwd, secondHalf) : cwd;
      let entries = buildsnapshot
        ? fg.globSync(absolutePattern, { cwd: testCwd, absolute: true })
        : Array.from(new Glob(absolutePattern).scanSync({ cwd: testCwd, followSymlinks: true, absolute: true }));
      // entries = entries.sort().map(entry => entry.slice(absoluteCwd.length + 1));
      entries = prepareEntries(entries);
      expect(entries.map(stripAbsoluteDir)).toMatchSnapshot(`absolute: ${pattern}`);
    });

    test(`patterns absolute cwd ${pattern}`, () => {
      const testCwd = secondHalf ? path.join(cwd, secondHalf) : cwd;
      let entries = buildsnapshot
        ? fg.globSync(pattern, { cwd: testCwd, absolute: true })
        : Array.from(new Glob(pattern).scanSync({ cwd: testCwd, followSymlinks: true, absolute: true }));

      entries = entries.sort().map(entry => entry.slice(testCwd.length + 1));
      entries = prepareEntries(entries);
      expect(entries).toMatchSnapshot(`absolute: ${pattern}`);
    });
  });

  onlyFilesPatterns.regular.forEach(pattern => {
    const absolutePattern = path.join(absolute_pattern_dir, pattern);

    test(`(absolute) only files ${pattern}`, () => {
      let entries = buildsnapshot
        ? prepareEntries(fg.globSync(absolutePattern, { cwd, absolute: false, onlyFiles: true }))
        : prepareEntries(
            Array.from(new Glob(absolutePattern).scanSync({ cwd, followSymlinks: true, onlyFiles: true })),
          );

      expect(entries.map(stripAbsoluteDir)).toMatchSnapshot(`absolute: ${pattern}`);
    });

    test(`only files ${pattern}`, () => {
      let entries = prepareEntries(fg.globSync(pattern, { cwd, absolute: false, onlyFiles: true }));

      // let entries = prepareEntries(
      //   Array.from(new Glob(pattern).scanSync({ cwd, followSymlinks: true, onlyFiles: true })),
      // );
      expect(entries).toMatchSnapshot(pattern);
    });
  });

  onlyFilesPatterns.cwd.forEach(({ pattern, cwd: secondHalf }) => {
    const absolutePattern = path.join(absolute_pattern_dir, pattern);
    test(`(absolute) only files (cwd) ${pattern}`, () => {
      const testCwd = secondHalf ? path.join(cwd, secondHalf) : cwd;
      let entries = buildsnapshot
        ? prepareEntries(fg.globSync(absolutePattern, { cwd: testCwd, absolute: false, onlyFiles: true }))
        : prepareEntries(
            Array.from(new Glob(absolutePattern).scanSync({ cwd: testCwd, followSymlinks: true, onlyFiles: true })),
          );

      expect(entries.map(stripAbsoluteDir)).toMatchSnapshot(`absolute: ${pattern}`);
    });

    test(`only files (cwd) ${pattern}`, () => {
      const testCwd = secondHalf ? path.join(cwd, secondHalf) : cwd;
      let entries = buildsnapshot
        ? prepareEntries(fg.globSync(pattern, { cwd: testCwd, absolute: false, onlyFiles: true }))
        : prepareEntries(
            Array.from(new Glob(pattern).scanSync({ cwd: testCwd, followSymlinks: true, onlyFiles: true })),
          );

      expect(entries).toMatchSnapshot(pattern);
    });
  });
});

test("broken symlinks", async () => {
  const glob = new Glob("**/*");
  const results = await Array.fromAsync(
    glob.scan({
      cwd: tempBrokenSymlinksDir,
      followSymlinks: true,
      absolute: true,
      onlyFiles: false,
    }),
  );
  expect(new Set(results)).toEqual(
    new Set([
      path.join(tempBrokenSymlinksDir, "broken_link_to_non_existent_dir"),
      path.join(tempBrokenSymlinksDir, "broken_link_to_non_existent_file.txt"),
    ]),
  );
});

// This is consistent with fast-glob's behavior
test.skipIf(process.platform == "win32")("error broken symlinks", async () => {
  const glob = new Glob("**/*");
  let err: Error | undefined = undefined;
  try {
    const results = await Array.fromAsync(
      glob.scan({
        cwd: tempBrokenSymlinksDir,
        followSymlinks: true,
        absolute: true,
        onlyFiles: false,
        throwErrorOnBrokenSymlink: true,
      }),
    );
  } catch (e) {
    err = e as any;
  }
  expect(err).toBeDefined();
});

test("error non-existent cwd", async () => {
  const glob = new Glob("**/*");
  let err: Error | undefined = undefined;
  try {
    const results = await Array.fromAsync(
      glob.scan({
        cwd: "alkfjalskdjfoogaboogaalskjflskdjfl",
        followSymlinks: true,
        absolute: true,
        onlyFiles: false,
        throwErrorOnBrokenSymlink: true,
      }),
    );
  } catch (e) {
    err = e as any;
  }
  expect(err).toBeDefined();
});

test("glob.scan(string)", async () => {
  const glob = new Glob("*.md");
  const entries = await Array.fromAsync(glob.scan(path.join(import.meta.dir, "fixtures")));
  expect(entries.length).toBeGreaterThan(0);
});

test("glob.scan('.')", async () => {
  const glob = new Glob("*.md");
  const entries = await Array.fromAsync(glob.scan("."));
  // bun root dir
  expect(entries).toContain("README.md");
});

describe("literal fast path", async () => {
  let tempdir = "";
  beforeAll(() => {
    tempdir = tempDirWithFiles("glob-scan-literal-fast-path", {
      "packages": {
        "a": {
          "package.json": "hi",
          "foo": "bar",
        },
        "b": {
          "package.json": "hi",
          "foo": "bar",
        },
        "c": {
          "package.json": "hi",
          "foo": "bar",
        },
        "foo": "bar",
      },
      "foo": "bar",
    });
  });

  test("works", async () => {
    const glob = new Glob("packages/*/package.json");
    const entries = await Array.fromAsync(glob.scan({ cwd: tempdir }));
    expect(entries.sort()).toEqual(
      [
        `packages${path.sep}a${path.sep}package.json`,
        `packages${path.sep}b${path.sep}package.json`,
        `packages${path.sep}c${path.sep}package.json`,
      ].sort(),
    );
  });

  test("works 2", async () => {
    const glob = new Glob("packages/*/foo");
    const entries = await Array.fromAsync(glob.scan({ cwd: tempdir }));
    expect(entries.sort()).toEqual(
      [
        `packages${path.sep}a${path.sep}foo`,
        `packages${path.sep}b${path.sep}foo`,
        `packages${path.sep}c${path.sep}foo`,
      ].sort(),
    );
  });

  test("works3", async () => {
    const glob = new Glob("packages/foo");
    const entries = await Array.fromAsync(glob.scan({ cwd: tempdir }));
    expect(entries.sort()).toEqual([`packages${path.sep}foo`].sort());
  });
});

describe("trailing directory separator", async () => {
  test("matches directories absolute", async () => {
    const tmpdir = tmpdirSync();
    const files = [`${tmpdir}${path.sep}bunx-foo`, `${tmpdir}${path.sep}bunx-bar`, `${tmpdir}${path.sep}bunx-baz`];
    await Bun.$`touch ${files[0]}; touch ${files[1]}; mkdir ${files[2]}`;
    const glob = new Glob(`${path.join(tmpdir, "bunx-*")}${path.sep}`);
    const entries = await Array.fromAsync(glob.scan({ onlyFiles: false }));
    expect(entries.sort()).toEqual(files.slice(2, 3).sort());
  });

  test("matches directories relative", async () => {
    const tmpdir = tmpdirSync();
    const files = [`bunx-foo`, `bunx-bar`, `bunx-baz`];
    await Bun.$`touch ${files[0]}; touch ${files[1]}; mkdir ${files[2]}`.cwd(tmpdir);
    const glob = new Glob(`bunx-*/`);
    const entries = await Array.fromAsync(glob.scan({ onlyFiles: false, cwd: tmpdir }));
    expect(entries.sort()).toEqual(files.slice(2, 3).sort());
  });
});

describe("absolute path pattern", async () => {
  test("works *", async () => {
    const tmpdir = tmpdirSync();
    const files = [`${tmpdir}${path.sep}bunx-foo`, `${tmpdir}${path.sep}bunx-bar`, `${tmpdir}${path.sep}bunx-baz`];
    await Bun.$`touch ${files[0]}; touch ${files[1]}; mkdir ${files[2]}`;
    const glob = new Glob(`${path.join(tmpdir, "bunx-*")}`);
    const entries = await Array.fromAsync(glob.scan({ onlyFiles: false }));
    expect(entries.sort()).toEqual(files.sort());
  });

  test("works **/", async () => {
    const tmpdir = tmpdirSync();
    const files = [
      `${tmpdir}${path.sep}bunx-foo`,
      `${tmpdir}${path.sep}bunx-bar`,
      `${tmpdir}${path.sep}bunx-baz`,
      `${tmpdir}${path.sep}foo`,
      `${tmpdir}${path.sep}bar`,
      `${tmpdir}${path.sep}bar`,
    ];
    await Bun.$`mkdir -p ${files.slice(0, 3)}; touch ${files.slice(3)}`;
    const glob = new Glob(`${path.join(tmpdir, "**")}${path.sep}`);
    const entries = await Array.fromAsync(glob.scan({ onlyFiles: false }));
    expect(entries.sort()).toEqual(files.slice(0, 3).sort());
  });

  test("works **", async () => {
    const tmpdir = tmpdirSync();
    const files = [
      `${tmpdir}${path.sep}bunx-foo`,
      `${tmpdir}${path.sep}bunx-bar`,
      `${tmpdir}${path.sep}bunx-baz`,
      `${tmpdir}${path.sep}foo`,
      `${tmpdir}${path.sep}bar`,
      `${tmpdir}${path.sep}bar`,
    ];
    await Bun.$`mkdir -p ${files.slice(0, 3)}; touch ${files.slice(3)}`;
    const glob = new Glob(`${path.join(tmpdir, "**")}`);
    const entries = await Array.fromAsync(glob.scan({ onlyFiles: false }));
    expect(entries.sort()).toEqual(files.slice(0, files.length - 1).sort());
  });

  test("non-special path as first component", async () => {
    const glob = new Glob("/**lol");
    const entries = await Array.fromAsync(glob.scan({ onlyFiles: false }));
    expect(entries).toEqual([]);
  });

  test("doesn't exist, file pattern", async () => {
    const tmpdir = tmpdirSync();
    await Bun.$`mkdir -p hello/friends; touch hello/friends/lol.json; echo ${tmpdir}`.cwd(tmpdir);
    const glob = new Glob(`${tmpdir}/hello/friends/nice.json`);
    console.log(Array.from(glob.scanSync({ cwd: tmpdir })));
  });
});

describe("glob.scan wildcard fast path", async () => {
  test("works", async () => {
    const tempdir = tempDirWithFiles("glob-scan-wildcard-fast-path", {
      "lol.md": "",
      "lol2.md": "",
      "shouldnt-show.md23243": "",
      "shouldnt-show.ts": "",
    });
    const glob = new Glob("*.md");
    const entries = await Array.fromAsync(glob.scan(tempdir));
    // bun root dir
    expect(entries.sort()).toEqual(["lol.md", "lol2.md"].sort());
  });

  // https://github.com/oven-sh/bun/issues/8817
  describe("fast-path detection edgecase", async () => {
    function runTest(pattern: string, files: Record<string, string>, expected: string[]) {
      test(`pattern: ${pattern}`, async () => {
        const tempdir = tempDirWithFiles("glob-scan-wildcard-fast-path", files);
        const glob = new Glob(pattern);
        const entries = await Array.fromAsync(glob.scan(tempdir));
        expect(entries.sort()).toEqual(expected.sort());
      });
    }

    runTest(
      "*.test.*",
      {
        "example.test.ts": "",
        "example.test.js": "",
        "shouldnt-show.ts": "",
      },
      ["example.test.ts", "example.test.js"],
    );

    runTest(
      "*.test.ts",
      {
        "example.test.ts": "",
        "example.test.ts.test.ts": "",
        "shouldnt-show.ts": "",
      },
      ["example.test.ts", "example.test.ts.test.ts"],
    );

    runTest(
      "*.test.{js,ts}",
      {
        "example.test.ts": "",
        "example.test.js": "",
        "shouldnt-show.ts": "",
      },
      ["example.test.ts", "example.test.js"],
    );

    runTest(
      "*.test.ts?",
      {
        "example.test.tsx": "",
        "example.test.tsz": "",
        "shouldnt-show.ts": "",
      },
      ["example.test.tsx", "example.test.tsz"],
    );

    // `!` only applies negation if at the start of the pattern
    runTest(
      "*.test!.*",
      {
        "hi.test!.js": "",
        "hello.test!.ts": "",
        "no.test.ts": "",
      },
      ["hi.test!.js", "hello.test!.ts"],
    );
  });
});
