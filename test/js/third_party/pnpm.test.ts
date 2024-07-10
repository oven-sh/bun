import { tmpdirSync, bunEnv, bunExe } from "harness";
import { expect, it } from "bun:test";
import * as path from "node:path";

it("successfully traverses pnpm-generated install directory", async () => {
  const package_dir = tmpdirSync();
  console.log(package_dir);

  //

  let { exited } = Bun.spawn({
    cmd: [bunExe(), "create", "vite", "my-vite-app", "--template", "solid-ts"],
    cwd: package_dir,
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  });
  expect(await exited).toBe(0);
  console.log(1);

  //

  ({ exited } = Bun.spawn({
    cmd: [bunExe(), "x", "pnpm@9", "install"],
    cwd: path.join(package_dir, "my-vite-app"),
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  }));
  expect(await exited).toBe(0);
  console.log(2);

  //

  ({ exited } = Bun.spawn({
    cmd: [bunExe(), "run", "build"],
    cwd: path.join(package_dir, "my-vite-app"),
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  }));
  expect(await exited).toBe(0);
  console.log(3);
}, 100_000);
