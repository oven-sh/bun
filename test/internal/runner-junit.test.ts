/**
 * scripts/runner.node.ts runs the bucket of parallel-safe test files as a single
 * `bun test --parallel` and reads the junit report it writes to decide which files
 * failed (to re-run them alone), what to print per file and what to put in the flaky
 * annotation. parseJunitFileSuites() in scripts/buildkite.ts is that parsing step.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getTestUrl, getVendorSource, parseJunitFileSuites } from "../../scripts/buildkite.ts";
import vendors from "../vendor.json";

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
 * The annotation of a failed test links to the file of the test. A test of a vendored suite runs in the
 * checkout of the suite, and scripts/runner.node.ts titles it by the path of its file from the root of
 * this repository. From that title, getVendorSource() finds the file in the suite's entry of
 * test/vendor.json, and getTestUrl() links it in the repository that the entry names.
 */
describe("getVendorSource", () => {
  const elysia = {
    directory: "vendor/elysia",
    repository: "https://github.com/elysiajs/elysia",
    commit: "56310be9617b826f862c985eae95ae823d95f097",
  };
  const plugin = {
    directory: "vendor/elysia-plugin",
    repository: "https://github.com/elysiajs/plugin",
    commit: "1111111111111111111111111111111111111111",
  };
  const hono = {
    // As path.relative() gives it on Windows.
    directory: "vendor\\hono",
    repository: "https://github.com/honojs/hono",
    commit: "2222222222222222222222222222222222222222",
  };
  const file = ({ repository, commit }: typeof elysia, title: string, path: string) => ({
    title,
    repository,
    commit,
    path,
  });

  test.each([
    [
      "vendor/elysia/test/response/stream.test.ts",
      file(elysia, "vendor/elysia/test/response/stream.test.ts", "test/response/stream.test.ts"),
    ],
    // The install of a suite is titled by its package.json.
    ["vendor/elysia/package.json", file(elysia, "vendor/elysia/package.json", "package.json")],
    ["vendor\\elysia\\test\\a.test.ts", file(elysia, "vendor/elysia/test/a.test.ts", "test/a.test.ts")],
    ["vendor/hono/test/a.test.ts", file(hono, "vendor/hono/test/a.test.ts", "test/a.test.ts")],
    // The name of one suite begins with the name of another.
    ["vendor/elysia-plugin/test/a.test.ts", file(plugin, "vendor/elysia-plugin/test/a.test.ts", "test/a.test.ts")],
    // Not a file of a suite: tests of this repository, a suite that is not in the list, the directory of a suite.
    ["test/js/bun/http/serve.test.ts", undefined],
    ["test/vendor/elysia/a.test.ts", undefined],
    ["vendor.test.ts", undefined],
    ["vendor/zod/test/a.test.ts", undefined],
    ["vendor/elysia", undefined],
  ])("%s", (title, source) => {
    expect(getVendorSource(title, [elysia, plugin, hono])).toEqual(source);
  });
});

describe("getTestUrl", () => {
  const commit = "56310be9617b826f862c985eae95ae823d95f097";
  const elysia = { directory: "vendor/elysia", repository: "https://github.com/elysiajs/elysia", commit };
  // The path of the result of a vendored test is from the checkout of its suite. The title is what says which suite.
  const url = (title: string, testPath: string, line?: number | string) =>
    getTestUrl(testPath, getVendorSource(title, [elysia]), line);

  test("links a test of a vendored suite in the repository of the suite, at the commit of its entry", () => {
    expect([
      url("vendor/elysia/test/response/stream.test.ts", "test/response/stream.test.ts", "95"),
      url("vendor/elysia/test/response/stream.test.ts", "test/response/stream.test.ts"),
      url("vendor\\elysia\\test\\response\\stream.test.ts", "test\\response\\stream.test.ts", 95),
      url("vendor/elysia/package.json", "vendor/elysia/package.json"),
    ]).toEqual([
      `https://github.com/elysiajs/elysia/blob/${commit}/test/response/stream.test.ts#L95`,
      `https://github.com/elysiajs/elysia/blob/${commit}/test/response/stream.test.ts`,
      `https://github.com/elysiajs/elysia/blob/${commit}/test/response/stream.test.ts#L95`,
      `https://github.com/elysiajs/elysia/blob/${commit}/package.json`,
    ]);
  });

  test("links a test of each suite in test/vendor.json", () => {
    // scripts/runner.node.ts checks a suite out at vendor/<package>.
    const suites = vendors.map(({ package: name, repository, commit }) => ({
      directory: `vendor/${name}`,
      repository,
      commit,
    }));
    expect(suites.length).toBeGreaterThan(0);
    for (const { directory, repository, commit } of suites) {
      const source = getVendorSource(`${directory}/test/a.test.ts`, suites);
      expect(getTestUrl("test/a.test.ts", source, 12)).toBe(`${repository}/blob/${commit}/test/a.test.ts#L12`);
    }
  });

  test("gives no link for a suite whose repository is not one of GitHub", () => {
    const source = getVendorSource("vendor/elysia/test/a.test.ts", [elysia])!;
    expect([
      getTestUrl("test/a.test.ts", { ...source, repository: "https://gitlab.com/elysiajs/elysia" }, 12),
      // parseGitUrl() resolves what follows the host, and "a:b/c" is a URL of its own, which cannot be a base.
      getTestUrl("test/a.test.ts", { ...source, repository: "https://github.com/a:b/c" }, 12),
      getTestUrl("test/a.test.ts", { ...source, repository: "https://github.com/a:b/c" }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

test("getFileUrl links a file of the repository of the build at its commit, and gives no link without either", async () => {
  // The directory and vendor/pkg in it are repositories with no commit and no remote.
  // scripts/vendor-checkout.ts leaves a vendored suite in a repository with no remote.
  using dir = tempDir("runner-file-url", { "vendor/pkg/test/a.test.ts": "" });
  for (const repository of [String(dir), join(String(dir), "vendor", "pkg")]) {
    await using git = Bun.spawn({
      cmd: ["git", "init", "--quiet", repository],
      env: bunEnv,
      stdio: ["ignore", "ignore", "inherit"],
    });
    expect(await git.exited).toBe(0);
  }

  const commit = "98cda0d8b1243fc3dbf6963f0a12e708efb20d80";
  const build = { BUILDKITE_REPO: "https://github.com/oven-sh/bun.git", BUILDKITE_COMMIT: commit };
  const blob = `https://github.com/oven-sh/bun/blob/${commit}`;
  // What the build says, the call, and what the call gives.
  const cases: [Record<string, string>, [filename: string, line?: number], string | null][] = [
    [build, ["test/js/bun/a.test.ts"], `${blob}/test/js/bun/a.test.ts`],
    [build, ["test\\js\\bun\\a.test.ts", 7], `${blob}/test/js/bun/a.test.ts#L7`],
    // The repository under vendor/ is not asked where its files are from.
    [build, ["vendor/pkg/test/a.test.ts", 12], `${blob}/vendor/pkg/test/a.test.ts#L12`],
    // Not a repository on GitHub.
    [{ ...build, BUILDKITE_REPO: "https://gitlab.com/oven-sh/bun.git" }, ["test/js/bun/a.test.ts", 7], null],
    // What the build does not say is asked of git, which has no origin remote and no commit to name.
    [{ BUILDKITE_COMMIT: commit }, ["test/js/bun/a.test.ts", 7], null],
    [{ BUILDKITE_REPO: build.BUILDKITE_REPO }, ["test/js/bun/a.test.ts", 7], null],
  ];

  const buildkite = pathToFileURL(join(import.meta.dir, "..", "..", "scripts", "buildkite.ts")).href;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import * as buildkite from ${JSON.stringify(buildkite)};
      for (const [build, call] of ${JSON.stringify(cases.map(([build, call]) => [build, call]))}) {
        delete process.env.BUILDKITE_REPO;
        delete process.env.BUILDKITE_COMMIT;
        Object.assign(process.env, build);
        console.log(buildkite.getFileUrl(...call) ?? null);
      }
      // A test that is of no vendored suite is a file of this repository.
      Object.assign(process.env, ${JSON.stringify(build)});
      console.log(buildkite.getTestUrl("test/js/bun/a.test.ts", undefined, 7) ?? null);`,
    ],
    cwd: String(dir),
    // Of what scripts/buildkite.ts reads, a CI agent sets more than the cases do.
    env: { ...bunEnv, BUILDKITE: "true", GITHUB_ACTIONS: undefined, GITHUB_SERVER_URL: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: [...cases.map(([, , url]) => url), `${blob}/test/js/bun/a.test.ts#L7`].map(url => `${url}\n`).join(""),
    stderr: "",
    exitCode: 0,
  });
});
