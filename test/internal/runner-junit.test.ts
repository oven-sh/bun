/**
 * scripts/runner.node.ts runs the bucket of parallel-safe test files as a single
 * `bun test --parallel` and reads the junit report it writes to decide which files
 * failed (to re-run them alone), what to print per file and what to put in the flaky
 * annotation. parseJunitFileSuites() in scripts/buildkite.ts is that parsing step.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExeAtLeast, tempDir } from "harness";
import { chmodSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parseJunitFileSuites } from "../../scripts/buildkite.ts";

const parse = (xml: string) => Object.fromEntries(parseJunitFileSuites(xml));

describe("parseJunitFileSuites", () => {
  test("reports each file from its own suite, not from the describe suites nested in it", () => {
    // Shape of bun's reporter: a suite per file, and inside it a suite per describe
    // block, every one of them carrying the file attribute. The file suite's counts
    // include the describe blocks; its time is the file's wall clock, theirs is the
    // sum of their tests.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="5" assertions="5" failures="2" skipped="0" time="2.5">
  <testsuite name="test/a.test.ts" file="test/a.test.ts" tests="4" assertions="4" failures="2" skipped="0" time="1.5" hostname="ci">
    <testcase name="top level" classname="" time="0.1" file="test/a.test.ts" assertions="1">
      <failure type="AssertionError" message="expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1">AssertionError: expect(received).toBe(expected)</failure>
    </testcase>
    <testsuite name="first" file="test/a.test.ts" line="3" tests="1" assertions="1" failures="1" skipped="0" time="0.2" hostname="ci">
      <testcase name="in &quot;first&quot;" classname="first" time="0.2" file="test/a.test.ts" assertions="1">
        <failure type="Error" message="a &lt; b &amp;&amp; c &gt; d" />
      </testcase>
    </testsuite>
    <testsuite name="second" file="test/a.test.ts" line="6" tests="2" assertions="2" failures="0" skipped="0" time="9" hostname="ci">
      <testsuite name="inner" file="test/a.test.ts" line="7" tests="2" assertions="2" failures="0" skipped="0" time="9" hostname="ci">
        <testcase name="fast" classname="second &gt; inner" time="0.3" file="test/a.test.ts" assertions="1" />
        <testcase name="skipped" classname="second &gt; inner" time="0" file="test/a.test.ts" assertions="0">
          <skipped />
        </testcase>
        <testcase name="slow" classname="second &gt; inner" time="8.7" file="test/a.test.ts" assertions="1" />
      </testsuite>
    </testsuite>
  </testsuite>
  <testsuite name="test/b.test.ts" file="test/b.test.ts" tests="1" assertions="1" failures="0" skipped="0" time="0.25" hostname="ci">
    <testcase name="plain" classname="" time="0.01" file="test/b.test.ts" assertions="1" />
  </testsuite>
</testsuites>
`;
    expect(parse(xml)).toEqual({
      "test/a.test.ts": {
        failures: 2,
        seconds: 1.5,
        cases: [
          { name: "top level", message: "expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1" },
          { name: 'in "first"', message: "a < b && c > d" },
        ],
      },
      "test/b.test.ts": { failures: 0, seconds: 0.25, cases: [] },
    });
  });

  test("keys files by their unescaped path with forward slashes", () => {
    // On Windows the reporter writes the path with backslashes; the runner looks files
    // up by their forward-slash path.
    const xml = `<testsuites name="bun test" tests="1" failures="1" time="0.5">
  <testsuite name="test\\js\\a &amp; b.test.ts" file="test\\js\\a &amp; b.test.ts" tests="1" failures="1" time="0.5">
    <testcase name="t" classname="" time="0.1" file="test\\js\\a &amp; b.test.ts" assertions="1">
      <failure type="Error" message="boom" />
    </testcase>
  </testsuite>
</testsuites>
`;
    expect(parse(xml)).toEqual({
      "test/js/a & b.test.ts": { failures: 1, seconds: 0.5, cases: [{ name: "t", message: "boom" }] },
    });
  });

  test("reports the suite bun test --parallel writes for a file whose worker crashed", () => {
    // The coordinator records a synthetic failing case for the file, after any
    // cases the worker reported before it died.
    const xml = `<testsuites name="bun test" tests="1" assertions="0" failures="1" skipped="0" time="0.3">
  <testsuite name="test/crash.test.ts" file="test/crash.test.ts" tests="1" assertions="0" failures="1" skipped="0" time="0.12" hostname="h">
    <testcase name="(worker crashed)" classname="" time="0" file="test/crash.test.ts" assertions="0">
      <failure type="Error" message="worker process crashed before reporting results" />
    </testcase>
  </testsuite>
</testsuites>
`;
    expect(parse(xml)).toEqual({
      "test/crash.test.ts": {
        failures: 1,
        seconds: 0.12,
        cases: [{ name: "(worker crashed)", message: "worker process crashed before reporting results" }],
      },
    });
  });

  test("reports nothing for a report without file suites", () => {
    expect(parse("")).toEqual({});
    expect(parse(`<testsuites name="bun test" tests="0" failures="0" time="0">\n</testsuites>\n`)).toEqual({});
  });
});

test("parseJunitFileSuites reads the report bun test --parallel --reporter=junit writes", async () => {
  using dir = tempDir("runner-junit", {
    "test/describes.test.ts": `
      import { describe, expect, test } from "bun:test";
      test("top level fails", () => expect(1).toBe(2));
      describe("first", () => {
        test('fails in "first"', () => expect("a").toBe("b"));
      });
      describe("second", () => {
        describe("inner", () => {
          test("passes", () => expect(1).toBe(1));
        });
        test("passes too", () => expect(2).toBe(2));
      });
    `,
    "test/plain.test.ts": `
      import { expect, test } from "bun:test";
      test("passes", () => expect(1).toBe(1));
    `,
    "test/crash.test.ts": `
      import { test } from "bun:test";
      test("exits the worker", () => process.exit(7));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "--reporter=junit", "--reporter-outfile=report.xml"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("worker crashed");
  const xml = await Bun.file(join(String(dir), "report.xml")).text();

  // The suites describes.test.ts gets: the file's own, "first", "second" and "inner",
  // the last three nested in the first. All of them name the file.
  expect(xml.match(/<testsuite [^>]*\sfile="test[\\/]describes\.test\.ts"/g)).toHaveLength(4);
  const fileSuiteSeconds = Number(/<testsuite name="test[\\/]describes\.test\.ts"[^>]*\stime="([^"]+)"/.exec(xml)![1]);

  expect(parse(xml)).toEqual({
    "test/describes.test.ts": {
      failures: 2,
      seconds: fileSuiteSeconds,
      cases: [
        { name: "top level fails", message: expect.stringContaining("Expected: 2") },
        { name: 'fails in "first"', message: expect.stringContaining('Expected: "b"') },
      ],
    },
    "test/plain.test.ts": { failures: 0, seconds: expect.any(Number), cases: [] },
    "test/crash.test.ts": {
      failures: 1,
      seconds: expect.any(Number),
      cases: [{ name: "(worker crashed)", message: "worker process crashed before reporting results" }],
    },
  });
  expect(exitCode).toBe(1);
});

/**
 * The runner starts the test files that build many executables beside one another. With a sanitizer every test of such a
 * file runs beside the others of the file, so there the runner gives a file the processors divided by the files at a time
 * as `--max-concurrency`. A file that runs alone, and every file without a sanitizer, keeps what it had.
 *
 * These tests start the runner itself, under Node.js as CI does, over test files of this repository. A stand-in for the
 * Bun under test answers what the runner asks of it and writes down each `bun test` command that it is started with.
 */
// As Node.js names it in the commands of the runner.
const tests = realpathSync(join(import.meta.dir, ".."));
// The runner is a TypeScript file, which Node.js starts without a flag since 22.18.
const node = nodeExeAtLeast("22.18.0");

const standIn = `#!/bin/sh
IFS='\t'
case "$1" in
  --print) echo "$0" ;;
  --revision) echo "0.0.0+stand-in" ;;
  test) echo "$*" >> "$COMMANDS" ;;
esac
`;
// The widths of the runner follow the machine, so every machine that runs these tests answers as the one that a test names.
const machine = (processors: number, gigabytes: number) => `import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
os.availableParallelism = () => ${processors};
os.totalmem = () => ${gigabytes} * 1024 ** 3;
syncBuiltinESMExports();
`;

const firstThree = (folder: string, named: RegExp) =>
  readdirSync(join(tests, folder))
    .filter(name => named.test(name))
    .sort()
    .slice(0, 3)
    .map(name => `${folder}/${name}`);
// Their tests build executables: the runner names how many of them run at once wherever such a file runs.
const building = firstThree("cli", /^aot-.*\.test\.ts$/);
// These run beside them. Alone, or without a sanitizer, they have the default of `bun test`.
const beside = firstThree("cli/compile", /\.test\.ts$/);
const theDefault = "the default of bun test";

/** Starts the runner for those six files with the stand-in named `bun`, on a machine with that many processors and gigabytes. */
async function run(bun: "bun-asan" | "bun-profile", processors: number, gigabytes: number) {
  using dir = tempDir("runner-files-beside-one-another", {
    [bun]: standIn,
    "machine.mjs": machine(processors, gigabytes),
  });
  chmodSync(join(String(dir), bun), 0o755);
  const commands = join(String(dir), "commands");
  await using runner = Bun.spawn({
    cmd: [
      node!,
      "--import",
      join(String(dir), "machine.mjs"),
      join(tests, "..", "scripts", "runner.node.ts"),
      `--exec-path=${join(String(dir), bun)}`,
      "--quiet",
      ...[...building, ...beside].map(file => `--include=${file}`),
    ],
    // Nothing of the CI that runs this test: the runner that is started here reports to nobody.
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", COMMANDS: commands },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([runner.stdout.text(), runner.stderr.text(), runner.exited]);
  // The file is the last word of a command.
  const testsAtOnce = new Map(
    readFileSync(commands, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(command => command.split("\t"))
      .map(words => [
        words.at(-1)!.slice(tests.length + 1),
        words.find(word => word.startsWith("--max-concurrency=")) ?? theDefault,
      ]),
  );
  return {
    building: building.map(file => testsAtOnce.get(file)),
    beside: beside.map(file => testsAtOnce.get(file)),
    filesAtATime: Number(/files that build many executables \((\d+)-wide\)/.exec(stdout)?.[1] ?? 1),
    stderr,
    exitCode,
  };
}
const each = (flag: string) => [flag, flag, flag];

describe.skipIf(isWindows || !node)("the files that build many executables", () => {
  test.concurrent("with a sanitizer a file beside others has its share of the processors", async () => {
    expect(await run("bun-asan", 8, 64)).toEqual({
      building: each("--max-concurrency=3"),
      beside: each("--max-concurrency=3"),
      filesAtATime: 3,
      stderr: "",
      exitCode: 0,
    });
    expect(await run("bun-asan", 4, 16)).toEqual({
      building: each("--max-concurrency=2"),
      beside: each("--max-concurrency=2"),
      filesAtATime: 2,
      stderr: "",
      exitCode: 0,
    });
  });

  // Three gigabytes for a file: four let one file run at a time.
  test.concurrent("with a sanitizer a file that runs alone keeps every processor", async () => {
    expect(await run("bun-asan", 8, 4)).toEqual({
      building: each("--max-concurrency=8"),
      beside: each(theDefault),
      filesAtATime: 1,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("without a sanitizer a file beside others keeps every processor", async () => {
    expect(await run("bun-profile", 8, 64)).toEqual({
      building: each("--max-concurrency=8"),
      beside: each(theDefault),
      filesAtATime: 3,
      stderr: "",
      exitCode: 0,
    });
  });
});
