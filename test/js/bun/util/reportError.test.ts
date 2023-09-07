import { test, expect } from "bun:test";
import { spawnSync } from "bun";
import { bunEnv, bunExe } from "harness";

test("reportError", () => {
  const cwd = import.meta.dir;
  const { stderr } = spawnSync({
    cmd: [bunExe(), new URL("./reportError.ts", import.meta.url).pathname],
    cwd,
    env: bunEnv,
  });
  const output = stderr.toString().replaceAll(cwd, "");
  expect(output).toMatchSnapshot();
});
