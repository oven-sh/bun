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

// globalThis has its own private names, such as the module resolver's.
test("scan and scanSync throw a TypeError when `this` is globalThis", () => {
  expect(() => Bun.Glob.prototype.scanSync.call(globalThis, "fs")).toThrow(TypeError);
  expect(() => Bun.Glob.prototype.scan.call(globalThis, "fs")).toThrow(TypeError);
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
    // Windows still goes into the link once (see the `describe` below).
    expect(result).toEqual(isWindows ? ["file.txt", "loop/file.txt"] : ["file.txt"]);

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
    expect(norm(result)).toEqual(isWindows ? ["file.txt", "loop/file.txt"] : ["file.txt"]);
  });

  // A link back up leads to a directory that a `**` already walks: the
  // directory where the `**` starts, or one below it on the way down. The `**`
  // does not continue into it, as `find -L` does not. Every name below it is a
  // longer name for a file that the `**` already gives.
  //
  // Not on Windows: a directory listing has no file id there, and the cost of
  // a query per directory is not measured yet.
  describe.skipIf(isWindows)("** with followSymlinks and a link back up", () => {
    const scan = (cwd: string, pattern = "**/*.txt", opts: GlobScanOptions = {}) =>
      norm(Array.from(new Glob(pattern).scanSync({ cwd, followSymlinks: true, ...opts })));
    const link = (target: string, ...at: string[]) => fs.symlinkSync(target, path.join(...at), "dir");
    const relativeTo = (root: string, names: string[]) => norm(names.map(name => path.relative(root, name)));

    // d1/d2/d3/d4 below `root`, with a file and a link to the parent in each.
    function buildLadder(root: string) {
      const files = ["t0.txt"];
      let at = root;
      let relative = "";
      for (let i = 1; i <= 4; i++) {
        at = path.join(at, `d${i}`);
        relative += `d${i}/`;
        fs.mkdirSync(at);
        fs.writeFileSync(path.join(at, `t${i}.txt`), "x");
        link("..", at, "up");
        files.push(`${relative}t${i}.txt`);
      }
      return files.sort();
    }

    test("every directory has a link to its parent", async () => {
      using dir = tempDir("glob-scan-symlink-ladder", { "t0.txt": "x" });
      const cwd = String(dir);
      const files = buildLadder(cwd);
      expect(scan(cwd)).toEqual(files);
      expect(norm(await Array.fromAsync(new Glob("**/*.txt").scan({ cwd, followSymlinks: true })))).toEqual(files);
      expect(relativeTo(cwd, scan(cwd, "**/*.txt", { absolute: true }))).toEqual(files);
      expect(relativeTo(cwd, scan(cwd, path.join(cwd, "**/*.txt")))).toEqual(files);
      expect(relativeTo("..", scan(path.join(cwd, "d1"), "../**/*.txt"))).toEqual(files);
    });

    test("the ** starts below the cwd", () => {
      using dir = tempDir("glob-scan-symlink-ladder-prefix", { "t0.txt": "x" });
      const cwd = String(dir);
      const files = buildLadder(cwd);
      // The `**` starts at `d1` and does not walk the cwd yet: it reads `d1/up`,
      // and no other name gives `t0.txt`. `d1/up/d1` is where it started.
      expect(scan(cwd, "d1/**/*.txt")).toEqual(
        [...files.filter(file => file.startsWith("d1/")), "d1/up/t0.txt"].sort(),
      );
      // `d1/up` is the cwd, and the `**` starts there: it gives every file once.
      expect(scan(cwd, "d1/up/**/*.txt")).toEqual(files.map(file => `d1/up/${file}`).sort());
      expect(scan(cwd, "d1/up/**/*.txt", { followSymlinks: false })).toEqual(files.map(file => `d1/up/${file}`).sort());
    });

    test("a link that a component after the ** names is read for that component", () => {
      using dir = tempDir("glob-scan-symlink-ladder-named", { "t0.txt": "x" });
      const cwd = String(dir);
      buildLadder(cwd);
      expect(scan(cwd, "**/up/*.txt")).toEqual([
        "d1/d2/d3/d4/up/t3.txt",
        "d1/d2/d3/up/t2.txt",
        "d1/d2/up/t1.txt",
        "d1/up/t0.txt",
      ]);
      expect(scan(cwd, "**/*/*.txt")).toEqual([
        "d1/d2/d3/d4/t4.txt",
        "d1/d2/d3/d4/up/t3.txt",
        "d1/d2/d3/t3.txt",
        "d1/d2/d3/up/t2.txt",
        "d1/d2/t2.txt",
        "d1/d2/up/t1.txt",
        "d1/t1.txt",
        "d1/up/t0.txt",
      ]);
    });

    test("a directory below a followed link that is the walk root", () => {
      using dir = tempDir("glob-scan-symlink-up", { "proj/a.txt": "x", "sib/b.txt": "x" });
      link("..", String(dir), "proj", "up");
      const proj = path.join(String(dir), "proj");
      // `up` is the parent of the walk root: the `**` does not walk it yet, so
      // it is listed. `up/proj` is the walk root again.
      expect(scan(proj)).toEqual(["a.txt", "up/sib/b.txt"]);
      expect(relativeTo(proj, scan(String(dir), path.join(proj, "**/*.txt")))).toEqual(["a.txt", "up/sib/b.txt"]);
      // Here the `**` starts at `up`, and `up/proj` is not a directory it walks.
      expect(scan(proj, "up/**/*.txt")).toEqual(["up/proj/a.txt", "up/sib/b.txt"]);
      expect(scan(proj, "up/**/*.txt", { followSymlinks: false })).toEqual(["up/proj/a.txt", "up/sib/b.txt"]);
    });

    test("packages that link to each other in a circle", () => {
      using dir = tempDir("glob-scan-symlink-circle", { "a/src/foo.txt": "x", "b/src/bar.txt": "x" });
      for (const [from, to] of [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ]) {
        fs.mkdirSync(path.join(String(dir), from, "node_modules"), { recursive: true });
        link(path.join("..", "..", to), String(dir), from, "node_modules", to);
      }
      expect(scan(path.join(String(dir), "a"))).toEqual(["node_modules/b/src/bar.txt", "src/foo.txt"]);
      // From the root no package is on the way down, so each is entered
      // through the links until the circle closes.
      expect(scan(String(dir))).toEqual([
        "a/node_modules/b/src/bar.txt",
        "a/src/foo.txt",
        "b/node_modules/c/node_modules/a/src/foo.txt",
        "b/src/bar.txt",
        "c/node_modules/a/node_modules/b/src/bar.txt",
        "c/node_modules/a/src/foo.txt",
      ]);
    });

    test("a package that links to itself", () => {
      using dir = tempDir("glob-scan-symlink-self-package", {
        "package.json": "{}",
        "node_modules/dep/package.json": "{}",
      });
      link("..", String(dir), "node_modules", "self");
      // The `**` starts at `node_modules`. No other name gives the package's
      // own file, so the link is followed. `self/node_modules` is a repeat.
      expect(scan(String(dir), "node_modules/**/package.json")).toEqual([
        "node_modules/dep/package.json",
        "node_modules/self/package.json",
      ]);
      expect(scan(String(dir), "**/package.json")).toEqual(["node_modules/dep/package.json", "package.json"]);
    });

    test("a ** below another **", () => {
      using dir = tempDir("glob-scan-symlink-two-globstars", { "index.js": "", "examples/basic/main.js": "" });
      fs.mkdirSync(path.join(String(dir), "examples", "basic", "node_modules"));
      link(path.join("..", "..", ".."), String(dir), "examples", "basic", "node_modules", "lib");
      // Only the second `**` gives the files of `lib`, so it goes into it once.
      expect(scan(String(dir), "**/node_modules/**/*.js")).toEqual([
        "examples/basic/node_modules/lib/examples/basic/main.js",
        "examples/basic/node_modules/lib/index.js",
      ]);
      expect(scan(String(dir), "**/*.js")).toEqual(["examples/basic/main.js", "index.js"]);
    });

    test("two links to the walk root", () => {
      using dir = tempDir("glob-scan-symlink-two-loops", { "file.txt": "x" });
      link(".", String(dir), "x");
      link(".", String(dir), "y");
      expect(scan(String(dir))).toEqual(["file.txt"]);
    });

    test("a link to a directory below a followed link", () => {
      using dir = tempDir("glob-scan-symlink-below-link", { "d0/d1/f.txt": "x" });
      link(".", String(dir), "d0", "d1", "self");
      link("d0", String(dir), "l0");
      expect(scan(String(dir))).toEqual(["d0/d1/f.txt", "l0/d1/f.txt"]);
      expect(scan(String(dir), "l0/**/*.txt")).toEqual(["l0/d1/f.txt"]);
    });

    test("a directory below a second link that is the target of the first", () => {
      using dir = tempDir("glob-scan-symlink-target-again", { "a/T/f.txt": "x" });
      link("..", String(dir), "a", "T", "up");
      link(path.join("a", "T"), String(dir), "L");
      expect(scan(String(dir))).toEqual(["L/f.txt", "a/T/f.txt"]);
      expect(scan(String(dir), "L/**/*.txt")).toEqual(["L/f.txt"]);
      expect(scan(String(dir), "L/**", { onlyFiles: false })).toEqual(["L/f.txt", "L/up", "L/up/T"]);
    });

    test("the name of the link still matches", () => {
      using dir = tempDir("glob-scan-symlink-name", { "follow/target/file.txt": "x" });
      const follow = path.join(String(dir), "follow");
      link(path.join(follow, "target"), follow, "link");
      link(follow, follow, "cycle");
      const names = ["cycle", "link", "link/file.txt", "target", "target/file.txt"];
      expect(scan(follow, "**", { onlyFiles: false })).toEqual(names);
      expect(scan(String(dir), "follow/**", { onlyFiles: false })).toEqual(names.map(name => `follow/${name}`));
    });

    test("a link that another component matches is read", () => {
      using dir = tempDir("glob-scan-symlink-named", { "top/file.txt": "x" });
      link(".", String(dir), "top", "loop");
      const top = path.join(String(dir), "top");
      expect(scan(top, "*/*.txt")).toEqual(["loop/file.txt"]);
      expect(scan(top, "loop/*.txt")).toEqual(["loop/file.txt"]);
      expect(scan(top, "loop/**/*.txt")).toEqual(["loop/file.txt"]);
      expect(scan(String(dir), "**/loop/*.txt")).toEqual(["top/loop/file.txt"]);
    });

    // The rule, written a second time: `**/*` gives every name below the cwd,
    // and goes into a directory unless its real path is on the way down to it.
    test("**/* on generated trees is the walk that does not enter a directory it is already inside", () => {
      function rng(seed: number) {
        let s = seed >>> 0;
        return () => {
          s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
          s = (Math.imul(s ^ (s >>> 13), 3266489909) + 0x85ebca6b) >>> 0;
          return ((s ^= s >>> 16) >>> 0) / 4294967296;
        };
      }

      function walk(cwd: string) {
        const entries: { name: string; file: boolean; hidden: boolean }[] = [];
        const list = (dir: string, real: string, relative: string, hidden: boolean, way: string[]) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const at = path.join(dir, entry.name);
            const stat = entry.isSymbolicLink() ? fs.statSync(at, { throwIfNoEntry: false }) : entry;
            const isHidden = hidden || entry.name.startsWith(".");
            entries.push({ name: relative + entry.name, file: !!stat?.isFile(), hidden: isHidden });
            if (!stat?.isDirectory()) continue;
            const realEntry = entry.isSymbolicLink() ? fs.realpathSync(at) : path.join(real, entry.name);
            if (!way.includes(realEntry))
              list(at, realEntry, `${relative}${entry.name}/`, isHidden, [...way, realEntry]);
          }
        };
        list(cwd, cwd, "", false, [cwd]);
        return entries;
      }

      // Directories up to 4 deep, a file in most, and 3 to 7 links: to `.`,
      // `..`, `../..`, nothing, a file, or another directory.
      function build(root: string, random: () => number) {
        const pick = <T>(from: T[]) => from[Math.floor(random() * from.length)];
        const dirs = ["."];
        for (let i = 3 + Math.floor(random() * 5); i > 0; i--) {
          const name = random() < 0.15 ? `.h${Math.floor(random() * 2)}` : `d${Math.floor(random() * 3)}`;
          const dir = path.posix.join(pick(dirs), name);
          if (dir.split("/").length > 4 || dirs.includes(dir)) continue;
          fs.mkdirSync(path.join(root, dir));
          dirs.push(dir);
        }
        for (const dir of dirs) {
          if (random() < 0.8) fs.writeFileSync(path.join(root, dir, `f${Math.floor(random() * 2)}.txt`), "x");
        }
        for (let i = 3 + Math.floor(random() * 5); i > 0; i--) {
          const at = path.join(root, pick(dirs));
          const name = path.join(
            at,
            random() < 0.15 ? `.h${Math.floor(random() * 2)}` : `l${Math.floor(random() * 3)}`,
          );
          if (fs.lstatSync(name, { throwIfNoEntry: false })) continue;
          const kind = random();
          let target = kind < 0.1 ? "." : kind < 0.3 ? ".." : kind < 0.37 ? "../.." : kind < 0.41 ? "missing" : "";
          if (target === "") {
            const to = kind < 0.45 ? path.join(root, "f0.txt") : path.join(root, pick(dirs));
            target = random() < 0.7 ? path.relative(at, to) || "." : to;
          }
          // Not above the tree: the walk would leave it.
          if (!(path.resolve(at, target) + path.sep).startsWith(root + path.sep)) target = ".";
          fs.symlinkSync(target, name);
        }
        return random() < 0.7 ? root : path.join(root, pick(dirs));
      }

      using dir = tempDir("glob-scan-symlink-generated", {});
      const base = fs.realpathSync(String(dir));
      for (let seed = 1; seed <= (isDebug || isASAN ? 25 : 100); seed++) {
        const root = path.join(base, `s${seed}`);
        fs.mkdirSync(root);
        const cwd = build(root, rng(seed * 104729));
        const entries = walk(cwd);
        for (const dot of [true, false]) {
          for (const onlyFiles of [true, false]) {
            const names = Array.from(new Glob("**/*").scanSync({ cwd, followSymlinks: true, dot, onlyFiles }));
            expect({ seed, dot, onlyFiles, names: norm(names) }).toEqual({
              seed,
              dot,
              onlyFiles,
              names: entries
                .filter(entry => (dot || !entry.hidden) && (!onlyFiles || entry.file))
                .map(entry => entry.name)
                .sort(),
            });
          }
        }
      }
    });

    // A walk with links and no link back up tells its directories apart from
    // the listings it reads anyway.
    const strace = isLinux ? Bun.which("strace") : null;
    test.skipIf(!strace)("a walk with no link back up makes no stat call", async () => {
      using dir = tempDir("glob-scan-symlink-syscalls", {
        "app/m.js": "",
        "store/p0/lib/i.js": "",
        "store/p1/lib/i.js": "",
      });
      link(path.join("..", "store", "p0"), String(dir), "app", "l0");
      link(path.join("..", "store", "p1"), String(dir), "app", "l1");
      const app = path.join(fs.realpathSync(String(dir)), "app");
      const trace = path.join(String(dir), "trace.log");
      await using proc = Bun.spawn({
        cmd: [
          strace!,
          "-f",
          "-y",
          "-o",
          trace,
          "-e",
          "trace=stat,lstat,fstat,newfstatat,statx",
          bunExe(),
          "-e",
          `console.log([...new Bun.Glob("**/*.js").scanSync({ cwd: ${JSON.stringify(app)}, followSymlinks: true })].sort().join())`,
        ],
        env: {
          ...bunEnv,
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
          LSAN_OPTIONS: "detect_leaks=0",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const stats = (await Bun.file(trace).text()).split("\n").filter(line => line.includes(app));
      expect({ stdout: stdout.trim(), stats, exitCode }, stderr).toEqual({
        stdout: "l0/lib/i.js,l1/lib/i.js,m.js",
        stats: [],
        exitCode: 0,
      });
    });

    // A filesystem can give no inode number for `.` in a listing, or the same
    // number in every directory (libfuse without `use_ino`). The walk then
    // tells directories apart with `fstat`. An LD_PRELOAD shim rewrites the
    // number after the real getdents64(2) returns. It also sets the length of
    // the first record of the directory `malformed` to 0: the search for `.`
    // ends there, and the walk fails as it does without that search.
    const cc = isLinux ? Bun.which("cc") || Bun.which("gcc") || Bun.which("clang") : null;
    test.skipIf(!cc)("a listing that does not tell directories apart gives the same names", async () => {
      const shim = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <limits.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static long (*next_syscall)(long, ...);

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) next_syscall = dlsym(RTLD_NEXT, "syscall");
  long rc = next_syscall(nr, a1, a2, a3, a4, a5, a6);
  const char *dot_ino = getenv("GLOB_TEST_DOT_INO");
  if (nr != SYS_getdents64 || rc <= 0 || !dot_ino) return rc;

  // struct linux_dirent64 { u64 d_ino; s64 d_off; u16 d_reclen; u8 d_type; char d_name[]; }
  enum { RECLEN_OFFSET = 16, NAME_OFFSET = 19 };
  unsigned char *buf = (unsigned char *)a2;

  char link[64], path[PATH_MAX];
  snprintf(link, sizeof link, "/proc/self/fd/%d", (int)a1);
  ssize_t n = readlink(link, path, sizeof path - 1);
  if (n > 0) {
    path[n] = 0;
    if (strcmp(strrchr(path, '/') + 1, "malformed") == 0) {
      memset(buf + RECLEN_OFFSET, 0, sizeof(uint16_t));
      return rc;
    }
  }

  uint64_t ino = strtoull(dot_ino, NULL, 0);
  for (long at = 0; at < rc;) {
    uint16_t reclen;
    memcpy(&reclen, buf + at + RECLEN_OFFSET, sizeof reclen);
    if (buf[at + NAME_OFFSET] == '.' && buf[at + NAME_OFFSET + 1] == 0) memcpy(buf + at, &ino, sizeof ino);
    at += reclen;
  }
  return rc;
}
`;
      using dir = tempDir("glob-scan-symlink-dot-ino", {
        "shim.c": shim,
        "ladder/t0.txt": "x",
        "package/package.json": "{}",
        "package/node_modules/dep/package.json": "{}",
        "links/app/m.txt": "x",
        "links/store/p0/lib/i.txt": "x",
        "links/store/p1/lib/i.txt": "x",
        "malformed/a.txt": "x",
      });
      const root = String(dir);
      buildLadder(path.join(root, "ladder"));
      link("..", root, "package", "node_modules", "self");
      link(path.join("..", "store", "p0"), root, "links", "app", "l0");
      link(path.join("..", "p1"), root, "links", "store", "p0", "l1");
      link(path.join("..", "..", "app"), root, "links", "store", "p1", "app");
      const scans = [
        ["ladder", "**/*.txt"],
        ["ladder", "d1/**/*.txt"],
        ["ladder", "**/up/*.txt"],
        ["ladder", "**/*/**/*.txt"],
        ["package", "node_modules/**/package.json"],
        ["package", "**/package.json"],
        ["links/app", "**/*.txt"],
        ["links", "**/*.txt"],
        ["malformed", "**"],
      ].map(([cwd, pattern]) => [path.join(root, cwd), pattern]);
      const names: (string[] | string)[] = scans.map(([cwd, pattern]) => scan(cwd, pattern));
      expect([names[0].length, names.at(-1)]).toEqual([5, ["a.txt"]]);
      names[names.length - 1] = "EIO";

      const shimPath = path.join(root, "shim.so");
      await using compile = Bun.spawn({
        cmd: [cc!, "-shared", "-fPIC", "-o", shimPath, path.join(root, "shim.c"), "-ldl"],
        env: bunEnv,
        stderr: "inherit",
      });
      expect(await compile.exited).toBe(0);

      const run = async (dotIno: string) => {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `const scan = ([cwd, pattern]) => {
              try {
                return [...new Bun.Glob(pattern).scanSync({ cwd, followSymlinks: true })].sort();
              } catch (e) {
                return e.code;
              }
            };
            console.log(JSON.stringify(JSON.parse(process.env.GLOB_TEST_SCANS).map(scan)));`,
          ],
          env: {
            ...bunEnv,
            LD_PRELOAD: [shimPath, bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
            GLOB_TEST_DOT_INO: dotIno,
            GLOB_TEST_SCANS: JSON.stringify(scans),
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { dotIno, stdout: stdout.trim(), stderr, exitCode };
      };
      for (const { stderr, ...result } of await Promise.all(["0", "0xffffffff"].map(run))) {
        expect(result, stderr).toEqual({ dotIno: result.dotIno, stdout: JSON.stringify(names), exitCode: 0 });
      }
    });
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

test("scan and scanSync reject a cwd or a pattern with a null byte", () => {
  using dir = tempDir("glob-scan-null-byte", { "safe/inside.ts": "x" });
  const nullByteError = expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" });
  const cwd = `${dir}/safe\0/../secret`;
  expect(() => Array.from(new Glob("*.ts").scanSync({ cwd }))).toThrow(nullByteError);
  expect(() => Array.from(new Glob("*.ts").scanSync(cwd))).toThrow(nullByteError);
  expect(() => new Glob("*.ts").scan({ cwd })).toThrow(nullByteError);
  const pattern = `${dir}/safe\0trailer/*.ts`;
  expect(() => Array.from(new Glob(pattern).scanSync())).toThrow(nullByteError);
  expect(() => new Glob(pattern).scan()).toThrow(nullByteError);
  expect(new Glob("a\0b").match("a\0b")).toBe(true);
});
