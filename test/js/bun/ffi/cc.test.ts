import { describe, expect, it } from "bun:test";
import path from "path";

import { bunExe, bunEnv } from "harness";

it("can run a .c file", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), path.join(__dirname, "cc-fixture.js")],
    cwd: __dirname,
    env: bunEnv,
  });

  expect(result.stderr.toString().replaceAll("\r\n", "\n").trim()).toMatchSnapshot("cc-fixture-stderr");
  expect(result.stdout.toString().replaceAll("\r\n", "\n").trim()).toMatchSnapshot("cc-fixture-stdout");
  expect(result.exitCode).toBe(0);
});
