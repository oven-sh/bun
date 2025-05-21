import { expect, it } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { cpSync } from "node:fs";
import * as path from "node:path";

it("successfully traverses pnpm-generated install directory", async () => {
  const package_dir = tmpdirSync();
  console.log(package_dir);

  cpSync(path.join(__dirname, "install_fixture"), package_dir, { recursive: true });

  let exited;

  //

  ({ exited } = Bun.spawn({
    cmd: [bunExe(), "x", "pnpm@9.15.6", "install"],
    cwd: path.join(package_dir),
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  }));
  expect(await exited).toBe(0);
  console.log(2);

  //

  ({ exited } = Bun.spawn({
    cmd: [bunExe(), "run", "build"],
    cwd: path.join(package_dir),
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  }));
  expect(await exited).toBe(0);
  console.log(3);
}, 100_000);
