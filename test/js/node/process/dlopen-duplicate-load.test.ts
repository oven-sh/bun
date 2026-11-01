import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons, isGlibc, isLinux, isWindows, tempDir, tempDirWithFiles } from "harness";
import { join } from "path";

// These tests share one node-gyp build of a few addons (the compile
// dominates the wall time). They cover:
// - duplicate loads: the second dlopen of the same module used to fail with
//   "symbol 'napi_register_module_v1' not found" because static constructors
//   only run once, so the module registration wasn't replayed
// - flags: the third argument is the mode that dlopen() gets, converted and
//   refused the way Node does it, and the handler of `.node` files takes none
// - non-object exports: null/undefined/primitive exports used to segfault
// - non-context-aware addons (NODE_MODULE, the NAN pattern): loading one from a
//   second thread must not run the init function again, because that would
//   point the addon's static V8 handles into the second thread's heap
// - nested calls: a dlopen made while the filename is converted to a string, or
//   from an init function, must not steal the outer call's registration
// - static constructor order: the init function must run after dlopen() returns,
//   once the static constructors after the module registration have run

// These need no addon: each throws before a library is opened, or for a file that does not exist.
describe("process.dlopen arguments", () => {
  const missing = join(import.meta.dir, "no-such-addon.node");
  const dlopen = process.dlopen as (...args: unknown[]) => unknown;
  const thrownBy = (call: () => unknown) => {
    try {
      call();
    } catch (e: any) {
      return { name: e.name, code: e.code, message: e.message };
    }
  };

  test.each([[[]], [[{ exports: {} }]]])("fewer than two arguments: %j", args => {
    expect(thrownBy(() => dlopen(...args))).toEqual({
      name: "TypeError",
      code: "ERR_MISSING_ARGS",
      message: "process.dlopen needs at least 2 arguments",
    });
  });

  test.each([
    ["a symbol", Symbol("flags")],
    ["a bigint", 1n],
    [
      "an object whose valueOf throws",
      {
        valueOf() {
          throw new Error("thrown by valueOf");
        },
      },
    ],
  ])("flags that are %s", (_, flags) => {
    const error = { name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message: "flag argument must be an integer." };
    expect(thrownBy(() => dlopen({ exports: {} }, missing, flags))).toEqual(error);
    // Node converts the flags first, so their error comes before the one for the module.
    expect(thrownBy(() => dlopen(null, missing, flags))).toEqual(error);
  });

  test("the flags are converted, then exports is read, then the filename is converted", () => {
    const order: string[] = [];
    const module = {
      get exports() {
        order.push("exports");
        return {};
      },
    };
    const filename = {
      toString() {
        order.push("filename");
        return missing;
      },
    };
    const flags = {
      valueOf() {
        order.push("flags");
        return 2;
      },
    };
    expect(thrownBy(() => dlopen(module, filename, flags))).toMatchObject({ name: "Error", code: "ERR_DLOPEN_FAILED" });
    expect(order).toEqual(["flags", "exports", "filename"]);
  });
});

describe.skipIf(!canBuildNodeAddons())("process.dlopen native addon", () => {
  let addonPath: string;
  // The names that it exports.
  const addonExports = ["hello", "lateStaticConstructed"];
  // Not on Windows: a Node-API addon, and a library that calls a function of it without being linked against it.
  let corePath: string;
  let pluginPath: string;
  // Not on Windows: a V8 addon whose init function calls a function that nothing defines.
  let undefinedSymbolPath: string;
  // A library that registers no module.
  let noRegistrationPath: string;
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

    // The shape of https://github.com/oven-sh/bun/issues/26137: an addon whose symbols a library that it opens later needs.
    // Node tests the same with test/addons/dlopen-ping-pong. test/aot/process-dlopen-flags.test.ts builds the two files too.
    const sharedWithAot = join(import.meta.dir, "../../../aot/process-dlopen-flags");
    const coreSource = readFileSync(join(sharedWithAot, "core.c"), "utf8");
    const pluginSource = readFileSync(join(sharedWithAot, "plugin.c"), "utf8");

    const undefinedSymbolSource = `
#include <node.h>

#ifndef _WIN32
// Nothing defines this, so the loader cannot bind it.
extern "C" void function_that_nothing_defines();
#endif

static void Initialize(v8::Local<v8::Object> exports,
                       v8::Local<v8::Value> module,
                       v8::Local<v8::Context> context,
                       void* priv) {
#ifndef _WIN32
  function_that_nothing_defines();
#endif
}

NODE_MODULE_CONTEXT_AWARE(undefined_symbol, Initialize)
`;

    const noRegistrationSource = `
int no_registration_value(void) { return 1; }
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
      "target_name": "core",
      "sources": [ "core.c" ]
    },
    {
      "target_name": "plugin",
      "sources": [ "plugin.c" ]
    },
    {
      "target_name": "undefined_symbol",
      "sources": [ "undefined_symbol.cpp" ]
    },
    {
      "target_name": "no_registration",
      "sources": [ "no_registration.c" ]
    },
    {
      "target_name": "non_context_aware",
      "sources": [ "non_context_aware.cpp" ]
    }
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
      "core.c": coreSource,
      "plugin.c": pluginSource,
      "undefined_symbol.cpp": undefinedSymbolSource,
      "no_registration.c": noRegistrationSource,
      "non_context_aware.cpp": nonContextAwareSource,
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
    corePath = join(dir, "build", "Release", "core.node");
    pluginPath = join(dir, "build", "Release", "plugin.node");
    undefinedSymbolPath = join(dir, "build", "Release", "undefined_symbol.node");
    noRegistrationPath = join(dir, "build", "Release", "no_registration.node");
    nonContextAwarePath = join(dir, "build", "Release", "non_context_aware.node");
    workerFixturePath = join(dir, "worker-fixture.js");
    addonCopyPath = join(dir, "build", "Release", "addon-copy.node");
    copyFileSync(addonPath, addonCopyPath);
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

  // Not concurrent, and neither are the two groups after it: the crash report tests above take most of their 10 seconds in a
  // debug build, and longer with every child that runs beside them.
  describe("process.dlopen flags", () => {
    // `report(path, ...flags)` answers the names that the addon exported, or what process.dlopen threw.
    const report = `
      const { ADDON, CORE, PLUGIN, UNDEFINED_SYMBOL } = process.env;
      const { RTLD_LAZY, RTLD_NOW, RTLD_GLOBAL, RTLD_DEEPBIND } = require("node:os").constants.dlopen;
      function report(path, ...flags) {
        const module = { exports: {} };
        try {
          process.dlopen(module, path, ...flags);
        } catch (e) {
          return { name: e.name, code: e.code, message: e.message };
        }
        return Object.keys(module.exports);
      }
    `;
    // Runs the script after `report` in a child, which prints one JSON value.
    const run = (script: string, env: Record<string, string> = {}) =>
      runJsonFixture([bunExe(), "-e", report + script], {
        ADDON: addonPath,
        CORE: corePath,
        PLUGIN: pluginPath,
        UNDEFINED_SYMBOL: undefinedSymbolPath,
        ...env,
      });

    // With the default RTLD_LAZY the load succeeds, and the loader ends the process when the init function makes the call.
    test.skipIf(isWindows)("RTLD_NOW: a symbol that nothing defines fails the load", async () => {
      expect(await run(`console.log(JSON.stringify(report(UNDEFINED_SYMBOL, RTLD_NOW)));`)).toEqual({
        name: "Error",
        code: "ERR_DLOPEN_FAILED",
        message: expect.stringContaining("function_that_nothing_defines"),
      });
    });

    // A symbol has the bytes that its library gave it. Node replaces what is not UTF-8.
    test.skipIf(!isLinux)("a loader error that is not UTF-8 keeps its text", async () => {
      using dir = tempDir("dlopen-not-utf8", {});
      const patched = join(String(dir), "not-utf8.node");
      const bytes = readFileSync(undefinedSymbolPath);
      const name = Buffer.from("function_that_nothing_defines");
      let names = 0;
      for (let at = bytes.indexOf(name); at !== -1; at = bytes.indexOf(name, at + 1), names++)
        bytes[at + name.length - 1] = 0xff;
      expect(names).toBeGreaterThan(0);
      writeFileSync(patched, bytes);
      expect(
        await run(`console.log(JSON.stringify(report(process.env.PATCHED, RTLD_NOW)));`, { PATCHED: patched }),
      ).toEqual({
        name: "Error",
        code: "ERR_DLOPEN_FAILED",
        message: expect.stringContaining("function_that_nothing_define\uFFFD"),
      });
    });

    // https://github.com/oven-sh/bun/issues/26137
    describe.skipIf(isWindows)("RTLD_GLOBAL: a library that the addon opens finds the addon's symbols", () => {
      const loadPlugin = `console.log(JSON.stringify(core.exports.loadPlugin(PLUGIN)));`;

      test.each([
        ["on the first load", `const core = { exports: {} }; process.dlopen(core, CORE, RTLD_LAZY | RTLD_GLOBAL);`],
        [
          "on a load after require() opened the addon without it",
          `require(CORE); const core = { exports: {} }; process.dlopen(core, CORE, RTLD_LAZY | RTLD_GLOBAL);`,
        ],
        [
          "under require(), from a process.dlopen that the program replaced",
          `const dlopen = process.dlopen;
           process.dlopen = function (module, filename) { return dlopen.call(this, module, filename, RTLD_LAZY | RTLD_GLOBAL); };
           const core = { exports: require(CORE) };`,
        ],
      ])("%s", async (_, load) => {
        expect(await run(load + loadPlugin)).toBe(43);
      });

      // macOS opens a library with RTLD_GLOBAL unless the flags have RTLD_LOCAL.
      test.skipIf(!isLinux)("and not without the flag", async () => {
        expect(await run(`const core = { exports: {} }; process.dlopen(core, CORE);` + loadPlugin)).toEqual(
          expect.stringContaining("core_value"),
        );
      });
    });

    // Node converts the argument only when it is there, so none of these is the default RTLD_LAZY: each is 0, with neither
    // RTLD_LAZY nor RTLD_NOW. glibc refuses that mode. The other C libraries take it, and Windows has no mode.
    test("a third argument that converts to 0 is the mode 0", async () => {
      const expected = isGlibc
        ? {
            name: "Error",
            code: "ERR_DLOPEN_FAILED",
            message: `${addonPath}: invalid mode for dlopen(): Invalid argument`,
          }
        : addonExports;
      expect(
        await run(`console.log(JSON.stringify([0, undefined, null, "abc", NaN].map(flags => report(ADDON, flags))));`),
      ).toEqual([expected, expected, expected, expected, expected]);
    });

    test("the third argument is converted with ToInt32, and every flag of os.constants.dlopen loads", async () => {
      // RTLD_NOW is 2 and RTLD_LAZY is 1 where they exist. RTLD_DEEPBIND is what Prisma passes.
      const flags = `["2", 2.5, true, { valueOf: () => 1 }, 2 ** 32 + 1, RTLD_LAZY, RTLD_NOW, RTLD_LAZY | RTLD_GLOBAL, RTLD_NOW | RTLD_GLOBAL, RTLD_LAZY | RTLD_DEEPBIND]`;
      expect(await run(`console.log(JSON.stringify(${flags}.map(flags => report(ADDON, flags))));`)).toEqual(
        Array.from({ length: 10 }, () => addonExports),
      );
    });

    // Node ends with a segmentation fault for both. 0x40000000 is a mode that glibc keeps for sprof(1), and 4 is RTLD_NOLOAD.
    test.skipIf(!isGlibc)("a mode that gives glibc no usable library throws", async () => {
      expect(
        await run(
          `console.log(JSON.stringify([report(ADDON, RTLD_LAZY | 0x40000000), report(ADDON, RTLD_LAZY | 4), report(ADDON), report(ADDON, RTLD_LAZY | 4)]));`,
        ),
      ).toEqual([
        { name: "Error", code: "ERR_DLOPEN_FAILED", message: "invalid mode parameter" },
        { name: "Error", code: "ERR_DLOPEN_FAILED", message: `${addonPath}: the library is not loaded` },
        addonExports,
        addonExports,
      ]);
    });
  });

  // In Node the handler is `(module, filename) => process.dlopen(module, filename)`, a function of its own.
  describe("process.dlopen and the handler of .node files", () => {
    test("the handler takes no flags", async () => {
      // As the third argument of process.dlopen the first throws, and so does the second with glibc.
      const script = `
        const handler = require("node:module")._extensions[".node"];
        console.log(JSON.stringify([Symbol("not flags"), 0].map(extra => {
          const module = { exports: {} };
          handler(module, process.env.ADDON, extra);
          return Object.keys(module.exports);
        })));
      `;
      expect(await runJsonFixture([bunExe(), "-e", script], { ADDON: addonPath })).toEqual([
        addonExports,
        addonExports,
      ]);
    });

    test.each(["process.dlopen", `require.extensions[".node"]`])(
      "%s is a handler for another extension",
      async handler => {
        using dir = tempDir("dlopen-other-extension", {});
        const copy = join(String(dir), "addon.addon");
        copyFileSync(addonPath, copy);
        const script = `
        require.extensions[".addon"] = ${handler};
        console.log(JSON.stringify(Object.keys(require(process.env.COPY))));
      `;
        expect(await runJsonFixture([bunExe(), "-e", script], { COPY: copy })).toEqual(addonExports);
      },
    );
  });

  describe("process.dlopen of a library that registers no module", () => {
    test("throws ERR_DLOPEN_FAILED", async () => {
      const script = `
        let thrown = null;
        try {
          process.dlopen({ exports: {} }, process.env.NO_REGISTRATION);
        } catch (e) {
          thrown = { name: e.name, code: e.code, message: e.message };
        }
        console.log(JSON.stringify(thrown));
      `;
      expect(await runJsonFixture([bunExe(), "-e", script], { NO_REGISTRATION: noRegistrationPath })).toEqual({
        name: "Error",
        code: "ERR_DLOPEN_FAILED",
        message: `Module did not self-register: '${noRegistrationPath}'.`,
      });
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
});
