/**
 * scripts/runner.node.ts runs the bucket of parallel-safe test files as a single
 * `bun test --parallel` and reads the junit report it writes to decide which files
 * failed (to re-run them alone), what to print per file and what to put in the flaky
 * annotation. parseJunitFileSuites() in scripts/buildkite.ts is that parsing step.
 */
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getUser, parseJunitFileSuites } from "../../scripts/buildkite.ts";

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

// The runner sets USER and HOME of every `bun test` it spawns from getUser(). It used to call
// os.userInfo() per test file, and on a macOS agent whose host had begun to shut down that call threw
// `uv_os_get_passwd returned ENOENT`, which ended the shard with exit 1 under the name of the next test.
const userInfoFailure = "A system error occurred: uv_os_get_passwd returned ENOENT (no such file or directory)";

test("getUser() looks the user up once", () => {
  const real = { ...os };
  const userInfo = mock(() => {
    if (userInfo.mock.calls.length > 1) throw new Error(userInfoFailure);
    return real.userInfo();
  });
  mock.module("node:os", () => ({ ...real, userInfo }));
  try {
    const user = getUser();
    expect(user).toEqual(real.userInfo());
    expect(getUser()).toBe(user);
    expect(userInfo).toHaveBeenCalledTimes(1);
  } finally {
    mock.module("node:os", () => real);
  }
});

// The runner only loads in a Node that has import.meta.main (scripts/agent.ts checks for it at import),
// which is 24.2 or newer and so strips types as well. CI has one. Elsewhere `node` can be older or absent.
const node = nodeExe();
const nodeLoadsTheRunner = await (async () => {
  if (!node) return false;
  await using probe = Bun.spawn({
    cmd: [node, "--input-type=module", "-e", "console.log(typeof import.meta.main)"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout] = await Promise.all([probe.stdout.text(), probe.exited]);
  return stdout.trim() === "boolean";
})();

// What the nightly cleanup of a bare macOS agent does to a shard that is in flight: files the runner
// has listed are gone when their turn comes, and the user lookup fails. Neither may end the run. This
// drives the runner itself, under node as CI does, on a copy in a scratch repository.
test.skipIf(!nodeLoadsTheRunner)(
  "the runner outlives a failing os.userInfo() and a listed node test file that vanished",
  async () => {
    const repo = join(import.meta.dir, "..", "..");
    const copied = (path: string) => readFileSync(join(repo, path), "utf8");
    using dir = tempDir("runner-host-shutdown", {
      "package.json": JSON.stringify({ type: "module" }),
      "bunfig.node-test.toml": "",
      "scripts/runner.node.ts": copied("scripts/runner.node.ts"),
      "scripts/buildkite.ts": copied("scripts/buildkite.ts"),
      "scripts/agent.ts": copied("scripts/agent.ts"),
      "test/docker/prestart-map.mjs": copied("test/docker/prestart-map.mjs"),
      "test/leaksan.supp": copied("test/leaksan.supp"),
      "test/vendor.json": "[]",
      // Serial tests run before the files under parallel/, so the file is gone before the runner reads it.
      "test/js/first.test.ts": `
      import { expect, test } from "bun:test";
      import { rmSync } from "node:fs";
      import { join } from "node:path";
      test("removes a test file the runner has listed", () => {
        rmSync(join(import.meta.dir, "node", "test", "parallel", "test-gone.js"));
        expect(process.env.USER || process.env.USERNAME).toBeString();
      });
    `,
      "test/js/node/test/parallel/test-gone.js": `console.log("still here");`,
      "test/js/node/test/parallel/test-kept.js": `console.log("kept");`,
      "user-info-fails.mjs": `
      import { syncBuiltinESMExports } from "node:module";
      import os from "node:os";
      const { userInfo } = os;
      let calls = 0;
      os.userInfo = (...args) => {
        if (++calls > 1) throw new Error(${JSON.stringify(userInfoFailure)});
        return userInfo(...args);
      };
      syncBuiltinESMExports();
    `,
    });

    await using runner = Bun.spawn({
      cmd: [
        node!,
        `--import=${pathToFileURL(join(String(dir), "user-info-fails.mjs"))}`,
        join("scripts", "runner.node.ts"),
        `--exec-path=${bunExe()}`,
        "--retries=0",
        "--results-json=results.json",
        "--quiet",
      ],
      // Not as a CI job: the copy must not annotate the build this test runs in.
      env: { ...bunEnv, CI: undefined, BUILDKITE: undefined, GITHUB_ACTIONS: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([runner.stdout.text(), runner.stderr.text(), runner.exited]);

    // The runner writes results.json at the end of a run. Without it, show what the runner printed.
    const results = Bun.file(join(String(dir), "results.json"));
    const summary = (await results.exists())
      ? ((await results.json()) as { testPath: string; ok: boolean }[]).map(({ testPath, ok }) => ({
          testPath: testPath.replaceAll("\\", "/"),
          ok,
        }))
      : { stdout, stderr };
    expect(summary).toEqual([
      { testPath: "test/js/first.test.ts", ok: true },
      { testPath: "test/js/node/test/parallel/test-kept.js", ok: true },
      { testPath: "test/js/node/test/parallel/test-gone.js", ok: false },
    ]);
    // A failed test, not a crashed runner.
    expect(exitCode).toBe(1);
  },
);
