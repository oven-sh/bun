import { expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import path from "path";

// TODO: we need to install build-essential and apple SDK in CI.
// it can't find includes. It can on machiens with that enabled.
it.todoIf(isWindows)("can run a .c file", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), path.join(__dirname, "cc-fixture.js")],
    cwd: __dirname,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });

  expect(result.exitCode).toBe(0);
});
