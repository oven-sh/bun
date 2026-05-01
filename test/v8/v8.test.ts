import { spawn } from "bun";
import { jscDescribe } from "bun:jsc";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isBroken, isMusl, isWindows, nodeExe, tmpdirSync } from "harness";
import assert from "node:assert";
import fs from "node:fs/promises";
import { basename, join } from "path";

enum Runtime {
  node,
  bun,
}

enum BuildMode {
  debug,
  release,
}

// clang-cl does not work on Windows with node-gyp 10.2.0, so we should not let that affect the
// test environment
delete bunEnv.CC;
delete bunEnv.CXX;

// Node.js 24.3.0 requires C++20
bunEnv.CXXFLAGS ??= "";
if (process.platform == "darwin") {
  bunEnv.CXXFLAGS += " -std=gnu++20";
} else {
  bunEnv.CXXFLAGS += " -std=c++20";
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

async function install(srcDir: string, tmpDir: string, runtime: Runtime): Promise<void> {
  await fs.cp(srcDir, tmpDir, { recursive: true, force: true });
  const install = spawn({
    cmd: [bunExe(), "install", "--ignore-scripts"],
    cwd: tmpDir,
    env: bunEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await install.exited;
  if (exitCode !== 0) {
    throw new Error(`install failed: ${exitCode}`);
  }
}

async function build(
  srcDir: string,
  tmpDir: string,
  runtime: Runtime,
  buildMode: BuildMode,
): Promise<{ out: string; err: string; description: string }> {
  const build = spawn({
    cmd:
      runtime == Runtime.bun
        ? [
            bunExe(),
            "--bun",
            "run",
            "node-gyp",
            "rebuild",
            buildMode == BuildMode.debug ? "--debug" : "--release",
            "-j",
            "max",
          ]
        : [bunExe(), "run", "node-gyp", "rebuild", "--release", "-j", "max"], // for node.js we don't bother with debug mode
    cwd: tmpDir,
    env: bunEnv,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, out, err] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);
  if (exitCode !== 0) {
    console.error(err);
    console.log(out);
    console.error(`build failed: ${exitCode}, bailing out`);
    process.exit(1);
  }

  const description = `build ${basename(srcDir)} with ${Runtime[runtime]} in ${BuildMode[buildMode]} mode`;

  console.log(description, "stdout:");
  console.log(out);
  console.log(description, "stderr:");
  console.log(err);
}

describe.todoIf(isBroken && isMusl)("node:v8", () => {
  beforeAll(async () => {
    // set up clean directories for our 4 builds
    directories.bunRelease = tmpdirSync();
    directories.bunDebug = tmpdirSync();
    directories.node = tmpdirSync();
    directories.badModules = tmpdirSync();

    await install(srcDir, directories.bunRelease, Runtime.bun);
    await install(srcDir, directories.bunDebug, Runtime.bun);
    await install(srcDir, directories.node, Runtime.node);
    await install(join(__dirname, "bad-modules"), directories.badModules, Runtime.node);

    await build(srcDir, directories.bunRelease, Runtime.bun, BuildMode.release);
    await build(srcDir, directories.bunDebug, Runtime.bun, BuildMode.debug);
    await build(srcDir, directories.node, Runtime.node, BuildMode.release);
    await build(join(__dirname, "bad-modules"), directories.badModules, Runtime.node, BuildMode.release);
  });

  describe("module lifecycle", () => {
    it("can call a basic native function", async () => {
      await checkSameOutput("test_v8_native_call");
    });
  });

  describe("primitives", () => {
    it("can create and distinguish between null, undefined, true, and false", async () => {
      await checkSameOutput("test_v8_primitives");
    });
  });

  describe("Value type checks", () => {
    it("Math.fround returns a double-encoded value", () => {
      // If this fails, you need to find a new way to make a JSValue which uses the double encoding
      // but holds an int32 value (maybe Float64Array?)
      expect(jscDescribe(Math.fround(1))).toBe("Double: 4607182418800017408, 1.000000");
    });

    it.each([
      // Each entry should eval() to an array of arguments
      "[new Map()]",
      "[[]]",
      "[42]",
      "[2 ** 31 - 1]", // INT32_MAX
      "[2 ** 31]", // INT32_MAX + 1 (should not be Int32)
      "[-(2 ** 31)]", // INT32_MIN
      "[-(2 ** 31) - 1]", // INT32_MIN - 1 (should not be Int32)
      "[2 ** 32 - 1]", // UINT32_MAX
      "[2 ** 32]", // UINT32_MAX + 1
      "[Math.fround(1)]", // Value represented as a double but whose numeric value fits in the int32 range (should be int32)
      "[123n]",
      "[3.14]",
      "['string']",
      "[{}]",
    ])("matches Node for IsMap/IsArray/IsInt32/IsBigInt on %s", async args => {
      await checkSameOutput("test_v8_value_type_checks", args);
    });
  });
  describe("Number", () => {
    it("can create small integer", async () => {
      await checkSameOutput("test_v8_number_int");
    });
    // non-i32 v8::Number is not implemented yet
    it("can create large integer", async () => {
      await checkSameOutput("test_v8_number_large_int");
    });
    it("can create fraction", async () => {
      await checkSameOutput("test_v8_number_fraction");
    });
  });

  describe("String", () => {
    it("can create and read back strings with only ASCII characters", async () => {
      await checkSameOutput("test_v8_string_ascii");
    });
    // non-ASCII strings are not implemented yet
    it("can create and read back strings with UTF-8 characters", async () => {
      await checkSameOutput("test_v8_string_utf8");
    });
    it("handles replacement correctly in strings with invalid UTF-8 sequences", async () => {
      await checkSameOutput("test_v8_string_invalid_utf8");
    });
    it("can create strings from null-terminated Latin-1 data", async () => {
      await checkSameOutput("test_v8_string_latin1");
    });
    describe("WriteUtf8", () => {
      it("truncates the string correctly", async () => {
        await checkSameOutput("test_v8_string_write_utf8");
      });
    });
  });

  describe("External", () => {
    it("can create an external and read back the correct value", async () => {
      await checkSameOutput("test_v8_external");
    });
  });

  describe("Value", () => {
    it("can compare values using StrictEquals", async () => {
      await checkSameOutput("test_v8_strict_equals");
    });
  });

  describe("Object", () => {
    it("can create an object and set properties", async () => {
      await checkSameOutput("test_v8_object");
    });
    it("can get properties by key using Object::Get(context, key)", async () => {
      await checkSameOutput("test_v8_object_get_by_key");
    });
    it("can get array elements by index using Object::Get(context, index)", async () => {
      await checkSameOutput("test_v8_object_get_by_index");
    });
    it("correctly handles exceptions from get and set", async () => {
      await checkSameOutput("test_v8_object_get_set_exceptions");
    });
  });
  describe("Array", () => {
    it("can create an array from a C array of Locals", async () => {
      await checkSameOutput("test_v8_array_new");
    });
    it("can create an array with a specific length", async () => {
      await checkSameOutput("test_v8_array_new_with_length");
    });
    it("can create an array from a callback", async () => {
      await checkSameOutput("test_v8_array_new_with_callback");
    });
    it("correctly reports array length", async () => {
      await checkSameOutput("test_v8_array_length");
    });
    it("can iterate over array elements with callbacks", async () => {
      await checkSameOutput("test_v8_array_iterate");
    });
  });

  describe("ObjectTemplate", () => {
    it("creates objects with internal fields", async () => {
      await checkSameOutput("test_v8_object_template");
    });
  });

  describe("FunctionTemplate", () => {
    it("keeps the data parameter alive", async () => {
      await checkSameOutput("test_v8_function_template");
    });
  });

  describe("Function", () => {
    it("correctly receives all its arguments from JS", async () => {
      await checkSameOutput("print_values_from_js", "[5.0, true, null, false, 'async meow', {}]");
      await checkSameOutput("print_native_function");
    });

    it("correctly receives the this value from JS", async () => {
      await checkSameOutput("call_function_with_weird_this_values");
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

  describe("Global", () => {
    it("can create, modify, and read the value from global handles", async () => {
      await checkSameOutput("test_v8_global");
    });
  });

  describe("HandleScope", () => {
    it("can hold a lot of locals", async () => {
      await checkSameOutput("test_many_v8_locals");
    });
    // Skip on ASAN: false positives due to dynamic library boundary crossing where
    // Bun is built with ASAN+UBSAN but the native addon is not
    it.skipIf(isASAN)(
      "keeps GC objects alive",
      async () => {
        await checkSameOutput("test_handle_scope_gc");
      },
      10000,
    );
  });

  describe("EscapableHandleScope", () => {
    it("keeps handles alive in the outer scope", async () => {
      await checkSameOutput("test_v8_escapable_handle_scope");
    });
  });

  describe("MaybeLocal", () => {
    it("correctly handles ToLocal and ToLocalChecked operations", async () => {
      await checkSameOutput("test_v8_maybe_local");
    });
  });

  describe("uv_os_getpid", () => {
    it.skipIf(isWindows)("returns the same result as getpid on POSIX", async () => {
      await checkSameOutput("test_uv_os_getpid");
    });
  });

  describe("uv_os_getppid", () => {
    it.skipIf(isWindows)("returns the same result as getppid on POSIX", async () => {
      await checkSameOutput("test_uv_os_getppid");
    });
  });
});

async function checkSameOutput(testName: string, args?: string, thisValue?: any) {
  const [nodeResultResolution, bunReleaseResultResolution, bunDebugResultResolution] = await Promise.allSettled([
    runOn(Runtime.node, BuildMode.release, testName, args, thisValue),
    runOn(Runtime.bun, BuildMode.release, testName, args, thisValue),
    runOn(Runtime.bun, BuildMode.debug, testName, args, thisValue),
  ]);
  const errors = [nodeResultResolution, bunReleaseResultResolution, bunDebugResultResolution]
    .filter(r => r.status === "rejected")
    .map(r => r.reason);
  if (errors.length > 0) {
    throw new AggregateError(errors);
  }
  let [nodeResult, bunReleaseResult, bunDebugResult] = [
    nodeResultResolution,
    bunReleaseResultResolution,
    bunDebugResultResolution,
  ].map(r => (r as any).value);
  // remove all debug logs
  bunReleaseResult = bunReleaseResult.replaceAll(/^\[\w+\].+$/gm, "").trim();
  bunDebugResult = bunDebugResult.replaceAll(/^\[\w+\].+$/gm, "").trim();

  expect(bunReleaseResult, `test ${testName} printed different output under bun vs. under node`).toBe(nodeResult);
  expect(bunDebugResult, `test ${testName} printed different output under bun in debug mode vs. under node`).toBe(
    nodeResult,
  );
  return nodeResult;
}

/**
 * @param jsArgs should eval() to an array
 * @param thisValue will be JSON stringified
 */
async function runOn(runtime: Runtime, buildMode: BuildMode, testName: string, jsArgs?: string, thisValue?: any) {
  if (runtime == Runtime.node) {
    assert(buildMode == BuildMode.release);
  }
  const baseDir =
    runtime == Runtime.node
      ? directories.node
      : buildMode == BuildMode.debug
        ? directories.bunDebug
        : directories.bunRelease;
  const exe = runtime == Runtime.node ? (nodeExe() ?? "node") : bunExe();

  const cmd = [
    exe,
    ...(runtime == Runtime.bun ? ["--smol"] : []),
    join(baseDir, "main.js"),
    testName,
    jsArgs ?? "[]",
    JSON.stringify(thisValue ?? null),
  ];
  if (buildMode == BuildMode.debug) {
    cmd.push("debug");
  }

  const proc = spawn({
    cmd,
    cwd: baseDir,
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  const [exitCode, out, err] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);
  const crashMsg = `test ${testName} crashed under ${Runtime[runtime]} in ${BuildMode[buildMode]} mode`;
  if (exitCode !== 0) {
    throw new Error(`${crashMsg}: ${err}\n${out}`.trim());
  }
  expect(exitCode, crashMsg).toBe(0);
  return out.trim();
}
