import { spawnSync } from "bun";
import { expect, it } from "bun:test";
import { bunExe, bunEnv } from "harness";

it("Should support printing 'hello world'", () => {
  const { stdout, exitCode } = spawnSync({
    cmd: [bunExe(), import.meta.dir + "/hello-wasi.wasm"],
    stdout: "pipe",
    env: bunEnv,
  });

  expect(stdout.toString()).toEqual("hello world\n");
  expect(exitCode).toBe(0);
});
