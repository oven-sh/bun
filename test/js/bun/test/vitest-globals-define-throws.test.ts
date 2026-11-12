// `globals = "vitest"`: before each test file, `bun test` reads the names that globalThis lacks from the module object of "vitest".
// The files of a run share that object, so an export that one file makes throw is read for the next file.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

// Split in two because `bun test` scans a test file's whole text for this name, this file's included.
const pragma = "@vitest" + "-environment";
const getter = `{ configurable: true, enumerable: true, get() { throw new Error("thrown by the getter"); } }`;
const arm = `Object.defineProperty(require("vitest"), "describe", ${getter});`;
const passes = `test("passes", () => {});`;
const files = {
  "a.test.js": `test("arms the getter", () => { delete globalThis.describe; ${arm} });`,
  "b.test.js": passes,
  "c.test.js": passes,
};
const armed = ["a.test.js:", "(pass) arms the getter"];
const thrown = "error: thrown by the getter";
const bothFail = [
  ...armed,
  "b.test.js:",
  thrown,
  "c.test.js:",
  thrown,
  " 1 pass",
  " 2 fail",
  " 2 errors",
  "Ran 3 tests across 3 files.",
];

// `report`: which files ran, how each ended, and how the run ended.
async function runTests(files: Record<string, string>, args: string[]) {
  using dir = tempDir("vitest-globals-define-throws", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--globals=vitest", ...args],
    env: { ...bunEnv, CI: "false" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    log: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")),
    report: stderr
      .split("\n")
      .filter(line => /^\S+\.test\.js:|^\((pass|fail)\) |^error: |^ \d+ (pass|fail|errors?)$|^Ran /.test(line))
      .map(line => line.replace(/ \[[\d.]+m?s\]$/, "")),
    exitCode,
  };
}

describe.concurrent("a throw while the Vitest globals are defined fails that file, and the next file runs", () => {
  test.each([
    ["every file after the one that arms the getter", files, [], bothFail],
    [
      "a getter that throws once: the file after the failed one passes",
      {
        ...files,
        "a.test.js": `
          const vitest = require("vitest");
          test("arms the getter", () => {
            const { describe } = vitest;
            let reads = 0;
            delete globalThis.describe;
            Object.defineProperty(vitest, "describe", {
              configurable: true,
              enumerable: true,
              get() {
                if (reads++ === 0) throw new Error("thrown by the getter");
                return describe;
              },
            });
          });
        `,
      },
      [],
      [
        ...armed,
        "b.test.js:",
        thrown,
        "c.test.js:",
        "(pass) passes",
        " 2 pass",
        " 1 fail",
        " 1 error",
        "Ran 3 tests across 3 files.",
      ],
    ],
    [
      // A preload that failed is loaded again for the next file. A file with environment options loads it in the project's environment first.
      "a file with environment options, which loads the preloads in the project's environment",
      {
        "setup.js": `delete globalThis.describe; ${arm} throw new Error("thrown by the preload");`,
        "a.test.js": passes,
        "b.test.js": `// ${pragma}-options {}\n${passes}`,
      },
      ["--preload=./setup.js"],
      [
        "a.test.js:",
        "error: thrown by the preload",
        "b.test.js:",
        thrown,
        " 0 pass",
        " 2 fail",
        " 2 errors",
        "Ran 2 tests across 2 files.",
      ],
    ],
    [
      // The module object starts as a copy of the exports of "bun:test", made when the globals are first defined. Only a DOM package runs before that.
      `an export of "bun:test", read when the module object is created`,
      {
        "node_modules/happy-dom/package.json": `{ "name": "happy-dom", "version": "0.0.0", "main": "index.js" }`,
        "node_modules/happy-dom/index.js": `Object.defineProperty(require("bun:test"), "describe", ${getter}); throw new Error("thrown by the package");`,
        "a.test.js": `// ${pragma} happy-dom\n${passes}`,
        "b.test.js": passes,
      },
      [],
      ["a.test.js:", thrown, "b.test.js:", thrown, " 0 pass", " 2 fail", " 2 errors", "Ran 2 tests across 2 files."],
    ],
  ] as [string, Record<string, string>, string[], string[]][])("%s", async (_, files, args, expected) => {
    const { report, exitCode } = await runTests(files, args);
    expect({ report, exitCode }).toEqual({ report: expected, exitCode: 1 });
  });

  // With this delay no second worker starts, so one worker runs every file. It takes b and c in either order.
  test("in a worker of --parallel, which runs the files after it too", async () => {
    const { report, exitCode } = await runTests(files, ["--parallel=2", "--parallel-delay=600000", "--no-isolate"]);
    expect({ report: report.sort(), exitCode }).toEqual({ report: [...bothFail].sort(), exitCode: 1 });
  });

  // --isolate=modules takes the names off globalThis before each file, so no file has to delete one. It loads the preloads for each file, after the globals are defined.
  // Not on a debug build: there this mode takes over a second before the first file, and beside other runs more than the 5 seconds of a test.
  test.skipIf(isDebug)("--isolate=modules, which loads no preload for the file that fails", async () => {
    const { log, report, exitCode } = await runTests(
      {
        "setup.js": `console.log("preload"); beforeAll(() => console.log("beforeAll")); afterAll(() => console.log("afterAll"));`,
        "a.test.js": `test("arms the getter", () => { ${arm} });`,
        "b.test.js": passes,
      },
      ["--isolate=modules", "--preload=./setup.js"],
    );
    expect({ log, report, exitCode }).toEqual({
      log: ["preload", "beforeAll", "afterAll"],
      report: [...armed, "b.test.js:", thrown, " 1 pass", " 1 fail", " 1 error", "Ran 2 tests across 2 files."],
      exitCode: 1,
    });
  });
});
