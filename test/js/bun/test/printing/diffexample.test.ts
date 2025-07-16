import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("color", async () => {
  const spawn = Bun.spawn({
    cmd: [bunExe(), import.meta.resolve("diffexample.fixture.ts")],
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...bunEnv,
      FORCE_COLOR: "1",
    },
  });
  await spawn.exited;
  expect(await spawn.stderr.text()).toBe("");
  expect(spawn.exitCode).toBe(0);
  expect(await spawn.stdout.text()).toMatchInlineSnapshot();
});

test("no color", async () => {
  const spawn = Bun.spawn({
    cmd: [bunExe(), import.meta.resolve("diffexample.fixture.ts")],
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...bunEnv,
      FORCE_COLOR: "0",
    },
  });
  await spawn.exited;
  expect(await spawn.stderr.text()).toBe("");
  expect(spawn.exitCode).toBe(0);
  expect(await spawn.stdout.text()).toMatchInlineSnapshot();
});
