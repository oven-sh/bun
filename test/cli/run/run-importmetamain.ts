import { expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

test("import.meta.main", async () => {
  const dir = tmpdirSync();
  mkdirSync(dir, { recursive: true });
  await Bun.write(
    join(dir, "index1.js"),
    `import "fs"; console.log(JSON.stringify([typeof require, import.meta.main, !import.meta.main, require.main === module, require.main !== module]));`,
  );
  const { stdout } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "index1.js")],
    cwd: dir,
    env: bunEnv,
    stderr: "inherit",
    stdout: "pipe",
  });
  expect(stdout.toString("utf8").trim()).toEqual(JSON.stringify(["function", true, false, true, false]));
});

test("import.meta.main in a common.js file", async () => {
  const dir = tmpdirSync();
  mkdirSync(dir, { recursive: true });
  await Bun.write(
    join(dir, "index1.js"),
    `module.exports = {}; console.log(JSON.stringify([typeof require, import.meta.main, !import.meta.main, require.main === module, require.main !== module]));`,
  );
  const { stdout } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "index1.js")],
    cwd: dir,
    env: bunEnv,
    stderr: "inherit",
    stdout: "pipe",
  });
  expect(stdout.toString("utf8").trim()).toEqual(JSON.stringify(["function", true, false, true, false]));
});
