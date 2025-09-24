import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("21177", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/21177.fixture.ts", "-t", "true is true"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"bun test <version> (<revision>)"`);
  expect(exitCode).toBe(0);
});

test("21177", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/21177.fixture-2.ts", "-t", "middle is middle"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    Running beforeAll in Outer describe
    Running beforeAll in Middle describe"
  `);
  expect(exitCode).toBe(0);
});
