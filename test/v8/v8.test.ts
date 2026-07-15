import { spawn } from "bun";
import { jscDescribe } from "bun:jsc";
import { beforeAll, describe, expect, it } from "bun:test";
import {
  bunEnv,
  bunExe,
  canBuildNodeAddons,
  isASAN,
  isBroken,
  isMusl,
  isWindows,
  nodeExeMatchingAbi,
  tempDir,
  tmpdirSync,
} from "harness";
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

// Node.js 26.3.0 requires C++20
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
        : // for node.js we don't bother with debug mode. Run node-gyp under bun
          // (--bun) here too: a clang-cl-built Node carries thin-LTO flags in
          // process.config.target_defaults that node-gyp copies into
          // config.gypi and MSVC's link.exe chokes on (/opt:lldltojobs) — gyp
          // -D defines can't override target_defaults. Bun reports the same
          // ABI (147) with clean target_defaults, so the module loads in
          // node 26 all the same.
          [bunExe(), "--bun", "run", "node-gyp", "rebuild", "--release", "-j", "max"],
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

describe.skipIf(!canBuildNodeAddons()).todoIf(isBroken && isMusl)("node:v8", () => {
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

    // Resolve (and possibly download) the ABI-matching node here, under the
    // generous hook timeout, instead of inside the first test that needs it.
    await nodeExeMatchingAbi();
  }, 600_000);

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
      "[new (class extends Array {})()]",
      "[new Proxy([], {})]",
      "[new Proxy(new Map(), {})]",
      "[(() => { const { proxy, revoke } = Proxy.revocable([], {}); revoke(); return proxy; })()]",
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
      it("encodes an astral character that doesn't fit the same way V8 does", async () => {
        await checkSameOutput("test_v8_string_write_utf8_surrogate");
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

    it("escaped handles survive in-scope inline handle creation", async () => {
      await checkSameOutput("test_v8_escapable_handle_scope_inline_grants");
    });

    it("inline handles survive a nested call's scope push/pop", async () => {
      await checkSameOutput("test_v8_locals_survive_nested_call");
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
  const exe = runtime == Runtime.node ? await nodeExeMatchingAbi() : bunExe();

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
  const crashMsg = `test ${testName} crashed under ${Runtime[runtime]} in ${BuildMode[buildMode]} mode (exit code ${exitCode}${exitCode && exitCode > 256 ? ` / 0x${exitCode.toString(16)}` : ""})`;
  if (exitCode !== 0) {
    throw new Error(`${crashMsg}: ${err}\n${out}`.trim());
  }
  expect(exitCode, crashMsg).toBe(0);
  return out.trim();
}

function standaloneAddonFiles(targetName: string, addonCpp: string, runJs: string) {
  return {
    "package.json": JSON.stringify({
      name: `${targetName}-test`,
      version: "1.0.0",
      devDependencies: { "node-gyp": "~11.2.0" },
    }),
    "binding.gyp": JSON.stringify({
      targets: [
        {
          target_name: targetName,
          sources: ["addon.cpp"],
          cflags: ["-Wno-deprecated-declarations"],
          cflags_cc: ["-Wno-deprecated-declarations"],
          xcode_settings: {
            OTHER_CFLAGS: ["-Wno-deprecated-declarations"],
            OTHER_CPLUSPLUSFLAGS: ["-Wno-deprecated-declarations"],
          },
        },
      ],
    }),
    "addon.cpp": addonCpp,
    "run.js": runJs,
  };
}

async function buildStandaloneAddon(cwd: string) {
  {
    await using install = spawn({
      cmd: [bunExe(), "install", "--ignore-scripts"],
      cwd,
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
  await using build = spawn({
    cmd: [
      bunExe(),
      "--bun",
      "run",
      "node-gyp",
      "rebuild",
      "--release",
      "-j",
      "max",
      "--",
      "-Denable_lto=false",
      "-Denable_thin_lto=false",
      "-Dlto_jobs=",
    ],
    cwd,
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
    throw new Error(`node-gyp rebuild failed with code ${exitCode}:\n${err}\n${out}`);
  }
}

async function runStandaloneAddon(cwd: string) {
  await using proc = spawn({
    cmd: [bunExe(), join(cwd, "run.js")],
    cwd,
    env: bunEnv,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = out
    .replaceAll(/^\[\w+\].+$/gm, "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  return { lines, err, exitCode };
}

describe.skipIf(!canBuildNodeAddons()).todoIf(isBroken && isMusl)("String::Utf8Length surrogates", () => {
  it(
    "counts each unpaired surrogate as three bytes",
    async () => {
      using dir = tempDir(
        "v8-utf8-length-surrogate",
        standaloneAddonFiles(
          "utf8lensurrogate",
          `#include <node.h>
#include <cstdio>
#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif

using namespace v8;

namespace utf8len_surrogate_test {

using LegacyUtf8Length = int (*)(const String *, Isolate *);

LegacyUtf8Length resolve_legacy_utf8_length() {
#ifdef _WIN32
  return reinterpret_cast<LegacyUtf8Length>(reinterpret_cast<void *>(
      GetProcAddress(GetModuleHandleW(nullptr),
                     "?Utf8Length@String@v8@@QEBAHPEAVIsolate@2@@Z")));
#else
  return reinterpret_cast<LegacyUtf8Length>(
      dlsym(RTLD_DEFAULT, "_ZNK2v86String10Utf8LengthEPNS_7IsolateE"));
#endif
}

void string_utf8_length(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<String> s = info[0].As<String>();
  static const LegacyUtf8Length legacy_utf8_length = resolve_legacy_utf8_length();
  if (legacy_utf8_length == nullptr) {
    printf("Utf8Length symbol missing\\n");
    fflush(stdout);
    return;
  }
  printf("Utf8Length = %d, Utf8LengthV2 = %zu\\n", legacy_utf8_length(*s, isolate),
         s->Utf8LengthV2(isolate));
  fflush(stdout);
}

void initialize(Local<Object> exports, Local<Value> module,
                Local<Context> context) {
  NODE_SET_METHOD(exports, "string_utf8_length", string_utf8_length);
}

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, initialize)

} // namespace utf8len_surrogate_test
`,
          `const addon = require("./build/Release/utf8lensurrogate");
addon.string_utf8_length("a\\u00e9b");
addon.string_utf8_length("a\\ud83d\\ude00b");
addon.string_utf8_length("a\\ud800b");
addon.string_utf8_length("\\ud800");
addon.string_utf8_length("a\\udfffb");
`,
        ),
      );
      const cwd = String(dir);
      await buildStandaloneAddon(cwd);
      const { lines, err, exitCode } = await runStandaloneAddon(cwd);
      expect(lines, `stderr:\n${err}`).toEqual([
        "Utf8Length = 4, Utf8LengthV2 = 4",
        "Utf8Length = 6, Utf8LengthV2 = 6",
        "Utf8Length = 5, Utf8LengthV2 = 5",
        "Utf8Length = 3, Utf8LengthV2 = 3",
        "Utf8Length = 5, Utf8LengthV2 = 5",
      ]);
      expect(exitCode).toBe(0);
    },
    10 * 60 * 1000,
  );
});

describe.skipIf(!canBuildNodeAddons()).todoIf(isBroken && isMusl)("Number::New", () => {
  it(
    "returns a numeric NaN for every NaN bit pattern",
    async () => {
      using dir = tempDir(
        "v8-number-nan",
        standaloneAddonFiles(
          "numbernan",
          `#include <node.h>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>

using namespace v8;

namespace number_nan_test {

void number_from_bits(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  uint64_t hi = static_cast<uint64_t>(info[0].As<Number>()->Value());
  uint64_t lo = static_cast<uint64_t>(info[1].As<Number>()->Value());
  uint64_t bits = (hi << 32) | lo;
  double value;
  memcpy(&value, &bits, sizeof value);
  Local<Number> num = Number::New(isolate, value);
  printf("isnan = %d\\n", std::isnan(num->Value()) ? 1 : 0);
  fflush(stdout);
  info.GetReturnValue().Set(num);
}

void initialize(Local<Object> exports, Local<Value> module,
                Local<Context> context) {
  NODE_SET_METHOD(exports, "number_from_bits", number_from_bits);
}

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, initialize)

} // namespace number_nan_test
`,
          `const addon = require("./build/Release/numbernan");
for (const [hi, lo] of [
  [0x7ff80000, 0x00000000],
  [0xfffe0000, 0x00010000],
  [0xfffe0000, 0x00000000],
  [0xffffffff, 0xffffffff],
  [0x7ff40000, 0x00000001],
]) {
  const value = addon.number_from_bits(hi, lo);
  console.log(typeof value, Number.isNaN(value));
}
`,
        ),
      );
      const cwd = String(dir);
      await buildStandaloneAddon(cwd);
      const { lines, err, exitCode } = await runStandaloneAddon(cwd);
      expect(lines, `stderr:\n${err}`).toEqual([
        "isnan = 1",
        "number true",
        "isnan = 1",
        "number true",
        "isnan = 1",
        "number true",
        "isnan = 1",
        "number true",
        "isnan = 1",
        "number true",
      ]);
      expect(exitCode).toBe(0);
    },
    10 * 60 * 1000,
  );
});

describe.skipIf(!canBuildNodeAddons()).todoIf(isBroken && isMusl)("String::Utf8Length bounds", () => {
  it(
    "reports sizes beyond INT32_MAX without wrapping",
    async () => {
      // Build a tiny standalone V8-API addon that just reports String::Utf8LengthV2 of its
      // argument, then feed it a Latin-1 string whose UTF-8 expansion is larger than INT32_MAX.
      // Utf8LengthV2 returns size_t, so the reported length must be the exact byte count
      // instead of wrapping to a negative or small value (the legacy int-returning Utf8Length
      // saturated at INT32_MAX here).
      using dir = tempDir("v8-utf8-length", {
        "package.json": JSON.stringify({
          name: "v8-utf8-length-test",
          version: "1.0.0",
          devDependencies: { "node-gyp": "~11.2.0" },
        }),
        "binding.gyp": JSON.stringify({
          targets: [
            {
              target_name: "utf8len",
              sources: ["addon.cpp"],
              cflags: ["-Wno-deprecated-declarations"],
              cflags_cc: ["-Wno-deprecated-declarations"],
              xcode_settings: {
                OTHER_CFLAGS: ["-Wno-deprecated-declarations"],
                OTHER_CPLUSPLUSFLAGS: ["-Wno-deprecated-declarations"],
              },
            },
          ],
        }),
        "addon.cpp": `#include <node.h>
#include <cstdio>

using namespace v8;

namespace utf8len_test {

void string_utf8_length(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<String> s = info[0].As<String>();
  printf("Utf8Length = %zu\\n", s->Utf8LengthV2(isolate));
  fflush(stdout);
}

void initialize(Local<Object> exports, Local<Value> module,
                Local<Context> context) {
  NODE_SET_METHOD(exports, "string_utf8_length", string_utf8_length);
}

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, initialize)

} // namespace utf8len_test
`,
        "run.js": `const addon = require("./build/Release/utf8len");
// sanity check: 3 two-byte characters encode to 6 UTF-8 bytes
addon.string_utf8_length("\\u00e9".repeat(3));
// 2**30 + 1 Latin-1 characters that each take 2 UTF-8 bytes encode to 2**31 + 2 UTF-8 bytes,
// which is larger than INT32_MAX
addon.string_utf8_length("\\u00ff".repeat(2 ** 30 + 1));
`,
      });
      const cwd = String(dir);

      {
        const install = spawn({
          cmd: [bunExe(), "install", "--ignore-scripts"],
          cwd,
          env: bunEnv,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        });
        expect(await install.exited).toBe(0);
      }

      {
        const build = spawn({
          cmd: [
            bunExe(),
            "--bun",
            "run",
            "node-gyp",
            "rebuild",
            "--release",
            "-j",
            "max",
            "--",
            "-Denable_lto=false",
            "-Denable_thin_lto=false",
            "-Dlto_jobs=",
          ],
          cwd,
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
          throw new Error(`node-gyp rebuild failed with code ${exitCode}:\n${err}\n${out}`);
        }
      }

      const proc = spawn({
        cmd: [bunExe(), join(cwd, "run.js")],
        cwd,
        env: bunEnv,
        stdin: "inherit",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      // strip debug-build scoped log lines, same as checkSameOutput does
      const lines = out
        .replaceAll(/^\[\w+\].+$/gm, "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      // Both strings report their exact UTF-8 size: Utf8LengthV2 returns size_t, so the
      // oversized string's 2**31 + 2 bytes are reported exactly instead of wrapping or
      // saturating at INT32_MAX like the legacy Utf8Length did.
      expect(lines, `stderr:\n${err}`).toEqual(["Utf8Length = 6", "Utf8Length = 2147483650"]);
      expect(exitCode).toBe(0);
    },
    10 * 60 * 1000,
  );
});
