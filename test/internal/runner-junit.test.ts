/**
 * scripts/runner.node.ts runs the bucket of parallel-safe test files as a single
 * `bun test --parallel` and reads the junit report it writes to decide which files
 * failed (to re-run them alone), what to print per file and what to put in the flaky
 * annotation. parseJunitFileSuites() in scripts/buildkite.ts is that parsing step.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { parseJunitFileSuites, parseTestStdout } from "../../scripts/buildkite.ts";

const parse = (xml: string) => Object.fromEntries(parseJunitFileSuites(xml));

describe("parseTestStdout", () => {
  for (const [emoji, status] of [
    ["✓", "pass"],
    ["✗", "fail"],
    ["»", "skip"],
    ["✎", "todo"],
  ]) {
    for (const name of ["plain name", "name [bracket] continues", "name [literal]"]) {
      for (const { suffix, duration } of [
        { suffix: "", duration: undefined },
        { suffix: " [1.25ms]", duration: 1.25 },
        { suffix: " [1.25s]", duration: 1250 },
      ]) {
        test(`${status}: ${name}${suffix}`, () => {
          for (const stdout of [
            `${emoji} ${name}${suffix}`,
            `\x1b[32m${emoji}\x1b[0m ${name}\x1b[2m${suffix}\x1b[0m`,
          ]) {
            expect(parseTestStdout(stdout)).toEqual({
              tests: [{ url: undefined, file: undefined, test: name, status, errors: [], duration }],
              errors: [],
              stdout,
            });
          }
        });
      }
    }
  }

  test("associates annotations with the complete durationless name and ignores the summary", () => {
    const lines = [
      "::group::example.test.ts",
      "✓ passed [literal]",
      "::error title=Error,line=12,col=3::first%0Astack%25",
      "::error title=TypeError::second%0D%0Astack",
      "✗ failed [literal]",
      "» skipped [literal]",
      "✎ pending [literal]",
      "::endgroup::",
      "✗ failed [literal]",
      "::error title=Ignored::after summary",
    ];
    const result = parseTestStdout(lines.join("\n"));
    expect(result.errors).toEqual([
      {
        url: undefined,
        file: undefined,
        line: "12",
        col: "3",
        name: "Error",
        stack: "Error\nfirst\nstack%",
        test: "failed [literal]",
      },
      {
        url: undefined,
        file: undefined,
        line: undefined,
        col: undefined,
        name: "TypeError",
        stack: "TypeError\nsecond\r\nstack",
        test: "failed [literal]",
      },
    ]);
    expect(result.tests).toEqual([
      { url: undefined, file: undefined, test: "passed [literal]", status: "pass", errors: [], duration: undefined },
      {
        url: undefined,
        file: undefined,
        test: "failed [literal]",
        status: "fail",
        errors: result.errors,
        duration: undefined,
      },
      { url: undefined, file: undefined, test: "skipped [literal]", status: "skip", errors: [], duration: undefined },
      { url: undefined, file: undefined, test: "pending [literal]", status: "todo", errors: [], duration: undefined },
    ]);
    expect(result.stdout).toBe(
      "✓ passed [literal]\n✗ failed [literal]\n» skipped [literal]\n✎ pending [literal]\n✗ failed [literal]",
    );
  });

  test("shortens consecutive non-failing output without discarding parsed tests", () => {
    const result = parseTestStdout("✓ first\n✓ second\n✓ third\n» fourth [literal]\n✗ fifth [literal]");
    expect(result.tests.map(({ test, status }) => [test, status])).toEqual([
      ["first", "pass"],
      ["second", "pass"],
      ["third", "pass"],
      ["fourth [literal]", "skip"],
      ["fifth [literal]", "fail"],
    ]);
    expect(result.stdout).toBe(
      "✓ first\n\x1b[90m... omitted 2 tests ...\x1b[0m\n» fourth [literal]\n✗ fifth [literal]",
    );
  });

  test("keeps the last 100 lines in a long preview without discarding parsed tests", () => {
    const lines = ["✓ fast [literal]", ...Array.from({ length: 110 }, (_, i) => `output ${i}`)];
    const result = parseTestStdout(lines.join("\n"));
    expect(result.tests).toEqual([
      { url: undefined, file: undefined, test: "fast [literal]", status: "pass", errors: [], duration: undefined },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.stdout).toBe(`\x1b[90m... omitted 11 lines ...\x1b[0m\n\n${lines.slice(-100).join("\n")}`);
  });
});

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
