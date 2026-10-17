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
import { execSync } from "child_process";
import fg from "fast-glob";
import {
  bunEnv,
  bunExe,
  isASAN,
  isDebug,
  isLinux,
  isRoot,
  isWindows,
  tempDir,
  tempDirWithFiles,
  tmpdirSync,
} from "harness";
import * as fs from "node:fs";
import * as path from "path";
import { createTempDirectoryWithBrokenSymlinks, prepareEntries, tempFixturesDir } from "./util";

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
        const [filepaths, fgFilepths] = await Promise.all([
          Array.fromAsync(glob.scan(bunGlobOpts)).then(prepareEntries),
          fg.glob(pattern, fgOpts),
        ]);

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
        const [filepaths, fgFilepths] = await Promise.all([
          Array.fromAsync(glob.scan(bunGlobOpts)).then(prepareEntries),
          fg.glob(pattern, fgOpts),
        ]);

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
        const [filepaths, fgFilepths] = await Promise.all([
          Array.fromAsync(glob.scan(bunGlobOpts)).then(prepareEntries),
          fg.glob(pattern, fgOpts),
        ]);

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

  test("oversized cwd throws instead of crashing", async () => {
    const glob = new Glob("*.ts");
    const tooLong = Buffer.alloc(100_000, "x").toString();
    // relative cwd
    expect(returnError(() => [...glob.scanSync({ cwd: tooLong })])).toBeDefined();
    expect(returnError(() => glob.scan({ cwd: tooLong }))).toBeDefined();
    // relative cwd that would be resolved against process.cwd()
    expect(returnError(() => [...glob.scanSync({ cwd: tooLong, absolute: true })])).toBeDefined();
    // absolute cwd
    expect(returnError(() => [...glob.scanSync({ cwd: "/" + tooLong })])).toBeDefined();
    expect(returnError(() => glob.scan({ cwd: "/" + tooLong }))).toBeDefined();

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
    "../.",
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

  // The fast path stats the literal in each matched directory. Mode 444 fails that stat.
  // Root ignores the mode bits, and chmod on Windows cannot make a directory unsearchable.
  test.skipIf(isWindows || isRoot)("a failed stat reports the path from cwd", () => {
    using dir = tempDir("glob-scan-literal-fast-path-eacces", { "packages/a/package.json": "hi" });
    const unsearchable = path.join(String(dir), "packages", "a");
    fs.chmodSync(unsearchable, 0o444);
    try {
      expect(() => [...new Glob("packages/*/package.json").scanSync({ cwd: String(dir) })]).toThrow(
        expect.objectContaining({ code: "EACCES", syscall: "fstatat", path: "packages/a/package.json" }),
      );
      expect(() => [...new Glob("packages/*/package.json").scanSync({ cwd: String(dir), absolute: true })]).toThrow(
        expect.objectContaining({
          code: "EACCES",
          syscall: "fstatat",
          path: path.join(unsearchable, "package.json"),
        }),
      );
    } finally {
      fs.chmodSync(unsearchable, 0o755);
    }
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

// https://github.com/oven-sh/bun/issues/24936
describe("glob scan should not escape cwd boundary", () => {
  test("pattern .*/* should not match parent directory via ..", async () => {
    // Create a directory structure where we can verify paths don't escape cwd
    await using tempdir = tempDir("glob-cwd-escape", {
      ".hidden": {
        "file.txt": "hidden file content",
      },
      ".dotfile": "dot file",
      "regular": {
        "file.txt": "regular file",
      },
    });

    const glob = new Glob(".*/*");
    const entries = await Array.fromAsync(
      glob.scan({
        cwd: tempdir,
        onlyFiles: false,
        dot: true, // Need dot:true to match dotfiles/directories
      }),
    );

    // All entries should be within the cwd - none should start with ../
    for (const entry of entries) {
      expect(entry.startsWith("../")).toBe(false);
      expect(entry.startsWith("..\\")).toBe(false);
      expect(entry.includes("/../")).toBe(false);
      expect(entry.includes("\\..\\")).toBe(false);
    }

    // Should match .hidden/file.txt but not escape to parent
    expect(entries.sort()).toEqual([`.hidden${path.sep}file.txt`].sort());
  });

  test("pattern .*/**/*.ts should not escape cwd", async () => {
    await using tempdir = tempDir("glob-cwd-escape-ts", {
      ".config": {
        "settings.ts": "export default {}",
        "nested": {
          "deep.ts": "export const x = 1",
        },
      },
      "src": {
        "index.ts": "console.log('hi')",
      },
    });

    const glob = new Glob(".*/**/*.ts");
    const entries = await Array.fromAsync(
      glob.scan({
        cwd: tempdir,
        onlyFiles: true,
        dot: true, // Need dot:true to match dotfiles/directories
      }),
    );

    // All entries should be within the cwd
    for (const entry of entries) {
      expect(entry.startsWith("../")).toBe(false);
      expect(entry.startsWith("..\\")).toBe(false);
      expect(entry.includes("/../")).toBe(false);
      expect(entry.includes("\\..\\")).toBe(false);
    }

    // Should match files in .config but not escape to parent
    expect(entries.sort()).toEqual(
      [`.config${path.sep}settings.ts`, `.config${path.sep}nested${path.sep}deep.ts`].sort(),
    );
  });
});

describe("glob.scan wildcard fast path", async () => {
  test("works", async () => {
    await using tempdir = tempDir("glob-scan-wildcard-fast-path", {
      "lol.md": "",
      "lol2.md": "",
      "shouldnt-show.md23243": "",
      "shouldnt-show.ts": "",
    });
    const glob = new Glob("*.md");
    const entries = await Array.fromAsync(glob.scan(String(tempdir)));
    // bun root dir
    expect(entries.sort()).toEqual(["lol.md", "lol2.md"].sort());
  });

  // https://github.com/oven-sh/bun/issues/8817
  describe("fast-path detection edgecase", async () => {
    function runTest(pattern: string, files: Record<string, string>, expected: string[]) {
      test(`pattern: ${pattern}`, async () => {
        await using tempdir = tempDir("glob-scan-wildcard-fast-path", files);
        const glob = new Glob(pattern);
        const entries = await Array.fromAsync(glob.scan(String(tempdir)));
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

// ComponentSet (AutoBitSet) stores up to 127 indices inline, then spills to
// heap. Verify patterns past that threshold still match correctly.
// Skipped on Windows: 130 levels × 2 chars + tmpdir prefix exceeds MAX_PATH (260).
test.skipIf(process.platform === "win32")("patterns with many components", () => {
  const depth = 130;
  const files: Record<string, string> = {};
  const parts: string[] = [];
  for (let i = 0; i < depth; i++) parts.push("a");
  files[parts.join("/") + "/hit.txt"] = "";
  files[parts.slice(0, depth - 1).join("/") + "/miss.txt"] = "";

  using dir = tempDir("glob-deep", files);

  // Exact-depth pattern: depth `*` components + literal tail
  const star = Array(depth).fill("*").join("/") + "/hit.txt";
  expect([...new Bun.Glob(star).scanSync({ cwd: dir })].length).toBe(1);

  // `**` at the start with a deep literal prefix after it
  const deepDouble = "**/" + Array(depth).fill("a").join("/") + "/*.txt";
  expect([...new Bun.Glob(deepDouble).scanSync({ cwd: dir })].length).toBe(1);

  // `**` sandwiched deep in the pattern (triggers merge at high index)
  const half = Math.floor(depth / 2);
  const sandwich =
    Array(half).fill("*").join("/") +
    "/**/" +
    Array(depth - half)
      .fill("a")
      .join("/") +
    "/*.txt";
  expect([...new Bun.Glob(sandwich).scanSync({ cwd: dir })].length).toBe(1);
});

// scan() keeps the cwd string it is given verbatim, but child paths pushed for
// symlink work items are joined and normalized. The entry-name offset stored on
// those work items must be derived from the normalized joined path, not from the
// raw cwd, otherwise a cwd with redundant trailing separators plus a short-named
// symlink makes the offset exceed the path length.
test("scan handles a cwd with redundant trailing separators when following symlinks", async () => {
  using dir = tempDir("glob-scan-symlink-raw-cwd", {
    "haystack/regular.txt": "regular",
    "haystack/target/inner.txt": "inner",
  });

  // Short-named symlink to a directory: after normalization the joined child
  // path is shorter than the raw cwd string passed to scan() below.
  try {
    fs.symlinkSync("target", path.join(String(dir), "haystack", "L"), "dir");
  } catch (err: any) {
    if (err.code === "EPERM" || err.code === "EACCES") return;
    throw err;
  }

  // cwd with redundant trailing separators, passed through to scan() as-is.
  const rawCwd = path.join(String(dir), "haystack") + path.sep.repeat(4);

  const script = `
    const opts = {
      cwd: process.env.GLOB_RAW_CWD,
      absolute: true,
      followSymlinks: true,
      onlyFiles: false,
    };
    const shallow = await Array.fromAsync(new Bun.Glob("*").scan(opts));
    const deep = await Array.fromAsync(new Bun.Glob("**/*").scan(opts));
    console.log(JSON.stringify({ shallow, deep }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, GLOB_RAW_CWD: rawCwd },
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const norm = (s: string) => s.replaceAll("\\", "/");
  const root = norm(path.join(String(dir), "haystack"));

  expect(stdout.trim()).not.toBe("");
  const result = JSON.parse(stdout.trim());
  const shallow = result.shallow.map(norm).sort();
  const deep = result.deep.map(norm).sort();

  // Only real entries under the scanned directory are reported, and the
  // symlinked directory is still traversed.
  expect(shallow).toEqual([`${root}/L`, `${root}/regular.txt`, `${root}/target`].sort());
  expect(deep).toEqual(
    [`${root}/L`, `${root}/L/inner.txt`, `${root}/regular.txt`, `${root}/target`, `${root}/target/inner.txt`].sort(),
  );
  expect(exitCode).toBe(0);
});

// A pattern segment that spells out a leading `.` is an explicit request for
// that dotfile/dot-directory, so the `dot: false` default must not hide it.
// This matches bash, picomatch, minimatch and fast-glob.
describe("explicit dotfile segments match without dot:true", () => {
  const norm = (a: string[]) => a.map(p => p.replaceAll("\\", "/")).sort();
  const files = {
    ".dotdir/inner.txt": "x",
    ".dotdir/.hidden.txt": "x",
    ".dotdir/foo/.dotdir/inner.txt": "x",
    ".env": "x",
    "sub/.dotdir/inner.txt": "x",
    "sub/visible.txt": "x",
    "visible.txt": "x",
  };

  test.each([
    [".dotdir/inner.txt", [".dotdir/inner.txt"]],
    [".dotdir/*.txt", [".dotdir/inner.txt"]],
    [".*/inner.txt", [".dotdir/inner.txt"]],
    [".env", [".env"]],
    [".*", [".env"]],
    // `**` may advance to an explicit `.dotdir` segment but must not itself
    // recurse through a hidden dir: `.dotdir/foo/.dotdir/inner.txt` must not
    // match since the only decomposition needs `**` to consume `.dotdir/foo`.
    ["**/.dotdir/inner.txt", [".dotdir/inner.txt", "sub/.dotdir/inner.txt"]],
    ["sub/.dotdir/*.txt", ["sub/.dotdir/inner.txt"]],
  ])("pattern %j finds explicitly-named dotfiles", (pattern, expected) => {
    using dir = tempDir("glob-scan-explicit-dot", files);
    const result = Array.from(new Glob(pattern).scanSync({ cwd: String(dir) }));
    expect(norm(result)).toEqual(expected.sort());
  });

  test.each([
    ["*", ["visible.txt"]],
    ["*.txt", ["visible.txt"]],
    ["*/inner.txt", []],
    ["**/inner.txt", []],
    ["**/*.txt", ["visible.txt", "sub/visible.txt"]],
  ])("wildcard pattern %j still hides dotfiles by default", (pattern, expected) => {
    using dir = tempDir("glob-scan-wildcard-dot", files);
    const result = Array.from(new Glob(pattern).scanSync({ cwd: String(dir) }));
    expect(norm(result)).toEqual(expected.sort());
  });

  test("async scan finds explicitly-named dotfiles", async () => {
    using dir = tempDir("glob-scan-explicit-dot-async", files);
    const result = await Array.fromAsync(new Glob(".dotdir/inner.txt").scan({ cwd: String(dir) }));
    expect(norm(result)).toEqual([".dotdir/inner.txt"]);
  });
});

// Directory entries on Linux are bytes that need not be valid UTF-8. The
// matcher must step over them in the same units the returned names use (one
// U+FFFD per maximal ill-formed subpart), not by the lead byte's nominal
// length, or `?` and `*` step into the next character or past the end.
describe.skipIf(!isLinux)("scan over entry names that are not valid UTF-8", () => {
  let dir: string;
  beforeAll(() => {
    dir = String(tempDir("glob-scan-invalid-utf8", {}));
    // Bytes after "t": `\xc3 x`, `\xe4\xb8 .js`, `é \xc3`, `😀 js`, `x \x80`, `\xed\xa0\x80` (a WTF-8 surrogate).
    for (const hex of ["c378", "e4b82e6a73", "c3a9c3", "f09f98806a73", "7880", "eda080"]) {
      fs.writeFileSync(Buffer.concat([Buffer.from(dir + "/t"), Buffer.from(hex, "hex")]), "");
    }
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const scan = (pattern: string) => [...new Glob(pattern).scanSync({ cwd: dir })].sort();
  const all = ["t\uFFFDx", "t\uFFFD.js", "té\uFFFD", "t😀js", "tx\uFFFD", "t\uFFFD\uFFFD\uFFFD"];

  test.each([
    ["*", all],
    ["t*", all],
    ["t?", []],
    ["t??", ["t\uFFFDx", "té\uFFFD", "tx\uFFFD"]],
    ["t???", ["t😀js", "t\uFFFD\uFFFD\uFFFD"]],
    ["t????", ["t\uFFFD.js"]],
    ["t*.js", ["t\uFFFD.js"]],
    ["t?.js", ["t\uFFFD.js"]],
    ["t*s", ["t\uFFFD.js", "t😀js"]],
    ["t[!a-z]x", ["t\uFFFDx"]],
    ["t[\uFFFD]*", ["t\uFFFDx", "t\uFFFD.js", "t\uFFFD\uFFFD\uFFFD"]],
  ] as [string, string[]][])("%j", (pattern, expected) => {
    expect(scan(pattern)).toEqual([...expected].sort());
    // Wildcards and classes see the raw bytes the way match() sees the decoded
    // name. (A literal U+FFFD in a pattern still compares bytes, since the
    // decode is lossy.)
    expect(scan(pattern)).toEqual(scan("*").filter(name => new Glob(pattern).match(name)));
  });
});

// `followSymlinks` controls whether wildcard traversal descends through
// symlinked directories. A segment that names the symlink literally is an
// explicit path the user wrote; it should resolve regardless, matching
// fast-glob and bash.
const canCreateDirSymlink = (() => {
  using probe = tempDir("glob-scan-symlink-probe", { "target/x": "" });
  try {
    fs.symlinkSync("target", path.join(String(probe), "link"), "dir");
    return true;
  } catch (err: any) {
    if (err.code === "EPERM" || err.code === "EACCES") return false;
    throw err;
  }
})();

describe.skipIf(!canCreateDirSymlink)("literal path segment through a symlinked directory", () => {
  const norm = (a: string[]) => a.map(p => p.replaceAll("\\", "/")).sort();

  function makeTree(prefix: string) {
    const dir = tempDir(prefix, {
      "realdir/file.txt": "x",
      "realdir/nested/deep.txt": "x",
      "plain/file.txt": "x",
    });
    fs.symlinkSync("realdir", path.join(String(dir), "linkdir"), "dir");
    return dir;
  }

  test("literal segment resolves through a symlink with followSymlinks:false", () => {
    using dir = makeTree("glob-scan-symlink-literal");
    const cwd = String(dir);
    const scan = (p: string) => norm(Array.from(new Glob(p).scanSync({ cwd, followSymlinks: false })));

    expect(scan("linkdir/file.txt")).toEqual(["linkdir/file.txt"]);
    expect(scan("linkdir/*.txt")).toEqual(["linkdir/file.txt"]);
    expect(scan("linkdir/nested/deep.txt")).toEqual(["linkdir/nested/deep.txt"]);
    expect(scan("linkdir/**/*.txt")).toEqual(["linkdir/file.txt", "linkdir/nested/deep.txt"]);
  });

  test("wildcard segment still respects followSymlinks:false", () => {
    using dir = makeTree("glob-scan-symlink-wildcard");
    const cwd = String(dir);
    const scan = (p: string) => norm(Array.from(new Glob(p).scanSync({ cwd, followSymlinks: false })));

    expect(scan("*/file.txt")).toEqual(["plain/file.txt", "realdir/file.txt"]);
    expect(scan("**/file.txt")).toEqual(["plain/file.txt", "realdir/file.txt"]);
    expect(scan("link*/file.txt")).toEqual([]);
  });

  test("followSymlinks:true still traverses via wildcards", () => {
    using dir = makeTree("glob-scan-symlink-follow");
    const cwd = String(dir);
    const scan = (p: string) => norm(Array.from(new Glob(p).scanSync({ cwd, followSymlinks: true })));

    expect(scan("*/file.txt")).toEqual(["linkdir/file.txt", "plain/file.txt", "realdir/file.txt"]);
    expect(scan("linkdir/file.txt")).toEqual(["linkdir/file.txt"]);
  });

  // The SymLink (and DT_UNKNOWN) readdir arms pre-filter entries through
  // eval_impl before eval_dir runs. eval_impl must therefore admit the same
  // `**/.X` peek that eval_dir does, or a symlinked `.dotdir` (and a real
  // `.dotdir` reported as DT_UNKNOWN on NFS/overlayfs/FUSE) would be dropped
  // before the explicit-dot logic ever sees it.
  test("**/.dotdir peek works when .dotdir is a symlink", () => {
    using dir = tempDir("glob-scan-symlink-dotdir", {
      "realdir/inner.txt": "x",
    });
    fs.symlinkSync("realdir", path.join(String(dir), ".dotdir"), "dir");
    const cwd = String(dir);
    const scan = (p: string, opts: GlobScanOptions) => norm(Array.from(new Glob(p).scanSync({ cwd, ...opts })));

    expect(scan("**/.dotdir/inner.txt", { followSymlinks: true })).toEqual([".dotdir/inner.txt"]);
    expect(scan(".dotdir/inner.txt", { followSymlinks: true })).toEqual([".dotdir/inner.txt"]);
    expect(scan(".dotdir/inner.txt", { followSymlinks: false })).toEqual([".dotdir/inner.txt"]);
  });

  test("symlink cycles do not loop when reached via a literal segment", () => {
    using dir = tempDir("glob-scan-symlink-cycle", {
      "top/file.txt": "x",
    });
    fs.symlinkSync(".", path.join(String(dir), "top", "loop"), "dir");
    // `top` is reached literally; the `loop -> .` symlink inside is only ever
    // reached via `**`, which must not follow it with followSymlinks:false.
    const result = norm(Array.from(new Glob("top/**/*.txt").scanSync({ cwd: String(dir), followSymlinks: false })));
    expect(result).toEqual(["top/file.txt"]);
  });

  test("** with followSymlinks does not descend into a symlink that resolves to one of its own ancestors", () => {
    using dir = tempDir("glob-scan-symlink-self-cycle", {
      "top/file.txt": "x",
    });
    fs.symlinkSync(".", path.join(String(dir), "top", "loop"), "dir");
    const cwd = path.join(String(dir), "top");
    const result = norm(Array.from(new Glob("**/*.txt").scanSync({ cwd, followSymlinks: true })));
    expect(result).toEqual(["file.txt", "loop/file.txt"]);

    using shared = tempDir("glob-scan-symlink-shared-target", {
      "realdir/file.txt": "x",
    });
    fs.symlinkSync("realdir", path.join(String(shared), "linkA"), "dir");
    fs.symlinkSync("realdir", path.join(String(shared), "linkB"), "dir");
    const dag = norm(Array.from(new Glob("**/*.txt").scanSync({ cwd: String(shared), followSymlinks: true })));
    expect(dag).toEqual(["linkA/file.txt", "linkB/file.txt", "realdir/file.txt"]);
  });

  // Symlinks to the same target in *different* subtrees are not a cycle: a
  // followed link recorded in one subtree must not suppress its cousin.
  test("** with followSymlinks descends cousin symlinks that share a target", () => {
    using dir = tempDir("glob-scan-symlink-cousins", {
      "shared/file.txt": "x",
      "a/keep.txt": "x",
      "b/keep.txt": "x",
    });
    fs.symlinkSync(path.join("..", "shared"), path.join(String(dir), "a", "link"), "dir");
    fs.symlinkSync(path.join("..", "shared"), path.join(String(dir), "b", "link"), "dir");
    const result = norm(Array.from(new Glob("**/*.txt").scanSync({ cwd: String(dir), followSymlinks: true })));
    expect(result).toEqual(["a/keep.txt", "a/link/file.txt", "b/keep.txt", "b/link/file.txt", "shared/file.txt"]);
  });

  test("async ** with followSymlinks does not descend into a symlink that resolves to one of its own ancestors", async () => {
    using dir = tempDir("glob-scan-symlink-self-cycle-async", {
      "top/file.txt": "x",
    });
    fs.symlinkSync(".", path.join(String(dir), "top", "loop"), "dir");
    const cwd = path.join(String(dir), "top");
    const result = await Array.fromAsync(new Glob("**/*.txt").scan({ cwd, followSymlinks: true }));
    expect(norm(result)).toEqual(["file.txt", "loop/file.txt"]);
  });

  test("async scan resolves a literal path through a symlink", async () => {
    using dir = makeTree("glob-scan-symlink-literal-async");
    const result = await Array.fromAsync(
      new Glob("linkdir/file.txt").scan({ cwd: String(dir), followSymlinks: false }),
    );
    expect(norm(result)).toEqual(["linkdir/file.txt"]);
  });
});

// A directory the user can read but not write (RX-only grant) must still be
// descended by the scanner: directory opens used to request FILE_ADD_FILE and
// fail ACCESS_DENIED there. Elevated tokens bypass the ACL; the precondition
// is probed and the test skips visibly then.
let roDirRoot = "";
let roDirA = "";
let roDirEnforced = false;
if (isWindows) {
  try {
    roDirRoot = tempDirWithFiles("glob-scan-readonly-dir", {
      "a/b/file.txt": "under a read-only directory",
    });
    roDirA = path.join(roDirRoot, "a");
    execSync(`icacls "${roDirA}" /inheritance:r /grant:r "${process.env.USERNAME}:(OI)(CI)(RX)" /Q`);
    try {
      fs.mkdirSync(path.join(roDirA, "probe"));
      // Creation succeeded: ACL not enforced under this token — restore and skip.
      execSync(`icacls "${roDirA}" /reset /T /Q`);
    } catch {
      roDirEnforced = true;
    }
  } catch {}
}

afterAll(() => {
  if (!roDirA) return;
  try {
    execSync(`icacls "${roDirA}" /reset /T /Q`);
  } catch {}
  try {
    fs.rmSync(roDirRoot, { recursive: true, force: true });
  } catch {}
});

describe("extglob and brace sequences", () => {
  const scan = (pattern: string, cwd: string) =>
    Array.from(new Glob(pattern).scanSync({ cwd }))
      .map(p => p.replaceAll("\\", "/"))
      .sort();

  test("scan finds the same files that match accepts", () => {
    using dir = tempDir("glob-extglob", {
      "a.js": "",
      "b.js": "",
      "c.js": "",
      "a.test.js": "",
      "1.txt": "",
      "2.txt": "",
      "3.txt": "",
      "a/x.js": "",
      "b/x.js": "",
      "ab/x.js": "",
      "c/x.js": "",
      "app/(marketing)/page.js": "",
      "app/marketing/page.js": "",
    });
    const cwd = String(dir);
    expect(scan("@(a|b).js", cwd)).toEqual(["a.js", "b.js"]);
    expect(scan("+(a|b).js", cwd)).toEqual(["a.js", "b.js"]);
    expect(scan("!(a|b).js", cwd)).toEqual(["a.test.js", "c.js"]);
    expect(scan("*.@(txt|md)", cwd)).toEqual(["1.txt", "2.txt", "3.txt"]);
    expect(scan("{1..2}.txt", cwd)).toEqual(["1.txt", "2.txt"]);
    expect(scan("@(a|b)/*.js", cwd)).toEqual(["a/x.js", "b/x.js"]);
    expect(scan("+(a|b)/*.js", cwd)).toEqual(["a/x.js", "ab/x.js", "b/x.js"]);
    expect(scan("**/!(x|page).js", cwd)).toEqual(["a.js", "a.test.js", "b.js", "c.js"]);
    expect(scan("app/(marketing)/*.js", cwd)).toEqual(["app/(marketing)/page.js"]);
    expect(scan("app/(marketing)/**", cwd)).toEqual(["app/(marketing)/page.js"]);
  });
});

// A group with a `/` inside it, or with a `**` as an alternative, matches more than one directory level:
// `src/{a,b/c}/index.ts` names `src/a/index.ts` and `src/b/c/index.ts`. From that path segment on, the scan lists what match() accepts.
describe("a group that crosses a path separator", () => {
  const norm = (paths: string[]) => paths.map(p => p.replaceAll("\\", "/")).sort();
  const scan = (pattern: string, cwd: string, opts: GlobScanOptions = {}) =>
    norm([...new Glob(pattern).scanSync({ cwd, ...opts })]);
  const tree = (prefix: string, files: string[]) => tempDir(prefix, Object.fromEntries(files.map(f => [f, ""])));
  const repeated = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();
  const files = [
    "src/a/index.ts",
    "src/b/c/index.ts",
    "src/index.ts",
    "svc/src/env.ts",
    "svc/env.ts",
    "packages/app/src/index.ts",
    "packages/lib/index.ts",
    "README.md",
    "x.js",
    "a/x.js",
    "a/a/x.js",
  ];
  const underSrc = ["src/a/index.ts", "src/b/c/index.ts", "src/index.ts"];

  // [pattern, what it lists]
  const rows: [string, string[]][] = [
    // oven-sh/bun#32596
    ["src/{a,b/c}/index.ts", ["src/a/index.ts", "src/b/c/index.ts"]],
    ["svc/{src/env.ts,env.ts}", ["svc/env.ts", "svc/src/env.ts"]],
    ["{packages/app/src,src}/index.ts", ["packages/app/src/index.ts", "src/index.ts"]],
    ["{svc/env.ts,README.md}", ["README.md", "svc/env.ts"]],
    // oven-sh/bun#24000
    ["{*/*}", ["a/x.js", "src/index.ts", "svc/env.ts"]],
    ["src/@(a|b/c)/index.ts", ["src/a/index.ts", "src/b/c/index.ts"]],
    ["@(a/x|a/a/x).js", ["a/a/x.js", "a/x.js"]],
    ["@(packages/app/src|src)/index.ts", ["packages/app/src/index.ts", "src/index.ts"]],
    // A group in a group.
    ["{packages/{app/src,lib},src}/index.ts", ["packages/app/src/index.ts", "packages/lib/index.ts", "src/index.ts"]],
    ["{packages/@(app/src|lib),src}/index.ts", ["packages/app/src/index.ts", "packages/lib/index.ts", "src/index.ts"]],
    // Two groups.
    ["{src,svc}/{a/index.ts,env.ts}", ["src/a/index.ts", "svc/env.ts"]],
    ["{a,a/a}/?(x.js|zz/y)", ["a/a/x.js", "a/x.js"]],
    // A group that starts or ends inside a path segment.
    ["s{rc/a,vc/src}/*.ts", ["src/a/index.ts", "svc/src/env.ts"]],
    ["sr{c/a/in,c/in}dex.ts", ["src/a/index.ts", "src/index.ts"]],
    ["{*.md,src/**/*.ts}", ["README.md", ...underSrc]],
    ["{*,svc/**/*}.{md,ts}", ["README.md", "svc/env.ts", "svc/src/env.ts"]],
    // A `**` in an alternative, and an alternative that is a `**`.
    ["{src/**,svc/**}", [...underSrc, "svc/env.ts", "svc/src/env.ts"]],
    ["src/{a,b/**}/index.ts", ["src/a/index.ts", "src/b/c/index.ts"]],
    ["**/{b/c,a}/*.ts", ["src/a/index.ts", "src/b/c/index.ts"]],
    ["src/{**,zzz}/index.ts", underSrc],
    ["{**,a}/x.js", ["a/a/x.js", "a/x.js", "x.js"]],
    // An optional group, and an alternative that ends with a separator.
    ["src/?(b/c/)index.ts", ["src/b/c/index.ts", "src/index.ts"]],
    ["?(svc/)src/*.ts", ["src/index.ts", "svc/src/env.ts"]],
    ["?(a/)x.js", ["a/x.js", "x.js"]],
    ["src{,/a}/index.ts", ["src/a/index.ts", "src/index.ts"]],
    ["{src/,svc/src/}*.ts", ["src/index.ts", "svc/src/env.ts"]],
    // An empty alternative leaves `src//index.ts`, and match() does not take `src/index.ts` for that.
    ["src/{,b/c}/index.ts", ["src/b/c/index.ts"]],
    // One alternative is a group too.
    ["{src/*.ts}", ["src/index.ts"]],
    ["svc/{src/env.ts}", ["svc/src/env.ts"]],
    // A group that repeats.
    ["+(a/)x.js", ["a/a/x.js", "a/x.js"]],
    ["*(a/)x.js", ["a/a/x.js", "a/x.js", "x.js"]],
    ["a/+(a/)x.js", ["a/a/x.js"]],
    ["src/*(b/|c/)index.ts", ["src/b/c/index.ts", "src/index.ts"]],
    ["**/+(a/)x.js", ["a/a/x.js", "a/x.js"]],
    // `!(a/b)` takes one name. It leaves out the paths that `a/b` and the rest of the pattern match.
    ["!(a/b)/index.ts", ["src/index.ts"]],
    ["src/!(b/c)/index.ts", ["src/a/index.ts"]],
    [
      "!(src/a)/**/index.ts",
      ["packages/app/src/index.ts", "packages/lib/index.ts", "src/b/c/index.ts", "src/index.ts"],
    ],
    ["!(a/a)/**/*.js", ["a/x.js"]],
    ["{src/!(b/c),zz}/index.ts", ["src/a/index.ts"]],
    // Only the group inside has the separator.
    ["{{src/a,zz},svc}/*.ts", ["src/a/index.ts", "svc/env.ts"]],
    // With a `**` before the group, the tail starts at the `**`.
    ["src/**/{b/c,a}/*.ts", ["src/a/index.ts", "src/b/c/index.ts"]],
  ];

  describe.each(["scanSync", "scan"] as const)("%s", method => {
    test.each(rows)("%j", async (pattern, expected) => {
      using dir = tree("glob-scan-group-separator", files);
      const cwd = String(dir);
      const glob = new Glob(pattern);
      const listed = method === "scan" ? norm(await Array.fromAsync(glob.scan({ cwd }))) : scan(pattern, cwd);
      expect(listed).toEqual(expected);
      // match() accepts these files of the tree, and no other.
      expect(files.filter(file => glob.match(file)).sort()).toEqual(expected);
    });
  });

  test.each([
    ["+(a/)*", { onlyFiles: false }, ["a/a", "a/a/x.js", "a/x.js"]],
    ["{src/a,svc/src}", { onlyFiles: false }, ["src/a", "svc/src"]],
    ["{src/b,svc}/*", { onlyFiles: false }, ["src/b/c", "svc/env.ts", "svc/src"]],
    // A pattern that ends with a separator lists only directories, as without the group.
    ["src/{a,b/c}/", { onlyFiles: false }, ["src/a", "src/b/c"]],
    ["src/{a,b/c}/", {}, []],
    // A separator that ends an alternative is no such rule: match() accepts `svc/`, and no entry has that path.
    ["{svc/,src/*}", { onlyFiles: false }, ["src/a", "src/b", "src/index.ts"]],
    ["src/?(b/c/)", { onlyFiles: false }, []],
    // A `*` does not match a name that starts with `.`, and a name that is written out does.
    ["+(*/)x.js", {}, ["a/a/x.js", "a/x.js"]],
    ["+(*/)x.js", { dot: true }, [".a/.a/x.js", ".a/x.js", "a/a/x.js", "a/x.js"]],
    ["+(.a/)x.js", {}, [".a/.a/x.js", ".a/x.js"]],
    ["{.a/.a,a}/*.js", {}, [".a/.a/x.js", "a/x.js"]],
    ["{.a,a,svc/s}x.js", {}, []],
    ["{.a/x,x}.js", {}, [".a/x.js", "x.js"]],
  ] as [string, GlobScanOptions, string[]][])("%j with %j", (pattern, opts, expected) => {
    using dir = tree("glob-scan-group-options", [...files, ".a/x.js", ".a/.a/x.js"]);
    expect(scan(pattern, String(dir), opts)).toEqual(expected);
  });

  // What is before the group does not change what the group matches. With `absolute`, a `.` or `..` is not in the paths.
  test.each([
    ["src/{a,b/c}/index.ts", ["src/a/index.ts", "src/b/c/index.ts"], ["src/a/index.ts", "src/b/c/index.ts"]],
    ["./{src/a,svc}/*.ts", ["./src/a/index.ts", "./svc/env.ts"], ["src/a/index.ts", "svc/env.ts"]],
    ["./*(a/)x.js", ["./a/a/x.js", "./a/x.js", "./x.js"], ["a/a/x.js", "a/x.js", "x.js"]],
    ["src/../+(a/)x.js", ["src/../a/a/x.js", "src/../a/x.js"], ["a/a/x.js", "a/x.js"]],
    ["*/{a,b/c}/index.ts", ["src/a/index.ts", "src/b/c/index.ts"], ["src/a/index.ts", "src/b/c/index.ts"]],
    ["**/a/*(a/)x.js", ["a/a/x.js", "a/x.js"], ["a/a/x.js", "a/x.js"]],
    ["./**/{b/c,a}/*.ts", ["./src/a/index.ts", "./src/b/c/index.ts"], ["src/a/index.ts", "src/b/c/index.ts"]],
  ])("after %j, and with absolute: true", (pattern, relative, absolute) => {
    using dir = tree("glob-scan-group-prefix", files);
    const cwd = String(dir).replaceAll("\\", "/");
    expect(scan(pattern, String(dir))).toEqual(relative);
    expect(scan(pattern, String(dir), { absolute: true })).toEqual(absolute.map(it => `${cwd}/${it}`));
  });

  test("an absolute pattern", () => {
    using dir = tree("glob-scan-group-separator", files);
    const cwd = String(dir).replaceAll("\\", "/");
    const expected = [`${cwd}/src/a/index.ts`, `${cwd}/src/b/c/index.ts`];
    expect(scan(`${cwd}/src/{a,b/c}/index.ts`, String(dir))).toEqual(expected);
    expect(scan(`${cwd}/{src/a,src/b/c}/*.ts`, String(dir))).toEqual(expected);
  });

  test("a class is read before a group", () => {
    using dir = tree("glob-scan-group-class", ["ax/y", "bx/y", "c/d"]);
    // `[!]{]` is one class: not `]` and not `{`.
    expect(scan("[!]{]x/y", String(dir))).toEqual(["ax/y", "bx/y"]);
    expect(scan("[a{]x/{y,z/w}", String(dir))).toEqual(["ax/y"]);
  });

  // In a group, a class or an escape that matches a separator is for the matcher, as a separator is.
  test.each([
    ["{a[/]b,c}/d", ["a/b/d", "c/d"]],
    ["{a[/]b,c/e}/d", ["a/b/d", "c/e/d"]],
    ...(isWindows ? [] : ([["{a\\/b,c}/d", ["a/b/d", "c/d"]]] as [string, string[]][])),
  ] as [string, string[]][])("%j", (pattern, expected) => {
    const all = ["a/b/d", "c/d", "c/e/d", "ax/d"];
    using dir = tree("glob-scan-group-class", all);
    expect(scan(pattern, String(dir))).toEqual(expected);
    expect(all.filter(file => new Glob(pattern).match(file)).sort()).toEqual(expected);
  });

  test.skipIf(isWindows)(
    "outside a group, a separator in a class or after a `\\` ends a path segment as before",
    () => {
      // These are the paths that a cut at each `/` names. match() accepts `a/b/d` for both patterns: that is not decided here.
      using dir = tree("glob-scan-group-class", ["a[/]b/d", "a\\/b/d", "a/b/d"]);
      expect([...new Glob("a[/]b/d").scanSync({ cwd: String(dir) })]).toEqual(["a[/]b/d"]);
      expect([...new Glob("a\\/b/d").scanSync({ cwd: String(dir) })]).toEqual(["a\\/b/d"]);
    },
  );

  // The splitter reads each of these brackets as the matcher does, or it cuts the group.
  test.each([
    // A closer of the other kind closes nothing.
    ["{a)/b,c}", ["a)/b", "c"]],
    // More open groups than the splitter counts.
    [`@(${repeated("{", 64)}a${repeated("}", 64)}/x|c)`, ["a/x", "c"]],
    // A `]` that is first in a class is a member, also after a `!`.
    ["{[]/]x,k}", ["]x", "k"]],
    ["{[!]/]x,k}", ["k", "qx"]],
    ...(isWindows ? [] : ([["{[\\]/]x,k}", ["]x", "k"]]] as [string, string[]][])),
  ] as [string, string[]][])("%j", (pattern, expected) => {
    const all = ["a)/b", "c", "a/x", "]x", "k", "qx"];
    using dir = tree("glob-scan-group-brackets", all);
    expect(scan(pattern, String(dir))).toEqual(expected);
    expect(all.filter(file => new Glob(pattern).match(file)).sort()).toEqual(expected);
  });

  test("an empty path segment is dropped, as without the group", () => {
    using dir = tree("glob-scan-group-separator", files);
    const expected = ["src/a/index.ts", "src/b/c/index.ts"];
    expect(scan("src//{a,b/c}/index.ts", String(dir))).toEqual(expected);
    expect(scan("src/{a,b/c}//index.ts", String(dir))).toEqual(expected);
    expect(scan("src/{a,b/c}//", String(dir), { onlyFiles: false })).toEqual(["src/a", "src/b/c"]);
    expect(scan("src/{a,b}//index.ts", String(dir))).toEqual(["src/a/index.ts"]);
  });

  test("a `!` after a separator is a plain character in the tail", () => {
    const all = ["y/plain", "y/other/q", "y/xa/q", "y/xb", "y/!xa/q", "y/!xb", "y/!!za/q", "y/!!zb"];
    using dir = tree("glob-scan-group-bang", all);
    for (const [pattern, expected] of [
      ["y/!x{a/q,b}", ["y/!xa/q", "y/!xb"]],
      ["y/!!z{a/q,b}", ["y/!!za/q", "y/!!zb"]],
    ] as [string, string[]][]) {
      expect(scan(pattern, String(dir))).toEqual(expected);
      expect(all.filter(file => new Glob(pattern).match(file)).sort()).toEqual(expected);
    }
  });

  // A `!` that starts the pattern negates all of it, as for match(). The scan then reads every directory.
  test("a pattern that starts with `!`", () => {
    const all = [...files, ".h/x.js", "a/.h/x.js", "b/c/x.js"];
    using dir = tree("glob-scan-group-negated", all);
    const cwd = String(dir);
    const others = all.filter(file => file !== "a/x.js" && file !== "b/c/x.js").sort();
    expect(scan("!{a,b/c}/x.js", cwd, { dot: true })).toEqual(others);
    expect(others).toEqual(all.filter(file => new Glob("!{a,b/c}/x.js").match(file)).sort());
    // Without `dot`, a name that starts with a dot is not listed, and the scan does not go into such a directory.
    expect(scan("!{a,b/c}/x.js", cwd)).toEqual(others.filter(file => !file.includes(".h/")));
    expect(scan("!!{a,b/c}/x.js", cwd)).toEqual(["a/x.js", "b/c/x.js"]);
    // Before the tail, a `!` negates one name, as without the group: any directory but `src`.
    expect(scan("!src/{a,b/c}/x.js", cwd)).toEqual(["a/a/x.js"]);
    expect(scan("src/!{a,b/c}/x.js", cwd)).toEqual([]);
  });

  // The same construct in a path segment of its own and in the tail. The first is how the walker reads one path segment, which
  // is older than the tail and not decided here. The second is how the matcher reads it: but for the empty segment, it is what
  // match() accepts.
  test.skipIf(isWindows).each([
    ["a/\\x.js", [], "{a,zz/y}/\\x.js", ["a/x.js"]],
    ["\\(g\\)/y.js", [], "{\\(g\\)/y,zz/y}.js", ["(g)/y.js"]],
    ["a/*.\\js", [], "{a,zz/y}/*.\\js", ["a/x.js"]],
    ["a\\/b/d", [], "{a\\/b,zz/y}/d", ["a/b/d"]],
    ["a[/]b/d", [], "{a[/]b,zz/y}/d", ["a/b/d"]],
    ["a[.-0]b/d", [], "{a[.-0]b,zz/y}/d", ["a/b/d"]],
    ["a/*[!z]c/x.js", [], "{a,zz/y}/*[!z]c/x.js", ["a/b/c/x.js"]],
    ["!x.js", ["README.md"], "{!x.js,zz/y}", []],
    ["a/!b/x.js", ["a/!b/x.js", "a/.h/x.js"], "{a,zz/y}/!b/x.js", ["a/!b/x.js"]],
    ["a//x.js", ["a/x.js"], "{a,zz/y}//x.js", ["a/x.js"]],
    ["a/x.js/", ["a/x.js"], "{a,zz/y}/x.js/", []],
    ["a/{.h,zz}/x.js", [], "{a,zz/y}/{.h,zz}/x.js", ["a/.h/x.js"], { dot: false }],
    ["{.h,a}/x.js", ["a/x.js"], "{.h/x,a/x}.js", [".h/x.js", "a/x.js"], { dot: false }],
  ] as [string, string[], string, string[], GlobScanOptions?][])(
    "%j lists %j, and %j lists %j",
    (segment, fromSegment, inTail, fromTail, opts = { dot: true }) => {
      const all = ["a/x.js", "(g)/y.js", "a/b/d", "a/b/c/x.js", "a/b/x.js", "a/!b/x.js", "a/.h/x.js", ".h/x.js"];
      using dir = tree("glob-scan-group-pairs", [...all, "README.md", "x.js"]);
      expect(scan(segment, String(dir), opts)).toEqual(fromSegment);
      expect(scan(inTail, String(dir), opts)).toEqual(fromTail);
    },
  );

  // The matcher takes a `**` right after a group for a `*`: a separator is not before it in the text of the pattern. So each of
  // these lists less than its alternatives written out list, which is what Node lists. The rows are here to change with the matcher.
  test.failing.each([
    ["{src/,svc/}**/*.ts", [...underSrc, "svc/env.ts", "svc/src/env.ts"]],
    ["{src/,svc/}**", [...underSrc, "svc/env.ts", "svc/src/env.ts"]],
    ["src/{b/,}**/index.ts", underSrc],
  ] as [string, string[]][])("%j lists what its alternatives list", (pattern, expected) => {
    using dir = tree("glob-scan-group-separator", files);
    expect(scan(pattern, String(dir))).toEqual(expected);
  });

  test("two alternatives that are the same give each path once", () => {
    using dir = tree("glob-scan-group-separator", files);
    expect([...new Glob("{src/a,src/a}/index.ts").scanSync({ cwd: String(dir) })]).toHaveLength(1);
    expect([...new Glob("src/{a/index.ts,*/index.ts}").scanSync({ cwd: String(dir) })]).toHaveLength(1);
  });

  test("a cwd that does not exist is an error", () => {
    using dir = tree("glob-scan-group-separator", files);
    const cwd = path.join(String(dir), "missing");
    expect(() => [...new Glob("{src/a,svc}/*.ts").scanSync({ cwd })]).toThrow(
      expect.objectContaining({ code: "ENOENT" }),
    );
  });

  test.skipIf(!isWindows)("a backslash is a separator in a group too", () => {
    using dir = tree("glob-scan-group-separator", files);
    expect(scan("src\\{a,b\\c}\\index.ts", String(dir))).toEqual(["src/a/index.ts", "src/b/c/index.ts"]);
    expect(scan("@(packages\\app\\src|src)\\index.ts", String(dir))).toEqual([
      "packages/app/src/index.ts",
      "src/index.ts",
    ]);
    // An absolute pattern keeps its separators in what it lists, as without a separator in the group.
    const raw = (pattern: string) => [...new Glob(pattern).scanSync({ cwd: String(dir) })].sort();
    const [inA] = raw(`${String(dir)}\\src\\{a,b}\\index.ts`);
    expect(inA.endsWith("\\src\\a\\index.ts")).toBe(true);
    expect(raw(`${String(dir)}\\src\\{a,b\\c}\\index.ts`)).toEqual(
      [inA, inA.replace("\\a\\index.ts", "\\b\\c\\index.ts")].sort(),
    );
  });

  test("a name that an alternative spells out is explicit", () => {
    using dir = tree("glob-scan-group-dot", [...files, ".github/workflows/ci.yml", ".vscode/x.json"]);
    // `.github` starts with a dot in the pattern, so `dot: true` is not necessary. A `*` still skips `.vscode`.
    expect(scan("{.github/workflows,src}/*", String(dir))).toEqual([".github/workflows/ci.yml", "src/index.ts"]);
    expect(scan("{.github/workflows,*}/*.{yml,json}", String(dir))).toEqual([".github/workflows/ci.yml"]);
    expect(scan("{.vscode,.github/workflows}/*", String(dir))).toEqual([".github/workflows/ci.yml", ".vscode/x.json"]);
  });

  describe.skipIf(!canCreateDirSymlink)("symlinks", () => {
    function makeTree() {
      const dir = tree("glob-scan-group-symlink", ["real/file.txt", "plain/file.txt", "f.txt"]);
      fs.symlinkSync("real", path.join(String(dir), "dirlink"), "dir");
      fs.symlinkSync("f.txt", path.join(String(dir), "filelink"), "file");
      fs.symlinkSync("missing", path.join(String(dir), "broken"), "file");
      return dir;
    }

    test.each([
      // A name inside a group is not a literal component: the link is followed only with followSymlinks.
      ["{dirlink/file.txt,plain/*.txt}", {}, ["plain/file.txt"]],
      ["{dirlink/file.txt,plain/*.txt}", { followSymlinks: true }, ["dirlink/file.txt", "plain/file.txt"]],
      ["{*/file.txt,zz/y}", {}, ["plain/file.txt", "real/file.txt"]],
      ["{*/file.txt,zz/y}", { followSymlinks: true }, ["dirlink/file.txt", "plain/file.txt", "real/file.txt"]],
      // A link that is not followed is an entry like any other.
      ["{dirlink/file.txt,*}", {}, ["f.txt"]],
      ["{dirlink/file.txt,*}", { onlyFiles: false }, ["broken", "dirlink", "f.txt", "filelink", "plain", "real"]],
      ["{filelink/x,*link}", { onlyFiles: false }, ["dirlink", "filelink"]],
      ["{filelink,plain/*}", { followSymlinks: true }, ["filelink", "plain/file.txt"]],
    ] as [string, GlobScanOptions, string[]][])("%j with %j", (pattern, opts, expected) => {
      using dir = makeTree();
      expect(scan(pattern, String(dir), opts)).toEqual(expected);
    });

    // A name after the group is in the tail too. It is no literal component, so a link with that name is followed only with
    // followSymlinks. `{a,b}/lnkdir/x.ts` lists `a/lnkdir/x.ts` without it.
    const follow = { followSymlinks: true };
    const strict = { followSymlinks: true, throwErrorOnBrokenSymlink: true };
    const both = (name: string) => [`a/${name}`, `b/c/${name}`];
    test.each([
      ["{a,b/c}/lnkdir/x.ts", {}, []],
      ["{a,b/c}/lnkdir/x.ts", follow, both("lnkdir/x.ts")],
      ["{a,b/c}/lnkdir/x.ts", { onlyFiles: false }, []],
      ["{a,b/c}/lnkdir/x.ts", strict, both("lnkdir/x.ts")],
      ["{a,b/c}/lnkfile", {}, []],
      ["{a,b/c}/lnkfile", follow, both("lnkfile")],
      ["{a,b/c}/lnkfile", { onlyFiles: false }, both("lnkfile")],
      ["{a,b/c}/lnkfile", strict, both("lnkfile")],
      ["{a,b/c}/dangling", {}, []],
      ["{a,b/c}/dangling", follow, []],
      ["{a,b/c}/dangling", { onlyFiles: false }, both("dangling")],
      ["{a,b/c}/dangling", strict, "ENOENT"],
      // The tail starts at a `**` before the group, so a name between the two is in the tail as well.
      ["**/lnk/{a/b,c}/y.ts", {}, []],
      ["**/lnk/{a/b,c}/y.ts", follow, ["q/lnk/a/b/y.ts", "q/lnk/c/y.ts"]],
    ] as [string, GlobScanOptions, string[] | string][])("after the group: %j with %j", (pattern, opts, expected) => {
      const plain = ["a/real/x.ts", "b/c/real/x.ts", "a/f.ts", "b/c/f.ts", "q/real/a/b/y.ts", "q/real/c/y.ts"];
      using dir = tree("glob-scan-group-symlink", plain);
      fs.symlinkSync("real", path.join(String(dir), "q/lnk"), "dir");
      for (const parent of ["a", "b/c"]) {
        fs.symlinkSync("real", path.join(String(dir), parent, "lnkdir"), "dir");
        fs.symlinkSync("f.ts", path.join(String(dir), parent, "lnkfile"), "file");
        fs.symlinkSync("missing", path.join(String(dir), parent, "dangling"), "file");
      }
      if (typeof expected === "string") {
        expect(() => scan(pattern, String(dir), opts)).toThrow(expect.objectContaining({ code: expected }));
      } else {
        expect(scan(pattern, String(dir), opts)).toEqual(expected);
      }
    });
  });

  // The scan opens a directory only if a path below it can match. So a directory that it cannot read is no error.
  test.skipIf(isWindows || isRoot).each([
    ["src/{a,b/c}/index.ts", "src/b/locked", ["src/a/index.ts", "src/b/c/index.ts"]],
    ["src/@(a|b/c)/index.ts", "src/b/locked", ["src/a/index.ts", "src/b/c/index.ts"]],
    ["src/{a,b/**}/index.ts", "src/a/locked", ["src/a/index.ts", "src/b/c/index.ts"]],
    ["{src/a,svc}/*.ts", "svc/locked", ["src/a/index.ts", "svc/env.ts"]],
    ["{src/a,svc}/*.ts", "locked", ["src/a/index.ts", "svc/env.ts"]],
    ["{packages/app/src,src}/index.ts", "packages/locked", ["packages/app/src/index.ts", "src/index.ts"]],
    ["+(a/)x.js", "a/locked", ["a/a/x.js", "a/x.js"]],
  ])("%j does not open %j", (pattern, locked, expected) => {
    using dir = tree("glob-scan-group-unreadable", [...files, `${locked}/secret.ts`]);
    fs.chmodSync(path.join(String(dir), locked), 0o000);
    try {
      expect(scan(pattern, String(dir))).toEqual(expected);
    } finally {
      fs.chmodSync(path.join(String(dir), locked), 0o755);
    }
  });

  test.skipIf(isWindows || isRoot)("a `**` in the group reads every directory, as without the group", () => {
    using dir = tree("glob-scan-group-unreadable", [...files, "locked/secret.ts"]);
    fs.chmodSync(path.join(String(dir), "locked"), 0o000);
    try {
      expect(() => scan("{**/a,svc}/*.ts", String(dir))).toThrow(expect.objectContaining({ code: "EACCES" }));
    } finally {
      fs.chmodSync(path.join(String(dir), "locked"), 0o755);
    }
  });

  test("a `!` that starts an alternative is a plain character", () => {
    using dir = tree("glob-scan-group-bang", ["!x/a", "y/b", "z/a"]);
    expect(scan("{!x/a,y/b}", String(dir))).toEqual(["!x/a", "y/b"]);
    expect(scan("@(!x|y)/{a,b/c}", String(dir))).toEqual(["!x/a"]);
  });

  test("a group that is not closed is plain text", () => {
    using dir = tree("glob-scan-group-unclosed", ["{a,b/c", "a", "b/c"]);
    expect(scan("{a,b/c", String(dir))).toEqual(["{a,b/c"]);
    // And the pieces of a group that is closed are not names.
    expect(scan("{a,b/c}", String(dir))).toEqual(["a", "b/c"]);
  });

  test.each([11, 14, 40])("%d groups in a row", count => {
    const repeat = (text: string) => Array.from({ length: count }, () => text).join("/");
    using dir = tree("glob-scan-group-row", [`${repeat("a/q")}/f`, `${repeat("b")}/f`]);
    expect(scan(`${repeat("{a/q,b}")}/f`, String(dir))).toEqual([`${repeat("a/q")}/f`, `${repeat("b")}/f`]);
  });

  test("groups that are adjacent in one path segment", () => {
    using dir = tree("glob-scan-group-adjacent", ["a/1d/2", "a/1f", "cd/2", "cf"]);
    expect(scan("{a/1,c}{d/2,f}", String(dir))).toEqual(["a/1d/2", "a/1f", "cd/2", "cf"]);
    expect(scan("@(a/1|c)@(d/2|f)", String(dir))).toEqual(["a/1d/2", "a/1f", "cd/2", "cf"]);
  });

  test.each([42, 43, 300])("a list of %d paths in one group", count => {
    const paths = Array.from({ length: count }, (_, i) => `d${i}/e/f${i}.ts`);
    using dir = tree("glob-scan-group-list", paths);
    expect(scan(`{${paths.join(",")}}`, String(dir))).toEqual([...paths].sort());
  });

  // No limit on the number of groups or of alternatives: the matcher reads the pattern once.
  test("many groups and many alternatives", () => {
    using dir = tree("glob-scan-group-many", ["x", "a/x", "a/b/x", "a0/q/b0/x", "a39/b39/x", "a/57/b", "a/123/b"]);
    const cwd = String(dir);
    expect(scan(repeated("{**/,**/}", 30) + "x", cwd)).toEqual(["a/b/x", "a/x", "a0/q/b0/x", "a39/b39/x", "x"]);
    const list = (count: number, item: (i: number) => string) =>
      `{${Array.from({ length: count }, (_, i) => item(i))}}`;
    expect(scan(`${list(40, i => `a${i}/**`)}/${list(40, i => `b${i}/x`)}`, cwd)).toEqual(["a0/q/b0/x", "a39/b39/x"]);
    expect(scan(`${list(40, i => `a${i}/`)}${list(40, i => `b${i}/x`)}`, cwd)).toEqual(["a39/b39/x"]);
    // Two groups in one path segment: a thousand times a thousand ways.
    expect(scan(list(1000, i => `a/${i}`) + list(1000, i => `${i}/b`), cwd)).toEqual(["a/123/b", "a/57/b"]);
    const nested = repeated("{a/", 2000) + "x" + repeated(",b}", 2000);
    expect(scan(nested, cwd, { onlyFiles: false })).toEqual(["a/b"]);
  });

  // The splitter and the tail read a pattern once. A pass for each bracket or for each group takes minutes for these.
  test("long patterns are read once", () => {
    using dir = tree("glob-scan-group-repeated", ["x", "a/x", "a/a/x", "za", "w/ya"]);
    // One pass takes about 10 ms in a release build and about 130 ms in a debug build for the slowest of these.
    const budgetMs = isDebug || isASAN ? 20_000 : 5_000;
    for (const [label, pattern, expected] of [
      ["{**/,**/} 10,000 times", repeated("{**/,**/}", 10_000) + "x", ["a/a/x", "a/x", "x"]],
      ["{a/,} 10,000 times", repeated("{a/,}", 10_000) + "x", ["a/a/x", "a/x", "x"]],
      ["?(a/) 10,000 times", repeated("?(a/)", 10_000) + "x", ["a/a/x", "a/x", "x"]],
      // No `]` closes any of these `[`. The matcher reads to the end of the pattern to find that out, so the splitter asks once.
      ["100,000 `[` in a group", "{" + repeated("[", 100_000) + "/q,a/x,x}", ["a/x", "x"]],
      ["20,000 groups in a group", "{w/y,z}" + repeated("+(", 20_000) + "a" + repeated(")", 20_000), ["w/ya", "za"]],
    ] as [string, string, string[]][]) {
      const start = performance.now();
      expect({ label, listed: scan(pattern, String(dir)) }).toEqual({ label, listed: expected });
      const elapsed = performance.now() - start;
      if (elapsed >= budgetMs)
        throw new Error(`${label}: the scan took ${elapsed.toFixed(0)} ms (budget ${budgetMs} ms)`);
    }
  });

  test.skipIf(!isDebug)("a directory is read only if a path below it can match", async () => {
    using dir = tree("glob-scan-group-reads", [...files, "src/other/x.ts", "src/a/deep/x.ts", "a/b/x.js"]);
    const script = `for (const pattern of JSON.parse(process.argv[1])) { console.log("PATTERN"); [...new Bun.Glob(pattern).scanSync({ cwd: process.argv[2] })]; }`;
    const patterns = ["src/{a,b/c}/index.ts", "{packages/app/src,src}/index.ts", "+(a/)x.js", "{src/**,svc/**}"];
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script, JSON.stringify(patterns), String(dir)],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: undefined, BUN_DEBUG_Glob: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const reads = (stdout + stderr)
      .split("PATTERN")
      .slice(1)
      .map(log =>
        [...log.matchAll(/Transition\(dirpath=([^,]*),/g)].map(match => match[1].replaceAll("\\", "/") || ".").sort(),
      );
    expect(reads).toEqual([
      [".", "src", "src/a", "src/b", "src/b/c"],
      [".", "packages", "packages/app", "packages/app/src", "src"],
      [".", "a", "a/a"],
      [".", "src", "src/a", "src/a/deep", "src/b", "src/b/c", "src/other", "svc", "svc/src"],
    ]);
    expect(exitCode).toBe(0);
  });

  // Generated patterns: the scan lists the entries of the tree that match() accepts. A failure names its pattern.
  // BUN_GLOB_FUZZ_SEED gives another sequence, and BUN_GLOB_FUZZ_ITERS more patterns.
  const fuzzSeed =
    process.env.BUN_GLOB_FUZZ_SEED !== undefined ? Number(process.env.BUN_GLOB_FUZZ_SEED) >>> 0 : 0x2f6e2b1;
  const fuzzIterations = Number(process.env.BUN_GLOB_FUZZ_ITERS ?? 200);
  const generator = (seed: number) => {
    let state = seed >>> 0;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
    return { random, pick, chance: (probability: number) => random() < probability };
  };
  // With `dot: false`, a name that starts with `.` is only for a pattern that writes the `.` out. No generated pattern does.
  const isHidden = (entry: string) => entry.split("/").some(name => name.startsWith("."));
  const directoriesOf = (all: string[]) =>
    [...new Set(all.flatMap(file => file.split("/").map((_, i, parts) => parts.slice(0, i).join("/"))))].filter(
      directory => directory !== "",
    );

  test.each([{ dot: false }, { dot: true }])(
    `one group in a real path lists what match() accepts, with %j (seed ${fuzzSeed}, ${fuzzIterations} patterns)`,
    ({ dot }) => {
      const all = [...files, ".h/x.js", "a/.h/x.js", "src/b/.env"];
      const entries = [...all, ...directoriesOf(all)];
      using dir = tree("glob-scan-group-seeded", all);
      const cwd = String(dir);
      const { random, pick } = generator(fuzzSeed);
      const others = ["zz", "*", "**", "src/b", "a/a", "svc", "b/c", "*/c", "packages/*", "**/a", "svc/src", "*/*"];
      let listedSome = 0;
      for (let i = 0; i < fuzzIterations; i++) {
        // Some segments of a real path become one alternative of a group.
        const segments = pick(files).split("/");
        const from = Math.floor(random() * segments.length);
        const to = from + 1 + Math.floor(random() * (segments.length - from));
        const alternatives = [segments.slice(from, to).join("/")];
        while (alternatives.length < 2 || random() < 0.3) {
          alternatives.splice(Math.floor(random() * (alternatives.length + 1)), 0, pick(others));
        }
        const open = pick(["{", "{", "@(", "?(", "+(", "*("]);
        const group = open + alternatives.join(open === "{" ? "," : "|") + (open === "{" ? "}" : ")");
        const pattern = [...segments.slice(0, from), group, ...segments.slice(to)].join("/");
        const glob = new Glob(pattern);
        const isListed = (entry: string) => glob.match(entry) && (dot || !isHidden(entry));
        const expected = all.filter(isListed).sort();
        expect({ pattern, listed: scan(pattern, cwd, { dot }) }).toEqual({ pattern, listed: expected });
        listedSome += Number(expected.length > 0);
        expect({ pattern, listed: scan(pattern, cwd, { dot, onlyFiles: false }) }).toEqual({
          pattern,
          listed: entries.filter(isListed).sort(),
        });
      }
      expect(listedSome).toBeGreaterThan(fuzzIterations / 2);
    },
  );

  test(`groups in groups list what match() accepts (seed ${fuzzSeed}, ${fuzzIterations} patterns)`, () => {
    const all = [
      ...["x.js", "a.ts", "a/x.js", "a/a/x.js", "a/a/a/x.js", "a/b/x.js", "a/b/a/b/x.js", "b/x.js", "b/a/x.js"],
      ...["ab/x.js", "ba/bx.js", "src/a.ts", "src/lib/a.ts", "src/lib/lib/a.ts", "src/b/c/index.ts", "c/d/e/f.ts"],
      ...["a/bc", "a/ba/bc", ".h/x.js", "a/.h/x.js"],
    ];
    const entries = [...all, ...directoriesOf(all)];
    using dir = tree("glob-scan-group-generated", all);
    const cwd = String(dir).replaceAll("\\", "/");
    const { random, pick, chance } = generator(fuzzSeed ^ 0x9e3779b9);
    const names = ["a", "b", "c", "x.js", "src", "lib", "a.ts", "ab", "bc", "d", "e", "index.ts", "f.ts"];
    const word = () => pick([...names, ...names, "*", "*", "**", pick(["*.js", "*.ts", "a*", "?"])]);
    const inner = (depth: number): string =>
      Array.from({ length: 1 + Math.floor(random() * 2) }, () =>
        depth < 2 && chance(0.2) ? group(depth + 1) : word(),
      ).join("/") + (chance(0.5) ? "/" : "");
    const group = (depth: number): string => {
      const open = pick(["+(", "*(", "!(", "@(", "{", "?("]);
      const alternatives = Array.from({ length: 1 + Math.floor(random() * 2) }, () =>
        chance(0.15) ? word() : inner(depth),
      );
      return open + alternatives.join(open === "{" ? "," : "|") + (open === "{" ? "}" : ")");
    };
    let listedSome = 0;
    for (let i = 0; i < fuzzIterations;) {
      let pattern = "";
      for (let pieces = 1 + Math.floor(random() * 3); pieces > 0; pieces--) {
        // A group that ends with a separator joins the next piece without one.
        pattern += (pattern && !/\/[)}]?$/.test(pattern) ? "/" : "") + (chance(0.6) ? group(0) : word());
      }
      // Some group has a separator or a `**` in it, and no path segment is empty.
      if (!/[{(][^{}()]*(\/|\*\*)/.test(pattern) || pattern.includes("//")) continue;
      i++;
      // A `!` before the pattern negates all of it if the first path segment has the group. Before a plain segment it negates one name.
      const startsWithGroup = /^([+*?@!]\(|\{)[^{}()]*(\/|\*\*)/.test(pattern);
      const prefix =
        startsWithGroup && chance(0.2) ? pick(["!", "!!"]) : pick(["", "", "", "./", "a/../", "./src/../"]);
      const isNegation = prefix.startsWith("!");
      const opts = { dot: chance(0.3), onlyFiles: chance(0.7), absolute: chance(0.3) };
      const glob = new Glob(isNegation ? prefix + pattern : pattern);
      const expected = (opts.onlyFiles ? all : entries)
        .filter(entry => glob.match(entry) && (opts.dot || !isHidden(entry)))
        // The walker keeps a `.` or `..` of the pattern in its paths, but not with `absolute`.
        .map(entry => (opts.absolute ? `${cwd}/${entry}` : isNegation ? entry : prefix + entry))
        .sort();
      const written = isNegation ? prefix + pattern : prefix + pattern;
      expect({ written, opts, listed: scan(written, String(dir), opts) }).toEqual({ written, opts, listed: expected });
      listedSome += Number(expected.length > 0);
    }
    expect(listedSome).toBeGreaterThan(fuzzIterations / 8);
  });
});

describe.skipIf(!isWindows)("glob scan descends read-only directories", () => {
  test.skipIf(!roDirEnforced)(
    `RX-only directory is descended, creates still fail${roDirEnforced ? "" : " (skipped: ACL not enforced under this token)"}`,
    () => {
      const entries = Array.from(new Glob("**/*.txt").scanSync({ cwd: roDirRoot }))
        .map(p => p.replaceAll("\\", "/"))
        .sort();
      expect(entries).toEqual(["a/b/file.txt"]);

      let err: any;
      try {
        fs.mkdirSync(path.join(roDirA, "x"));
      } catch (e) {
        err = e;
      }
      expect(err?.code).toBe("EPERM");
    },
  );
});
