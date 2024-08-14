import { it, expect, test, beforeAll, describe, afterAll } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { spawnSync } from "bun";
import { join } from "path";
import fs from "node:fs";
import assert from "node:assert";

// clang-cl does not work on Windows with node-gyp 10.2.0, so we should not let that affect the
// test environment
delete bunEnv.CC;
delete bunEnv.CXX;
if (process.platform == "darwin") {
  bunEnv.CXXFLAGS ??= "";
  bunEnv.CXXFLAGS += "-std=gnu++17";
}
// https://github.com/isaacs/node-tar/blob/bef7b1e4ffab822681fea2a9b22187192ed14717/lib/get-write-flag.js
// prevent node-tar from using UV_FS_O_FILEMAP
if (process.platform == "win32") {
  bunEnv.__FAKE_PLATFORM__ = "linux";
}

describe("v8", () => {
  beforeAll(() => {
    // set up a clean directory for the version built with node and the version built in debug mode
    fs.rmSync(join(__dirname, "v8-module-node"), { recursive: true, force: true });
    fs.rmSync(join(__dirname, "v8-module-debug"), { recursive: true, force: true });
    fs.cpSync(join(__dirname, "v8-module"), join(__dirname, "v8-module-node"), { recursive: true });
    fs.cpSync(join(__dirname, "v8-module"), join(__dirname, "v8-module-debug"), { recursive: true });

    // build code using bun
    // we install/build with separate commands so that we can use --bun to run node-gyp
    const bunInstall = spawnSync({
      cmd: [bunExe(), "install", "--ignore-scripts"],
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

    // build code using bun, in debug mode
    const bunDebugInstall = spawnSync({
      cmd: [bunExe(), "install", "--verbose", "--ignore-scripts"],
      cwd: join(__dirname, "v8-module-debug"),
      env: bunEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!bunDebugInstall.success) {
      throw new Error("build failed");
    }
    const bunDebugBuild = spawnSync({
      cmd: [bunExe(), "x", "--bun", "node-gyp", "rebuild", "--debug"],
      cwd: join(__dirname, "v8-module-debug"),
      env: bunEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!bunDebugBuild.success) {
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

  describe("External", () => {
    it("can create an external and read back the correct value", () => {
      checkSameOutput("test_v8_external", []);
    });
  });

  describe("Object", () => {
    it("can create an object and set properties", () => {
      checkSameOutput("test_v8_object", []);
    });
  });
  describe("Array", () => {
    // v8::Array::New is broken as it still tries to reinterpret locals as JSValues
    it.skip("can create an array from a C array of Locals", () => {
      checkSameOutput("test_v8_array_new", []);
    });
  });

  describe("ObjectTemplate", () => {
    it("creates objects with internal fields", () => {
      checkSameOutput("test_v8_object_template", []);
    });
  });

  describe("Function", () => {
    it("correctly receives all its arguments from JS", () => {
      checkSameOutput("print_values_from_js", [5.0, true, null, false, "meow", {}], {});
    });
  });

  afterAll(() => {
    fs.rmSync(join(__dirname, "v8-module-node"), { recursive: true, force: true });
    fs.rmSync(join(__dirname, "v8-module-debug"), { recursive: true, force: true });
  });
});

enum Runtime {
  node,
  bun,
}

enum BuildMode {
  debug,
  release,
}

function checkSameOutput(testName: string, args: any[], thisValue?: any) {
  const nodeResult = runOn(Runtime.node, BuildMode.release, testName, args, thisValue).trim();
  let bunReleaseResult = runOn(Runtime.bun, BuildMode.release, testName, args, thisValue);
  let bunDebugResult = runOn(Runtime.bun, BuildMode.debug, testName, args, thisValue);

  // remove all debug logs
  bunReleaseResult = bunReleaseResult.replaceAll(/^\[\w+\].+$/gm, "").trim();
  bunDebugResult = bunDebugResult.replaceAll(/^\[\w+\].+$/gm, "").trim();

  expect(bunReleaseResult, `test ${testName} printed different output under bun vs. under node`).toBe(nodeResult);
  expect(bunDebugResult, `test ${testName} printed different output under bun in debug mode vs. under node`).toBe(
    nodeResult,
  );
  return nodeResult;
}

function runOn(runtime: Runtime, buildMode: BuildMode, testName: string, jsArgs: any[], thisValue?: any) {
  if (runtime == Runtime.node) {
    assert(buildMode == BuildMode.release);
  }
  const baseDir =
    runtime == Runtime.node ? "v8-module-node" : buildMode == BuildMode.debug ? "v8-module-debug" : "v8-module";
  const exe = runtime == Runtime.node ? "node" : bunExe();

  const cmd = [
    exe,
    join(__dirname, baseDir, "main.js"),
    testName,
    JSON.stringify(jsArgs),
    JSON.stringify(thisValue ?? null),
  ];
  if (buildMode == BuildMode.debug) {
    cmd.push("debug");
  }

  const exec = spawnSync({
    cmd,
    env: bunEnv,
  });
  const errs = exec.stderr.toString();
  if (errs !== "") {
    throw new Error(errs);
  }
  expect(exec.success, `test ${testName} crashed under ${Runtime[runtime]} in ${BuildMode[buildMode]} mode`).toBeTrue();
  return exec.stdout.toString();
}
