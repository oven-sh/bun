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
  dtUnknownReaddir,
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

  // The rule applies to each alternative of a group, like minimatch after
  // brace expansion: `{.a,*}` is `.a` (explicit) or `*` (hidden).
  const groupFiles = {
    "flat/.a": "x",
    "flat/.b": "x",
    "flat/.ca": "x",
    "flat/a.b": "x",
    "flat/c": "x",
    ".env": "x",
    ".eslintrc.js": "x",
    "package.json": "x",
    ".github/ci.yml": "x",
    ".github/.secret": "x",
    ".github/workflows/test.yml": "x",
    "src/index.ts": "x",
    "src/.keep": "x",
    "sub/.npmrc": "x",
    "sub/package.json": "x",
  };

  test.each([
    ["flat/{.a,.b}", ["flat/.a", "flat/.b"]],
    ["flat/{c,.a}", ["flat/.a", "flat/c"]],
    ["flat/{*,.a}", ["flat/.a", "flat/a.b", "flat/c"]],
    ["flat/{.,}a", ["flat/.a"]],
    ["flat/{,.}a", ["flat/.a"]],
    ["flat/{.c,x}*", ["flat/.ca"]],
    ["flat/{a,.c}?", ["flat/.ca"]],
    ["flat/{x,{.b,c}}", ["flat/.b", "flat/c"]],
    ["flat/{.a,c}{,x}", ["flat/.a", "flat/c"]],
    ["flat/{,x}.a", ["flat/.a"]],
    ["flat/{{,x},y}.a", ["flat/.a"]],
    ["flat/{**,.a}", ["flat/.a", "flat/a.b", "flat/c"]],
    ["flat/+(.a|c)", ["flat/.a", "flat/c"]],
    ["flat/@(.a|.b)", ["flat/.a", "flat/.b"]],
    ["flat/?(.)a", ["flat/.a"]],
    // A dotfile or a dot directory at any depth.
    ["{.env,package.json}", [".env", "package.json"]],
    ["{.env,.eslintrc.js}", [".env", ".eslintrc.js"]],
    ["{.github,src}/*", [".github/ci.yml", "src/index.ts"]],
    ["{.github,src}/**", [".github/ci.yml", ".github/workflows/test.yml", "src/index.ts"]],
    ["{.github,src}/{*,.keep}", [".github/ci.yml", "src/.keep", "src/index.ts"]],
    ["**/{.npmrc,package.json}", ["package.json", "sub/.npmrc", "sub/package.json"]],
    ["**/{.github,sub}/*", [".github/ci.yml", "sub/package.json"]],
    // No alternative spells out the dot: dotfiles stay hidden.
    ["flat/{*,?a}", ["flat/a.b", "flat/c"]],
    ["flat/*{.a,c}", ["flat/c"]],
    ["flat/{,x}*", ["flat/a.b", "flat/c"]],
    ["flat/{[!x],c}a", []],
    ["flat/[.a]a", []],
    ["{src,sub}/*", ["src/index.ts", "sub/package.json"]],
    ["{*,src}/*", ["flat/a.b", "flat/c", "src/index.ts", "sub/package.json"]],
    // A negated segment never opts dotfiles in.
    ["flat/!*", []],
    ["flat/!{.a,c}", ["flat/a.b"]],
  ])("pattern %j applies the dotfile rule to each alternative", async (pattern, expected) => {
    using dir = tempDir("glob-scan-group-dot", groupFiles);
    const cwd = String(dir);
    const glob = new Glob(pattern);
    expect(norm(Array.from(glob.scanSync({ cwd })))).toEqual(expected);
    expect(norm(await Array.fromAsync(glob.scan({ cwd })))).toEqual(expected);
    // `dot: true` only adds entries.
    expect(norm(Array.from(glob.scanSync({ cwd, dot: true })))).toEqual(expect.arrayContaining(expected));
  });

  test.skipIf(isWindows)("an escaped dot in an alternative is explicit", () => {
    using dir = tempDir("glob-scan-group-dot-escaped", groupFiles);
    const result = Array.from(new Glob("flat/{\\.a,c}").scanSync({ cwd: String(dir) }));
    expect(result.sort()).toEqual(["flat/.a", "flat/c"]);
  });

  test("a dot directory that an alternative names is returned with onlyFiles: false", () => {
    using dir = tempDir("glob-scan-group-dot-dirs", groupFiles);
    const scan = (p: string) => norm(Array.from(new Glob(p).scanSync({ cwd: String(dir), onlyFiles: false })));
    expect(scan("{.github,src}")).toEqual([".github", "src"]);
    expect(scan("{src,sub}")).toEqual(["src", "sub"]);
    expect(scan("{*,.x}")).toEqual(["flat", "package.json", "src", "sub"]);
  });

  test("an absolute pattern applies the same rule", () => {
    using dir = tempDir("glob-scan-group-dot-absolute", groupFiles);
    const result = Array.from(new Glob(path.join(String(dir), "{.env,package.json}")).scanSync());
    expect(result.sort()).toEqual([path.join(String(dir), ".env"), path.join(String(dir), "package.json")]);
  });

  test("a group of 65 dotfiles returns each of them", () => {
    const names = Array.from({ length: 65 }, (_, i) => `.f${i}`).sort();
    using dir = tempDir("glob-scan-group-dot-65", Object.fromEntries(names.map(name => [name, "x"])));
    const result = Array.from(new Glob(`{${names.join(",")}}`).scanSync({ cwd: String(dir) }));
    expect(result.sort()).toEqual(names);
  });

  // Differential check. A dotfile is returned exactly when `dot: true` returns
  // it and one expansion of the pattern that starts with `.` matches it. Every
  // other name does not depend on `dot`.
  test("generated brace patterns agree with their expansions", () => {
    const names = [".a", ".b", ".ca", ".x", ".xa", "a", "c", "ca", "xa", "a.a", "x.a"];
    using dir = tempDir("glob-scan-group-dot-generated", Object.fromEntries(names.map(name => [name, "x"])));
    const cwd = String(dir);

    let seed = 0x2f6e2b1;
    const rand = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };
    type Part = [text: string, expansions: string[]];
    const atoms = [".a", ".", "a", "c", "x", "*", "?", "", ".*", "?a"];
    const atom = (): Part => {
      const text = atoms[rand(atoms.length)];
      return [text, [text]];
    };
    const group = (depth: number): Part => {
      const alternatives = Array.from({ length: 2 + rand(2) }, () =>
        depth < 2 && rand(4) === 0 ? group(depth + 1) : atom(),
      );
      return [`{${alternatives.map(a => a[0]).join(",")}}`, alternatives.flatMap(a => a[1])];
    };

    const failures: { pattern: string; actual: string[]; expected: string[] }[] = [];
    for (let i = 0; i < 50; i++) {
      const parts = Array.from({ length: 1 + rand(3) }, () => (rand(3) === 0 ? atom() : group(0)));
      const pattern = parts.map(p => p[0]).join("");
      const expansions = parts.reduce((acc, p) => acc.flatMap(a => p[1].map(b => a + b)), [""]);
      const withDot = new Set(new Glob(pattern).scanSync({ cwd, dot: true }));
      const expected = names
        .filter(
          name =>
            withDot.has(name) &&
            (!name.startsWith(".") || expansions.some(e => e.startsWith(".") && new Glob(e).match(name))),
        )
        .sort();
      const actual = Array.from(new Glob(pattern).scanSync({ cwd })).sort();
      if (!Bun.deepEquals(actual, expected)) failures.push({ pattern, actual, expected });
    }
    expect(failures).toEqual([]);
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

  // A segment without a wildcard names each entry that it matches, as a
  // literal segment does: its text and one alternative of each `{a,b}` spell
  // the name out. A wildcard anywhere in the segment names nothing.
  describe("segment without a wildcard", () => {
    function makeNamedTree(prefix: string) {
      const dir = tempDir(prefix, {
        "realdir/file.txt": "x",
        "src/file.txt": "x",
        "package.json": "{}",
        "pkg/realdir/file.txt": "x",
      });
      const link = (target: string, name: string, type: "dir" | "file") =>
        fs.symlinkSync(target, path.join(String(dir), name), type);
      for (const name of [
        "linkdir",
        "link2",
        "!linkdir",
        "!(linkdir",
        ".dotlink",
        "my!link",
        "un[closed",
        "un{closed",
      ]) {
        link("realdir", name, "dir");
      }
      link("realdir", path.join("pkg", "linkdir"), "dir");
      link("realdir", "[id]", "dir");
      link("package.json", "link.json", "file");
      link("package.json", ".link.json", "file");
      link("nowhere", ".broken", "dir");
      return dir;
    }
    const scanSync = (cwd: string, pattern: string, opts: GlobScanOptions = {}) =>
      norm(Array.from(new Glob(pattern).scanSync({ cwd, followSymlinks: false, ...opts })));
    const thrown = (cwd: string, pattern: string, opts: GlobScanOptions = {}) => {
      try {
        return scanSync(cwd, pattern, opts);
      } catch (err: any) {
        return { code: err.code, syscall: err.syscall };
      }
    };

    test.each([
      ["{linkdir,src}/*", ["linkdir/file.txt", "src/file.txt"]],
      ["link{dir,x}/*", ["linkdir/file.txt"]],
      ["{link.json,package.json}", ["link.json", "package.json"]],
      ["lin{k,}dir/*", ["linkdir/file.txt"]],
      ["{link,x}{dir,y}/*", ["linkdir/file.txt"]],
      ["{l{ink,x}dir,src}/*", ["linkdir/file.txt", "src/file.txt"]],
      // A sequence value and a group of one alternative are spelled out too.
      ["link{1..3}/*", ["link2/file.txt"]],
      ["{linkdir}/*", ["linkdir/file.txt"]],
      ["**/pkg/{linkdir,realdir}/*", ["pkg/linkdir/file.txt", "pkg/realdir/file.txt"]],
      // With the dotfile rule: an alternative that spells the dot names a hidden link.
      ["{.dotlink,src}/*", [".dotlink/file.txt", "src/file.txt"]],
      [".dot{link,x}/*", [".dotlink/file.txt"]],
      ["{.link.json,package.json}", [".link.json", "package.json"]],
      // No group: text that the walker does not take for a literal segment.
      ["my!link/*", ["my!link/file.txt"]],
      ["un[closed/*", ["un[closed/file.txt"]],
      ["un{closed/*", ["un{closed/file.txt"]],
    ])("%j follows the link that it names", async (pattern, expected) => {
      using dir = makeNamedTree("glob-scan-symlink-named");
      const cwd = String(dir);
      expect(scanSync(cwd, pattern)).toEqual(expected);
      expect(norm(await Array.fromAsync(new Glob(pattern).scan({ cwd, followSymlinks: false })))).toEqual(expected);
    });

    test.each([
      ["{link*,src}/*", ["src/file.txt"]],
      ["{link?ir,src}/*", ["src/file.txt"]],
      ["{[l]inkdir,src}/*", ["src/file.txt"]],
      ["@(linkdir|src)/*", ["src/file.txt"]],
      ["+(linkdir|src)/*", ["src/file.txt"]],
      // A class is a wildcard, also one that holds a single `[`.
      ["[[]id]/*", []],
      // A negated segment names nothing, not even the link `!linkdir`.
      ["!{linkdir,x}/*", ["realdir/file.txt", "src/file.txt"]],
      // An unclosed `!(` is text for the matcher. The segment still starts with `!`.
      ["!(linkdir/*", []],
      // `**` reaches the segment, so nothing names the link.
      ["**/{linkdir,src}/*", ["src/file.txt"]],
      // A wildcard in one alternative: the segment names nothing. Node follows `linkdir` in the first three, fast-glob does not.
      ["{linkdir,link*}/*", []],
      ["{link.json,pack*}", ["package.json"]],
      ["{l{ink*,x}dir,linkdir}/*", []],
      ["{l*,*(,linkdir}/*", []],
    ])("%j does not follow a link", (pattern, expected) => {
      using dir = makeNamedTree("glob-scan-symlink-unnamed");
      expect(scanSync(String(dir), pattern)).toEqual(expected);
    });

    // Not on Windows: a `\` in a pattern is a path separator there, and a file name cannot hold `*`.
    test.skipIf(isWindows)("an escaped wildcard or class is text", () => {
      using dir = makeNamedTree("glob-scan-symlink-named-escape");
      const cwd = String(dir);
      fs.symlinkSync("realdir", path.join(cwd, "link*"), "dir");
      fs.symlinkSync("package.json", path.join(cwd, "[link].json"), "file");
      expect(scanSync(cwd, "\\[id\\]/*")).toEqual(["[id]/file.txt"]);
      expect(scanSync(cwd, "\\[id\\]/file.txt")).toEqual(["[id]/file.txt"]);
      expect(scanSync(cwd, "\\[link\\].json")).toEqual(["[link].json"]);
      expect(scanSync(cwd, "{link\\*,src}/*")).toEqual(["link*/file.txt", "src/file.txt"]);
    });

    test("the matcher reads the segments above as their rows say", () => {
      expect(new Glob("!(linkdir").match("!(linkdir")).toBe(true);
      expect(new Glob("{l*,*(,linkdir}").match("linkdir")).toBe(true);
      expect(new Glob("{q*,*(,linkdir}").match("linkdir")).toBe(false);
      expect(new Glob("[[]id]").match("[id]")).toBe(true);
    });

    test("options do not change what a segment names", () => {
      using dir = makeNamedTree("glob-scan-symlink-named-options");
      const cwd = String(dir);
      expect(scanSync(cwd, "{.dotlink,src}/*", { dot: true })).toEqual([".dotlink/file.txt", "src/file.txt"]);
      expect(scanSync(cwd, "{linkdir,src}/*", { absolute: true })).toEqual(
        norm([path.join(cwd, "linkdir", "file.txt"), path.join(cwd, "src", "file.txt")]),
      );
      expect(scanSync(cwd, "{link*,src}/*", { followSymlinks: true })).toEqual([
        "link2/file.txt",
        "linkdir/file.txt",
        "src/file.txt",
      ]);
      expect(scanSync(cwd, "{linkdir,src}/*", { followSymlinks: true })).toEqual(["linkdir/file.txt", "src/file.txt"]);
    });

    test("a named link to a directory is a match itself with onlyFiles:false", () => {
      using dir = makeNamedTree("glob-scan-symlink-named-dirs");
      const cwd = String(dir);
      expect(scanSync(cwd, "{linkdir,src}", { onlyFiles: false })).toEqual(["linkdir", "src"]);
      // With a trailing separator only a directory matches, so the link has to be resolved.
      expect(scanSync(cwd, "{linkdir,src}/", { onlyFiles: false })).toEqual(["linkdir", "src"]);
      expect(scanSync(cwd, "{link*,src}/", { onlyFiles: false })).toEqual(["src"]);
    });

    // In `a/a` three components are active: `**`, the group and `*`. The group names a link there, and `*` matches it as an entry.
    test("a link that one component names is still an entry for the other components", () => {
      using dir = tempDir("glob-scan-symlink-named-entry", { "a/a/f.txt": "x", "a/sub/s.txt": "x" });
      const cwd = String(dir);
      fs.symlinkSync("f.txt", path.join(cwd, "a", "a", "lf"), "file");
      fs.symlinkSync("nowhere", path.join(cwd, "a", "a", "broken"), "file");
      fs.symlinkSync(path.join("..", "sub"), path.join(cwd, "a", "a", "ld"), "dir");
      const entries = ["a/a/broken", "a/a/f.txt", "a/a/ld", "a/a/lf"];
      expect(scanSync(cwd, "**/a/{a,lf}/*", { onlyFiles: false })).toEqual(entries);
      expect(scanSync(cwd, "**/a/{a,broken}/*", { onlyFiles: false })).toEqual(entries);
      expect(scanSync(cwd, "**/a/{a,ld}/*", { onlyFiles: false })).toEqual([...entries, "a/a/ld/s.txt"].sort());
      expect(scanSync(cwd, "**/a/{a,ld}/*")).toEqual(["a/a/f.txt", "a/a/ld/s.txt"]);
      // The same for a literal segment: `a/a/a` is a link that `a` names and `*` matches.
      fs.symlinkSync(path.join("..", "sub"), path.join(cwd, "a", "a", "a"), "dir");
      expect(scanSync(cwd, "**/a/a/*", { onlyFiles: false })).toEqual([
        "a/a/a",
        "a/a/a/s.txt",
        "a/a/broken",
        "a/a/f.txt",
        "a/a/ld",
        "a/a/lf",
      ]);
    });

    // Not on Windows: the rows pin the POSIX error of the failed open (`ENOENT` from `open`), as "error broken symlinks" above is POSIX only.
    test.skipIf(isWindows)("a broken link that a segment names throws with throwErrorOnBrokenSymlink", () => {
      using dir = makeNamedTree("glob-scan-symlink-named-broken");
      const cwd = String(dir);
      fs.symlinkSync("nowhere", path.join(cwd, "broken"), "dir");
      const enoent = { code: "ENOENT", syscall: "open" };
      expect(scanSync(cwd, "{broken,src}/*")).toEqual(["src/file.txt"]);
      expect(thrown(cwd, "broken/*", { throwErrorOnBrokenSymlink: true })).toEqual(enoent);
      expect(thrown(cwd, "{broken,src}/*", { throwErrorOnBrokenSymlink: true })).toEqual(enoent);
      expect(thrown(cwd, "{.broken,src}/*", { throwErrorOnBrokenSymlink: true })).toEqual(enoent);
      expect(thrown(cwd, "{brok*,src}/*", { throwErrorOnBrokenSymlink: true })).toEqual(["src/file.txt"]);
      // As the last segment: the literal form looks the name up and finds nothing, the group opens the link.
      expect(thrown(cwd, "broken", { throwErrorOnBrokenSymlink: true })).toEqual([]);
      expect(thrown(cwd, "{broken,package.json}", { throwErrorOnBrokenSymlink: true })).toEqual(enoent);
    });

    // What is behind a named link is read as behind a literal segment, errors included.
    // Not on Windows: the row pins `ELOOP`, the POSIX error for a link that points at itself.
    test.skipIf(isWindows)("an error behind a named link is the error of the literal form", () => {
      using dir = tempDir("glob-scan-symlink-named-eloop", { "realdir/file.txt": "x", "src/loop.txt": "x" });
      const cwd = String(dir);
      fs.symlinkSync("realdir", path.join(cwd, "linkdir"), "dir");
      fs.symlinkSync("loop.txt", path.join(cwd, "realdir", "loop.txt"), "file");
      const literal = thrown(cwd, "linkdir/loop.txt");
      expect(literal).toMatchObject({ code: "ELOOP" });
      expect(thrown(cwd, "{linkdir,src}/loop.txt")).toEqual(literal);
      expect(scanSync(cwd, "{link*,src}/loop.txt")).toEqual(["src/loop.txt"]);
    });

    // `loop` leads back to `top`. The walk goes through a followed link once, for a literal segment too.
    test("a named link that leads back above itself is followed once", () => {
      using dir = tempDir("glob-scan-symlink-named-cycle", { "top/file.txt": "x" });
      const cwd = String(dir);
      fs.symlinkSync(".", path.join(cwd, "top", "loop"), "dir");
      expect(scanSync(cwd, "top/{loop,x}/**/*.txt")).toEqual(["top/loop/file.txt"]);
      expect(scanSync(cwd, "top/{loop,x}/file.txt")).toEqual(["top/loop/file.txt"]);
      // Node and fast-glob return `top/loop/loop/file.txt` for these two.
      expect(scanSync(cwd, "top/loop/loop/file.txt")).toEqual([]);
      expect(scanSync(cwd, "top/{loop,x}/{loop,x}/file.txt")).toEqual([]);
    });

    test("packages that are links are found by a group of their names", () => {
      using dir = tempDir("glob-scan-symlink-named-packages", {
        "store/react/package.json": "{}",
        "store/react-dom/package.json": "{}",
        "store/left-pad/package.json": "{}",
        "node_modules/.keep": "",
      });
      const cwd = String(dir);
      for (const name of ["react", "react-dom", "left-pad"]) {
        fs.symlinkSync(path.join("..", "store", name), path.join(cwd, "node_modules", name), "dir");
      }
      const both = ["node_modules/react-dom/package.json", "node_modules/react/package.json"];
      expect(scanSync(cwd, "node_modules/{react,react-dom}/package.json")).toEqual(both);
      expect(scanSync(cwd, "node_modules/react{,-dom}/package.json")).toEqual(both);
      expect(scanSync(cwd, "node_modules/{react,left-*}/package.json")).toEqual([]);
    });

    // Differential check. A pattern without a wildcard returns what its expansions return, and each expansion is a literal path.
    test("generated patterns without a wildcard agree with their expansions", () => {
      using dir = tempDir("glob-scan-symlink-named-generated", { "real/f": "x", "na/f": "x", "nab/f": "x" });
      const cwd = String(dir);
      for (const name of ["nb", "nl", "nla", "nlab", "nba"]) fs.symlinkSync("real", path.join(cwd, name), "dir");

      let seed = 0x51f15e;
      const rand = (n: number) => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) % n;
      };
      type Part = [text: string, expansions: string[]];
      const atoms = ["a", "b", "l", "la", "ab", "", "x"];
      const atom = (): Part => {
        const text = atoms[rand(atoms.length)];
        return [text, [text]];
      };
      const group = (depth: number): Part => {
        const alternatives = Array.from({ length: 1 + rand(3) }, () =>
          depth < 2 && rand(4) === 0 ? group(depth + 1) : atom(),
        );
        return [`{${alternatives.map(a => a[0]).join(",")}}`, alternatives.flatMap(a => a[1])];
      };

      const failures: { pattern: string; actual: string[]; expected: string[] }[] = [];
      let throughLinks = 0;
      for (let i = 0; i < 60; i++) {
        const parts = Array.from({ length: 1 + rand(3) }, () => (rand(3) === 0 ? atom() : group(0)));
        if (!parts.some(p => p[0].includes("{"))) parts.push(group(0));
        const pattern = "n" + parts.map(p => p[0]).join("") + "/f";
        const expansions = parts.reduce((acc, p) => acc.flatMap(a => p[1].map(b => a + b)), ["n"]);
        const expected = [...new Set(expansions.flatMap(e => scanSync(cwd, e + "/f")))].sort();
        const actual = scanSync(cwd, pattern);
        if (!Bun.deepEquals(actual, expected)) failures.push({ pattern, actual, expected });
        throughLinks += expected.filter(p => p !== "na/f" && p !== "nab/f").length;
      }
      expect(failures).toEqual([]);
      // The check means something only if many of the paths are behind a link.
      expect(throughLinks).toBeGreaterThan(20);
    });

    describe.skipIf(!dtUnknownReaddir.available)("where readdir does not report the entry type", () => {
      let env: NodeJS.Dict<string>;
      // This compiles the shim. A C compiler on a busy machine can take longer than the default hook timeout.
      beforeAll(async () => {
        env = await dtUnknownReaddir.env();
      }, 30_000);

      test("the same segments name the same links", async () => {
        using dir = makeNamedTree("glob-scan-symlink-named-dt-unknown");
        const cwd = String(dir);
        fs.mkdirSync(path.join(cwd, "a", "a"), { recursive: true });
        fs.writeFileSync(path.join(cwd, "a", "a", "f.txt"), "x");
        fs.symlinkSync("f.txt", path.join(cwd, "a", "a", "lf"), "file");
        const rows: [string, GlobScanOptions, string[]][] = [
          ["linkdir/*", {}, ["linkdir/file.txt"]],
          ["{linkdir,src}/*", {}, ["linkdir/file.txt", "src/file.txt"]],
          ["{link.json,package.json}", {}, ["link.json", "package.json"]],
          ["{link*,src}/*", {}, ["src/file.txt"]],
          ["**/a/{a,lf}/*", { onlyFiles: false }, ["a/a/f.txt", "a/a/lf"]],
        ];
        const script = `const rows = ${JSON.stringify(rows.map(([pattern, opts]) => [pattern, opts]))};
          console.log(JSON.stringify(rows.map(([p, o]) => [...new Bun.Glob(p).scanSync({ followSymlinks: false, ...o })].sort())));`;

        await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], cwd, env, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect(stderr).toContain(dtUnknownReaddir.marker);
        expect(JSON.parse(stdout)).toEqual(rows.map(row => row[2]));
        expect(exitCode).toBe(0);
      });
    });
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
