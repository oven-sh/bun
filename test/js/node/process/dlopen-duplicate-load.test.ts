import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, readFileSync, writeFileSync } from "fs";
import {
  bunEnv,
  bunExe,
  canBuildNodeAddons,
  isGlibc,
  isLinux,
  isMacOS,
  isMusl,
  isWindows,
  tempDirWithFiles,
} from "harness";
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
          "sources": [ "initializer_missing_import.cpp" ],
          "defines": [ "MISSING_FUNCTION=deflateInit_" ],
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
    // Bun calls this symbol only where it can check the addon's imports before. macOS and Windows also bind an
    // import at its first call, and a call of one that nothing defines ends the process.
    const callsTheSymbol = !isMacOS && !isWindows;
    const built = (addon: string) => join(addonPath, "..", addon);

    async function run(args: string[], addon: string, env: Record<string, string> = {}) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
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
    // The error of a dlopen() that failed: the loader's own text, which names the symbol that it did not find.
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
      // Node's executable exports zlib, and Bun's does not.
      ["initializer_zlib_import.node", "deflateInit_"],
      // Compiled with -fno-plt: the call goes through the global offset table.
      ["initializer_got_import.node", "bun_test_symbol_that_nothing_defines"],
      // Linked with -z now.
      ["initializer_bind_now_missing_import.node", "bun_test_symbol_that_nothing_defines"],
    ])("%s is refused, because nothing defines its import %s", async (addon, symbol) => {
      const { bindNow, relocations } = elfImports(built(addon));
      const relocation = relocations.get(symbol);
      const leftToBun = !bindNow && (relocation === "JUMP_SLOT" || (relocation === "GLOB_DAT" && isMusl));
      expect(await load(addon)).toEqual(
        leftToBun
          ? refused(`Cannot load native addon ${built(addon)}: it imports '${symbol}', which Bun does not provide`)
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

    // The loader has bound every import of this addon when dlopen() returns. Bun finds the address of a definition in
    // each import's slot and asks nothing about it. It reads no name for such an import, so the copy whose names Bun
    // could not read loads too.
    test.skipIf(!isLinux)("an addon with only this entry loads when it is linked with -z now", async () => {
      expect(elfImports(built("initializer_bind_now.node")).bindNow).toBe(true);
      expect(await load("initializer_bind_now.node")).toEqual(loaded({ loaded: "initializer_bind_now" }));
      writeWithoutStringTableSize("initializer_bind_now.node", "initializer_bind_now_unreadable.node");
      expect(await load("initializer_bind_now_unreadable.node")).toEqual(loaded({ loaded: "initializer_bind_now" }));
    });

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
            `Cannot load native addon ${built(addon)}: it imports 'bun_test_symbol_that_nothing_defines', which Bun does not provide`,
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

    // Node calls node_register_module_v<ABI> for this addon.
    test("an addon that also exports napi_register_module_v1 loads through Node-API", async () => {
      expect(await load("both_entries.node")).toEqual(loaded({ via: "napi_register_module_v1" }));
    });

    test("an addon without an entry did not self-register", async () => {
      expect(await load("no_registration.node")).toEqual(
        refused(`Module did not self-register: '${built("no_registration.node")}'.`),
      );
    });
  });
});

const [PT_LOAD, PT_DYNAMIC] = [1, 2];
const [DT_PLTRELSZ, DT_STRTAB, DT_SYMTAB, DT_RELA, DT_RELASZ, DT_STRSZ, DT_JMPREL] = [2, 5, 6, 7, 8, 10, 23];
const [DT_BIND_NOW, DT_FLAGS, DT_FLAGS_1, DF_BIND_NOW, DF_1_NOW] = [24, 30, 0x6ffffffb, 8, 1];

// The program headers of a 64-bit ELF file.
function elfProgramHeaders(view: DataView) {
  return Array.from({ length: view.getUint16(0x38, true) }, (_, i) => {
    const header = Number(view.getBigUint64(0x20, true)) + i * view.getUint16(0x36, true);
    return {
      type: view.getUint32(header, true),
      offset: Number(view.getBigUint64(header + 8, true)),
      address: Number(view.getBigUint64(header + 16, true)),
      size: Number(view.getBigUint64(header + 32, true)),
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
// JUMP_SLOT or a GLOB_DAT relocation names, which of the two.
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
  // The numbers of the two relocation types on arm64 (machine 183) and on x64.
  const types = view.getUint16(0x12, true) === 183 ? [1025, 1026] : [6, 7];
  const relocations = new Map<string, "GLOB_DAT" | "JUMP_SLOT">();
  for (const [tag, size] of [
    [DT_JMPREL, DT_PLTRELSZ],
    [DT_RELA, DT_RELASZ],
  ]) {
    if (!dynamic.has(tag)) continue;
    for (let entry = table(tag); entry < table(tag) + dynamic.get(size)!; entry += 24) {
      const info = view.getBigUint64(entry + 8, true);
      const type = types.indexOf(Number(info & 0xffffffffn));
      if (type < 0) continue;
      const name = strings + view.getUint32(symbols + Number(info >> 32n) * 24, true);
      relocations.set(image.toString("latin1", name, image.indexOf(0, name)), type === 0 ? "GLOB_DAT" : "JUMP_SLOT");
    }
  }
  const bindNow =
    dynamic.has(DT_BIND_NOW) ||
    ((dynamic.get(DT_FLAGS) ?? 0) & DF_BIND_NOW) !== 0 ||
    ((dynamic.get(DT_FLAGS_1) ?? 0) & DF_1_NOW) !== 0;
  return { bindNow, relocations };
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
