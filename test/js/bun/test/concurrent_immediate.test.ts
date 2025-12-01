import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("concurrent immediate", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent_immediate.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    beforeEach
    start test 1
    afterEach
    beforeEach
    start test 2
    afterEach
    beforeEach
    start test 3
    afterEach"
    `);

  const result2 = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent_immediate_promise.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode2 = await result2.exited;
  const stdout2 = await result2.stdout.text();
  const stderr2 = await result2.stderr.text();
  expect(exitCode2).toBe(0);
  expect(normalizeBunSnapshot(stdout2)).toBe(normalizeBunSnapshot(stdout));
  expect(normalizeBunSnapshot(stderr2).replaceAll("_promise.", ".")).toBe(normalizeBunSnapshot(stderr));
});

function filterImportantLines(stderr: string) {
  return normalizeBunSnapshot(stderr)
    .split("\n")
    .filter(l => l.startsWith("(pass)") || l.startsWith("(fail)") || l.startsWith("error:"))
    .join("\n");
}

test("concurrent immediate error", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent_immediate_error.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(exitCode).toBe(1);
  expect(filterImportantLines(stderr)).toMatchInlineSnapshot(`
    "(pass) test 1
    error: test 2 error
    (fail) test 2
    (pass) test 3"
  `);

  const result2 = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent_immediate_error_promise.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode2 = await result2.exited;
  const stdout2 = await result2.stdout.text();
  const stderr2 = await result2.stderr.text();
  expect(filterImportantLines(stderr2)).toBe(filterImportantLines(stderr));
});
