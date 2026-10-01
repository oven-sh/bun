import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, normalizeBunSnapshot, tempDir } from "harness";
import { readFileSync, truncateSync, writeFileSync } from "node:fs";
import path from "path";

test("coverage crash", () => {
  using dir = tempDir("cov", {
    "demo.test.ts": `class Y {
  #hello
}`,
  });
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: ["inherit", "inherit", "inherit"],
  });
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeUndefined();
});

test("lcov coverage reporter", () => {
  using dir = tempDir("cov", {
    "demo2.ts": `
import { Y } from "./demo1";

export function covered() {
  // this function IS covered
  return Y;
}

export function uncovered() {
  // this function is not covered
  return 42;
}

covered();
`,
    "demo1.ts": `
export class Y {
#hello;
};
    `,
  });
  const result = Bun.spawnSync([bunExe(), "test", "--coverage", "--coverage-reporter", "lcov", "./demo2.ts"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: ["inherit", "inherit", "inherit"],
  });
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeUndefined();
  expect(normalizeBunSnapshot(readFileSync(path.join(dir, "coverage", "lcov.info"), "utf-8"), dir)).toMatchSnapshot(
    "lcov-coverage-reporter-output",
  );
});

test("coverage excludes node_modules directory", () => {
  using dir = tempDir("cov", {
    "node_modules/pi/index.js": `
    export const pi = 3.14;
    `,
    "demo.test.ts": `
    import { pi } from 'pi';
    console.log(pi);
    `,
  });
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });
  expect(result.stderr.toString("utf-8")).toContain("demo.test.ts");
  expect(result.stderr.toString("utf-8")).not.toContain("node_modules");
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeUndefined();
});

test("coveragePathIgnorePatterns - single pattern string", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = "ignore-me.ts"
coverageSkipTestFiles = false
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}
`,
    "ignore-me.ts": `
export function ignoreMe() {
  return "ignored";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { includeMe } from "./include-me";
import { ignoreMe } from "./ignore-me";

test("should call both functions", () => {
  expect(includeMe()).toBe("included");
  expect(ignoreMe()).toBe("ignored");
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"test.test.ts:
(pass) should call both functions
---------------|---------|---------|-------------------
File           | % Funcs | % Lines | Uncovered Line #s
---------------|---------|---------|-------------------
All files      |  100.00 |  100.00 |
 include-me.ts |  100.00 |  100.00 | 
 test.test.ts  |  100.00 |  100.00 | 
---------------|---------|---------|-------------------

 1 pass
 0 fail
 2 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - partial coverage without nan", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = "ignore-me.ts"
coverageSkipTestFiles = false
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}

export function neverCalled() {
  return "never called";
}
`,
    "ignore-me.ts": `
export function ignoreMe() {
  return "ignored";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { includeMe } from "./include-me";
import { ignoreMe } from "./ignore-me";

test("should call only some functions", () => {
  expect(includeMe()).toBe("included");
  expect(ignoreMe()).toBe("ignored");
  // Note: neverCalled() is not called, so coverage should be partial
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"test.test.ts:
(pass) should call only some functions
---------------|---------|---------|-------------------
File           | % Funcs | % Lines | Uncovered Line #s
---------------|---------|---------|-------------------
All files      |   75.00 |   83.33 |
 include-me.ts |   50.00 |   66.67 | 6
 test.test.ts  |  100.00 |  100.00 | 
---------------|---------|---------|-------------------

 1 pass
 0 fail
 2 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - array of patterns", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = ["utils/**", "*.config.ts"]
coverageSkipTestFiles = false
`,
    "src/main.ts": `
export function main() {
  return "main";
}
`,
    "utils/helper.ts": `
export function helper() {
  return "helper";
}
`,
    "build.config.ts": `
export const config = { build: true };
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { main } from "./src/main";
import { helper } from "./utils/helper";
import { config } from "./build.config";

test("should call all functions", () => {
  expect(main()).toBe("main");
  expect(helper()).toBe("helper");
  expect(config.build).toBe(true);
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"test.test.ts:
(pass) should call all functions
--------------|---------|---------|-------------------
File          | % Funcs | % Lines | Uncovered Line #s
--------------|---------|---------|-------------------
All files     |  100.00 |  100.00 |
 src/main.ts  |  100.00 |  100.00 | 
 test.test.ts |  100.00 |  100.00 | 
--------------|---------|---------|-------------------

 1 pass
 0 fail
 3 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - glob patterns", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = ["**/*.spec.ts", "test-utils/**"]
coverageSkipTestFiles = false
`,
    "src/feature.ts": `
export function feature() {
  return "feature";
}
`,
    "src/feature.spec.ts": `
export function featureSpec() {
  return "spec";
}
`,
    "test-utils/index.ts": `
export function testUtils() {
  return "utils";
}
`,
    "main.test.ts": `
import { test, expect } from "bun:test";
import { feature } from "./src/feature";
import { featureSpec } from "./src/feature.spec";
import { testUtils } from "./test-utils";

test("should call all functions", () => {
  expect(feature()).toBe("feature");
  expect(featureSpec()).toBe("spec");
  expect(testUtils()).toBe("utils");
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"main.test.ts:
(pass) should call all functions

src/feature.spec.ts:
----------------|---------|---------|-------------------
File            | % Funcs | % Lines | Uncovered Line #s
----------------|---------|---------|-------------------
All files       |  100.00 |  100.00 |
 main.test.ts   |  100.00 |  100.00 | 
 src/feature.ts |  100.00 |  100.00 | 
----------------|---------|---------|-------------------

 1 pass
 0 fail
 3 expect() calls
Ran 1 test across 2 files."
`);
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - lcov reporter", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = "ignore-me.ts"
coverageSkipTestFiles = false
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}
`,
    "ignore-me.ts": `
export function ignoreMe() {
  return "ignored";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { includeMe } from "./include-me";
import { ignoreMe } from "./ignore-me";

test("should call both functions", () => {
  expect(includeMe()).toBe("included");
  expect(ignoreMe()).toBe("ignored");
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage", "--coverage-reporter", "lcov"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let lcovContent = readFileSync(path.join(dir, "coverage", "lcov.info"), "utf-8");
  // Normalize LCOV content for cross-platform consistency
  lcovContent = normalizeBunSnapshot(lcovContent, dir);

  expect(lcovContent).toMatchInlineSnapshot(`
"TN:
SF:include-me.ts
FNF:1
FNH:1
DA:2,11
DA:3,17
LF:2
LH:2
end_of_record
TN:
SF:test.test.ts
FNF:1
FNH:1
DA:2,40
DA:3,41
DA:4,39
DA:6,42
DA:7,39
DA:8,36
DA:9,2
LF:7
LH:7
end_of_record"
`);
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - invalid config type", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = 123
coverageSkipTestFiles = false
`,
    "test.test.ts": `
import { test, expect } from "bun:test";

test("should pass", () => {
  expect(true).toBe(true);
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize error output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"3 | coveragePathIgnorePatterns = 123
                                 ^
error: coveragePathIgnorePatterns must be a string or array of strings
    at <dir>/bunfig.toml:3:30

Invalid Bunfig: failed to load bunfig"
`);
  expect(result.exitCode).toBe(1);
});

test("coveragePathIgnorePatterns - invalid array item", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = ["valid-pattern", 123]
coverageSkipTestFiles = false
`,
    "test.test.ts": `
import { test, expect } from "bun:test";

test("should pass", () => {
  expect(true).toBe(true);
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize error output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"3 | coveragePathIgnorePatterns = ["valid-pattern", 123]
                                                   ^
error: coveragePathIgnorePatterns array must contain only strings
    at <dir>/bunfig.toml:3:48

Invalid Bunfig: failed to load bunfig"
`);
  expect(result.exitCode).toBe(1);
});

test("coveragePathIgnorePatterns - empty array", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = []
coverageSkipTestFiles = false
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { includeMe } from "./include-me";

test("should call function", () => {
  expect(includeMe()).toBe("included");
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"test.test.ts:
(pass) should call function
---------------|---------|---------|-------------------
File           | % Funcs | % Lines | Uncovered Line #s
---------------|---------|---------|-------------------
All files      |  100.00 |  100.00 |
 include-me.ts |  100.00 |  100.00 | 
 test.test.ts  |  100.00 |  100.00 | 
---------------|---------|---------|-------------------

 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - ignore all files", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = "**"
coverageSkipTestFiles = false
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { includeMe } from "./include-me";

test("should call function", () => {
  expect(includeMe()).toBe("included");
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"test.test.ts:
(pass) should call function
-----------|---------|---------|-------------------
File       | % Funcs | % Lines | Uncovered Line #s
-----------|---------|---------|-------------------
All files  |    0.00 |    0.00 |
-----------|---------|---------|-------------------

 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});

// `bun build --target=bun` writes a file that starts with `// @bun`, and a JSON source map for
// it. The report of such a file is in the lines of its sources. The map does not say how many
// lines they have, and the report made room for 2^31 of them: 768 MiB for each file, and under
// `--parallel` a 9 GB message that the worker could not build. The room is now one past the
// largest line that a mapping names, and never more than the source text at hand can have.
// https://github.com/oven-sh/bun/issues/44325
describe("a file with a JSON source map", () => {
  const source = "export function first() {\n  return 1;\n}\nexport function second() {\n  return 2;\n}\n";
  // A hand-made file is `// @bun`, then `source`, then the comment that names its map.
  // `lineByLine` maps each line of `source` in it to itself.
  const handMade = (name: string) => `// @bun\n${source}//# sourceMappingURL=${name}.js.map\n`;
  const lineByLine = ";AAAA;AACA;AACA;AACA;AACA;AACA";
  // One more mapping, for the comment: the line of the source goes up by 2^31 - 6, to 2^31 - 1.
  const hugeLine = lineByLine + ";AA0/////DA";
  type SourceMapFields = { sources: string[]; sourcesContent: (string | null)[]; mappings: string };
  const map = (fields: Partial<SourceMapFields> = {}) =>
    JSON.stringify({
      version: 3,
      sources: ["../src/lib.ts"],
      sourcesContent: [source],
      mappings: lineByLine,
      names: [],
      ...fields,
    });
  // `undefined`: the file names a map that does not exist, so its report is in its own lines.
  const handMadeMaps: Record<string, string | undefined> = {
    "plain": map(),
    "no-map": undefined,
    "no-mappings": map({ mappings: "" }),
    "huge-line": map({ mappings: hugeLine }),
    // The last line of `plain` in the report is 6. A text of 5 bytes can have 6 lines.
    "text-of-5-bytes": map({ sourcesContent: ["12345"] }),
    "text-of-4-bytes": map({ sourcesContent: ["1234"] }),
    "null-text": map({ sourcesContent: [null] }),
    "empty-text": map({ sourcesContent: [""] }),
    "null-text-huge-line": map({ sourcesContent: [null], mappings: hugeLine }),
    "null-text-missing-file": map({ sources: ["../src/missing.ts"], sourcesContent: [null] }),
    "no-sources": map({ sources: [], sourcesContent: [] }),
  };
  // [the map, the end of its warning]
  const unreadable: [string, RegExp][] = [
    ["null-text-missing-file", /missing\.ts" and the file could not be read \(ENOENT\)$/],
    ["no-sources", /: the sourcemap names no source$/],
  ];
  if (isPosix) {
    handMadeMaps["null-text-fifo"] = map({ sources: ["../src/fifo"], sourcesContent: [null] });
    handMadeMaps["null-text-2-gib-file"] = map({ sources: ["../src/2-gib"], sourcesContent: [null] });
    unreadable.push(
      ["null-text-fifo", /fifo" and the file could not be read \(not a regular file\)$/],
      ["null-text-2-gib-file", /2-gib" and the file could not be read \(larger than 2 GiB\)$/],
    );
  }
  const handMadeNames = Object.keys(handMadeMaps);

  const bunfig = "[test]\ncoverageSkipTestFiles = true\ncoverageThreshold = { functions = 0.9 }\n";
  const files: Record<string, string> = {
    "bunfig.toml": bunfig,
    "ignore-maps.toml": bunfig + "coverageIgnoreSourcemaps = true\n",
    "src/lib.ts": source,
    // The map of the bundle of these two has both texts. `long.ts` has the larger lines.
    "src/short.ts":
      'import * as long from "./long.ts";\nexport const pick = (n: number) => [long.one, long.two, long.three, long.last][n];\n',
    "src/long.ts":
      "export function one() {\n  return 1;\n}\nexport function two() {\n  return 2;\n}\n" +
      'export function three() {\n  return 3;\n}\nexport function last() {\n  return "never called";\n}\n',
    "built.test.ts": `
import { expect, test } from "bun:test";
import { first } from "./dist/linked/lib.js";

test("calls first", () => {
  expect(first()).toBe(1);
});
`,
    "others.test.ts": `
import { expect, test } from "bun:test";
import { codeCoverageForFile } from "bun:jsc";
import { first as inline } from "./dist/inline/lib.js";
import { first as external } from "./dist/external/lib.js";
import { pick } from "./dist/bundle/short.js";
${handMadeNames.map((name, i) => `import { first as handMade${i} } from "./dist/${name}.js";`).join("\n")}

test("calls first of each file", () => {
  for (const first of [inline, external, ${handMadeNames.map((_, i) => `handMade${i}`).join(", ")}]) expect(first()).toBe(1);
  expect(pick(0)()).toBe(1);
  // codeCoverageForFile() takes the path as the module loader spells it.
  const row = (name: string) => codeCoverageForFile(Bun.resolveSync("./dist/" + name + ".js", import.meta.dir), false);
  console.log(JSON.stringify({ plain: row("plain"), unreadable: [row("no-sources"), row("no-sources")] }));
});
`,
    // On Linux the peak RSS of a child starts at the RSS of its parent, and the process that runs
    // this file is large. So a small process starts the two runs to compare.
    "peak-rss-fixture.ts": `
async function run(config: string) {
  const proc = Bun.spawn({
    cmd: [process.execPath, "--config=" + config, "test", "--coverage", "./built.test.ts"],
    cwd: import.meta.dir,
    stdio: ["ignore", "ignore", "ignore"],
  });
  const exitCode = await proc.exited;
  return { maxRSS: proc.resourceUsage()!.maxRSS, exitCode };
}
const [withTheMap, withoutTheMap] = await Promise.all([run("bunfig.toml"), run("ignore-maps.toml")]);
console.log(JSON.stringify({ withTheMap, withoutTheMap }));
`,
  };
  for (const [name, text] of Object.entries(handMadeMaps)) {
    files[`dist/${name}.js`] = handMade(name);
    if (text !== undefined) files[`dist/${name}.js.map`] = text;
  }

  type Row = { functions: string; lines: string; uncovered: string };
  type Report = {
    rows: Record<string, Row>;
    // For each file, the lines that its lcov record has a `DA:` entry for.
    lines: Record<string, number[]>;
    lcov: string;
    stdout: string;
    stderr: string;
    exitCode: number;
  };
  async function report(cwd: string, coverageDir: string, ...args: string[]): Promise<Report> {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        "--coverage",
        "--coverage-reporter=text",
        "--coverage-reporter=lcov",
        `--coverage-dir=${coverageDir}`,
        ...args,
      ],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const rows: Report["rows"] = {};
    for (const [, file, functions, lines, uncovered] of stderr.matchAll(
      /^ (\S+) +\| +(\d+\.\d+) \| +(\d+\.\d+) \| ?([\d,-]*)$/gm,
    )) {
      rows[file.replaceAll("\\", "/")] = { functions, lines, uncovered };
    }
    const lcov = readFileSync(path.join(cwd, coverageDir, "lcov.info"), "utf-8");
    const lines: Report["lines"] = {};
    for (const record of lcov.split("end_of_record")) {
      const file = record.match(/^SF:(.+)$/m)?.[1].replaceAll("\\", "/");
      if (file) lines[file] = Array.from(record.matchAll(/^DA:(\d+),/gm), ([, line]) => Number(line));
    }
    return { rows, lines, lcov, stdout, stderr, exitCode };
  }

  let dir: ReturnType<typeof tempDir>;
  let bundleMappings: string;
  let serial: Report;
  let parallel: Report;

  beforeAll(async () => {
    dir = tempDir("cov-json-source-map", files);
    const cwd = String(dir);
    if (isPosix) {
      expect(Bun.spawnSync(["mkfifo", path.join(cwd, "src", "fifo")]).exitCode).toBe(0);
      // One byte more than the longest text that a parser of bun takes. It has no data on disk.
      writeFileSync(path.join(cwd, "src", "2-gib"), "");
      truncateSync(path.join(cwd, "src", "2-gib"), 2 ** 31);
    }
    const build = (entry: string, outdir: string, sourcemap: "linked" | "inline" | "external") =>
      Bun.build({
        entrypoints: [path.join(cwd, "src", entry)],
        outdir: path.join(cwd, "dist", outdir),
        target: "bun",
        sourcemap,
        throw: true,
      });
    await Promise.all([
      build("lib.ts", "linked", "linked"),
      build("lib.ts", "inline", "inline"),
      build("lib.ts", "external", "external"),
      build("short.ts", "bundle", "linked"),
    ]);
    bundleMappings = JSON.parse(readFileSync(path.join(cwd, "dist", "bundle", "short.js.map"), "utf-8")).mappings;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "peak-rss-fixture.ts"],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(exitCode).toBe(0);
    const { withTheMap, withoutTheMap } = JSON.parse(stdout);
    // Each run reports that `second` was never called, which is below the threshold.
    expect([withTheMap.exitCode, withoutTheMap.exitCode]).toEqual([1, 1]);
    // The run with the map took 768 MiB more. While it does, the runs of the next hook need
    // gigabytes, and they do not start after a hook that failed.
    expect(withTheMap.maxRSS - withoutTheMap.maxRSS).toBeLessThan(256 * 1024 * 1024);
  });

  beforeAll(async () => {
    [serial, parallel] = await Promise.all([
      report(String(dir), "serial"),
      report(String(dir), "parallel", "--parallel=2"),
    ]);
  });

  afterAll(() => dir?.[Symbol.dispose]());

  test.each(["linked", "inline", "external"])("bun build --sourcemap=%s reports the lines of the source", kind => {
    // `second` is never called. It starts on line 4, and `return 2;` is line 5.
    expect(serial.rows[`dist/${kind}/lib.js`]).toEqual({
      functions: "50.00",
      lines: expect.any(String),
      uncovered: expect.stringMatching(/^4(-5)?$/),
    });
    expect(serial.lines[`dist/${kind}/lib.js`]).toEqual([1, 2, 4, 5]);
  });

  test("a bundle of two sources has room for the lines of the longer one", () => {
    // The parser of mappings takes another path for 128 bytes and more.
    expect(bundleMappings.length).toBeGreaterThanOrEqual(128);
    // short.ts has 2 lines. `return "never called";` is line 11 of long.ts, which has 12.
    expect(serial.lines["dist/bundle/short.js"]).toContain(11);
    expect(Math.max(...serial.lines["dist/bundle/short.js"])).toBeLessThanOrEqual(12);
  });

  test("a hand-made map reports the lines that it names", () => {
    expect(serial.rows["dist/plain.js"]).toEqual({ functions: "50.00", lines: expect.any(String), uncovered: "4" });
    expect(serial.lines["dist/plain.js"]).toEqual(expect.arrayContaining([1, 6]));
    expect(Math.max(...serial.lines["dist/plain.js"])).toBe(6);
    // Without the map the same text reports its own lines, which are one further down.
    expect(serial.rows["dist/no-map.js"].uncovered).toBe("5");
  });

  test("a map with no mappings reports no line", () => {
    expect(serial.rows["dist/no-mappings.js"]).toEqual({ functions: "100.00", lines: "100.00", uncovered: "" });
    expect(serial.lines["dist/no-mappings.js"]).toEqual([]);
  });

  test("a mapping to line 2^31 of a text of 6 lines is dropped", () => {
    expect(serial.rows["dist/huge-line.js"]).toEqual(serial.rows["dist/plain.js"]);
    expect(serial.lines["dist/huge-line.js"]).toEqual(serial.lines["dist/plain.js"]);
  });

  test("a text of n bytes has room for n + 1 lines", () => {
    expect(serial.lines["dist/text-of-5-bytes.js"]).toEqual(serial.lines["dist/plain.js"]);
    expect(serial.lines["dist/text-of-4-bytes.js"]).toEqual(serial.lines["dist/plain.js"].filter(line => line < 6));
  });

  describe("with no text for a source in the map", () => {
    test.each(["null-text", "empty-text", "null-text-huge-line"])("%s: the file of the source has the lines", name => {
      expect(serial.rows[`dist/${name}.js`]).toEqual(serial.rows["dist/plain.js"]);
      expect(serial.lines[`dist/${name}.js`]).toEqual(serial.lines["dist/plain.js"]);
    });

    test.each(unreadable)("%s: the report is in the lines of the built file, with a warning", (name, why) => {
      expect(serial.rows[`dist/${name}.js`]).toEqual(serial.rows["dist/no-map.js"]);
      expect(serial.lines[`dist/${name}.js`]).toEqual(serial.lines["dist/no-map.js"]);
      const warnings = serial.stderr.split("\n").filter(line => line.includes(" is not mapped to its sources"));
      expect(warnings.filter(line => line.includes(`${name}.js"`))).toEqual([
        expect.stringMatching(/^warn: Coverage of ".+" is not mapped to its sources: the sourcemap /),
      ]);
      expect(warnings.find(line => line.includes(`${name}.js"`))).toMatch(why);
      // No other file has the warning. codeCoverageForFile() reported `no-sources` twice before.
      expect(warnings).toHaveLength(unreadable.length);
    });
  });

  test("bun:jsc codeCoverageForFile()", () => {
    const rows = JSON.parse(serial.stdout.split("\n").find(line => line.startsWith("{"))!);
    expect(rows.plain).toMatch(/plain\.js \| +50\.00 \| +\d+\.\d+ \| 4$/);
    expect(rows.unreadable[0]).toMatch(/no-sources\.js \| +50\.00 \| +\d+\.\d+ \| 5$/);
    expect(rows.unreadable[1]).toBe(rows.unreadable[0]);
  });

  test("--parallel reports what the serial run reports", () => {
    expect(parallel.rows).toEqual(serial.rows);
    expect(parallel.lcov).toBe(serial.lcov);
    // The threshold fails each run.
    expect([serial.exitCode, parallel.exitCode]).toEqual([1, 1]);
  });
});

// https://github.com/oven-sh/bun/issues/39930
// One worker executes count(), the other only imports the module. The
// import-only worker reports the unexecuted function's whole line range
// (blank line 5 included) as executable with zero hits. The merge must not
// let that over-approximation mark the fully executed function as
// partially covered.
test("--parallel merges line coverage across workers", async () => {
  using dir = tempDir("cov-parallel-merge", {
    "subject.ts": `await Bun.sleep(100);

export default function count(values: string[]) {
  const count = values.length;

  return count;
}
`,
    "execute.test.ts": `
import { expect, test } from "bun:test";
import count from "./subject.ts";

test("executes the function", () => {
  expect(count(["first", "second"])).toBe(2);
});
`,
    "importOnly.test.ts": `
import { expect, test } from "bun:test";
import count from "./subject.ts";

test("only imports the function", () => {
  expect(typeof count).toBe("function");
});
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", "--parallel=2"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8");
  const record = lcov.split("end_of_record").find(r => r.includes("SF:subject.ts"));
  expect(record).toBeDefined();
  // Blank line 5 is only "executable" in the worker that never ran count().
  expect(record).not.toContain("DA:5,");
  expect(record).toMatch(/LF:4\nLH:4\n/);

  expect(stderr).toMatch(/ subject\.ts +\| +100\.00 +\| +100\.00 +\| +\n/);
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/40586
// Each worker executes a different function of the same module; the merged
// report must count a function as covered if any worker ran it.
test("--parallel merges function coverage across workers", async () => {
  // Each test file waits at import time until the other has started, so the
  // two can only make progress in two different workers.
  const rendezvous = (me: string, other: string) => `
await Bun.write("${me}.started", "");
for (const deadline = Date.now() + 60_000; !(await Bun.file("${other}.started").exists()); ) {
  if (Date.now() > deadline) throw new Error("${other} never started in another worker");
  await Bun.sleep(5);
}
`;
  using dir = tempDir("cov-parallel-fn-merge", {
    "bunfig.toml": `[test]\ncoverageSkipTestFiles = true\ncoverageThreshold = { lines = 1.0, functions = 1.0 }\n`,
    "subject.ts": `export function first() {
  return 1;
}
export function second() {
  return 2;
}
`,
    "first.test.ts": `${rendezvous("first", "second")}
import { expect, test } from "bun:test";
import { first } from "./subject.ts";

test("calls first", () => {
  expect(first()).toBe(1);
});
`,
    "second.test.ts": `${rendezvous("second", "first")}
import { expect, test } from "bun:test";
import { second } from "./subject.ts";

test("calls second", () => {
  expect(second()).toBe(2);
});
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", "--parallel=2"],
    env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("2 pass");
  expect(stderr).toMatch(/ subject\.ts +\| +100\.00 +\| +100\.00 +\| +\n/);
  const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8");
  const record = lcov.split("end_of_record").find(r => r.includes("SF:subject.ts"));
  expect(record).toMatch(/FNF:2\nFNH:2\n/);
  expect(exitCode).toBe(0);
});

// JSC records coverage per SourceProvider, and a file has one for each time
// it is loaded. Each case has a subject file of its own. Where a case loads
// its subject twice, one load runs the `if` branch and the other runs the
// `return` after it.
describe("a file loaded more than once counts every load", () => {
  const esm = `export function covered(n: number): number {
  if (n > 5) {
    return n * 2;
  }
  return n + 1;
}
`;
  const cjs = `exports.covered = function covered(n) {
  if (n > 5) {
    return n * 2;
  }
  return n + 1;
};
`;
  const compiledText =
    Buffer.alloc(12, "\n").toString() +
    "exports.other = function other(n) {\n  if (n > 5) {\n    return 1;\n  }\n  return 2;\n};\nexports.other(1);\n";

  const files = {
    "host-and-graph.ts": esm,
    "two-graphs.ts": esm,
    "cjs-host-and-graph.cjs": cjs,
    "query-strings.ts": esm,
    "overlapping-imports.ts": esm,
    "require-cache.cjs": cjs,
    // https://github.com/oven-sh/bun/issues/35345
    "issue-35345.ts": `export const MODULE_SCOPE = "evaluated";

export function fnA(x: number): number {
  const a = x + 1;
  return a * 2;
}

export function fnB(x: number): number {
  const b = x + 10;
  return b * 3;
}
`,
    "functions.ts": `export function first() {
  return 1;
}
export function second() {
  return 2;
}
export function third() {
  return 3;
}
`,
    "cjs-graph-alone.cjs": cjs,
    "compile-target.cjs": cjs,
    "compile.cjs": `
const Module = require("node:module");
exports.compileAs = (filename, text) => {
  const module = new Module(filename);
  module.filename = filename;
  module._compile(text, filename);
  return module.exports;
};
`,
    // With ONE_LOAD=1 the last three cases leave out the load under test, to compare against.
    "loads.test.ts": `
import { expect, test } from "bun:test";
import { codeCoverageForFile } from "bun:jsc";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { covered as hostAndGraph } from "./host-and-graph.ts";
import { first } from "./functions.ts";
const cjsHostAndGraph = require("./cjs-host-and-graph.cjs");
const compileTarget = require("./compile-target.cjs");

const oneLoad = !!process.env.ONE_LOAD;
// codeCoverageForFile() takes the path as the module loader spells it.
const here = name => join(import.meta.dir, name);

test("host-and-graph.ts", async () => {
  expect(hostAndGraph(1)).toBe(2);
  const hostAlone = codeCoverageForFile(here("host-and-graph.ts"), false);
  using graph = new Bun.ModuleGraph({});
  const subject = await graph.import(here("host-and-graph.ts"));
  expect(graph.run(() => subject.covered(10))).toBe(20);
  console.log(JSON.stringify({ hostAlone, both: codeCoverageForFile(here("host-and-graph.ts"), false) }));
  expect(() => codeCoverageForFile(here("never-loaded.ts"), false)).toThrow("No source for file");
});

test("two-graphs.ts", async () => {
  using a = new Bun.ModuleGraph({});
  using b = new Bun.ModuleGraph({});
  const inA = await a.import(here("two-graphs.ts"));
  const inB = await b.import(here("two-graphs.ts"));
  expect(a.run(() => inA.covered(10))).toBe(20);
  expect(b.run(() => inB.covered(1))).toBe(2);
});

test("cjs-host-and-graph.cjs", async () => {
  expect(cjsHostAndGraph.covered(1)).toBe(2);
  using graph = new Bun.ModuleGraph({});
  const subject = await graph.import(here("cjs-host-and-graph.cjs"));
  expect(graph.run(() => subject.covered(10))).toBe(20);
});

test("query-strings.ts", async () => {
  const a = await import("./query-strings.ts?a");
  const b = await import("./query-strings.ts?b");
  expect(a.covered).not.toBe(b.covered);
  expect(a.covered(10)).toBe(20);
  expect(b.covered(1)).toBe(2);
});

test("overlapping-imports.ts", async () => {
  const [a, b] = await Promise.all([import("./overlapping-imports.ts"), import("./overlapping-imports.ts")]);
  expect(a).toBe(b);
  expect(a.covered(10)).toBe(20);
  expect(b.covered(1)).toBe(2);
});

test("issue-35345.ts", async () => {
  const first = await import("./issue-35345.ts?bun-spec=1");
  expect(first.fnA(1)).toBe(4);
  const second = await import("./issue-35345.ts?bun-spec=2");
  expect(second.fnB(1)).toBe(33);
});

test("require-cache.cjs", () => {
  const a = require("./require-cache.cjs");
  delete require.cache[require.resolve("./require-cache.cjs")];
  const b = require("./require-cache.cjs");
  expect(a.covered).not.toBe(b.covered);
  expect(a.covered(10)).toBe(20);
  expect(b.covered(1)).toBe(2);
});

test("functions.ts", async () => {
  expect(first()).toBe(1);
  using graph = new Bun.ModuleGraph({});
  const subject = await graph.import(here("functions.ts"));
  expect(graph.run(() => subject.second())).toBe(2);
});

test("cjs-graph-alone.cjs", async () => {
  if (oneLoad) {
    expect(require("./cjs-graph-alone.cjs").covered(10)).toBe(20);
    return;
  }
  using graph = new Bun.ModuleGraph({});
  const subject = await graph.import(here("cjs-graph-alone.cjs"));
  expect(graph.run(() => subject.covered(10))).toBe(20);
});

test("compile-target.cjs", async () => {
  expect(compileTarget.covered(1)).toBe(2);
  if (oneLoad) return;
  using graph = new Bun.ModuleGraph({});
  const { compileAs } = await graph.import(here("compile.cjs"));
  const compiled = graph.run(() => compileAs(here("compile-target.cjs"), ${JSON.stringify(compiledText)}));
  expect(compiled.other(10)).toBe(1);
});

test("changed.ts", async () => {
  if (!oneLoad) {
    writeFileSync(here("changed.ts"), ${JSON.stringify(esm)});
    const before = await import("./changed.ts?before");
    expect(before.covered(10)).toBe(20);
  }
  writeFileSync(here("changed.ts"), ${JSON.stringify("export function unused() {\n  return 0;\n}\n" + esm)});
  const after = await import("./changed.ts?after");
  expect(after.covered(1)).toBe(2);
});
`,
  };

  // A plugin's onLoad result gets a new SourceProvider for every load, under --isolate too.
  // https://github.com/oven-sh/bun/issues/40386
  const pluginFiles = {
    "bunfig.toml": `[test]\npreload = ["./plugin.ts"]\n`,
    "plugin.ts": `
import { plugin } from "bun";

plugin({
  name: "passthrough",
  setup(build) {
    build.onLoad({ filter: /plugin-loaded\\.ts$/ }, async ({ path }) => {
      return { contents: await Bun.file(path).text(), loader: "ts" };
    });
  },
});
`,
    "plugin-loaded.ts": esm,
    "a.test.ts": `
import { expect, test } from "bun:test";
import { covered } from "./plugin-loaded.ts";

test("a", () => {
  expect(covered(10)).toBe(20);
});
`,
    "b.test.ts": `
import { expect, test } from "bun:test";
import { covered } from "./plugin-loaded.ts";

test("b", () => {
  expect(covered(1)).toBe(2);
});
`,
  };

  type Row = { functions: string; lines: string; uncovered: string };
  async function run(fixture: Record<string, string>, args: string[], env: Record<string, string> = {}) {
    using dir = tempDir("cov-loaded-twice", fixture);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", ...args],
      env: { ...bunEnv, ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(stderr);
    const rows: Record<string, Row> = {};
    for (const line of stderr.split("\n")) {
      const [file, functions, lines, uncovered] = line.split("|").map(column => column.trim());
      if (uncovered !== undefined) rows[file] = { functions, lines, uncovered };
    }
    const lcov: Record<string, string> = {};
    for (const record of readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8").split(
      "end_of_record",
    )) {
      const file = record.match(/^SF:(.+)$/m)?.[1];
      if (file) lcov[file] = record;
    }
    return { rows, lcov, stdout };
  }

  let loaded: Awaited<ReturnType<typeof run>>;
  let oneLoad: Awaited<ReturnType<typeof run>>;
  let pluginUnderIsolate: Awaited<ReturnType<typeof run>>;
  beforeAll(async () => {
    [loaded, oneLoad, pluginUnderIsolate] = await Promise.all([
      run(files, ["./loads.test.ts"]),
      run(files, ["./loads.test.ts"], { ONE_LOAD: "1" }),
      run(pluginFiles, ["--isolate", "./a.test.ts", "./b.test.ts"]),
    ]);
  });

  const fullyCovered: Row = { functions: "100.00", lines: "100.00", uncovered: "" };

  describe.each([
    ["by the host and by a Bun.ModuleGraph", "host-and-graph.ts"],
    ["by two Bun.ModuleGraphs", "two-graphs.ts"],
    ["CommonJS, by the host and by a Bun.ModuleGraph", "cjs-host-and-graph.cjs"],
    ["under two query strings", "query-strings.ts"],
    ["by two overlapping import()s", "overlapping-imports.ts"],
    ["again after a require.cache delete", "require-cache.cjs"],
  ])("%s", (_, file) => {
    test("is fully covered", () => {
      expect(loaded.rows[file]).toEqual(fullyCovered);
    });
  });

  test("from a plugin's onLoad, by two test files under --isolate", () => {
    expect(pluginUnderIsolate.rows["plugin-loaded.ts"]).toEqual(fullyCovered);
  });

  test("lcov has the functions and the lines of both loads (#35345)", () => {
    expect(loaded.lcov["issue-35345.ts"]).toMatch(/FNF:2\nFNH:2\n/);
    expect(loaded.lcov["issue-35345.ts"]).not.toMatch(/DA:\d+,0\n/);
  });

  test("a function counts if any load ran it, and not if none did", () => {
    // The host runs first(), a graph runs second(). third() spans lines 7 to 9.
    expect(loaded.rows["functions.ts"]).toEqual({
      functions: "66.67",
      lines: expect.any(String),
      uncovered: expect.stringMatching(/^[789](-[89])?$/),
    });
  });

  test("CommonJS, by a Bun.ModuleGraph alone, reports what the host alone reports", () => {
    expect(oneLoad.rows["cjs-graph-alone.cjs"].uncovered).not.toBe("");
    expect(loaded.rows["cjs-graph-alone.cjs"]).toEqual(oneLoad.rows["cjs-graph-alone.cjs"]);
  });

  // module._compile() names a file and brings a text of its own, which no
  // line table describes. In a graph it runs under a wrapping SourceProvider,
  // like the graph's load of the file itself, and must not count as one.
  test("module._compile() in a Bun.ModuleGraph does not count as a load of the file it names", () => {
    expect(oneLoad.rows["compile-target.cjs"].uncovered).not.toBe("");
    expect(loaded.rows["compile-target.cjs"]).toEqual(oneLoad.rows["compile-target.cjs"]);
  });

  // The line table and the source map on record describe one text, so a load
  // of another text starts the file's coverage over.
  test("a file that changed between two loads reports the last text alone", () => {
    expect(oneLoad.rows["changed.ts"].functions).toBe("50.00");
    expect(loaded.rows["changed.ts"]).toEqual(oneLoad.rows["changed.ts"]);
  });

  test("bun:jsc codeCoverageForFile()", () => {
    expect(JSON.parse(loaded.stdout.split("\n").find(line => line.startsWith("{"))!)).toEqual({
      hostAlone: expect.stringMatching(/host-and-graph\.ts \| +100\.00 \| +\d+\.\d+ \| \d/),
      both: expect.stringMatching(/host-and-graph\.ts \| +100\.00 \| +100\.00 \| $/),
    });
  });
});
