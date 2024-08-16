import { it, expect, test, beforeAll, describe, afterAll } from "bun:test";
import { bunExe, bunEnv, tmpdirSync } from "harness";
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

const srcDir = join(__dirname, "v8-module");
const directories = {
  bunRelease: "",
  bunDebug: "",
  node: "",
  badModules: "",
};

beforeAll(() => {
  // set up clean directories for our 4 builds
  directories.bunRelease = tmpdirSync();
  directories.bunDebug = tmpdirSync();
  directories.node = tmpdirSync();
  directories.badModules = tmpdirSync();

  fs.cpSync(srcDir, directories.bunRelease, { recursive: true });
  fs.cpSync(srcDir, directories.bunDebug, { recursive: true });
  fs.cpSync(srcDir, directories.node, { recursive: true });
  fs.cpSync(join(__dirname, "bad-modules"), directories.badModules, { recursive: true });

  // build code using bun
  // we install/build with separate commands so that we can use --bun to run node-gyp
  const bunInstall = spawnSync({
    cmd: [bunExe(), "install", "--ignore-scripts"],
    cwd: directories.bunRelease,
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
    cwd: directories.bunRelease,
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
    cwd: directories.bunDebug,
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
    cwd: directories.bunDebug,
    env: bunEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!bunDebugBuild.success) {
    throw new Error("build failed");
  }

  // build code using node (since `bun install` neither uses nor has a --bun flag)
  const nodeInstall = spawnSync({
    cmd: [bunExe(), "install"],
    cwd: directories.node,
    env: bunEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!nodeInstall.success) {
    throw new Error("build failed");
  }

  // build bad modules (these should not depend strongly on the runtime version)
  const badModulesBuild = spawnSync({
    cmd: [bunExe(), "install"],
    cwd: directories.badModules,
    env: bunEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!badModulesBuild.success) {
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
  it("can create large integer", () => {
    checkSameOutput("test_v8_number_large_int", []);
  });
  it("can create fraction", () => {
    checkSameOutput("test_v8_number_fraction", []);
  });
});

describe("String", () => {
  it("can create and read back strings with only ASCII characters", () => {
    checkSameOutput("test_v8_string_ascii", []);
  });
  // non-ASCII strings are not implemented yet
  it("can create and read back strings with UTF-8 characters", () => {
    checkSameOutput("test_v8_string_utf8", []);
  });
  it("handles replacement correctly in strings with invalid UTF-8 sequences", () => {
    checkSameOutput("test_v8_string_invalid_utf8", []);
  });
  describe("WriteUtf8", () => {
    it("truncates the string correctly", () => {
      checkSameOutput("test_v8_string_write_utf8", []);
    });
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

describe("error handling", () => {
  it("throws an error for modules built using the wrong ABI version", () => {
    expect(() => require(join(directories.badModules, "build/Release/mismatched_abi_version.node"))).toThrow(
      "The module 'mismatched_abi_version' was compiled against a different Node.js ABI version using NODE_MODULE_VERSION 42.",
    );
  });

  it("throws an error for modules with no entrypoint", () => {
    expect(() => require(join(directories.badModules, "build/Release/no_entrypoint.node"))).toThrow(
      "The module 'no_entrypoint' has no declared entry point.",
    );
  });
});

afterAll(() => {
  fs.rmSync(directories.bunRelease, { recursive: true, force: true });
  fs.rmSync(directories.bunDebug, { recursive: true, force: true });
  fs.rmSync(directories.node, { recursive: true, force: true });
  fs.rmSync(directories.badModules, { recursive: true, force: true });
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
    runtime == Runtime.node
      ? directories.node
      : buildMode == BuildMode.debug
        ? directories.bunDebug
        : directories.bunRelease;
  const exe = runtime == Runtime.node ? "node" : bunExe();

  const cmd = [exe, join(baseDir, "main.js"), testName, JSON.stringify(jsArgs), JSON.stringify(thisValue ?? null)];
  if (buildMode == BuildMode.debug) {
    cmd.push("debug");
  }

  const exec = spawnSync({
    cmd,
    cwd: baseDir,
    env: bunEnv,
  });
  const errs = exec.stderr.toString();
  if (errs !== "") {
    throw new Error(errs);
  }
  expect(exec.success, `test ${testName} crashed under ${Runtime[runtime]} in ${BuildMode[buildMode]} mode`).toBeTrue();
  return exec.stdout.toString();
}
