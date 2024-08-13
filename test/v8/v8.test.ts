import { it, expect, test, beforeAll, describe, afterAll } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { spawnSync } from "bun";
import { join } from "path";
import fs from "node:fs";

// clang-cl does not work on Windows with node-gyp 10.2.0, so we should not let that affect the
// test environment
delete bunEnv.CC;
delete bunEnv.CXX;
if (process.platform == "darwin") {
  bunEnv.CXXFLAGS ??= "";
  bunEnv.CXXFLAGS += "-std=gnu++17";
}

describe("v8", () => {
  beforeAll(() => {
    // set up a clean directory for the version built with node
    fs.rmSync(join(__dirname, "v8-module-node"), { recursive: true, force: true });
    fs.cpSync(join(__dirname, "v8-module"), join(__dirname, "v8-module-node"), { recursive: true });

    // build code using bun
    const bunInstall = spawnSync({
      cmd: [bunExe(), "install", "--verbose", "--ignore-scripts"],
      cwd: join(__dirname, "v8-module"),
      env: bunEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!bunInstall.success) {
      throw new Error("build failed");
    }
    const bunBuild = spawnSync({
      cmd: [bunExe(), "x", "--bun", "node-gyp", "rebuild"],
      cwd: join(__dirname, "v8-module"),
      env: bunEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!bunBuild.success) {
      throw new Error("build failed");
    }

    const nodeInstall = spawnSync({
      cmd: ["npm", "install", "--verbose", "--foreground-scripts"],
      cwd: join(__dirname, "v8-module-node"),
      env: bunEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!nodeInstall.success) {
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

  describe("Number", () => {
    it("can create small integer", () => {
      checkSameOutput("test_v8_number_int", []);
    });
    // non-i32 v8::Number is not implemented yet
    it.skip("can create large integer", () => {
      checkSameOutput("test_v8_number_large_int", []);
    });
    it.skip("can create fraction", () => {
      checkSameOutput("test_v8_number_fraction", []);
    });
  });

  describe("String", () => {
    it("can create and read back strings with only ASCII characters", () => {
      checkSameOutput("test_v8_string_ascii", []);
    });
    // non-ASCII strings are not implemented yet
    it.skip("can create and read back strings with UTF-8 characters", () => {
      checkSameOutput("test_v8_string_utf8", []);
    });
    it.skip("handles replacement correctly in strings with invalid UTF-8 sequences", () => {
      checkSameOutput("test_v8_string_invalid_utf8", []);
    });
  });

  afterAll(() => {
    fs.rmSync("v8-module-node", { recursive: true, force: true });
  });
});

enum Runtime {
  node,
  bun,
}

function checkSameOutput(test: string, args: any[]) {
  const nodeResult = runOn(Runtime.node, test, args).trim();
  let bunResult = runOn(Runtime.bun, test, args);
  // remove all debug logs
  bunResult = bunResult.replaceAll(/^\[\w+\].+$/gm, "").trim();
  expect(bunResult).toBe(nodeResult);
  return nodeResult;
}

function runOn(runtime: Runtime, test: string, args: any[]) {
  const exec = spawnSync({
    cmd:
      runtime == Runtime.node
        ? ["node", join(__dirname, "v8-module-node/main.js"), test, JSON.stringify(args)]
        : [bunExe(), join(__dirname, "v8-module/main.js"), test, JSON.stringify(args)],
    env: bunEnv,
  });
  const errs = exec.stderr.toString();
  if (errs !== "") {
    throw new Error(errs);
  }
  expect(exec.success).toBeTrue();
  return exec.stdout.toString();
}
