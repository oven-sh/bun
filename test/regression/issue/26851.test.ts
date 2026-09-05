// https://github.com/oven-sh/bun/issues/26851
// `bun test --bail --reporter=junit --reporter-outfile=<file>` must still write
// the JUnit file when --bail stops the run.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";

const passing = (name: string) =>
  `import { test, expect } from "bun:test";\ntest(${JSON.stringify(name)}, () => { expect(1).toBe(1); });\n`;
const failing = (name: string) =>
  `import { test, expect } from "bun:test";\ntest(${JSON.stringify(name)}, () => { expect(1).toBe(2); });\n`;

// The hostname and the time attributes differ per run. Everything else is stable.
function normalizeJUnit(xml: string) {
  return xml.replace(/ time="[^"]*"/g, ' time="<time>"').replace(/ hostname="[^"]*"/g, ' hostname="<hostname>"');
}

async function runBailWithJUnit(dir: string, args: string[]) {
  const outfile = join(dir, "results.xml");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--bail", "--reporter=junit", `--reporter-outfile=${outfile}`, ...args],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, xml: normalizeJUnit(await Bun.file(outfile).text()) };
}

// Each test spawns its own `bun test` child in its own tempDir, so they run concurrently.
test.concurrent("--bail writes JUnit reporter outfile", async () => {
  using dir = tempDir("bail-junit", {
    "fail.test.ts": failing("failing test") + passing("after the failure"),
  });

  const { stdout, stderr, exitCode, xml } = await runBailWithJUnit(String(dir), ["fail.test.ts"]);

  expect(normalizeBunSnapshot(stdout)).toBe("bun test <version> (<revision>)");
  expect(stderr).toContain("(fail) failing test");
  expect(stderr).not.toContain("after the failure");
  expect(stderr).toContain("Ran 1 test across 1 file.");
  expect(stderr).toContain("Bailed out after 1 failure");
  expect(exitCode).toBe(1);

  expect(xml).toMatchInlineSnapshot(`
    "<?xml version="1.0" encoding="UTF-8"?>
    <testsuites name="bun test" tests="1" assertions="1" failures="1" skipped="0" time="<time>">
      <testsuite name="fail.test.ts" file="fail.test.ts" tests="1" assertions="1" failures="1" skipped="0" time="<time>" hostname="<hostname>">
        <testcase name="failing test" classname="" time="<time>" file="fail.test.ts" line="2" assertions="1">
          <failure type="AssertionError" message="expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1&#10;">AssertionError: expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1&#10;&#10;      at fail.test.ts:2:40&#10;</failure>
        </testcase>
      </testsuite>
    </testsuites>
    "
  `);
});

test.concurrent("--bail writes JUnit reporter outfile with multiple files", async () => {
  // Discovery order is sorted by name: a_pass runs, b_fail bails, c_never is never loaded.
  using dir = tempDir("bail-junit-multi", {
    "a_pass.test.ts": passing("passing test"),
    "b_fail.test.ts": failing("another failing test"),
    "c_never.test.ts": passing("never runs"),
  });

  const { stdout, stderr, exitCode, xml } = await runBailWithJUnit(String(dir), []);

  expect(normalizeBunSnapshot(stdout)).toBe("bun test <version> (<revision>)");
  expect(stderr).toContain("(pass) passing test");
  expect(stderr).toContain("(fail) another failing test");
  expect(stderr).not.toContain("never runs");
  expect(stderr).toContain("Ran 2 tests across 2 files.");
  expect(stderr).toContain("Bailed out after 1 failure");
  expect(exitCode).toBe(1);

  expect(xml).toMatchInlineSnapshot(`
    "<?xml version="1.0" encoding="UTF-8"?>
    <testsuites name="bun test" tests="2" assertions="2" failures="1" skipped="0" time="<time>">
      <testsuite name="a_pass.test.ts" file="a_pass.test.ts" tests="1" assertions="1" failures="0" skipped="0" time="<time>" hostname="<hostname>">
        <testcase name="passing test" classname="" time="<time>" file="a_pass.test.ts" line="2" assertions="1" />
      </testsuite>
      <testsuite name="b_fail.test.ts" file="b_fail.test.ts" tests="1" assertions="1" failures="1" skipped="0" time="<time>" hostname="<hostname>">
        <testcase name="another failing test" classname="" time="<time>" file="b_fail.test.ts" line="2" assertions="1">
          <failure type="AssertionError" message="expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1&#10;">AssertionError: expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1&#10;&#10;      at b_fail.test.ts:2:48&#10;</failure>
        </testcase>
      </testsuite>
    </testsuites>
    "
  `);
});
