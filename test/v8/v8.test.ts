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
    it("SetClassName propagates to GetFunction result", async () => {
      const out = await checkSameOutput("test_v8_function_template_set_class_name");
      expect(out).toContain("MyNamedClass");
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

    it("receives globalThis as this when called bare through a closure", async () => {
      const output = await checkSameOutput("call_function_bare_through_closure");
      expect(output).toContain("bare call returned globalThis: true");
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

  describe("ReturnValue", () => {
    it("keeps the returned value alive when the scope it was created in closes", async () => {
      await checkSameOutput("test_v8_return_value_from_inner_scope");
    });
  });

  describe("MaybeLocal", () => {
    it("correctly handles ToLocal and ToLocalChecked operations", async () => {
      await checkSameOutput("test_v8_maybe_local");
    });
  });

  describe("Integer", () => {
    it("can create and read back int32 values", async () => {
      await checkSameOutput("test_v8_integer");
    });
  });

  describe("Object::DefineOwnProperty", () => {
    it("applies PropertyAttribute flags to the defined property", async () => {
      await checkSameOutput("test_v8_define_own_property");
    });
  });

  describe("BigInt", () => {
    it("BigInt::New creates a JS bigint with the given int64 value", async () => {
      await checkSameOutput("test_v8_bigint");
    });
  });

  describe("String::NewFromUtf8Literal", () => {
    it("creates strings from C string literals (ASCII and UTF-8)", async () => {
      await checkSameOutput("test_v8_string_from_utf8_literal");
    });
  });

  describe("PrototypeTemplate / Template::Set / SetNativeDataProperty", () => {
    it("prototype methods and native accessors are reachable on instances", async () => {
      await checkSameOutput("test_v8_prototype_template");
    });

    it("native accessor callbacks see the object as their holder on property access", async () => {
      const output = await checkSameOutput("native_accessor_holder_on_property_access");
      expect(output).toBe(["getter holder is the object: true", "setter holder is the object: true"].join("\n"));
    });

    // Only Bun exposes a native data property's getter and setter as callable functions, so this
    // cannot be compared against Node: the receiver has to be converted the way a sloppy-mode
    // function would, in particular a bare call through a closure must not hand the accessor the
    // scope object JSC leaves in the this slot.
    it("native accessor callbacks get a sloppy-mode holder when called as functions", async () => {
      const expected = [
        "bare getter(): globalThis",
        "getter.call(undefined): globalThis",
        "getter.call(null): globalThis",
        "getter.call(5): a Number object",
        "getter.call(obj): the object",
        "bare setter(): globalThis",
        "setter.call(undefined): globalThis",
        "setter.call(null): globalThis",
        "setter.call(5): a Number object",
        "setter.call(obj): the object",
      ].join("\n");
      for (const buildMode of [BuildMode.release, BuildMode.debug]) {
        const output = await runOn(Runtime.bun, buildMode, "native_accessor_holder_for_weird_receivers");
        expect(output.replaceAll(/^\[\w+\].+$/gm, "").trim(), `addon built in ${BuildMode[buildMode]} mode`).toBe(
          expected,
        );
      }
    });
  });

  describe("ArrayBuffer / TypedArray", () => {
    it("can create an ArrayBuffer and read through its BackingStore", async () => {
      await checkSameOutput("test_v8_arraybuffer");
    });
    it("can create Uint8Array/Uint32Array views with offset and length", async () => {
      await checkSameOutput("test_v8_typedarray");
    });
  });

  describe("Function::Call / NewInstance", () => {
    it("Function::Call forwards recv and argv", async () => {
      await checkSameOutput("test_v8_function_call");
    });
    it("Function::NewInstance constructs via a FunctionTemplate", async () => {
      await checkSameOutput("test_v8_function_new_instance");
    });
    it("FunctionTemplate::GetFunction returns the same function on repeat calls", async () => {
      await checkSameOutput("test_v8_getfunction_memoized");
    });
  });

  describe("Map", () => {
    it("Map::Set and Map::Delete mutate the underlying JS Map", async () => {
      await checkSameOutput("test_v8_map");
    });
  });

  describe("Exception", () => {
    it("Exception::Error/TypeError create throwable Error objects", async () => {
      await checkSameOutput("test_v8_exception");
    });
  });

  describe("Aligned internal fields", () => {
    it("round-trips pointers through Set/GetAlignedPointerInInternalField", async () => {
      await checkSameOutput("test_v8_aligned_pointer_in_internal_field");
    });
  });

  describe("CpuProfiler", () => {
    it("Start/Stop returns a profile with a root node", async () => {
      await checkSameOutput("test_v8_cpu_profiler");
    });
    it("accepts overlapping sessions and returns a profile for each", async () => {
      // Regression test for dd-trace's profiler, which calls Start() for the
      // next cycle before Stop() of the current one (see @datadog/pprof).
      await checkSameOutput("test_v8_cpu_profiler_overlapping_sessions");
    });
    it("StartProfiling/StopProfiling key sessions by title and GetTitle returns it", async () => {
      // google's pprof addon uses the title-keyed overloads (#19678).
      await checkSameOutput("test_v8_cpu_profiler_title_api");
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

// A Node-API addon can also call the V8 API from its callbacks. Node runs every Node-API callback
// inside a v8::HandleScope, so such an addon does not open one itself, and with the Node 26
// headers an addon-side v8::HandleScope is inline and never reaches Bun either way. Bun used to
// keep separate Node-API and V8 handle scopes and had no V8 scope open here, so the first V8 call
// that created a handle crashed (Array::New from a napi_define_class constructor, in the wild).
// Now both APIs share the scope Bun opens around the callback.
describe.skipIf(!canBuildNodeAddons()).todoIf(isBroken && isMusl)("V8 API from Node-API callbacks", () => {
  it(
    "creates handles in the Node-API scope, keeps them alive, and releases them when it closes",
    async () => {
      using dir = tempDir(
        "v8-api-from-napi",
        standaloneAddonFiles(
          "hybridnapi",
          `// A Node-API addon whose callbacks also use the V8 C++ API. Node runs every Node-API callback
// inside a v8::HandleScope, so the callbacks below only open one where the test is about that.
// Each callback reports its result as a string so that run.js can print everything in order.
#include <node.h>
#include <node_api.h>
#include <cstdio>
#include <cstring>

namespace hybrid_test {

using namespace v8;

Global<Array> stashed_array;

napi_value to_napi_string(napi_env env, const char* text) {
  napi_value result;
  napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &result);
  return result;
}

// Array::New(isolate, length) is where the crash under test happened. The callback overload
// additionally opens an EscapableHandleScope inside Bun around the callbacks.
napi_value describe_new_values(napi_env env, Isolate* isolate) {
  Local<Array> array = Array::New(isolate, 3);
  Local<String> string =
      String::NewFromUtf8(isolate, "string from v8", NewStringType::kNormal).ToLocalChecked();
  int next = 0;
  Local<Array> from_callback =
      Array::New(isolate->GetCurrentContext(), 4,
                 [&]() -> MaybeLocal<Value> { return Number::New(isolate, next++); })
          .ToLocalChecked();
  char string_text[64];
  string->WriteUtf8V2(isolate, string_text, sizeof string_text, String::WriteFlags::kNullTerminate);
  char result[128];
  snprintf(result, sizeof result, "arrays of length %u and %u, '%s'", array->Length(),
           from_callback->Length(), string_text);
  return to_napi_string(env, result);
}

napi_value without_scope(napi_env env, napi_callback_info info) {
  return describe_new_values(env, Isolate::GetCurrent());
}

napi_value with_scope(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  return describe_new_values(env, isolate);
}

napi_value with_escapable_scope(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<String> escaped;
  {
    EscapableHandleScope scope(isolate);
    escaped = scope.Escape(
        String::NewFromUtf8(isolate, "escaped string", NewStringType::kNormal).ToLocalChecked());
  }
  char text[64];
  escaped->WriteUtf8V2(isolate, text, sizeof text, String::WriteFlags::kNullTerminate);
  return to_napi_string(env, text);
}

napi_value constructor(napi_env env, napi_callback_info info) {
  napi_value description = describe_new_values(env, Isolate::GetCurrent());
  napi_value this_arg;
  size_t argc = 0;
  napi_get_cb_info(env, info, &argc, nullptr, &this_arg, nullptr);
  napi_set_named_property(env, this_arg, "description", description);
  return this_arg;
}

void call_argument(napi_env env, napi_callback_info info, napi_value* result) {
  size_t argc = 1;
  napi_value callback;
  napi_get_cb_info(env, info, &argc, &callback, nullptr, nullptr);
  napi_value global;
  napi_get_global(env, &global);
  napi_call_function(env, global, callback, 0, nullptr, result);
}

// The handles created in a callback have to keep their values alive for the rest of the callback,
// including across a GC that the callback triggers itself (the argument is a function that runs
// the GC).
napi_value survives_gc(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  constexpr int count = 500;
  Local<String> strings[count];
  for (int i = 0; i < count; i++) {
    char text[32];
    snprintf(text, sizeof text, "string %d", i);
    strings[i] = String::NewFromUtf8(isolate, text, NewStringType::kNormal).ToLocalChecked();
  }

  napi_value ignored;
  call_argument(env, info, &ignored);

  int intact = 0;
  for (int i = 0; i < count; i++) {
    char expected[32], actual[32];
    snprintf(expected, sizeof expected, "string %d", i);
    strings[i]->WriteUtf8V2(isolate, actual, sizeof actual, String::WriteFlags::kNullTerminate);
    intact += strcmp(expected, actual) == 0;
  }
  char result[64];
  snprintf(result, sizeof result, "%d of %d strings intact after gc", intact, count);
  return to_napi_string(env, result);
}

constexpr int num_buffers = 1000;

// The argument is a function that runs the GC and returns the number of live ArrayBuffers. Reports
// whether the buffers the caller created inside already-closed scopes are gone.
napi_value describe_released(napi_env env, napi_callback_info info) {
  napi_value live_value;
  call_argument(env, info, &live_value);
  int32_t live = -1;
  napi_get_value_int32(env, live_value, &live);
  return to_napi_string(env, live < num_buffers / 10 ? "released before the callback returned"
                                                     : "still alive when the callback returned");
}

napi_value napi_scopes_release(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  for (int i = 0; i < num_buffers; i++) {
    napi_handle_scope scope;
    napi_open_handle_scope(env, &scope);
    ArrayBuffer::New(isolate, 8);
    napi_close_handle_scope(env, scope);
  }
  return describe_released(env, info);
}

// No scope at all: run.js checks that the buffers are released once this returns.
napi_value create_buffers(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  for (int i = 0; i < num_buffers; i++) {
    ArrayBuffer::New(isolate, 8);
  }
  return nullptr;
}

napi_value stash_array(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  stashed_array.Reset(isolate, Array::New(isolate, 5));
  return nullptr;
}

// Global::Get creates its Local through V8's inline handle creation code, which enters Bun through
// HandleScope::Extend rather than through a value constructor like Array::New, and each inline
// HandleScope hands those handles back through HandleScope::DeleteExtensions when it closes.
napi_value read_stashed_array(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  unsigned total_length = 0;
  for (int i = 0; i < 1000; i++) {
    HandleScope scope(isolate);
    total_length += stashed_array.Get(isolate)->Length();
  }
  Local<Array> array = stashed_array.Get(isolate);
  char result[96];
  snprintf(result, sizeof result, "stashed array of length %u, %u in total over 1000 inline scopes",
           array->Length(), total_length);
  stashed_array.Reset();
  return to_napi_string(env, result);
}

napi_value init(napi_env env, napi_value exports) {
  struct {
    const char* name;
    napi_callback callback;
  } functions[] = {
      {"withoutScope", without_scope},
      {"withScope", with_scope},
      {"withEscapableScope", with_escapable_scope},
      {"survivesGc", survives_gc},
      {"napiScopesRelease", napi_scopes_release},
      {"createBuffers", create_buffers},
      {"stashArray", stash_array},
      {"readStashedArray", read_stashed_array},
  };
  for (auto& function : functions) {
    napi_value value;
    napi_create_function(env, function.name, NAPI_AUTO_LENGTH, function.callback, nullptr, &value);
    napi_set_named_property(env, exports, function.name, value);
  }
  napi_value klass;
  napi_define_class(env, "Klass", NAPI_AUTO_LENGTH, constructor, nullptr, 0, nullptr, &klass);
  napi_set_named_property(env, exports, "Klass", klass);
  return exports;
}

}  // namespace hybrid_test

NAPI_MODULE(NODE_GYP_MODULE_NAME, hybrid_test::init)`,
          `const addon = require("./build/Release/hybridnapi");
const { heapStats } = require("bun:jsc");

function gc() {
  Bun.gc(true);
}

function liveArrayBuffers() {
  gc();
  return heapStats().objectTypeCounts.ArrayBuffer ?? 0;
}

console.log("function without scope:", addon.withoutScope());
console.log("function with scope:", addon.withScope());
console.log("function with escapable scope:", addon.withEscapableScope());
console.log("class constructor:", new addon.Klass().description);
console.log("survives gc:", addon.survivesGc(gc));
console.log("per-iteration napi_handle_scope:", addon.napiScopesRelease(liveArrayBuffers));
addon.createBuffers();
console.log("no scope:", liveArrayBuffers() < 100 ? "released when the callback returned" : "still alive after the callback returned");
addon.stashArray();
console.log("global handle:", addon.readStashedArray());`,
        ),
      );
      const cwd = String(dir);
      await buildStandaloneAddon(cwd);
      const { lines, err, exitCode } = await runStandaloneAddon(cwd);
      expect(lines, `stderr:\n${err}`).toEqual([
        "function without scope: arrays of length 3 and 4, 'string from v8'",
        "function with scope: arrays of length 3 and 4, 'string from v8'",
        "function with escapable scope: escaped string",
        "class constructor: arrays of length 3 and 4, 'string from v8'",
        "survives gc: 500 of 500 strings intact after gc",
        "per-iteration napi_handle_scope: released before the callback returned",
        "no scope: released when the callback returned",
        "global handle: stashed array of length 5, 5000 in total over 1000 inline scopes",
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
