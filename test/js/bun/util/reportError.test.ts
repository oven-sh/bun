import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

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
  let output = stderr.toString().replaceAll(cwd, "").replaceAll("\\", "/");
  // remove bun version from output
  output = output.split("\n").slice(0, -2).join("\n");

  expect(output).toMatchSnapshot();
});
