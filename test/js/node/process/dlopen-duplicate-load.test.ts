import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons, isDebug, isLinux, isWindows, tempDir, tempDirWithFiles } from "harness";
import { join } from "path";

// These tests share one node-gyp build of a few addons (the compile
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
// - better-sqlite3: a Node-API build loads under the file name that node-gyp
//   gives it, and a V8 C++ API build is refused by the name it registers under

describe.skipIf(!canBuildNodeAddons())("process.dlopen native addon", () => {
  let addonPath: string;
  let nonContextAwarePath: string;
  let workerFixturePath: string;
  let everyWayFixturePath: string;
  // A copy of the same addon at a second path, which the loader treats as a different library.
  let addonCopyPath: string;
  // Stand-ins for builds of better-sqlite3. node-gyp names the binary of every version better_sqlite3.node.
  let napiBetterSqlite3Path: string;
  let v8BetterSqlite3Path: string;
  let v8BetterSqlite3NamedPath: string;
  let v8BetterSqlite3OtherAbiPath: string;
  // Linux only: addons linked with -z now that call a function nothing defines.
  let missingV8FunctionPath: string;
  let missingV8FunctionNamedPath: string;
  let missingOtherFunctionPath: string;
  let missingOtherFunctionNamedPath: string;
  let missingBetterSqlite3Path: string;
  let missingInV8NamedDirectoryPath: string;
  let notALibraryBetterSqlite3Path: string;

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

    // What better-sqlite3 13 is: a Node-API addon.
    const napiBetterSqlite3Source = `
#include <node_api.h>

static napi_value Hello(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_string_utf8(env, "world", NAPI_AUTO_LENGTH, &result);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value hello;
  napi_create_function(env, "hello", NAPI_AUTO_LENGTH, Hello, NULL, &hello);
  napi_set_named_property(env, exports, "hello", hello);
  return exports;
}
`;

    // What better-sqlite3 12 and older are: a V8 addon that registers as better_sqlite3.
    // The real one calls V8 functions that Bun does not export. This one calls abort().
    const v8BetterSqlite3Source = `
#include <node.h>
#include <cstdlib>

#if defined(CALL_MISSING_V8_FUNCTION)
namespace v8 {
// Stands for a V8 function that Bun does not export. Nothing defines it.
void FunctionThatBunDoesNotExport();
}
#elif defined(CALL_MISSING_OTHER_FUNCTION)
// Not a member of v8:: or node::, but its mangled name has "N2v8" in it.
void FunctionThatNothingDefines(v8::Local<v8::Value>);
#endif

static void Initialize(v8::Local<v8::Object> exports,
                       v8::Local<v8::Value> module,
                       v8::Local<v8::Context> context,
                       void* priv) {
#if defined(CALL_MISSING_V8_FUNCTION)
  v8::FunctionThatBunDoesNotExport();
#elif defined(CALL_MISSING_OTHER_FUNCTION)
  FunctionThatNothingDefines(module);
#endif
  // Bun must refuse the module before it runs this.
  std::abort();
}

#ifdef OTHER_ABI
// What a better-sqlite3 binary for Node.js 22 registers.
extern "C" {
static node::node_module module_for_node_22 = {
    127,               // nm_version
    0,                 // nm_flags
    nullptr,           // nm_dso_handle
    __FILE__,          // nm_filename
    nullptr,           // nm_register_func
    Initialize,        // nm_context_register_func
    "better_sqlite3",  // nm_modname
    nullptr,           // nm_priv
    nullptr,           // nm_link
};

NODE_C_CTOR(register_module_for_node_22) { node_module_register(&module_for_node_22); }
}
#else
NODE_MODULE_CONTEXT_AWARE(better_sqlite3, Initialize)
#endif
`;

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
      "target_name": "better_sqlite3",
      "sources": [ "napi_better_sqlite3.c" ]
    },
    {
      "target_name": "better_sqlite3_v8",
      "sources": [ "better_sqlite3_v8.cpp" ]
    },
    {
      "target_name": "better_sqlite3_v8_other_abi",
      "sources": [ "better_sqlite3_v8.cpp" ],
      "defines": [ "OTHER_ABI" ]
    }
  ],
  "conditions": [
    ["OS=='linux'", {
      "targets": [
        {
          "target_name": "missing_v8_function",
          "sources": [ "better_sqlite3_v8.cpp" ],
          "defines": [ "CALL_MISSING_V8_FUNCTION" ],
          "ldflags": [ "-Wl,-z,now" ]
        },
        {
          "target_name": "missing_other_function",
          "sources": [ "better_sqlite3_v8.cpp" ],
          "defines": [ "CALL_MISSING_OTHER_FUNCTION" ],
          "ldflags": [ "-Wl,-z,now" ]
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

    // Loads the addon at $ADDON_PATH in every way and prints one JSON report: process.dlopen,
    // process.dlopen again, require(), and process.dlopen in a Worker.
    const everyWayFixture = `
const { Worker, isMainThread, parentPort } = require("node:worker_threads");

function attempt(load) {
  try {
    return { loaded: true, hello: load().hello() };
  } catch (e) {
    return { loaded: false, code: e.code, message: e.message };
  }
}

function dlopen() {
  const m = { exports: {} };
  process.dlopen(m, process.env.ADDON_PATH);
  return m.exports;
}

if (!isMainThread) {
  parentPort.postMessage(attempt(dlopen));
} else {
  const result = {
    dlopen: attempt(dlopen),
    dlopenAgain: attempt(dlopen),
    require: attempt(() => require(process.env.ADDON_PATH)),
  };
  const worker = new Worker(__filename);
  worker.on("message", report => {
    result.worker = report;
  });
  worker.on("error", e => {
    result.workerError = e.message;
  });
  worker.on("exit", () => console.log(JSON.stringify(result)));
}
`;

    const dir = tempDirWithFiles("dlopen-duplicate-test", {
      "addon.cpp": addonSource,
      "non_context_aware.cpp": nonContextAwareSource,
      "napi_better_sqlite3.c": napiBetterSqlite3Source,
      "better_sqlite3_v8.cpp": v8BetterSqlite3Source,
      "worker-fixture.js": workerFixture,
      "every-way-fixture.js": everyWayFixture,
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
    everyWayFixturePath = join(dir, "every-way-fixture.js");
    addonCopyPath = join(dir, "build", "Release", "addon-copy.node");
    copyFileSync(addonPath, addonCopyPath);

    // A copy of `from` in its own directory, with the file name of a better-sqlite3 build.
    const namedBetterSqlite3 = (from: string, directory: string) => {
      mkdirSync(join(dir, directory));
      const to = join(dir, directory, "better_sqlite3.node");
      copyFileSync(from, to);
      return to;
    };
    napiBetterSqlite3Path = join(dir, "build", "Release", "better_sqlite3.node");
    v8BetterSqlite3Path = join(dir, "build", "Release", "better_sqlite3_v8.node");
    v8BetterSqlite3NamedPath = namedBetterSqlite3(v8BetterSqlite3Path, "v8");
    v8BetterSqlite3OtherAbiPath = join(dir, "build", "Release", "better_sqlite3_v8_other_abi.node");
    if (isLinux) {
      missingV8FunctionPath = join(dir, "build", "Release", "missing_v8_function.node");
      missingV8FunctionNamedPath = namedBetterSqlite3(missingV8FunctionPath, "missing-v8-function");
      missingOtherFunctionPath = join(dir, "build", "Release", "missing_other_function.node");
      missingOtherFunctionNamedPath = namedBetterSqlite3(missingOtherFunctionPath, "missing-other-function");
    }
    missingBetterSqlite3Path = join(dir, "missing", "better_sqlite3.node");
    missingInV8NamedDirectoryPath = join(dir, "_ZN2v8", "better_sqlite3.node");
    mkdirSync(join(dir, "not-a-library"));
    notALibraryBetterSqlite3Path = join(dir, "not-a-library", "better_sqlite3.node");
    writeFileSync(notALibraryBetterSqlite3Path, "not a library");
  }, 180_000);

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

  // better-sqlite3 13 uses Node-API and works. 12 and older use the V8 C++ API and call functions that
  // Bun does not export. Only what a build registers tells the two apart.
  //
  // Not concurrent: more children at the same time make the crash report tests above exceed their
  // time limit on a debug build.
  describe("process.dlopen of a better-sqlite3 build", () => {
    const remedy =
      "\nbetter-sqlite3 13 uses Node-API. Upgrade to 13.0.2 or later, or use bun:sqlite, which has a similar API.";
    const refusal = (path: string) => ({
      loaded: false,
      code: "ERR_DLOPEN_FAILED",
      message:
        `Cannot load native addon '${path}': this build of better-sqlite3 uses V8 C++ API functions that ` +
        `are not yet supported in Bun (https://github.com/oven-sh/bun/issues/4290).` +
        remedy,
    });
    const loadEveryWay = (path: string) => runJsonFixture([bunExe(), everyWayFixturePath], { ADDON_PATH: path });

    test("a Node-API build named better_sqlite3.node loads", async () => {
      const loaded = { loaded: true, hello: "world" };
      expect(await loadEveryWay(napiBetterSqlite3Path)).toEqual({
        dlopen: loaded,
        dlopenAgain: loaded,
        require: loaded,
        worker: loaded,
      });
    });

    test.each([
      ["with another file name", () => v8BetterSqlite3Path],
      ["named better_sqlite3.node", () => v8BetterSqlite3NamedPath],
      // Re-compiling does not help, so the refusal comes before the check of the Node.js version.
      ["for another Node.js version", () => v8BetterSqlite3OtherAbiPath],
    ])("a V8 C++ API build %s is refused with an error that says what to do", async (_, path) => {
      const refused = refusal(path());
      const result = await loadEveryWay(path());
      expect(result).toEqual({
        dlopen: refused,
        dlopenAgain: refused,
        require: {
          ...refused,
          message: expect.stringContaining("uses V8 C++ API functions that are not yet supported in Bun"),
        },
        worker: refused,
      });
      // Code in the wild matches this phrase to fall back to bun:sqlite.
      expect(result.dlopen.message).toMatch(/not yet supported in Bun/i);
    });

    test(
      "a compiled executable loads the Node-API build and refuses the V8 C++ API build that it embeds",
      async () => {
        const entry = `
          const attempt = load => {
            try {
              return { loaded: true, hello: load().hello() };
            } catch (e) {
              return { loaded: false, code: e.code, message: e.message };
            }
          };
          console.log(JSON.stringify({
            napi: attempt(() => require(${JSON.stringify(napiBetterSqlite3Path)})),
            v8: attempt(() => require(${JSON.stringify(v8BetterSqlite3Path)})),
          }));
        `;
        using dir = tempDir("dlopen-better-sqlite3-compile", { "entry.js": entry, "tmp": {} });
        const exe = join(String(dir), isWindows ? "app.exe" : "app");
        await using build = Bun.spawn({
          cmd: [bunExe(), "build", "--compile", "entry.js", "--outfile", exe],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, buildStderr, buildExitCode] = await Promise.all([
          build.stdout.text(),
          build.stderr.text(),
          build.exited,
        ]);
        expect({ buildStderr, buildExitCode }).toEqual({ buildStderr: expect.any(String), buildExitCode: 0 });

        // The executable loads each embedded addon from a copy in the temporary directory, under another name.
        const tmp = join(String(dir), "tmp");
        expect(await runJsonFixture([exe], { BUN_TMPDIR: tmp, TMPDIR: tmp })).toEqual({
          napi: { loaded: true, hello: "world" },
          v8: {
            loaded: false,
            code: "ERR_DLOPEN_FAILED",
            message: expect.stringMatching(
              /^Cannot load native addon '.+': this build of better-sqlite3 uses V8 C\+\+ API functions that are not yet supported in Bun /,
            ),
          },
        });
      },
      // A debug build copies and rewrites itself here: 1.6 GB, which takes 15 s when the file is not cached.
      isDebug ? 60_000 : undefined,
    );

    test.each([
      ["a missing file", () => missingBetterSqlite3Path],
      // The loader repeats the path in its error, and this one has the start of a mangled v8:: name in it.
      ["a missing file in a directory named _ZN2v8", () => missingInV8NamedDirectoryPath],
      ["a file that is not a library", () => notALibraryBetterSqlite3Path],
    ])("%s named better_sqlite3.node gets the loader's error", async (_, path) => {
      const { dlopen } = await loadEveryWay(path());
      expect(dlopen).toEqual({
        loaded: false,
        code: "ERR_DLOPEN_FAILED",
        message: expect.not.stringMatching(/better-sqlite3|bun:sqlite|Bun does not export/),
      });
    });

    // Linked with -z now, like the better-sqlite3 12 binaries for musl: the loader looks up every function
    // when it opens the file, so the load fails before the module registers.
    describe.skipIf(!isLinux)("an addon that the loader rejects for a missing function", () => {
      const cause =
        "\nBun does not export this V8 or Node.js C++ API function. Either the addon was built for another " +
        `Node.js version (this version of Bun requires NODE_MODULE_VERSION ${process.versions.modules}), or it ` +
        "uses a function that is not yet supported in Bun (https://github.com/oven-sh/bun/issues/4290).";
      const v8Function = "_ZN2v828FunctionThatBunDoesNotExportEv";
      const otherFunction = "_Z26FunctionThatNothingDefinesN2v85LocalINS_5ValueEEE";

      test.each([
        ["a V8 function", () => missingV8FunctionPath, v8Function, cause],
        ["a V8 function, named better_sqlite3.node", () => missingV8FunctionNamedPath, v8Function, cause + remedy],
        ["another function", () => missingOtherFunctionPath, otherFunction, ""],
        ["another function, named better_sqlite3.node", () => missingOtherFunctionNamedPath, otherFunction, ""],
      ])("%s: the loader's error comes first, then the cause if Bun knows it", async (_, path, symbol, added) => {
        const { dlopen } = await loadEveryWay(path());
        expect(dlopen).toEqual({ loaded: false, code: "ERR_DLOPEN_FAILED", message: expect.any(String) });
        const [loaderError, ...rest] = dlopen.message.split("\n");
        expect(loaderError).toContain(path());
        expect(loaderError).toContain(symbol);
        expect(rest.map(line => "\n" + line).join("")).toBe(added);
      });
    });
  });
});
