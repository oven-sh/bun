import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

describe("node:test", () => {
  test("should run basic tests", async () => {
    const { exitCode, stderr } = await runTest("01-harness.js");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run hooks in the right order", async () => {
    const { exitCode, stderr } = await runTest("02-hooks.js");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run tests with different variations", async () => {
    const { exitCode, stderr } = await runTest("03-test-variations.js");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run async tests", async () => {
    const { exitCode, stderr } = await runTest("04-async-tests.js");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should support skip option", async () => {
    const { exitCode, stderr } = await runTest("05-skip-todo.js");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("0 pass");
    expect(stderr).toContain("4 skip");
    expect(stderr).toContain("4 todo");
    expect(stderr).toContain("0 fail");
  });

  test("should support only option", async () => {
    const { exitCode, stderr } = await runTest("06-only.js");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("6 pass");
    expect(stderr).toContain("0 fail");
    // output with "only" tests should not even mention other tests
    expect(stderr).not.toContain("todo");
    expect(stderr).not.toContain("skip");
    expect(stderr).not.toContain("should not run");
  });
});

async function runTest(filename: string) {
  const testPath = join(import.meta.dirname, "fixtures", filename);
  const {
    exited,
    stdout: stdoutStream,
    stderr: stderrStream,
  } = spawn({
    cmd: [bunExe(), "test", testPath],
    env: bunEnv,
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    exited,
    new Response(stdoutStream).text(),
    new Response(stderrStream).text(),
  ]);
  return { exitCode, stdout, stderr };
}
