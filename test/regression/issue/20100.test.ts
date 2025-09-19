import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("20100", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/20100.fixture.ts"],
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
    <top-level>
      <top-level-test> { unpredictableVar: "top level" } </top-level-test>
      <describe-1>
        <describe-1-test> { unpredictableVar: "describe 1" } </describe-1-test>
      </describe-1>
      <describe-2>
        <describe-2-test> { unpredictableVar: "describe 2" } </describe-2-test>
      </describe-2>
    </top-level>"
  `);
});
