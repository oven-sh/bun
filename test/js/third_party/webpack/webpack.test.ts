import { bunExe, bunEnv } from "harness";
import { existsSync, rmdirSync } from "fs";
import { join } from "path";

afterEach(() => {
  rmdirSync(join(import.meta.dir, "dist"), { recursive: true });
});

test("webpack works", () => {
  Bun.spawnSync({
    cmd: [bunExe(), "-b", "webpack", "--entry", "./test.js", "-o", "./dist/test1/main.js"],
    cwd: import.meta.dir,
    env: bunEnv,
  });

  expect(existsSync(join(import.meta.dir, "dist", "test1/main.js"))).toBe(true);
});

test("webpack --watch works", async () => {
  Bun.spawnSync({
    cmd: ["timeout", "3", bunExe(), "-b", "webpack", "--entry", "./test.js", "-o", "./dist/test2/main.js", "--watch"],
    cwd: import.meta.dir,
    env: bunEnv,
  });

  expect(existsSync(join(import.meta.dir, "dist", "test2/main.js"))).toBe(true);
});
