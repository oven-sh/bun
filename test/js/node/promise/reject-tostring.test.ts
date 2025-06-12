import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("reject does not call toString", () => {
  const node_result = Bun.spawnSync({
    cmd: ["node", "--unhandled-rejections=throw", import.meta.dir + "/reject-tostring.js"],
    stdio: ["ignore", "pipe", "pipe"],
  });
  const bun_result = Bun.spawnSync({
    cmd: [bunExe(), "--unhandled-rejections=throw", import.meta.dir + "/reject-tostring.js"],
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  });
  expect(bun_result.stderr.toString().split("\n")).toEqual(node_result.stderr.toString().split("\n"));
  expect(bun_result.exitCode).toBe(node_result.exitCode);
  expect(bun_result.stdout.toString().split("\n")).toEqual(node_result.stdout.toString().split("\n"));
});
