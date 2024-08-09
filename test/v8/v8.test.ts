import { it, expect, test, beforeAll, describe } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { spawnSync } from "bun";
import { join } from "path";

describe("v8", () => {
  beforeAll(() => {
    // build gyp
    const install = spawnSync({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: join(__dirname, "v8-module"),
      stderr: "inherit",
      env: bunEnv,
      stdout: "inherit",
      stdin: "inherit",
    });
    if (!install.success) {
      throw new Error("build failed");
    }
  });

  describe("module lifecycle", () => {
    it("can call a basic native function", () => {
      checkSameOutput("test_v8_native_call", []);
    });
  });
  describe("primitives", () => {
    it("can create and distinguish between null, undefined, true, and false", () => {
      checkSameOutput("test_v8_primitives", []);
    });
  });
});

function checkSameOutput(test: string, args: any[]) {
  const nodeResult = runOn("node", test, args).trim();
  let bunResult = runOn(bunExe(), test, args);
  // remove all debug logs
  bunResult = bunResult.replaceAll(/^\[\w+\].+$/gm, "").trim();
  expect(bunResult).toBe(nodeResult);
  return nodeResult;
}

function runOn(executable: string, test: string, args: any[]) {
  const exec = spawnSync({
    cmd: [executable, join(__dirname, "v8-module/main.js"), test, JSON.stringify(args)],
    env: bunEnv,
  });
  const errs = exec.stderr.toString();
  if (errs !== "") {
    throw new Error(errs);
  }
  expect(exec.success).toBeTrue();
  return exec.stdout.toString();
}
