import { bunExe, bunEnv } from "harness";
import { existsSync, promises } from "fs";
import { join } from "path";
import { test, expect, beforeEach, afterEach } from "bun:test";

beforeEach(async () => {
  await promises.rm(join(import.meta.dir, "dist"), { recursive: true, force: true });
  await promises.mkdir(join(import.meta.dir, "dist"), { recursive: true });
});

afterEach(async () => {
  await promises.rm(join(import.meta.dir, "dist"), { recursive: true, force: true });
});

test("webpack works", () => {
  const { exitCode } = Bun.spawnSync({
    cmd: ["bun", "webpack", "--mode=production", "--entry", "./test.js", "-o", "./dist/test1"],
    cwd: import.meta.dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });

  expect(existsSync(join(import.meta.dir, "dist", "test1/main.js"))).toBe(true);
  expect(exitCode).toBe(0);
});

test("webpack --watch works", async () => {
  const { exited, pid } = Bun.spawn({
    cmd: [bunExe(), "-b", "webpack", "--mode=development", "--entry", "./test.js", "-o", "./dist/test2", "--watch"],
    cwd: import.meta.dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });

  var { promise, resolve, reject } = Promise.withResolvers();
  Promise.race([exited.finally(() => {}), new Promise(resolve => setTimeout(resolve, 3000).unref())]).then(() => {
    resolve(undefined);
    try {
      process.kill(pid, 1);
    } catch (e) {}
  }, reject);
  await promise;
  await exited;

  expect(existsSync(join(import.meta.dir, "dist", "test2/main.js"))).toBe(true);
}, 8000);
