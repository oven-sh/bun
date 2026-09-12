import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, canBuildNodeAddons, nodeExeMatchingAbi, tempDirWithFiles } from "harness";
import { join } from "path";

// These tests share one node-gyp build of three V8 addons (the compile
// dominates the wall time), covering three previously-broken paths:
// - duplicate loads: the second dlopen of the same module used to fail with
//   "symbol 'napi_register_module_v1' not found" because static constructors
//   only run once, so the module registration wasn't replayed
// - non-object exports: null/undefined/primitive exports used to segfault
// - non-context-aware addons (NODE_MODULE, the NAN pattern): a load from a
//   second thread used to run the addon's init again. The init keeps V8 handles
//   in statics, so the first thread's statics then pointed into the other
//   thread's heap and it crashed once that heap was gone. Node refuses the load
//   while the thread that loaded the addon is alive.

describe.skipIf(!canBuildNodeAddons())("process.dlopen native addon", () => {
  let addonPath: string;
  let nonContextAwarePath: string;
  let mismatchedAbiPath: string;
  let workerFixturePath: string;
  let nodeExe: string;

  beforeAll(async () => {
    const addonSource = `
#include <node.h>

namespace demo {

using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

void Hello(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  args.GetReturnValue().Set(String::NewFromUtf8(isolate, "world").ToLocalChecked());
}

void Initialize(Local<Object> exports,
                Local<Value> module,
                Local<Context> context,
                void* priv) {
  NODE_SET_METHOD(exports, "hello", Hello);
}

}  // namespace demo

NODE_MODULE_CONTEXT_AWARE(addon, demo::Initialize)
`;

    // The shape NAN generates: NODE_MODULE (no context register function) and
    // a static Persistent that the init fills in for the isolate it ran in.
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

// Reads the static the init filled in, like a NAN class's NewInstance.
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

    // A non-context-aware addon built for another ABI: its init never runs, so
    // every load, from any thread, must report the ABI mismatch.
    const mismatchedAbiSource = `
#include <node.h>
#include <cstdlib>

void Initialize(v8::Local<v8::Object> exports, v8::Local<v8::Value> module, void* priv) {
  abort();
}

extern "C" {
static node::node_module _module = {
    42,                     // nm_version
    0,                      // nm_flags
    nullptr,                // nm_dso_handle
    "mismatched_abi.cpp",   // nm_filename
    Initialize,             // nm_register_func
    nullptr,                // nm_context_register_func
    "mismatched_abi",       // nm_modname
    nullptr,                // nm_priv
    nullptr,                // nm_link
};

NODE_C_CTOR(_register_mismatched_abi) {
  node_module_register(&_module);
}
}
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
      "target_name": "mismatched_abi",
      "sources": [ "mismatched_abi.cpp" ]
    }
  ]
}
`;

    // Loads the addon at $ADDON_PATH on the main thread and in a Worker and
    // prints one JSON report. Runs under Node as well, to compare.
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
      // makeInstance reads the static the init filled in. It must still point
      // into this thread's heap now that the worker is gone.
      if (process.isBun) Bun.gc(true);
      result.mainExportsAfterWorkerExit = describeExports(main.exports);
    }
    console.log(JSON.stringify(result));
  });
}
`;

    const dir = tempDirWithFiles("dlopen-duplicate-test", {
      "addon.cpp": addonSource,
      "non_context_aware.cpp": nonContextAwareSource,
      "mismatched_abi.cpp": mismatchedAbiSource,
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
    mismatchedAbiPath = join(dir, "build", "Release", "mismatched_abi.node");
    workerFixturePath = join(dir, "worker-fixture.js");
    nodeExe = await nodeExeMatchingAbi();
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

    // Runs the worker fixture under the bun being tested and under the node
    // whose addon ABI the addons were built for, and returns both reports.
    function loadInMainAndWorker(addon: string, order: "main first" | "worker first") {
      const env = {
        ADDON_PATH: addon,
        ...(order === "worker first" ? { WORKER_LOADS_FIRST: "1" } : {}),
      };
      return Promise.all([
        runJsonFixture([bunExe(), workerFixturePath], env),
        runJsonFixture([nodeExe, workerFixturePath], env),
      ]);
    }

    const selfRegisterError = (addon: string) => ({
      loaded: false,
      code: "ERR_DLOPEN_FAILED",
      message: `Module did not self-register: '${addon}'.`,
    });

    test("a context-aware addon loads in a Worker after the main thread", async () => {
      const [bun, node] = await loadInMainAndWorker(addonPath, "main first");
      expect(bun).toEqual({
        main: { loaded: true, hello: "world" },
        worker: { loaded: true, hello: "world" },
        workerExitCode: 0,
        mainExportsAfterWorkerExit: { hello: "world" },
      });
      expect(node).toEqual(bun);
    });

    test("a context-aware addon loads on the main thread while and after a Worker has it", async () => {
      const [bun, node] = await loadInMainAndWorker(addonPath, "worker first");
      expect(bun).toEqual({
        worker: { loaded: true, hello: "world" },
        mainWhileWorkerAlive: { loaded: true, hello: "world" },
        workerExitCode: 0,
        mainAfterWorkerExit: { loaded: true, hello: "world" },
      });
      expect(node).toEqual(bun);
    });

    test("a non-context-aware addon loaded by the main thread is refused in a Worker", async () => {
      const [bun, node] = await loadInMainAndWorker(nonContextAwarePath, "main first");
      expect(bun).toEqual({
        main: { loaded: true, hello: "world", initCount: 1, instance: "object" },
        worker: selfRegisterError(nonContextAwarePath),
        workerExitCode: 0,
        mainExportsAfterWorkerExit: { hello: "world", initCount: 1, instance: "object" },
      });
      expect(node).toEqual(bun);
    });

    test("a non-context-aware addon loaded by a Worker is refused on the main thread until the Worker exits", async () => {
      const [bun, node] = await loadInMainAndWorker(nonContextAwarePath, "worker first");
      expect(bun).toEqual({
        worker: { loaded: true, hello: "world", initCount: 1, instance: "object" },
        mainWhileWorkerAlive: selfRegisterError(nonContextAwarePath),
        workerExitCode: 0,
        mainAfterWorkerExit: { loaded: true, hello: "world", initCount: 2, instance: "object" },
      });
      // Once the Worker is gone, node dlcloses the addon and the next load starts
      // it over. Whether that works depends on the libc actually unloading it
      // (glibc does, musl does not), so only the steps before it are compared.
      const { mainAfterWorkerExit: _bunAfter, ...bunWhileAlive } = bun;
      const { mainAfterWorkerExit: _nodeAfter, ...nodeWhileAlive } = node;
      expect(nodeWhileAlive).toEqual(bunWhileAlive);
    });

    // Node's own message differs, so this one is not compared with node.
    test("an addon built for another ABI reports the mismatch from a Worker too", async () => {
      const abiError = {
        loaded: false,
        message:
          `The module 'mismatched_abi' was compiled against a different Node.js ABI version using NODE_MODULE_VERSION 42. ` +
          `This version of Bun requires NODE_MODULE_VERSION ${process.versions.modules}. Please try re-compiling or re-installing the module.`,
      };
      expect(await runJsonFixture([bunExe(), workerFixturePath], { ADDON_PATH: mismatchedAbiPath })).toEqual({
        main: abiError,
        worker: abiError,
        workerExitCode: 0,
      });
    });

    // Node refuses this load too. Bun runs the init again on the thread whose
    // heap the addon's statics already point into; `bun --hot` relies on that.
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
