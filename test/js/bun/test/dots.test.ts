import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { lateHeaderFiles, runLateHeaderFiles } from "./printing/late-header";

test("dots 1", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/dots.fixture.ts", "--dots", "-t", "filterin"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect({
    exitCode,
    stdout: normalizeBunSnapshot(stdout),
    stderr: normalizeBunSnapshot(stderr),
  }).toMatchInlineSnapshot(`
    {
      "exitCode": 1,
      "stderr": 
    "....................

    test/js/bun/test/dots.fixture.ts:
    (fail) failing filterin
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (fail) failing filterin
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (fail) failing filterin
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    ..........

    10 pass
    10 skip
    10 todo
    3 fail
    Ran 33 tests across 1 file."
    ,
      "stdout": "bun test <version> (<revision>)",
    }
  `);
});

test("dots 2", async () => {
  const result = await Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      import.meta.dir + "/printing/dots/dots1.fixture.ts",
      import.meta.dir + "/printing/dots/dots2.fixture.ts",
      import.meta.dir + "/printing/dots/dots3.fixture.ts",
      "--dots",
    ],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect({
    exitCode,
    stderr: normalizeBunSnapshot(stderr),
  }).toMatchInlineSnapshot(`
    {
      "exitCode": 1,
      "stderr": 
    "..........

    test/js/bun/test/printing/dots/dots1.fixture.ts:
    Hello, world!
    ...........
    Hello, world!
    .

    test/js/bun/test/printing/dots/dots2.fixture.ts:
    Hello, world!
    ...........
    (fail) failing test
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    ....................

    test/js/bun/test/printing/dots/dots3.fixture.ts:
    3 | // unhandled failure. it should print the filename
    4 | test("failure", async () => {
    5 |   const { resolve, reject, promise } = Promise.withResolvers();
    6 |   setTimeout(() => {
    7 |     resolve();
    8 |     throw new Error("unhandled error");
                                             ^
    error: unhandled error
        at <anonymous> (file:NN:NN)
    (fail) failure


    43 pass
    10 skip
    2 fail
    Ran 55 tests across 3 files."
    ,
    }
  `);
});

test("a console group with no label does not break the line of dots", async () => {
  using dir = tempDir("dots-empty-group", {
    "empty-group.test.ts": `
      import { test } from "bun:test";
      test("before", () => {});
      test("group", () => {
        console.group();
        console.groupEnd();
      });
      test("between", () => {});
      test("groupCollapsed", () => {
        console.groupCollapsed();
        console.groupEnd();
      });
      test("after", () => {});
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--dots", "./empty-group.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
  }).toEqual({
    stdout: "bun test <version> (<revision>)",
    stderr: ".....\n\n5 pass\n0 fail\nRan 5 tests across 1 file.",
    exitCode: 0,
  });
});

test.concurrent("a call in a test ends the line of dots and prints the file header only when it prints", async () => {
  // Each file has three tests, so a dot is on the line when the second test makes its call.
  const files = lateHeaderFiles.map(({ file, prints }) => (prints ? `.\n\n${file}:\n${prints}..` : "..."));
  const tests = lateHeaderFiles.length * 3;
  expect(await runLateHeaderFiles("--dots")).toEqual({
    output: [
      "bun test <version> (<revision>)\n",
      ...files,
      `\n\n${tests} pass\n0 fail\n1 expect() calls\n`,
      `Ran ${tests} tests across ${lateHeaderFiles.length} files. [<elapsed>]\n`,
    ].join(""),
    exitCode: 0,
  });
});

test.concurrent("--parallel prints no empty line above console output or above the error of a test", async () => {
  // A test passes first, so the worker has sent a dot when the second test prints.
  const fixture = (call: string) => `
    import { test } from "bun:test";
    test("passes", () => {});
    test("prints", () => {
      ${call};
    });
  `;
  using dir = tempDir("dots-parallel-console", {
    "log.test.ts": fixture(`console.log("log-line")`),
    "warn.test.ts": fixture(`console.warn("warn-line")`),
    "count.test.ts": fixture(`console.count("count-label")`),
    "timeEnd.test.ts": fixture(`console.time("end-label"); console.timeEnd("end-label")`),
    "timeLog.test.ts": fixture(`console.time("log-label"); console.timeLog("log-label")`),
    "assert.test.ts": fixture(`console.assert(false)`),
    // The error of the test starts with the source lines above the line that threw.
    "fails.test.ts": `// first-source-line
import { expect, test } from "bun:test";
test("passes", () => {});
test("fails", () => {
  expect(1).toBe(2);
});
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--dots", "--parallel=2"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      // A console.assert that fails aborts a build that validates exception checks: #44950.
      BUN_JSC_validateExceptionChecks: undefined,
      BUN_JSC_dumpSimulatedThrows: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The coordinator prints the output of its workers on stderr.
  const lines = stderr.replace(/\[\d+\.\d+m?s\]/g, "[<elapsed>]").split(/\r?\n/);
  for (const line of [
    "log-line",
    "warn-line",
    "count-label: 1",
    "[<elapsed>] end-label",
    "[<elapsed>] log-label",
    "Assertion failed",
    "1 | // first-source-line",
  ]) {
    expect(lines).toContain(line);
    // The coordinator ends the line of dots. A line feed from the worker adds an empty line here.
    expect({ line, above: lines[lines.indexOf(line) - 1] }).not.toEqual({ line, above: "" });
  }
  expect(lines).toContain("13 pass");
  expect(lines).toContain("1 fail");
  expect(normalizeBunSnapshot(stdout, String(dir))).toBe("bun test <version> (<revision>) 2x PARALLEL");
  expect(exitCode).toBe(1);
});
