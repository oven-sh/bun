/**
 * scripts/runner.node.ts runs the bucket of parallel-safe test files as a single
 * `bun test --parallel` and reads the junit report it writes to decide which files
 * failed (to re-run them alone), what to print per file and what to put in the flaky
 * annotation. parseJunitFileSuites() in scripts/buildkite.ts is that parsing step.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "../../scripts/agent.ts";
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

// The native runner uses /tmp on Linux/macOS, independently of TMPDIR.
const node = nodeExe();
test.skipIf((process.platform !== "linux" && process.platform !== "darwin") || !node)(
  "explicit Linux/macOS JUnit keeps per-file reports while default execution batches allowlisted files",
  async () => {
    {
      await using probe = Bun.spawn({
        cmd: [node!, "-p", "process.release.name === 'node' && !process.versions.bun"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([probe.stdout.text(), probe.stderr.text(), probe.exited]);
      expect(stdout.trim()).toBe("true");
      expect(exitCode, stderr).toBe(0);
    }
    const files = Array.from({ length: 8 }, (_, i) => `test/js/node/module/fixture-${i}.test.ts`);
    const fixture: Record<string, string> = {
      "test/parallel-allowlist.json": JSON.stringify({ dirs: ["js/node/module"], excludeFiles: [] }),
      "test/leaksan.supp": "",
      "alternate-tmp/keep": "",
    };
    for (const file of [
      "scripts/runner.node.ts",
      "scripts/agent.ts",
      "scripts/buildkite.ts",
      "test/docker/prestart-map.mjs",
    ])
      fixture[file] = await Bun.file(join(import.meta.dir, "../..", file)).text();
    for (const file of files)
      fixture[file] = 'import { test, expect } from "bun:test"; test("passes", () => expect(1).toBe(1));';
    using dir = tempDir("runner-junit-files", fixture);
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
        cwd: String(dir),
        encoding: "utf8",
        env: {
          ...bunEnv,
          GIT_AUTHOR_NAME: "Test",
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "Test",
          GIT_COMMITTER_EMAIL: "test@example.com",
        },
      }).trim();
    git("init", "--quiet");
    git("remote", "add", "origin", "https://github.com/oven-sh/bun.git");
    git("add", ".");
    git("commit", "--quiet", "-m", "fixture");
    const prefix = `runner-junit-files-${randomUUID()}-`;
    const nativeTemp = tmpdir();
    const reports = () => readdirSync(nativeTemp).filter(name => name.startsWith(prefix));
    expect(reports()).toEqual([]);
    try {
      for (const junit of [false, true]) {
        await using proc = Bun.spawn({
          cmd: [
            node!,
            "scripts/runner.node.ts",
            "--exec-path",
            bunExe(),
            "--quiet",
            "--vendor=false",
            "--retries=0",
            ...(junit ? ["--junit", "--junit-temp-dir", prefix] : []),
          ],
          cwd: String(dir),
          env: { ...bunEnv, CI: "", GITHUB_ACTIONS: "", BUILDKITE: "", TMPDIR: join(String(dir), "alternate-tmp") },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout.includes("8 files in parallel")).toBe(!junit);
        if (!junit) {
          expect(reports()).toEqual([]);
          expect(exitCode, stderr).toBe(0);
          continue;
        }
        expect(reports()).toHaveLength(1);
        const directory = join(nativeTemp, reports()[0]!);
        expect(lstatSync(directory).isDirectory()).toBe(true);
        expect(lstatSync(directory).isSymbolicLink()).toBe(false);
        expect(readdirSync(join(String(dir), "alternate-tmp"))).toEqual(["keep"]);
        const expected = files.map(file => `test-${createHash("sha1").update(file).digest("base64url")}.xml`);
        expect(readdirSync(directory).sort()).toEqual(expected.sort());
        for (const file of files) {
          const name = `test-${createHash("sha1").update(file).digest("base64url")}.xml`;
          const xml = await Bun.file(join(directory, name)).text();
          expect(xml.match(/<testcase\b/g)).toHaveLength(1);
          expect(parse(xml)).toEqual({ [file]: { failures: 0, seconds: expect.any(Number), cases: [] } });
        }
        expect(exitCode, stderr).toBe(0);
      }
    } finally {
      for (const name of reports()) rmSync(join(nativeTemp, name), { recursive: true, force: true });
    }
  },
);
