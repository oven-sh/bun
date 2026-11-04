import { spawnSync } from "bun";
import { dlopen, ptr } from "bun:ffi";
import { beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import {
  bunEnv,
  bunExe,
  canBuildNodeAddons,
  isGlibc,
  isLinux,
  isMacOS,
  isMusl,
  isWindows,
  nodeExeMatchingAbi,
  tempDirWithFiles,
} from "harness";
import { deflateRawSync } from "node:zlib";
import { join } from "path";

// These tests share one node-gyp build of their addons (the compile
// dominates the wall time). They cover:
// - duplicate loads: the second dlopen of the same module used to fail with
//   "symbol 'napi_register_module_v1' not found" because static constructors
//   only run once, so the module registration wasn't replayed
// - non-object exports: null/undefined/primitive exports used to segfault
// - non-context-aware addons (NODE_MODULE, the NAN pattern): loading one from a
//   second thread must not run the init function again, because that would
//   point the addon's static V8 handles into the second thread's heap
// - nested calls: a dlopen made while the filename is converted to a string, or
//   from an init function, must not steal the outer call's registration
// - static constructor order: the init function must run after dlopen() returns,
//   once the static constructors after the module registration have run
// - the entry of an addon: a registration, the symbol napi_register_module_v1, or
//   the symbol node_register_module_v<ABI> where Bun can check the addon's imports
// - zlib: with glibc, an addon with that last entry that imports zlib from the host
//   as it does from Node gets Bun's zlib, where nothing else defines zlib

// The zlib that the system has beside Bun's: the file that the loader finds for libz.so.1, which some addons of these
// tests link, and its raw deflate of a text. Undefined where there is none, and off glibc.
const systemZlib = isGlibc ? openSystemZlib() : undefined;

function openSystemZlib() {
  try {
    const { symbols } = dlopen("libz.so.1", {
      compress2: { args: ["ptr", "ptr", "ptr", "u64", "i32"], returns: "i32" },
      compressBound: { args: ["u64"], returns: "u64" },
    });
    const path = readFileSync("/proc/self/maps", "utf8").match(/ (\/.*\/libz\.so\.1[^/\n]*)$/m)?.[1];
    if (!path) return undefined;
    return {
      path,
      deflateRaw(text: string, level: number) {
        const input = Buffer.from(text);
        const output = Buffer.alloc(Number(symbols.compressBound(input.length)));
        const length = new BigUint64Array([BigInt(output.length)]);
        expect(symbols.compress2(ptr(output), ptr(length), ptr(input), input.length, level)).toBe(0);
        // compress2() writes the 2 bytes of the zlib header before the raw deflate and the 4 of the checksum after it.
        return output.subarray(2, Number(length[0]) - 4).toString("hex");
      },
    };
  } catch {
    return undefined;
  }
}

describe.skipIf(!canBuildNodeAddons())("process.dlopen native addon", () => {
  let addonPath: string;
  let nonContextAwarePath: string;
  let workerFixturePath: string;
  // A copy of the same addon at a second path, which the loader treats as a different library.
  let addonCopyPath: string;

  beforeAll(() => {
    const addonSource = `
#include <node.h>
#include <node_api.h>

namespace demo {

using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

// Set by late_static's constructor, which is defined after the module registration.
static bool late_static_constructed = false;

void Hello(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  args.GetReturnValue().Set(String::NewFromUtf8(isolate, "world").ToLocalChecked());
}

static Local<Value> GetOption(Isolate* isolate, Local<Context> context, Local<Value> module, const char* name) {
  return module.As<Object>()->Get(context, String::NewFromUtf8(isolate, name).ToLocalChecked()).ToLocalChecked();
}

// The tests control the init function through properties on the module object:
// duringInit (a function to call), fatalInInit and throwInInit (true).
void Initialize(Local<Object> exports,
                Local<Value> module,
                Local<Context> context,
                void* priv) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<Value> duringInit = GetOption(isolate, context, module, "duringInit");
  if (duringInit->IsFunction() && duringInit.As<Function>()->Call(context, module, 0, nullptr).IsEmpty()) {
    return;
  }
  if (GetOption(isolate, context, module, "fatalInInit")->IsTrue()) {
    napi_fatal_error("Initialize", NAPI_AUTO_LENGTH, "fatal error in init", NAPI_AUTO_LENGTH);
  }
  if (GetOption(isolate, context, module, "throwInInit")->IsTrue()) {
    isolate->ThrowException(Exception::Error(String::NewFromUtf8(isolate, "thrown by init").ToLocalChecked()));
    return;
  }
  NODE_SET_METHOD(exports, "hello", Hello);
  exports->Set(context,
               String::NewFromUtf8(isolate, "lateStaticConstructed").ToLocalChecked(),
               Boolean::New(isolate, late_static_constructed)).Check();
}

}  // namespace demo

NODE_MODULE_CONTEXT_AWARE(addon, demo::Initialize)

namespace demo {

// The registration above runs in a static constructor. This constructor runs after it, like re2's addonDataMap.
struct LateStatic {
  LateStatic() { late_static_constructed = true; }
};
static LateStatic late_static;

}  // namespace demo
`;

    // Mimics what NAN generates: NODE_MODULE (no context-aware register function) and
    // a static Persistent that the init function sets for the isolate it ran in.
    const nonContextAwareSource = `
#include <node.h>

namespace demo {

using v8::Context;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::Isolate;
using v8::Local;
using v8::Number;
using v8::Object;
using v8::Persistent;
using v8::String;
using v8::Value;

Persistent<FunctionTemplate> constructor;
int init_count = 0;

void Hello(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  args.GetReturnValue().Set(String::NewFromUtf8(isolate, "world").ToLocalChecked());
}

void InitCount(const FunctionCallbackInfo<Value>& args) {
  args.GetReturnValue().Set(Number::New(args.GetIsolate(), init_count));
}

// Reads the static that the init function set, like a NAN class's NewInstance.
void MakeInstance(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<FunctionTemplate> tpl = Local<FunctionTemplate>::New(isolate, constructor);
  Local<Function> fn = tpl->GetFunction(context).ToLocalChecked();
  args.GetReturnValue().Set(fn->NewInstance(context).ToLocalChecked());
}

void Initialize(Local<Object> exports, Local<Value> module, void* priv) {
  Isolate* isolate = Isolate::GetCurrent();
  init_count++;
  constructor.Reset(isolate, FunctionTemplate::New(isolate, Hello));
  NODE_SET_METHOD(exports, "hello", Hello);
  NODE_SET_METHOD(exports, "initCount", InitCount);
  NODE_SET_METHOD(exports, "makeInstance", MakeInstance);
}

}  // namespace demo

NODE_MODULE(non_context_aware, demo::Initialize)
`;

    // These link the system's zlib by the path of its file: the system may have no libz.so for -lz.
    const systemZlibTargets = !systemZlib
      ? ""
      : `
        {
          "target_name": "initializer_system_zlib_import",
          "sources": [ "initializer_zlib_import.cpp" ],
          "libraries": [ ${JSON.stringify(systemZlib.path)} ]
        },
        {
          "target_name": "zlib_sqlite_extension",
          "sources": [ "zlib_sqlite_extension.c" ],
          "libraries": [ ${JSON.stringify(systemZlib.path)} ]
        },
        {
          "target_name": "zlib_parent",
          "type": "shared_library",
          "sources": [ "zlib_parent.c" ],
          "dependencies": [ "initializer_zlib_import", "initializer_address_taken_zlib_import" ],
          "ldflags": [ "-Wl,--no-as-needed", "-Wl,-rpath=\\\\$$ORIGIN/" ],
          "libraries": [
            "<(PRODUCT_DIR)/initializer_zlib_import.node",
            "<(PRODUCT_DIR)/initializer_address_taken_zlib_import.node",
            ${JSON.stringify(systemZlib.path)}
          ]
        },`;

    const bindingGyp = `
{
  "targets": [
    {
      "target_name": "addon",
      "sources": [ "addon.cpp" ]
    },
    {
      "target_name": "non_context_aware",
      "sources": [ "non_context_aware.cpp" ]
    },
    {
      "target_name": "initializer_only",
      "sources": [ "initializer_only.cpp" ]
    },
    {
      "target_name": "both_entries",
      "sources": [ "both_entries.cpp" ]
    },
    {
      "target_name": "no_registration",
      "sources": [ "no_registration.cpp" ]
    }
  ],
  "conditions": [
    # Loaded only on Linux, where Bun checks the imports. An import that nothing defines does not link on Windows,
    # and it opens only with lazy binding, which is not the default of every compiler.
    ["OS=='linux'", {
      "targets": [
        {
          "target_name": "initializer_missing_import",
          "sources": [ "initializer_missing_import.cpp" ],
          "defines": [ "MISSING_FUNCTION=bun_test_symbol_that_nothing_defines" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "initializer_zlib_import",
          "sources": [ "initializer_zlib_import.cpp" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "initializer_got_import",
          "sources": [ "initializer_missing_import.cpp" ],
          "defines": [ "MISSING_FUNCTION=bun_test_symbol_that_nothing_defines" ],
          "cflags": [ "-fno-plt" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "initializer_bind_now",
          "sources": [ "initializer_bind_now.cpp" ],
          "ldflags": [ "-Wl,-z,now" ]
        },
        {
          "target_name": "initializer_bind_now_missing_import",
          "sources": [ "initializer_missing_import.cpp" ],
          "defines": [ "MISSING_FUNCTION=bun_test_symbol_that_nothing_defines" ],
          "ldflags": [ "-Wl,-z,now" ]
        },
        {
          "target_name": "initializer_compat_import",
          "sources": [ "initializer_compat_import.cpp" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "versioned",
          "type": "shared_library",
          "sources": [ "versioned.c" ],
          "ldflags": [ "-Wl,--version-script=<(module_root_dir)/versioned.map" ]
        },
        {
          "target_name": "versioned_without_versions",
          "type": "shared_library",
          "sources": [ "versioned.c" ]
        },
        {
          "target_name": "versioned_other_function",
          "type": "shared_library",
          "sources": [ "versioned.c" ],
          "ldflags": [ "-Wl,--version-script=<(module_root_dir)/versioned_other_function.map" ]
        },
        {
          "target_name": "versioned_later_version",
          "type": "shared_library",
          "sources": [ "versioned.c" ],
          "ldflags": [ "-Wl,--version-script=<(module_root_dir)/versioned_later_version.map" ]
        },
        {
          "target_name": "versioned_second",
          "type": "shared_library",
          "sources": [ "versioned_second.c" ]
        },
        {
          "target_name": "versioned_second_with_function",
          "type": "shared_library",
          "sources": [ "versioned_second.c" ],
          "defines": [ "WITH_VERSIONED_FUNCTION" ]
        },
        {
          "target_name": "initializer_versioned_import",
          "sources": [ "initializer_versioned_import.cpp" ],
          "dependencies": [ "versioned", "versioned_second" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "old_version_dependency",
          "type": "shared_library",
          "sources": [ "old_version_dependency.c" ],
          "ldflags": [ "-Wl,--version-script=<(module_root_dir)/old_version_dependency.map" ]
        },
        {
          "target_name": "initializer_old_version_dependency_import",
          "sources": [ "initializer_old_version_dependency_import.cpp" ],
          "dependencies": [ "old_version_dependency" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "initializer_large_image",
          "sources": [ "initializer_large_image.cpp" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "initializer_large_image_bind_now",
          "sources": [ "initializer_large_image.cpp" ],
          "ldflags": [ "-Wl,-z,now" ]
        },
        {
          "target_name": "initializer_zlib_unbound_import",
          "sources": [ "initializer_zlib_import.cpp" ],
          "defines": [ "UNBOUND_ZLIB_FUNCTION=inflateCopy" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "partial_zlib",
          "type": "shared_library",
          "sources": [ "partial_zlib.c" ]
        },
        {
          "target_name": "initializer_partial_zlib_import",
          "sources": [ "initializer_zlib_import.cpp" ],
          "dependencies": [ "partial_zlib" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "initializer_read_only_zlib_import",
          "sources": [ "initializer_zlib_import.cpp" ],
          "ldflags": [ "-Wl,-z,now", "-Wl,-z,relro" ]
        },
        {
          "target_name": "initializer_weak_zlib_import",
          "sources": [ "initializer_zlib_import.cpp" ],
          "defines": [ "WEAK_ZLIB_IMPORTS" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "initializer_address_taken_zlib_import",
          "sources": [ "initializer_zlib_import.cpp" ],
          "defines": [ "ADDRESS_TAKEN_ZLIB_IMPORT" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "initializer_weak_address_taken_zlib_import",
          "sources": [ "initializer_zlib_import.cpp" ],
          "defines": [ "WEAK_ZLIB_IMPORTS", "ADDRESS_TAKEN_ZLIB_IMPORT" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "initializer_guarded_weak_zlib_import",
          "sources": [ "initializer_zlib_import.cpp" ],
          "defines": [ "GUARDED_WEAK_ZLIB_IMPORT" ],
          "ldflags": [ "-Wl,-z,lazy", "-Wl,-z,relro" ]
        },
        {
          "target_name": "initializer_guarded_weak_zlib_import_no_relro",
          "sources": [ "initializer_zlib_import.cpp" ],
          "defines": [ "GUARDED_WEAK_ZLIB_IMPORT" ],
          "ldflags": [ "-Wl,-z,lazy", "-Wl,-z,norelro" ]
        },
        {
          "target_name": "initializer_all_weak_zlib_import",
          "sources": [ "initializer_zlib_import.cpp" ],
          "defines": [ "ALL_WEAK_ZLIB_IMPORTS" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },${systemZlibTargets}
        {
          "target_name": "initializer_weak_import",
          "sources": [ "initializer_weak_import.cpp" ]
        },
        {
          "target_name": "dependency",
          "type": "shared_library",
          "sources": [ "dependency.c" ]
        },
        {
          "target_name": "initializer_dependency_import",
          "sources": [ "initializer_dependency_import.cpp" ],
          "dependencies": [ "dependency" ]
        },
        {
          "target_name": "initializer_stub_import",
          "sources": [ "initializer_stub_import.cpp" ]
        },
        {
          "target_name": "registered_missing_import",
          "sources": [ "registered_missing_import.cpp" ],
          "ldflags": [ "-Wl,-z,lazy" ]
        },
        {
          "target_name": "registered_initializer",
          "sources": [ "registered_initializer.cpp" ]
        }
      ]
    }]
  ]
}
`;

    // Loads the addon at $ADDON_PATH on the main thread and in a Worker and
    // prints one JSON report.
    //
    // Main thread first (default): main loads, the Worker loads, the Worker
    // exits, main uses the exports it already has.
    //
    // Worker first ($WORKER_LOADS_FIRST): the Worker loads and then blocks on a
    // message from main, main loads while the Worker is alive, the Worker
    // exits, main loads again.
    const workerFixture = `
const { Worker, isMainThread, parentPort } = require("node:worker_threads");

function describeExports(exports) {
  const report = { hello: exports.hello() };
  if (exports.initCount) report.initCount = exports.initCount();
  if (exports.makeInstance) report.instance = typeof exports.makeInstance();
  return report;
}

function load() {
  const m = { exports: {} };
  try {
    process.dlopen(m, process.env.ADDON_PATH);
  } catch (e) {
    return { report: { loaded: false, code: e.code, message: e.message } };
  }
  return { report: { loaded: true, ...describeExports(m.exports) }, exports: m.exports };
}

if (!isMainThread) {
  parentPort.postMessage(load().report);
  parentPort.on("message", () => process.exit(0));
} else {
  const workerLoadsFirst = !!process.env.WORKER_LOADS_FIRST;
  const result = {};
  const main = workerLoadsFirst ? undefined : load();
  if (main) result.main = main.report;

  const worker = new Worker(__filename);
  worker.on("message", report => {
    result.worker = report;
    if (workerLoadsFirst) result.mainWhileWorkerAlive = load().report;
    worker.postMessage("exit");
  });
  worker.on("error", e => {
    result.workerError = e.message;
  });
  worker.on("exit", exitCode => {
    result.workerExitCode = exitCode;
    if (workerLoadsFirst) {
      result.mainAfterWorkerExit = load().report;
    } else if (main.exports) {
      // makeInstance reads the static that the init function set. It must still
      // point into this thread's heap after the worker has exited.
      Bun.gc(true);
      result.mainExportsAfterWorkerExit = describeExports(main.exports);
    }
    console.log(JSON.stringify(result));
  });
}
`;

    const dir = tempDirWithFiles("dlopen-duplicate-test", {
      "addon.cpp": addonSource,
      "non_context_aware.cpp": nonContextAwareSource,
      ...entryFixtureSources(),
      "worker-fixture.js": workerFixture,
      "binding.gyp": bindingGyp,
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        gypfile: true,
        scripts: {
          // Run node-gyp under the bun being tested: the system Node on Windows
          // is built with clang-cl and its process.config leaks thin-LTO flags
          // into addon builds (link.exe fails on /opt:lldltojobs), and the
          // system Node's ABI may not match ours at all (e.g. older macOS CI
          // machines). gyp -D defines can't override target_defaults, so use
          // bun's clean process.config instead.
          install: `${JSON.stringify(bunExe())} --bun node-gyp rebuild`,
        },
        devDependencies: {
          "node-gyp": "^11.2.0",
        },
      }),
    });

    // Build the addons
    const build = spawnSync({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    if (!build.success) {
      throw new Error("Failed to build native addons");
    }

    addonPath = join(dir, "build", "Release", "addon.node");
    nonContextAwarePath = join(dir, "build", "Release", "non_context_aware.node");
    workerFixturePath = join(dir, "worker-fixture.js");
    addonCopyPath = join(dir, "build", "Release", "addon-copy.node");
    copyFileSync(addonPath, addonCopyPath);
  }, 180_000);

  // Each test spawns an isolated child (dlopen state is process-global), so
  // they are safe to run in parallel once the addon has been built.
  describe.concurrent("process.dlopen duplicate loads", () => {
    test("should load the same module twice successfully", async () => {
      const testScript = `
      // First load
      const m1 = { exports: {} };
      process.dlopen(m1, "${addonPath.replace(/\\/g, "\\\\")}");
      console.log("First load: hello exists?", typeof m1.exports.hello === "function");

      // Second load - this should work now
      const m2 = { exports: {} };
      process.dlopen(m2, "${addonPath.replace(/\\/g, "\\\\")}");
      console.log("Second load: hello exists?", typeof m2.exports.hello === "function");

      // Verify both work
      console.log("First module result:", m1.exports.hello());
      console.log("Second module result:", m2.exports.hello());
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", testScript],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout).toContain("First load: hello exists? true");
      expect(stdout).toContain("Second load: hello exists? true");
      expect(stdout).toContain("First module result: world");
      expect(stdout).toContain("Second module result: world");
      expect(exitCode).toBe(0);
    });

    test("should load module with different exports objects", async () => {
      const testScript = `
      // First load with empty object
      const m1 = { exports: {} };
      process.dlopen(m1, "${addonPath.replace(/\\/g, "\\\\")}");
      console.log("m1.exports.hello:", m1.exports.hello());

      // Second load with different exports object
      const m2 = { exports: { initial: true } };
      process.dlopen(m2, "${addonPath.replace(/\\/g, "\\\\")}");
      console.log("m2.exports.initial:", m2.exports.initial);
      console.log("m2.exports.hello:", m2.exports.hello());
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", testScript],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout).toContain("m1.exports.hello: world");
      expect(stdout).toContain("m2.exports.initial: true");
      expect(stdout).toContain("m2.exports.hello: world");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("process.dlopen init function", () => {
    test("runs after all of the addon's static constructors", async () => {
      const testScript = `
      const m = { exports: {} };
      process.dlopen(m, ${JSON.stringify(addonPath)});
      console.log(JSON.stringify({ hello: m.exports.hello(), lateStaticConstructed: m.exports.lateStaticConstructed }));
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", testScript],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ hello: "world", lateStaticConstructed: true });
      expect(exitCode).toBe(0);
    });

    // A debug build's exception check validator aborts if the throw isn't checked on the way out.
    test("its exception propagates to the caller", async () => {
      const testScript = `
      try {
        process.dlopen({ exports: {}, throwInInit: true }, ${JSON.stringify(addonPath)});
        console.log("no exception");
      } catch (e) {
        console.log("caught: " + e.message);
      }
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", testScript],
        env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout).toBe("caught: thrown by init\n");
      expect(exitCode).toBe(0);
    });

    // The crash handler only records which addon is loading on POSIX.
    describe.skipIf(isWindows)("the crash report shows the addon whose init function crashed", () => {
      test.each([
        ["in a plain load", "addon", `process.dlopen({ exports: {}, fatalInInit: true }, addon);`],
        [
          "in the outer load, after a nested load",
          "addon",
          `process.dlopen({ exports: {}, fatalInInit: true, duringInit() { process.dlopen({ exports: {} }, addonCopy); } }, addon);`,
        ],
        [
          "in a nested load",
          "addonCopy",
          `process.dlopen({ exports: {}, duringInit() { process.dlopen({ exports: {}, fatalInInit: true }, addonCopy); } }, addon);`,
        ],
      ])(
        "%s",
        async (_, crashed, load) => {
          const testScript = `
          const addon = ${JSON.stringify(addonPath)};
          const addonCopy = ${JSON.stringify(addonCopyPath)};
          ${load}
          console.log("loaded");
        `;

          await using proc = Bun.spawn({
            cmd: [bunExe(), "-e", testScript],
            env: { ...bunEnv, BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT: "1" },
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect(stderr).toContain("NAPI FATAL ERROR: Initialize fatal error in init");
          expect(stderr).toContain(
            `Crashed while loading native module: ${crashed === "addon" ? addonPath : addonCopyPath}\n`,
          );
          expect(stdout).not.toContain("loaded");
          // The longer timeout is for debug builds, which symbolize the whole stack before exiting.
        },
        10_000,
      );
    });
  });

  describe.concurrent("process.dlopen nested in the init function", () => {
    test.each([
      ["another addon", "addonCopy"],
      ["the same addon", "addon"],
    ])("both modules get their exports when the init function loads %s", async (_, nested) => {
      const testScript = `
      const addon = ${JSON.stringify(addonPath)};
      const addonCopy = ${JSON.stringify(addonCopyPath)};
      const inner = { exports: {} };
      const outer = { exports: {}, duringInit() { process.dlopen(inner, ${nested}); } };
      process.dlopen(outer, addon);
      console.log(JSON.stringify({ outer: typeof outer.exports.hello, inner: typeof inner.exports.hello }));
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", testScript],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ outer: "function", inner: "function" });
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("process.dlopen nested in the filename's toString()", () => {
    test.each([
      ["fails", { outer: "function", inner: "undefined" }],
      ["succeeds", { outer: "function", inner: "function" }],
    ])("the outer module gets the exports when the nested dlopen %s", async (nested, expected) => {
      const testScript = `
      const addonPath = ${JSON.stringify(addonPath)};
      const inner = { exports: {} };
      const outer = { exports: {} };
      process.dlopen(outer, {
        toString() {
          try {
            process.dlopen(inner, ${nested === "fails" ? `addonPath + ".missing"` : "addonPath"});
          } catch {}
          return addonPath;
        },
      });
      console.log(JSON.stringify({ outer: typeof outer.exports.hello, inner: typeof inner.exports.hello }));
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", testScript],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(expected);
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("process.dlopen with non-object exports", () => {
    test("should throw error when exports is null", async () => {
      const testScript = `
      const m = { exports: null };
      try {
        process.dlopen(m, "${addonPath.replace(/\\/g, "\\\\")}");
        console.log("FAIL: Should have thrown");
      } catch (e) {
        console.log("SUCCESS:", e.message);
      }
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", testScript],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout).toContain("SUCCESS:");
      expect(stdout).toContain("null is not an object");
      expect(exitCode).toBe(0);
    });

    test("should throw error when exports is undefined", async () => {
      const testScript = `
      const m = { exports: undefined };
      try {
        process.dlopen(m, "${addonPath.replace(/\\/g, "\\\\")}");
        console.log("FAIL: Should have thrown");
      } catch (e) {
        console.log("SUCCESS:", e.message);
      }
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", testScript],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout).toContain("SUCCESS:");
      expect(stdout).toContain("undefined is not an object");
      expect(exitCode).toBe(0);
    });

    test("should handle primitive exports gracefully", async () => {
      // Primitives get converted to wrapper objects
      const testScript = `
      const m = { exports: "primitive" };
      process.dlopen(m, "${addonPath.replace(/\\/g, "\\\\")}");
      console.log("Type:", typeof m.exports);
      console.log("Value:", m.exports);
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", testScript],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Should not crash - primitives get converted to wrapper objects
      expect(stderr).toBe("");
      expect(stdout).toContain("Type: string");
      expect(stdout).toContain("Value: primitive");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("process.dlopen of an addon that is already loaded", () => {
    async function runJsonFixture(cmd: string[], env: Record<string, string>) {
      await using proc = Bun.spawn({
        cmd,
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ exe: cmd[0], stderr, exitCode }).toEqual({ exe: cmd[0], stderr: "", exitCode: 0 });
      return JSON.parse(stdout);
    }

    const selfRegisterError = {
      loaded: false,
      code: "ERR_DLOPEN_FAILED",
      message: expect.stringContaining("Module did not self-register"),
    };

    test("a non-context-aware addon loaded by the main thread fails to load in a Worker", async () => {
      expect(await runJsonFixture([bunExe(), workerFixturePath], { ADDON_PATH: nonContextAwarePath })).toEqual({
        main: { loaded: true, hello: "world", initCount: 1, instance: "object" },
        worker: selfRegisterError,
        workerExitCode: 0,
        mainExportsAfterWorkerExit: { hello: "world", initCount: 1, instance: "object" },
      });
    });

    test("a non-context-aware addon loaded by a Worker fails on the main thread until the Worker exits", async () => {
      const env = { ADDON_PATH: nonContextAwarePath, WORKER_LOADS_FIRST: "1" };
      expect(await runJsonFixture([bunExe(), workerFixturePath], env)).toEqual({
        worker: { loaded: true, hello: "world", initCount: 1, instance: "object" },
        mainWhileWorkerAlive: selfRegisterError,
        workerExitCode: 0,
        mainAfterWorkerExit: { loaded: true, hello: "world", initCount: 2, instance: "object" },
      });
    });

    // `bun --hot` relies on this.
    test("a non-context-aware addon loads again on the thread that first loaded it", async () => {
      const script = `
        const load = () => {
          const m = { exports: {} };
          process.dlopen(m, process.env.ADDON_PATH);
          return { hello: m.exports.hello(), initCount: m.exports.initCount(), instance: typeof m.exports.makeInstance() };
        };
        const first = load();
        const second = load();
        console.log(JSON.stringify({ first, second }));
      `;
      expect(await runJsonFixture([bunExe(), "-e", script], { ADDON_PATH: nonContextAwarePath })).toEqual({
        first: { hello: "world", initCount: 1, instance: "object" },
        second: { hello: "world", initCount: 2, instance: "object" },
      });
    });
  });

  // https://github.com/oven-sh/bun/issues/9785
  describe.concurrent("process.dlopen and the symbol node_register_module_v<ABI>", () => {
    // Bun calls this symbol only where it can check the addon's imports before. macOS's loader binds every lazy import inside dlopen() and stores 0 or an abort function for a missing one, and Bun has no Mach-O reader for those slots. On Windows Bun already checks the load-time node.exe imports of every addon, and this entry is not ported there.
    const callsTheSymbol = !isMacOS && !isWindows;
    const built = (addon: string) => join(addonPath, "..", addon);

    async function run(args: string[], addon: string, env: Record<string, string> = {}, exe = bunExe()) {
      await using proc = Bun.spawn({
        cmd: [exe, ...args],
        env: { ...bunEnv, ADDON_PATH: built(addon), ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    }

    // Prints the exports of the addon, or the error of process.dlopen() once the script has caught it.
    const load = (addon: string, env?: Record<string, string>) =>
      run(
        [
          "-e",
          `
            try {
              const loaded = { exports: {} };
              process.dlopen(loaded, process.env.ADDON_PATH);
              console.log(JSON.stringify({ exports: loaded.exports }));
            } catch (e) {
              console.log(JSON.stringify({ code: e.code, message: e.message }));
            }
          `,
        ],
        addon,
        env,
      );
    const loaded = (exports: object) => ({ stdout: JSON.stringify({ exports }), stderr: "", exitCode: 0 });
    const refused = (message: string) => ({
      stdout: JSON.stringify({ code: "ERR_DLOPEN_FAILED", message }),
      stderr: "",
      exitCode: 0,
    });
    // Writes a copy of an addon in which the string table has no size. The loader does not read the size, and Bun reads
    // no name outside it.
    const writeWithoutStringTableSize = (addon: string, copy: string) => {
      const image = readFileSync(built(addon));
      const view = new DataView(image.buffer, image.byteOffset, image.length);
      const stringTableSizes = elfDynamicEntries(view).filter(entry => entry.tag === DT_STRSZ);
      expect(stringTableSizes).toHaveLength(1);
      view.setBigUint64(stringTableSizes[0].offset + 8, 0n, true);
      writeFileSync(built(copy), image);
    };
    // The error of a dlopen() that failed: the loader's own text, which names the symbol that it did not find. The
    // symbol is a part of a regular expression.
    const refusedByLoader = (symbol: string) => ({
      ...refused(""),
      stdout: expect.stringMatching(
        new RegExp(`^\\{"code":"ERR_DLOPEN_FAILED","message":"(?!Cannot load native addon ).*\\b${symbol}\\b.*"\\}$`),
      ),
    });

    test.skipIf(!callsTheSymbol)(
      "an addon with only this entry loads with require() and process.dlopen(), and each load calls it",
      async () => {
        const script = `
          const describeExports = exports => ({ hello: exports.hello(), initCount: exports.initCount() });
          const required = describeExports(require(process.env.ADDON_PATH));
          const loaded = { exports: {} };
          process.dlopen(loaded, process.env.ADDON_PATH);
          console.log(JSON.stringify({ required, loaded: describeExports(loaded.exports) }));
        `;
        expect(await run(["-e", script], "initializer_only.node")).toEqual({
          stdout: JSON.stringify({
            required: { hello: "world", initCount: 1 },
            loaded: { hello: "world", initCount: 2 },
          }),
          stderr: "",
          exitCode: 0,
        });
      },
    );

    test.skipIf(!callsTheSymbol)("an addon with only this entry loads in a Worker, which calls it again", async () => {
      expect(await run([workerFixturePath], "initializer_only.node")).toEqual({
        stdout: JSON.stringify({
          main: { loaded: true, hello: "world", initCount: 1 },
          worker: { loaded: true, hello: "world", initCount: 2 },
          workerExitCode: 0,
          mainExportsAfterWorkerExit: { hello: "world", initCount: 2 },
        }),
        stderr: "",
        exitCode: 0,
      });
    });

    // The V8 API has one isolate for a thread: that of its default realm. An initializer that ran for another realm
    // created its handles outside every open handle scope, and the process ended in abort().
    test.skipIf(!callsTheSymbol)(
      "an addon with only this entry did not self-register in a ShadowRealm, which the V8 API does not serve",
      async () => {
        const addon = built("initializer_only.node");
        const inRealm = built("loads-in-a-shadow-realm.mjs");
        writeFileSync(
          inRealm,
          `import { createRequire } from "node:module";
          export const load = () => {
            try {
              createRequire(import.meta.url)(${JSON.stringify(addon)});
              return "loaded";
            } catch (e) {
              return JSON.stringify({ code: e.code, message: e.message });
            }
          };`,
        );
        const script = `
          const load = await new ShadowRealm().importValue(${JSON.stringify(inRealm)}, "load");
          console.log(load());
        `;
        expect(await run(["-e", script], "initializer_only.node")).toEqual(
          refused(`Module did not self-register: '${addon}'.`),
        );
      },
    );

    test.skipIf(callsTheSymbol)(
      "an addon with only this entry did not self-register on macOS and Windows",
      async () => {
        expect(await load("initializer_only.node")).toEqual(
          refused(`Module did not self-register: '${built("initializer_only.node")}'.`),
        );
      },
    );

    // Who refuses an addon whose import nothing defines depends on how the addon was linked, which the test reads from
    // the file. With BIND_NOW the loader binds every import in dlopen(), and glibc binds there every import through the
    // global offset table (GLOB_DAT): dlopen() fails, with the loader's text. Every loader leaves a jump slot unbound,
    // and musl a GLOB_DAT too: those Bun finds before it calls the initializer.
    test.skipIf(!isLinux).each([
      ["initializer_missing_import.node", "bun_test_symbol_that_nothing_defines"],
      // Compiled with -fno-plt: the call goes through the global offset table.
      ["initializer_got_import.node", "bun_test_symbol_that_nothing_defines"],
      // Linked with -z now.
      ["initializer_bind_now_missing_import.node", "bun_test_symbol_that_nothing_defines"],
      // An addon that imports zlib, which Node's executable exports, has its tests at the end.
    ])("%s is refused, because nothing defines its import %s", async (addon, symbol) => {
      const { bindNow, relocations } = elfImports(built(addon));
      const relocation = relocations.get(symbol);
      const leftToBun = !bindNow && (relocation === "JUMP_SLOT" || (relocation === "GLOB_DAT" && isMusl));
      expect(await load(addon)).toEqual(
        leftToBun
          ? refused(
              `Cannot load native addon ${built(addon)}: it imports '${symbol}', and Bun found no definition of it`,
            )
          : refusedByLoader(symbol),
      );
    });

    // Built against a glibc before 2.34, an addon imports pthread_yield with the version of that time. A newer glibc has
    // the function only with that version: the loader binds the import, and a lookup of the name alone finds nothing.
    test.skipIf(!isLinux || isMusl)(
      "an addon with only this entry loads with an import that glibc defines only with an old version",
      async () => {
        const script = `
          const loaded = { exports: {} };
          process.dlopen(loaded, process.env.ADDON_PATH);
          console.log(JSON.stringify({ yield: loaded.exports.yield() }));
        `;
        expect(await run(["-e", script], "initializer_compat_import.node")).toEqual({
          stdout: JSON.stringify({ yield: 0 }),
          stderr: "",
          exitCode: 0,
        });
      },
    );

    // The library that the addon links keeps the function only with a version that is not its default, as glibc keeps
    // pthread_yield, and it is not in the global scope. Only the lookup by that version in the addon's own libraries
    // finds the function.
    test.skipIf(!isLinux || isMusl)(
      "an addon with only this entry loads with an import that the library that it links defines only with an old version",
      async () => {
        const script = `
          const loaded = { exports: {} };
          process.dlopen(loaded, process.env.ADDON_PATH);
          console.log(JSON.stringify({ call: loaded.exports.call() }));
        `;
        expect(await run(["-e", script], "initializer_old_version_dependency_import.node")).toEqual({
          stdout: JSON.stringify({ call: 7 }),
          stderr: "",
          exitCode: 0,
        });
      },
    );

    // initializer_versioned_import.node imports bun_test_versioned_function with the version BUN_TEST_V1 of versioned.so,
    // through a jump slot. Each test runs a copy of the addon in a directory of its own, beside the libraries that the
    // test names there as the addon needs them: the loader looks beside the addon first.
    const versionedImport = (directory: string, libraries: Record<string, string>) => {
      mkdirSync(built(directory), { recursive: true });
      copyFileSync(built("initializer_versioned_import.node"), built(join(directory, "addon.node")));
      for (const [name, library] of Object.entries(libraries))
        copyFileSync(built(library), built(join(directory, name)));
      const script = `
        const loaded = { exports: {} };
        process.dlopen(loaded, process.env.ADDON_PATH);
        console.log("loaded");
        console.log(JSON.stringify({ call: loaded.exports.call() }));
      `;
      const runIn = (exe: string) => run(["-e", script], join(directory, "addon.node"), {}, exe);
      return { addon: built(join(directory, "addon.node")), runIn };
    };

    // Bun asks whether something defines the import by its name first, and by its version only after a no. The loader
    // binds an import that names a version also to a function that has no version, which a lookup by the version
    // does not find. So each of these addons loads only because the name is asked first.
    test.skipIf(!isLinux || isMusl).each([
      ["has no versions", "without-versions", "versioned_without_versions.so", "versioned_second.so", 7],
      [
        "has that version for another function only",
        "other-function",
        "versioned_other_function.so",
        "versioned_second.so",
        7,
      ],
      [
        "has the function with a later version only, and a second library has it without a version",
        "second-library",
        "versioned_later_version.so",
        "versioned_second_with_function.so",
        9,
      ],
    ])(
      "an addon with only this entry loads with an import by a version when its library %s, like in Node",
      async (_, directory, versioned, second, result) => {
        const { runIn } = versionedImport(directory, { "versioned.so": versioned, "versioned_second.so": second });
        const called = { stdout: `loaded\n${JSON.stringify({ call: result })}`, stderr: "", exitCode: 0 };
        const [bun, node] = await Promise.all([runIn(bunExe()), runIn(await nodeExeMatchingAbi())]);
        expect(node).toEqual(called);
        expect(bun).toEqual(called);
      },
    );

    // The import that this order accepts although nothing defines it: a lookup by the name cannot tell a function
    // without a version, which the loader binds, from one whose only version is another one, which it does not bind.
    // Node calls the initializer of this addon too, and the loader ends either process at the first call.
    test.skipIf(!isLinux || isMusl)(
      "an addon with only this entry loads with an import by a version when its library has the function with a later version only, and the first call ends the process, like in Node",
      async () => {
        const libraries = {
          "versioned.so": "versioned_later_version.so",
          "versioned_second.so": "versioned_second.so",
        };
        const { addon, runIn } = versionedImport("later-version", libraries);
        const ended = {
          stdout: "loaded",
          stderr: expect.stringContaining(
            `symbol lookup error: ${addon}: undefined symbol: bun_test_versioned_function, version BUN_TEST_V1`,
          ),
          exitCode: 127,
        };
        const [bun, node] = await Promise.all([runIn(bunExe()), runIn(await nodeExeMatchingAbi())]);
        expect(node).toEqual(ended);
        expect(bun).toEqual(ended);
      },
    );

    // The loader has bound every import of this addon when dlopen() returns. Bun finds the address of a definition in
    // each import's slot and asks nothing about it. It reads no name for such an import, so the copy whose names Bun
    // could not read loads too.
    test.skipIf(!isLinux)("an addon with only this entry loads when it is linked with -z now", async () => {
      expect(elfImports(built("initializer_bind_now.node")).bindNow).toBe(true);
      expect(await load("initializer_bind_now.node")).toEqual(loaded({ loaded: "initializer_bind_now" }));
      writeWithoutStringTableSize("initializer_bind_now.node", "initializer_bind_now_unreadable.node");
      expect(await load("initializer_bind_now_unreadable.node")).toEqual(loaded({ loaded: "initializer_bind_now" }));
    });

    // With musl a slot that the loader has bound can hold an address in Bun's own image, which is not position
    // independent. Where the addon spans more memory than that address is large, Bun cannot tell the slot from one
    // that musl has left as the file has it, and only the lookup of the import's name says that the import is
    // defined. So the zeroes of this addon must span more memory than Bun's image does: about 126 MB with musl today.
    test.skipIf(!isLinux).each([
      ["-z lazy", "initializer_large_image.node"],
      ["-z now", "initializer_large_image_bind_now.node"],
    ])(
      "an addon with only this entry that spans more memory than Bun loads when it is linked with %s",
      async (_, addon) => {
        const image = readFileSync(built(addon));
        const segments = elfProgramHeaders(new DataView(image.buffer, image.byteOffset, image.length));
        const memory = Math.max(...segments.filter(({ type }) => type === PT_LOAD).map(s => s.address + s.memorySize));
        // The zeroes are not in the file: the loader maps them after the addon's data.
        expect({ file: image.length < 1 << 20, memory: memory > 160 << 20 }).toEqual({ file: true, memory: true });
        expect(await load(addon)).toEqual(loaded({ loaded: "initializer_large_image" }));
      },
    );

    // A glibc that profiles calls binds every object at the first call, also one that is linked with -z now. So
    // dlopen() passes for the addon that it refuses in the test above, and its import is left for Bun to find.
    test.skipIf(!isGlibc)(
      "an addon that is linked with -z now is refused when the loader has left its import unbound all the same",
      async () => {
        const addon = "initializer_bind_now_missing_import.node";
        expect(elfImports(built(addon)).bindNow).toBe(true);
        // LD_PROFILE names the object to profile. No object has this name, so nothing is written to the directory.
        const profiling = { LD_PROFILE: "bun_test_object_that_nothing_loads", LD_PROFILE_OUTPUT: built("") };
        expect(await load(addon, profiling)).toEqual(
          refused(
            `Cannot load native addon ${built(addon)}: it imports 'bun_test_symbol_that_nothing_defines', and Bun found no definition of it`,
          ),
        );
      },
    );

    test.skipIf(!isLinux).each([
      ["a weak import that nothing defines", "initializer_weak_import.node", { loaded: "initializer_weak_import" }],
      [
        "an import that only the library that it links defines",
        "initializer_dependency_import.node",
        { dependency: "defined by the dependency library" },
      ],
      [
        "an import that Bun defines as a function that ends the process",
        "initializer_stub_import.node",
        { loaded: "initializer_stub_import" },
      ],
    ])("an addon with only this entry loads with %s", async (_, addon, exports) => {
      expect(await load(addon)).toEqual(loaded(exports));
    });

    // Every loader leaves the import of this addon unbound, because nothing defines it, and Bun must read the name of
    // the import to ask about it. The copy has no name that Bun can read. An addon without such an import has nothing
    // that Bun must read with musl, which binds each import that has a definition already in dlopen().
    test.skipIf(!isLinux)(
      "an addon with only this entry is refused when Bun cannot read the name of an import that the loader left unbound",
      async () => {
        const symbol = "bun_test_symbol_that_nothing_defines";
        const { bindNow, relocations } = elfImports(built("initializer_missing_import.node"));
        const relocation = relocations.get(symbol);
        const leftToBun = !bindNow && (relocation === "JUMP_SLOT" || (relocation === "GLOB_DAT" && isMusl));
        writeWithoutStringTableSize("initializer_missing_import.node", "initializer_unreadable.node");
        const unreadable = built("initializer_unreadable.node");
        expect(await load("initializer_unreadable.node")).toEqual(
          leftToBun
            ? refused(`Cannot load native addon ${unreadable}: Bun cannot read its import tables`)
            : refusedByLoader(symbol),
        );
      },
    );

    // @datadog/pprof is such an addon: it has an import that nothing defines, and never calls it.
    test.skipIf(!isLinux)(
      "an addon that also registers itself loads through its registration, and its imports are not checked",
      async () => {
        expect(await load("registered_missing_import.node")).toEqual(loaded({ loaded: "registered_missing_import" }));
      },
    );

    // The static constructor of an addon runs once, when its library is mapped: here in the dlopen() of bun:ffi, which
    // saves no registration. process.dlopen() then finds a library that is mapped and has registered nothing, and
    // calls the symbol, as Node does.
    test.skipIf(!isLinux)(
      "an addon that also registers itself loads through the symbol when its library is already mapped",
      async () => {
        const script = `
          const symbol = "node_register_module_v" + process.versions.modules;
          require("bun:ffi").dlopen(process.env.ADDON_PATH, { [symbol]: { args: [], returns: "void" } });
          const loaded = { exports: {} };
          process.dlopen(loaded, process.env.ADDON_PATH);
          console.log(JSON.stringify({ exports: loaded.exports }));
        `;
        expect(await run(["-e", script], "registered_initializer.node")).toEqual(
          loaded({ loaded: "registered_initializer" }),
        );
      },
    );

    // Node calls node_register_module_v<ABI> for this addon.
    test("an addon that also exports napi_register_module_v1 loads through Node-API", async () => {
      expect(await load("both_entries.node")).toEqual(loaded({ via: "napi_register_module_v1" }));
    });

    test("an addon without an entry did not self-register", async () => {
      expect(await load("no_registration.node")).toEqual(
        refused(`Module did not self-register: '${built("no_registration.node")}'.`),
      );
    });

    // Node's executable exports its zlib to addons, and uWebSockets.js imports 13 functions of it. Bun does not export
    // its zlib. With glibc, Bun stores the addresses of its own 13 functions in an addon's imports of them before the
    // initializer runs: in all of these imports or in none. It stores them only when the loader has bound none of these
    // imports, Bun can store to the slot of each, and nothing that Bun can ask defines one of the 13 names. Otherwise
    // Bun stores nothing, and the imports of zlib are checked like all the others.
    describe("an addon with only this entry that imports zlib", () => {
      const text = Array.from(
        { length: 120 },
        (_, i) => `${(i * 7919) % 1000} bottles of ${["beer", "milk", "tea"][i % 3]} on the wall`,
      ).join("\n");
      // The raw deflate at levels 1 and 6, which differs from one implementation of zlib to another.
      const deflatedByBun = [1, 6].map(level => deflateRawSync(text, { level }).toString("hex"));
      // The addon's roundTrip() returns the same two after it has used all 13 functions and inflated what it deflated.
      const roundTrip = `
        const roundTrip = addon => {
          const loaded = { exports: {} };
          process.dlopen(loaded, addon);
          return loaded.exports.roundTrip(${JSON.stringify(text)});
        };
      `;
      // Loads the addon while bun:ffi holds its library too, so that the library stays mapped when process.dlopen()
      // refuses it. The library's bound_zlib_slots() counts its imports of zlib whose slot holds a function of another
      // object. Nothing has called a function of zlib yet: before the load these are the imports that the loader bound
      // in dlopen(), and after it also those that Bun has filled. `uses` says whether the script then calls the addon.
      const loadAndCount = (uses = true) => `
        const held = require("bun:ffi").dlopen(process.env.ADDON_PATH, { bound_zlib_slots: { args: [], returns: "i32" } });
        const report = { before: held.symbols.bound_zlib_slots() };
        const loaded = { exports: {} };
        try {
          process.dlopen(loaded, process.env.ADDON_PATH);
        } catch (e) {
          report.refused = e.message;
        }
        report.after = held.symbols.bound_zlib_slots();
        if (${uses} && !report.refused) report.deflated = loaded.exports.roundTrip(${JSON.stringify(text)});
        console.log(JSON.stringify(report));
      `;
      const printed = (value: unknown) => ({ stdout: JSON.stringify(value), stderr: "", exitCode: 0 });
      // The same two from the system's zlib, where the system has one.
      const deflatedBySystem = () => [1, 6].map(level => systemZlib!.deflateRaw(text, level));
      // db.loadExtension() opens the extension and the libraries that it needs with RTLD_GLOBAL: every later lookup in
      // the global scope of the process finds what they define.
      const withInGlobalScope = (extension: string, script: string, addon: string) =>
        run(
          [
            "-e",
            `
              const database = new (require("bun:sqlite").Database)(":memory:");
              database.loadExtension(process.env.EXTENSION);
              ${script}
              database.close();
            `,
          ],
          addon,
          { EXTENSION: built(extension) },
        );
      const withSystemZlibInGlobalScope = (script: string, addon: string) =>
        withInGlobalScope("zlib_sqlite_extension.node", script, addon);
      // bun:ffi opens zlib_parent.so as the loader opens any library: its scope is not the global one. That library
      // needs the addon and the system's zlib, so the loader binds the addon's imports in a scope that has a zlib, and
      // neither a lookup in the global scope nor one in the addon's own libraries finds a function of it.
      const withParentOpen = (script: string, addon: string) =>
        run(
          [
            "-e",
            `
              require("bun:ffi").dlopen(process.env.PARENT, { zlib_parent_marker: { args: [], returns: "i32" } });
              ${script}
            `,
          ],
          addon,
          { PARENT: built("zlib_parent.so") },
        );
      const isZlib = (symbol: string) => /^(?:de|in)flate/.test(symbol);
      const noDefinition = (addon: string, symbol: string) =>
        `Cannot load native addon ${built(addon)}: it imports '${symbol}', and Bun found no definition of it`;
      // The import that the check finds first where nothing defines zlib and Bun stores nothing: the first call of a
      // function of zlib in the addon's table, as the linker ordered it. A weak import may stay unresolved.
      const firstCall = (addon: string) => {
        const { relocations, weak } = elfImports(built(addon));
        const calls = [...relocations].filter(([symbol, type]) => isZlib(symbol) && type === "JUMP_SLOT");
        return calls.map(([symbol]) => symbol).find(symbol => !weak.includes(symbol))!;
      };

      test.skipIf(!isGlibc)("gets Bun's zlib where nothing defines zlib", async () => {
        const script = `${roundTrip} console.log(JSON.stringify(roundTrip(process.env.ADDON_PATH)));`;
        expect(await run(["-e", script], "initializer_zlib_import.node")).toEqual(printed(deflatedByBun));
      });

      // The second load finds Bun's functions in the slots, and has nothing to store.
      test.skipIf(!isGlibc)("keeps Bun's zlib when it is loaded a second time", async () => {
        const script = `
          const held = require("bun:ffi").dlopen(process.env.ADDON_PATH, { bound_zlib_slots: { args: [], returns: "i32" } });
          const report = { slots: [held.symbols.bound_zlib_slots()], deflated: [] };
          for (let load = 0; load < 2; load++) {
            const loaded = { exports: {} };
            process.dlopen(loaded, process.env.ADDON_PATH);
            report.slots.push(held.symbols.bound_zlib_slots());
            report.deflated.push(loaded.exports.roundTrip(${JSON.stringify(text)}));
          }
          console.log(JSON.stringify(report));
        `;
        expect(await run(["-e", script], "initializer_zlib_import.node")).toEqual(
          printed({ slots: [0, 13, 13], deflated: [deflatedByBun, deflatedByBun] }),
        );
      });

      // With musl nothing is stored, because musl binds a pending import again at a later dlopen(). Bun refuses the
      // addon on the first of its zlib imports, unless the addon is linked with BIND_NOW and dlopen() has failed.
      test.skipIf(!isMusl)("is refused with musl, because nothing defines its imports", async () => {
        const addon = "initializer_zlib_import.node";
        const { bindNow, relocations } = elfImports(built(addon));
        const first = [...relocations.keys()].find(isZlib)!;
        expect(await load(addon)).toEqual(
          bindNow ? refusedByLoader("(?:de|in)flate\\w*") : refused(noDefinition(addon, first)),
        );
      });

      // The tests with the system's zlib are skipped where the system has none of its own (libz.so.1).
      // Bun's zlib is the last resort: where another zlib is in the addon's scope, the loader binds the addon's imports
      // to that one, and Bun stores nothing. The address that one of these addons takes is bound already in dlopen().
      test.skipIf(!systemZlib).each([
        ["with the 13 imports of uWebSockets.js", "initializer_zlib_import.node", 0],
        [
          "with an import of a function of zlib that Bun does not have for addons",
          "initializer_zlib_unbound_import.node",
          0,
        ],
        ["that takes the address of a function of zlib", "initializer_address_taken_zlib_import.node", 1],
        ["with weak imports", "initializer_weak_zlib_import.node", 0],
      ])(
        "%s uses the system's zlib when that is in the global scope, and Bun stores nothing",
        async (_, addon, bound) => {
          expect(await withSystemZlibInGlobalScope(loadAndCount(), addon)).toEqual(
            printed({ before: bound, after: bound, deflated: deflatedBySystem() }),
          );
        },
      );

      // The loader has bound the address that the addon takes to the system's function, in the scope of the library
      // that needs both. That slot shows Bun that the addon has a zlib, although no lookup finds one. A stream of Bun's
      // zlib would go through the system's function, so Bun stores nothing, and the check finds no definition of the
      // first call.
      test.skipIf(!systemZlib)(
        "is refused when the loader has bound one of its imports to a zlib that no lookup finds, and Bun stores nothing",
        async () => {
          const addon = "initializer_address_taken_zlib_import.node";
          expect(await withParentOpen(loadAndCount(), addon)).toEqual(
            printed({ before: 1, refused: noDefinition(addon, firstCall(addon)), after: 1 }),
          );
        },
      );

      // Every import of this addon is a call, so the loader has bound none of them yet, and nothing shows Bun the zlib
      // of the scope in which it would bind them.
      test.skipIf(!systemZlib)(
        "gets Bun's zlib when the only zlib of its scope is one that no lookup finds and the loader has bound none of its imports",
        async () => {
          expect(await withParentOpen(loadAndCount(), "initializer_zlib_import.node")).toEqual(
            printed({ before: 0, after: 13, deflated: deflatedByBun }),
          );
        },
      );

      // Linked with -z now and -z relro, the addon opens only when the global scope has a zlib. dlopen() binds every
      // import to that one and then makes the slots read-only: Bun finds them bound, and stores nothing.
      test.skipIf(!systemZlib)("keeps the zlib that the loader bound when it is linked with -z now", async () => {
        const addon = "initializer_read_only_zlib_import.node";
        expect(elfImports(built(addon)).bindNow).toBe(true);
        const script = `${roundTrip} console.log(JSON.stringify(roundTrip(process.env.ADDON_PATH)));`;
        expect(await withSystemZlibInGlobalScope(script, addon)).toEqual(printed(deflatedBySystem()));
      });

      test.skipIf(!isLinux)(
        "fails in dlopen() when it is linked with -z now and no zlib is in the global scope",
        async () => {
          expect(await load("initializer_read_only_zlib_import.node")).toEqual(refusedByLoader("(?:de|in)flate\\w*"));
        },
      );

      // The loader binds an import that is no call in dlopen(), where Bun has stored nothing yet.
      test.skipIf(!isGlibc)(
        "fails in dlopen() when it takes the address of a function of zlib and nothing defines zlib",
        async () => {
          const addon = "initializer_address_taken_zlib_import.node";
          const { relocations } = elfImports(built(addon));
          expect({ deflate: relocations.get("deflate"), deflateEnd: relocations.get("deflateEnd") }).toEqual({
            deflate: "ABS64",
            deflateEnd: "JUMP_SLOT",
          });
          expect(await load(addon)).toEqual(refusedByLoader("deflate"));
        },
      );

      test.skipIf(!systemZlib)("keeps the zlib that it links, and Bun stores nothing", async () => {
        expect(await run(["-e", loadAndCount()], "initializer_system_zlib_import.node")).toEqual(
          printed({ before: 0, after: 0, deflated: deflatedBySystem() }),
        );
      });

      // A weak import that nothing defines would stay at address 0, and the first call through it would end the process.
      test.skipIf(!isGlibc)("gets Bun's zlib for its weak imports too", async () => {
        const addon = "initializer_weak_zlib_import.node";
        const { relocations, weak } = elfImports(built(addon));
        expect(weak.filter(isZlib).sort()).toEqual(["deflate", "inflate"]);
        expect([...relocations].filter(([symbol]) => isZlib(symbol)).map(([, type]) => type)).toEqual(
          Array(13).fill("JUMP_SLOT"),
        );
        expect(await run(["-e", loadAndCount()], addon)).toEqual(
          printed({ before: 0, after: 13, deflated: deflatedByBun }),
        );
      });

      // The address of the weak import is in a word of the addon's data, where the loader has stored 0 in dlopen().
      test.skipIf(!isGlibc)("gets Bun's zlib for a weak import whose address it keeps in its data", async () => {
        const addon = "initializer_weak_address_taken_zlib_import.node";
        const { relocations, weak } = elfImports(built(addon));
        expect({ deflate: relocations.get("deflate"), weak: weak.filter(isZlib).sort() }).toEqual({
          deflate: "ABS64",
          weak: ["deflate", "inflate"],
        });
        expect(await run(["-e", loadAndCount()], addon)).toEqual(
          printed({ before: 0, after: 13, deflated: deflatedByBun }),
        );
      });

      // The addon tests the address of deflate before it calls it, as code does that can work without the function. The
      // address is in the global offset table, where the loader has stored 0 in dlopen(). With -z relro the loader
      // has made that table read-only by now, so Bun cannot store deflate there. It stores nothing then: the addon would
      // see a zlib without deflate. With -z norelro Bun can store to the table.
      test.skipIf(!isGlibc).each([
        ["is refused when Bun cannot store to", "initializer_guarded_weak_zlib_import.node", false],
        ["gets Bun's zlib when Bun can store to", "initializer_guarded_weak_zlib_import_no_relro.node", true],
      ])("%s the slot of a weak import whose address it tests", async (_, addon, storable) => {
        const { relocations, weak } = elfImports(built(addon));
        expect({ deflate: relocations.get("deflate"), weak: weak.filter(isZlib) }).toEqual({
          deflate: "GLOB_DAT",
          weak: ["deflate"],
        });
        expect(await run(["-e", loadAndCount()], addon)).toEqual(
          printed(
            storable
              ? { before: 0, after: 13, deflated: deflatedByBun }
              : { before: 0, refused: noDefinition(addon, firstCall(addon)), after: 0 },
          ),
        );
      });

      // A provider of zlib that lacks a function that the addon imports: the loader would bind the other imports to
      // it, so Bun stores nothing, and the import that it lacks is one that nothing defines.
      test.skipIf(!isGlibc).each([
        ["the library that it links", "initializer_partial_zlib_import.node", false],
        ["a library in the global scope", "initializer_zlib_import.node", true],
      ])("is refused when %s has only a part of zlib, and Bun stores nothing", async (_, addon, inGlobalScope) => {
        const result = inGlobalScope
          ? withInGlobalScope("partial_zlib.so", loadAndCount(), addon)
          : run(["-e", loadAndCount()], addon);
        expect(await result).toEqual(
          printed({ before: 0, refused: noDefinition(addon, "inflateSetDictionary"), after: 0 }),
        );
      });

      // Every import of zlib is weak in this addon, and a weak import may stay unresolved. So beside a library with a
      // part of zlib the check passes, as it does without Bun's zlib, and Bun stores nothing: the script does not call
      // the addon then. Alone, the addon gets Bun's zlib.
      test.skipIf(!isGlibc)(
        "loads when all its imports of zlib are weak and a library in the global scope has only a part of zlib, and Bun stores nothing",
        async () => {
          const addon = "initializer_all_weak_zlib_import.node";
          expect(elfImports(built(addon)).weak.filter(isZlib)).toHaveLength(13);
          const [besideAPart, alone] = await Promise.all([
            withInGlobalScope("partial_zlib.so", loadAndCount(false), addon),
            run(["-e", loadAndCount()], addon),
          ]);
          expect(alone).toEqual(printed({ before: 0, after: 13, deflated: deflatedByBun }));
          expect(besideAPart).toEqual(printed({ before: 0, after: 0 }));
        },
      );

      // A function of zlib outside the 13 is an import like any other: with nothing that defines zlib, nothing defines it.
      test.skipIf(!isGlibc)(
        "is refused when it imports a function of zlib that Bun does not have for addons, and a later addon loads",
        async () => {
          const script = `
            ${roundTrip}
            const report = {};
            try {
              roundTrip(process.env.UNBOUND);
            } catch (e) {
              report.refused = { code: e.code, message: e.message };
            }
            report.later = roundTrip(process.env.ADDON_PATH);
            console.log(JSON.stringify(report));
          `;
          const unbound = "initializer_zlib_unbound_import.node";
          expect(await run(["-e", script], "initializer_zlib_import.node", { UNBOUND: built(unbound) })).toEqual(
            printed({
              refused: { code: "ERR_DLOPEN_FAILED", message: noDefinition(unbound, "inflateCopy") },
              later: deflatedByBun,
            }),
          );
        },
      );

      // Bun stores only after the check of all the imports has passed. The second addon is the control: there the count
      // sees the 13 stores.
      test.skipIf(!isGlibc)("has none of its imports filled when Bun refuses it", async () => {
        const refusedAddon = "initializer_zlib_unbound_import.node";
        const [refusedLoad, control] = await Promise.all([
          run(["-e", loadAndCount()], refusedAddon),
          run(["-e", loadAndCount()], "initializer_zlib_import.node"),
        ]);
        expect(control).toEqual(printed({ before: 0, after: 13, deflated: deflatedByBun }));
        expect(refusedLoad).toEqual(
          printed({ before: 0, refused: noDefinition(refusedAddon, "inflateCopy"), after: 0 }),
        );
      });

      // The first loads of one library store the same addresses in the same slots at the same time. A pass shows that
      // no result was wrong, not that there is no race. It runs alone: its 8 threads slow the tests beside it, and a
      // debug build writes the crash reports above close to their timeout.
      test.serial.skipIf(!isGlibc)(
        "gets Bun's zlib in 8 Workers that load it at the same time",
        async () => {
          const fixture = join(workerFixturePath, "..", "zlib-workers-fixture.js");
          expect(await run([fixture], "initializer_zlib_import.node", { TEXT: text })).toEqual(
            printed({ workers: 8, roundTrips: 8 * 200, results: [deflatedByBun] }),
          );
          // The longer timeout is for debug builds, where 8 Workers take seconds to start and ASAN maps each zlib stream.
        },
        30_000,
      );
    });
  });
});

const [PT_LOAD, PT_DYNAMIC] = [1, 2];
const [DT_PLTRELSZ, DT_STRTAB, DT_SYMTAB, DT_RELA, DT_RELASZ, DT_STRSZ, DT_JMPREL] = [2, 5, 6, 7, 8, 10, 23];
const [DT_BIND_NOW, DT_FLAGS, DT_FLAGS_1, DF_BIND_NOW, DF_1_NOW] = [24, 30, 0x6ffffffb, 8, 1];
const STB_WEAK = 2;

// The program headers of a 64-bit ELF file.
function elfProgramHeaders(view: DataView) {
  return Array.from({ length: view.getUint16(0x38, true) }, (_, i) => {
    const header = Number(view.getBigUint64(0x20, true)) + i * view.getUint16(0x36, true);
    return {
      type: view.getUint32(header, true),
      offset: Number(view.getBigUint64(header + 8, true)),
      address: Number(view.getBigUint64(header + 16, true)),
      size: Number(view.getBigUint64(header + 32, true)),
      memorySize: Number(view.getBigUint64(header + 40, true)),
    };
  });
}

// The entries of its dynamic section: where each is in the file, its tag and its value.
function elfDynamicEntries(view: DataView) {
  return elfProgramHeaders(view)
    .filter(header => header.type === PT_DYNAMIC)
    .flatMap(({ offset, size }) =>
      Array.from({ length: size / 16 }, (_, i) => ({
        offset: offset + i * 16,
        tag: Number(view.getBigInt64(offset + i * 16, true)),
        value: Number(view.getBigUint64(offset + i * 16 + 8, true)),
      })),
    );
}

// How the loader binds the imports of an addon: all of them in dlopen() (BIND_NOW) or not, and for each symbol that a
// GLOB_DAT or a JUMP_SLOT relocation or one of a word of data (ABS64) names, which of the three, and whether the
// symbol is weak.
function elfImports(path: string) {
  const image = readFileSync(path);
  const view = new DataView(image.buffer, image.byteOffset, image.length);
  const headers = elfProgramHeaders(view).filter(header => header.type === PT_LOAD);
  const dynamic = new Map(elfDynamicEntries(view).map(entry => [entry.tag, entry.value]));
  // A table of the dynamic section, as its offset in the file.
  const table = (tag: number) => {
    const address = dynamic.get(tag)!;
    const header = headers.find(header => address >= header.address && address < header.address + header.size)!;
    return address - header.address + header.offset;
  };
  const [symbols, strings] = [table(DT_SYMTAB), table(DT_STRTAB)];
  // The numbers of the three relocation types on arm64 (machine 183) and on x64.
  const types = view.getUint16(0x12, true) === 183 ? [1025, 1026, 257] : [6, 7, 1];
  const names = ["GLOB_DAT", "JUMP_SLOT", "ABS64"] as const;
  const relocations = new Map<string, (typeof names)[number]>();
  const weak: string[] = [];
  for (const [tag, size] of [
    [DT_JMPREL, DT_PLTRELSZ],
    [DT_RELA, DT_RELASZ],
  ]) {
    if (!dynamic.has(tag)) continue;
    for (let entry = table(tag); entry < table(tag) + dynamic.get(size)!; entry += 24) {
      const info = view.getBigUint64(entry + 8, true);
      const type = types.indexOf(Number(info & 0xffffffffn));
      if (type < 0) continue;
      const symbol = symbols + Number(info >> 32n) * 24;
      const name = strings + view.getUint32(symbol, true);
      relocations.set(image.toString("latin1", name, image.indexOf(0, name)), names[type]);
      if (view.getUint8(symbol + 4) >> 4 === STB_WEAK)
        weak.push(image.toString("latin1", name, image.indexOf(0, name)));
    }
  }
  const bindNow =
    dynamic.has(DT_BIND_NOW) ||
    ((dynamic.get(DT_FLAGS) ?? 0) & DF_BIND_NOW) !== 0 ||
    ((dynamic.get(DT_FLAGS_1) ?? 0) & DF_1_NOW) !== 0;
  return { bindNow, relocations, weak };
}

// The addons of "process.dlopen and the symbol node_register_module_v<ABI>".
function entryFixtureSources() {
  const initializer = `extern "C" NODE_MODULE_EXPORT void NODE_MODULE_INITIALIZER(v8::Local<v8::Object> exports,
                                                           v8::Local<v8::Value> module,
                                                           v8::Local<v8::Context> context)`;
  return {
    "exports.h": `
#include <node.h>

// exports[name] = value
static inline void SetExport(v8::Local<v8::Object> exports, v8::Local<v8::Context> context, const char* name, const char* value) {
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  exports->Set(context,
               v8::String::NewFromUtf8(isolate, name).ToLocalChecked(),
               v8::String::NewFromUtf8(isolate, value).ToLocalChecked()).Check();
}
`,

    // As in uWebSockets.js, the only entry is the symbol.
    "initializer_only.cpp": `
#include <node.h>

static int init_count = 0;

static void Hello(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(v8::String::NewFromUtf8(args.GetIsolate(), "world").ToLocalChecked());
}

static void InitCount(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(v8::Number::New(args.GetIsolate(), init_count));
}

${initializer} {
  init_count++;
  NODE_SET_METHOD(exports, "hello", Hello);
  NODE_SET_METHOD(exports, "initCount", InitCount);
}
`,

    // As uWebSockets.js, this takes zlib from the host: the targets that link a zlib say so in binding.gyp.
    "initializer_zlib_import.cpp": `
#include <node.h>
#include <zlib.h>

#include <dlfcn.h>
#include <link.h>

#include <cstring>
#include <string>

static const Bytef dictionary[] = "a preset dictionary";

#ifdef UNBOUND_ZLIB_FUNCTION
// Bun does not have this function of zlib for addons. It is in the PLT and is never called.
extern "C" NODE_MODULE_EXPORT void never_called() { UNBOUND_ZLIB_FUNCTION(nullptr, nullptr); }
#endif

#ifdef ALL_WEAK_ZLIB_IMPORTS
#pragma weak deflate
#pragma weak deflateBound
#pragma weak deflateEnd
#pragma weak deflateInit2_
#pragma weak deflateInit_
#pragma weak deflateReset
#pragma weak deflateSetDictionary
#pragma weak inflate
#pragma weak inflateEnd
#pragma weak inflateInit2_
#pragma weak inflateInit_
#pragma weak inflateReset
#pragma weak inflateSetDictionary
#endif

#ifdef WEAK_ZLIB_IMPORTS
#pragma weak deflate
#pragma weak inflate
#endif

#ifdef ADDRESS_TAKEN_ZLIB_IMPORT
// A pointer in initialized data: the loader binds this import in dlopen(), and the calls below at their first time.
static int (*volatile deflate_by_address)(z_streamp, int) = deflate;
#define deflate deflate_by_address
#endif

#ifdef GUARDED_WEAK_ZLIB_IMPORT
#pragma weak deflate
// As code that can work without the function: it reads the address from the global offset table and tests it before
// the call. The loader binds such an import in dlopen() too, to 0 if nothing defines it.
static int guarded_deflate(z_streamp stream, int flush) {
  int (*volatile function)(z_streamp, int) = deflate;
  return function ? function(stream, flush) : Z_VERSION_ERROR;
}
#define deflate guarded_deflate
#endif

extern ElfW(Dyn) _DYNAMIC[] __attribute__((visibility("hidden")));

// The relocations that store the address of a function: in a slot of the PLT, in one of the global offset table, and
// in a word of data.
#if defined(__aarch64__)
static const unsigned address_relocations[] = { R_AARCH64_JUMP_SLOT, R_AARCH64_GLOB_DAT, R_AARCH64_ABS64 };
#else
static const unsigned address_relocations[] = { R_X86_64_JUMP_SLOT, R_X86_64_GLOB_DAT, R_X86_64_64 };
#endif

// The number of this library's imports of zlib whose slot holds a function of another object: the loader has stored
// it there, in dlopen() or at the first call, or Bun before the initializer. Until then the slot of a call points into
// the library itself, and that of a weak import of another kind holds 0.
extern "C" NODE_MODULE_EXPORT int bound_zlib_slots() {
  Dl_info self;
  if (!dladdr(_DYNAMIC, &self)) return -1;
  const char* base = static_cast<const char*>(self.dli_fbase);
  // glibc stores the address of a table in its dynamic entry, and musl leaves its offset from the base there.
  auto table = [&](const ElfW(Dyn)* entry) {
    const char* address = reinterpret_cast<const char*>(entry->d_un.d_ptr);
    return address < base ? base + entry->d_un.d_ptr : address;
  };
  // The table of the PLT, and the table of everything else.
  const ElfW(Rela)* relocations[2] = {};
  size_t sizes[2] = {};
  const ElfW(Sym)* symbols = nullptr;
  const char* strings = nullptr;
  for (const ElfW(Dyn)* entry = _DYNAMIC; entry->d_tag != DT_NULL; entry++) {
    if (entry->d_tag == DT_JMPREL) relocations[0] = reinterpret_cast<const ElfW(Rela)*>(table(entry));
    if (entry->d_tag == DT_PLTRELSZ) sizes[0] = entry->d_un.d_val;
    if (entry->d_tag == DT_RELA) relocations[1] = reinterpret_cast<const ElfW(Rela)*>(table(entry));
    if (entry->d_tag == DT_RELASZ) sizes[1] = entry->d_un.d_val;
    if (entry->d_tag == DT_SYMTAB) symbols = reinterpret_cast<const ElfW(Sym)*>(table(entry));
    if (entry->d_tag == DT_STRTAB) strings = table(entry);
  }
  int bound = 0;
  for (int i = 0; i < 2; i++) {
    for (const ElfW(Rela)* relocation = relocations[i]; relocation < relocations[i] + sizes[i] / sizeof(ElfW(Rela)); relocation++) {
      unsigned type = ELF64_R_TYPE(relocation->r_info);
      if (type != address_relocations[0] && type != address_relocations[1] && type != address_relocations[2]) continue;
      const ElfW(Sym)& symbol = symbols[ELF64_R_SYM(relocation->r_info)];
      const char* name = strings + symbol.st_name;
      if (symbol.st_shndx != SHN_UNDEF) continue;
      if (strncmp(name, "deflate", 7) != 0 && strncmp(name, "inflate", 7) != 0) continue;
      void* function = *reinterpret_cast<void* const*>(base + relocation->r_offset);
      Dl_info owner;
      if (function && (!dladdr(function, &owner) || owner.dli_fbase != self.dli_fbase)) bound++;
    }
  }
  return bound;
}

// Deflates the input, inflates the result, and says whether that gave the input back.
static bool DeflateAndInflate(z_stream& deflater, z_stream& inflater, std::string& input, std::string& deflated) {
  deflated.assign(deflateBound(&deflater, input.size()), '\\0');
  deflater.next_in = reinterpret_cast<Bytef*>(input.data());
  deflater.avail_in = input.size();
  deflater.next_out = reinterpret_cast<Bytef*>(deflated.data());
  deflater.avail_out = deflated.size();
  if (deflate(&deflater, Z_FINISH) != Z_STREAM_END) return false;
  deflated.resize(deflated.size() - deflater.avail_out);

  std::string inflated(input.size(), '\\0');
  inflater.next_in = reinterpret_cast<Bytef*>(deflated.data());
  inflater.avail_in = deflated.size();
  inflater.next_out = reinterpret_cast<Bytef*>(inflated.data());
  inflater.avail_out = inflated.size();
  return inflate(&inflater, Z_FINISH) == Z_STREAM_END && inflated == input;
}

// Calls the 13 functions of zlib that uWebSockets.js imports: a raw stream, that stream again after a reset and with a
// dictionary, and a stream in the zlib format. \`raw\` is the deflate of the first.
static bool RoundTrip(std::string& input, int level, std::string& raw) {
  z_stream deflater = {};
  z_stream inflater = {};
  std::string other;
  bool ok = deflateInit2(&deflater, level, Z_DEFLATED, -MAX_WBITS, 8, Z_DEFAULT_STRATEGY) == Z_OK &&
            inflateInit2(&inflater, -MAX_WBITS) == Z_OK &&
            DeflateAndInflate(deflater, inflater, input, raw) &&
            deflateReset(&deflater) == Z_OK &&
            inflateReset(&inflater) == Z_OK &&
            deflateSetDictionary(&deflater, dictionary, sizeof dictionary) == Z_OK &&
            inflateSetDictionary(&inflater, dictionary, sizeof dictionary) == Z_OK &&
            DeflateAndInflate(deflater, inflater, input, other) &&
            deflateEnd(&deflater) == Z_OK &&
            inflateEnd(&inflater) == Z_OK;
  deflater = {};
  inflater = {};
  return ok &&
         deflateInit(&deflater, level) == Z_OK &&
         inflateInit(&inflater) == Z_OK &&
         DeflateAndInflate(deflater, inflater, input, other) &&
         deflateEnd(&deflater) == Z_OK &&
         inflateEnd(&inflater) == Z_OK;
}

// roundTrip(text) returns the raw deflate of the text at levels 1 and 6, in hexadecimal.
static void RoundTripCallback(const v8::FunctionCallbackInfo<v8::Value>& args) {
  v8::Isolate* isolate = args.GetIsolate();
  v8::Local<v8::String> text = args[0].As<v8::String>();
  std::string input(text->Utf8LengthV2(isolate), '\\0');
  text->WriteUtf8V2(isolate, input.data(), input.size());

  v8::Local<v8::Value> deflated[2];
  for (int i = 0; i < 2; i++) {
    std::string raw, hex;
    if (!RoundTrip(input, i == 0 ? 1 : 6, raw)) {
      isolate->ThrowException(v8::Exception::Error(v8::String::NewFromUtf8(isolate, "zlib failed").ToLocalChecked()));
      return;
    }
    for (unsigned char byte : raw) {
      hex += "0123456789abcdef"[byte >> 4];
      hex += "0123456789abcdef"[byte & 15];
    }
    deflated[i] = v8::String::NewFromUtf8(isolate, hex.data(), v8::NewStringType::kNormal, hex.size()).ToLocalChecked();
  }
  args.GetReturnValue().Set(v8::Array::New(isolate, deflated, 2));
}

${initializer} {
  NODE_SET_METHOD(exports, "roundTrip", RoundTripCallback);
}
`,

    // A zlib that lacks inflateSetDictionary: the other 12 of the 13 functions that the addon imports. It is a SQLite
    // extension too, so that db.loadExtension() can put it in the global scope.
    "partial_zlib.c": `
#define DEFINE(name) int name(void) { return -1; }
DEFINE(deflate) DEFINE(deflateBound) DEFINE(deflateEnd) DEFINE(deflateInit2_) DEFINE(deflateInit_) DEFINE(deflateReset)
DEFINE(deflateSetDictionary) DEFINE(inflate) DEFINE(inflateEnd) DEFINE(inflateInit2_) DEFINE(inflateInit_) DEFINE(inflateReset)
int sqlite3_extension_init(void* database, char** error, const void* api) { return 0; }
`,

    // A library that needs two of the addons and the system's zlib. Who opens it brings a zlib into the scope in which
    // the loader binds the imports of these addons, and into no scope that a lookup from outside can search.
    "zlib_parent.c": `
int zlib_parent_marker(void) { return 1; }
`,

    // A SQLite extension that needs the system's zlib, as compress, sqlar and zipfile do.
    "zlib_sqlite_extension.c": `
extern const char* zlibVersion(void);
int sqlite3_extension_init(void* database, char** error, const void* api) { return zlibVersion() ? 0 : 1; }
`,

    // Eight Workers wait at a gate. Then each loads the addon at $ADDON_PATH, which nothing has loaded before, and runs
    // the round trip 200 times.
    "zlib-workers-fixture.js": `
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

if (isMainThread) {
  const gate = new Int32Array(new SharedArrayBuffer(4));
  const report = { workers: 0, roundTrips: 0, results: [] };
  let waiting = 0;
  for (let i = 0; i < 8; i++) {
    const worker = new Worker(__filename, { workerData: gate });
    worker.on("message", message => {
      if (message === "waiting") {
        if (++waiting === 8) {
          Atomics.store(gate, 0, 1);
          Atomics.notify(gate, 0);
        }
        return;
      }
      report.roundTrips += message.roundTrips;
      for (const result of message.results) {
        if (!report.results.includes(result)) report.results.push(result);
      }
      if (++report.workers < 8) return;
      console.log(JSON.stringify({ ...report, results: report.results.map(result => JSON.parse(result)) }));
    });
    worker.on("error", error => {
      console.log(JSON.stringify({ error: error.message }));
      process.exit(1);
    });
  }
} else {
  parentPort.postMessage("waiting");
  Atomics.wait(workerData, 0, 0);
  const loaded = { exports: {} };
  process.dlopen(loaded, process.env.ADDON_PATH);
  const results = new Set();
  for (let i = 0; i < 200; i++) results.add(JSON.stringify(loaded.exports.roundTrip(process.env.TEXT)));
  parentPort.postMessage({ roundTrips: 200, results: [...results] });
}
`,

    // The loader must refuse this addon: the call in its initializer would end the process.
    "initializer_missing_import.cpp": `
#include <node.h>

#include <cstdio>

extern "C" void MISSING_FUNCTION();

${initializer} {
  puts("the initializer ran");
  fflush(stdout);
  MISSING_FUNCTION();
}
`,

    // The loader binds every import of this addon in dlopen(): binding.gyp links it with -z now.
    "initializer_bind_now.cpp": `
#include "exports.h"

${initializer} {
  SetExport(exports, context, "loaded", "initializer_bind_now");
}
`,

    // As an addon that was built against glibc before 2.34: the import names the version of that time, and a newer
    // glibc keeps pthread_yield only with that version.
    "initializer_compat_import.cpp": `
#include <node.h>

#ifdef __GLIBC__
#if defined(__aarch64__)
__asm__(".symver bun_test_old_yield,pthread_yield@GLIBC_2.17");
#else
__asm__(".symver bun_test_old_yield,pthread_yield@GLIBC_2.2.5");
#endif
extern "C" int bun_test_old_yield(void);
#else
static int bun_test_old_yield(void) { return 0; }
#endif

static void Yield(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(v8::Number::New(args.GetIsolate(), bun_test_old_yield()));
}

${initializer} {
  NODE_SET_METHOD(exports, "yield", Yield);
}
`,

    // The function that initializer_versioned_import.node imports with the version BUN_TEST_V1. binding.gyp builds
    // several libraries of this file, and the version script of each says which version the function has in it:
    // BUN_TEST_V1, none, or BUN_TEST_V2. getpid() gives each library a table of versions, as a real library has.
    "versioned.c": `
#include <unistd.h>

int bun_test_versioned_function(void) { return getpid() > 0 ? 7 : 0; }
int bun_test_versioned_marker(void) { return 1; }
`,
    "versioned.map": `BUN_TEST_V1 { global: bun_test_versioned_function; bun_test_versioned_marker; };\n`,
    "versioned_other_function.map": `BUN_TEST_V1 { global: bun_test_versioned_marker; };\n`,
    "versioned_later_version.map": `
BUN_TEST_V1 { global: bun_test_versioned_marker; };
BUN_TEST_V2 { global: bun_test_versioned_function; } BUN_TEST_V1;
`,

    // A second library that the addon needs. One build of it has the function too, without a version.
    "versioned_second.c": `
#include <unistd.h>

int bun_test_second_marker(void) { return 2; }
#ifdef WITH_VERSIONED_FUNCTION
int bun_test_versioned_function(void) { return getpid() > 0 ? 9 : 0; }
#endif
`,
    "initializer_versioned_import.cpp": `
#include <node.h>

extern "C" int bun_test_versioned_function();
extern "C" int bun_test_second_marker();

static void Call(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(v8::Number::New(args.GetIsolate(), bun_test_versioned_function()));
}

${initializer} {
  if (bun_test_second_marker() == 2) NODE_SET_METHOD(exports, "call", Call);
}
`,

    // The library keeps the function only with a version that is not its default, and the addon names that version.
    "old_version_dependency.c": `
int bun_test_old_version_implementation(void) { return 7; }
__asm__(".symver bun_test_old_version_implementation,bun_test_old_version_function@BUN_TEST_OLD");
`,
    "old_version_dependency.map": `BUN_TEST_OLD { };\n`,
    "initializer_old_version_dependency_import.cpp": `
#include <node.h>

__asm__(".symver bun_test_old_version_reference,bun_test_old_version_function@BUN_TEST_OLD");
extern "C" int bun_test_old_version_reference();

static void Call(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(v8::Number::New(args.GetIsolate(), bun_test_old_version_reference()));
}

${initializer} {
  NODE_SET_METHOD(exports, "call", Call);
}
`,

    // About 160 MB of zeroes, which the file does not carry.
    "initializer_large_image.cpp": `
#include "exports.h"

extern "C" {
NODE_MODULE_EXPORT char bun_test_zeroes[160 << 20];
}

${initializer} {
  SetExport(exports, context, "loaded", "initializer_large_image");
}
`,

    // As the _ITM_* functions in uWebSockets.js: the import is in the PLT and is never called.
    "initializer_weak_import.cpp": `
#include "exports.h"

extern "C" void bun_test_weak_function_that_nothing_defines() __attribute__((weak));
extern "C" NODE_MODULE_EXPORT void never_called() { bun_test_weak_function_that_nothing_defines(); }

${initializer} {
  SetExport(exports, context, "loaded", "initializer_weak_import");
}
`,

    // The library is not in the global scope: only a lookup in the addon finds the function.
    "dependency.c": `
const char* bun_test_dependency_function(void) { return "defined by the dependency library"; }
`,
    "initializer_dependency_import.cpp": `
#include "exports.h"

extern "C" const char* bun_test_dependency_function();

${initializer} {
  SetExport(exports, context, "dependency", bun_test_dependency_function());
}
`,

    // Bun defines uv_loop_new only as a function that ends the process. It is in the PLT and is never called.
    "initializer_stub_import.cpp": `
#include "exports.h"

extern "C" void* uv_loop_new();
extern "C" NODE_MODULE_EXPORT void never_called() { uv_loop_new(); }

${initializer} {
  SetExport(exports, context, "loaded", "initializer_stub_import");
}
`,

    // NODE_MODULE_INIT() registers the module in a static constructor, and also exports the symbol.
    "registered_missing_import.cpp": `
#include "exports.h"

extern "C" void bun_test_symbol_that_nothing_defines();
extern "C" NODE_MODULE_EXPORT void never_called() { bun_test_symbol_that_nothing_defines(); }

NODE_MODULE_INIT() {
  SetExport(exports, context, "loaded", "registered_missing_import");
}
`,

    // The same without an import that nothing defines.
    "registered_initializer.cpp": `
#include "exports.h"

NODE_MODULE_INIT() {
  SetExport(exports, context, "loaded", "registered_initializer");
}
`,

    "both_entries.cpp": `
#include "exports.h"
#include <node_api.h>

${initializer} {
  SetExport(exports, context, "via", "node_register_module_v");
}

extern "C" NODE_MODULE_EXPORT napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value via;
  napi_create_string_utf8(env, "napi_register_module_v1", NAPI_AUTO_LENGTH, &via);
  napi_set_named_property(env, exports, "via", via);
  return exports;
}
`,

    "no_registration.cpp": `
// Registers no module and exports no entry point.
int no_registration;
`,
  };
}
