import { describe, test, expect } from "bun:test";
import { spawn } from "bun";
import { join } from "node:path";
import { bunEnv, bunExe } from "harness";

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
