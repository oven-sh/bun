import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

async function testFailureSkip(failurePoints: string[]): Promise<string[]> {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/failure-skip.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, FAILURE_POINTS: failurePoints.join(",") },
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  const messages = stdout.matchAll(/%%<([^>]+)>%%/g);

  return [...messages].map(([_, msg]) => msg).join(",");
}

describe("failure-skip", async () => {
  test("none", async () => {
    expect(await testFailureSkip([])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,aftereach2,beforeeach1,beforeeach2,test2,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
  test("beforeall1", async () => {
    // expect(await testFailureSkip(["beforeall1"])).toMatchInlineSnapshot(`"beforeall1"`);
    expect(await testFailureSkip(["beforeall1"])).toMatchInlineSnapshot(`"beforeall1,afterall1,afterall2"`); // breaking change
  });
  test("beforeall2", async () => {
    // expect(await testFailureSkip(["beforeall2"])).toMatchInlineSnapshot(`"beforeall1,beforeall2"`);
    expect(await testFailureSkip(["beforeall2"])).toMatchInlineSnapshot(`"beforeall1,beforeall2,afterall1,afterall2"`); // breaking change
  });
  test("beforeeach1", async () => {
    expect(await testFailureSkip(["beforeeach1"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,aftereach1,aftereach2,beforeeach1,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
  test("beforeeach2", async () => {
    expect(await testFailureSkip(["beforeeach2"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,aftereach1,aftereach2,beforeeach1,beforeeach2,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
  test("test1", async () => {
    expect(await testFailureSkip(["test1"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,aftereach2,beforeeach1,beforeeach2,test2,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
  test("test2", async () => {
    expect(await testFailureSkip(["test2"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,aftereach2,beforeeach1,beforeeach2,test2,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
  test("aftereach1", async () => {
    expect(await testFailureSkip(["aftereach1"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,beforeeach1,beforeeach2,test2,aftereach1,afterall1,afterall2"`,
    );
  });
  test("aftereach2", async () => {
    expect(await testFailureSkip(["aftereach2"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,aftereach2,beforeeach1,beforeeach2,test2,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
  test("afterall1", async () => {
    expect(await testFailureSkip(["afterall1"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,aftereach2,beforeeach1,beforeeach2,test2,aftereach1,aftereach2,afterall1"`,
    );
  });
  test("afterall2", async () => {
    expect(await testFailureSkip(["afterall2"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,aftereach2,beforeeach1,beforeeach2,test2,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });

  // A failing beforeAll must still report the tests it skipped. They used to
  // vanish from the console, the summary counts, and the JUnit report.
  test("a failing beforeAll reports its tests as skipped", async () => {
    using dir = tempDir("failure-skip-report", {});
    const junit = join(String(dir), "junit.xml");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        "--reporter=junit",
        "--reporter-outfile=" + junit,
        import.meta.dir + "/failure-skip.fixture.ts",
      ],
      stdout: "pipe",
      stderr: "pipe",
      env: { ...bunEnv, FAILURE_POINTS: "beforeall1" },
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toMatch(/\(skip\) test\b/);
    expect(stderr).toMatch(/\(skip\) test1\b/);
    expect(stderr).toInclude("2 skip");
    expect(stderr).toInclude("1 fail");
    expect(stderr).toInclude("Ran 3 tests across 1 file");
    const report = readFileSync(junit, "utf-8");
    expect(report).toInclude('tests="3"');
    expect(report).toInclude('failures="1"');
    expect(report).toInclude('skipped="2"');
    expect(exitCode).toBe(1);
  });

  // A test filtered out by -t must stay in the "filtered out" bucket even
  // when its scope's beforeAll throws, not get promoted to a regular skip.
  test("a failing beforeAll keeps -t filtered-out tests suppressed", async () => {
    using dir = tempDir("failure-skip-filter", {
      "filter.test.ts": `
        import { test, describe, beforeAll } from "bun:test";
        describe("d", () => {
          beforeAll(() => {
            throw new Error("boom");
          });
          test("yes-match", () => {});
          test("no-thanks", () => {});
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "-t", "yes-match", "filter.test.ts"],
      stdout: "pipe",
      stderr: "pipe",
      cwd: String(dir),
      env: bunEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toMatch(/\(skip\) d > yes-match\b/);
    expect(stderr).not.toInclude("(skip) d > no-thanks");
    expect(stderr).toInclude("1 skip");
    // fail(hook) + skip(yes-match); the filtered-out test is not counted
    expect(stderr).toInclude("Ran 2 tests across 1 file");
    expect(exitCode).toBe(1);
  });
});
