import { test, expect } from "bun:test";
import { spawnSync } from "bun";
import { join } from "path";
import { bunEnv, bunExe } from "harness";

test("reportError", () => {
  const cwd = import.meta.dir;
  const { stderr } = spawnSync({
    cmd: [bunExe(), join(import.meta.dir, "reportError.ts")],
    cwd,
    env: {
      ...bunEnv,
      // this is default enabled in debug, affects output.
      BUN_JSC_showPrivateScriptsInStackTraces: "0",
    },
  });
  const output = stderr.toString().replaceAll(cwd, "").replaceAll("\\", "/");
  expect(output).toMatchSnapshot();
});
