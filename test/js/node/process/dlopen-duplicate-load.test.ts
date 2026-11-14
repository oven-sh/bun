import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, readFileSync } from "fs";
import {
  bunEnv,
  bunExe,
  canBuildNodeAddons,
  isLinux,
  isWindows,
  nodeExeMatchingAbi,
  tempDir,
  tempDirWithFiles,
} from "harness";
import { mkfifo } from "mkfifo";
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
// - concurrent loads: an addon registers its modules only on the thread that
//   loads it first, and a thread that loads it at the same moment must still
//   find all of them

// How many modules registers_v8.node and registers_napi.node register. Saving this many takes long enough for another
// thread to look while it is in progress.
const registrations = 2000;
// How many Workers concurrent-load-fixture.js starts.
const concurrentWorkers = 4;

describe.skipIf(!canBuildNodeAddons())("process.dlopen native addon", () => {
  let addonPath: string;
  let nonContextAwarePath: string;
  let workerFixturePath: string;
  // A copy of the same addon at a second path, which the loader treats as a different library.
  let addonCopyPath: string;
  let registersV8Path: string;
  let registersNapiPath: string;
  let registersNapiOncePath: string;
  let bySymbolPath: string;
  let callsJsInConstructorPath: string;
  let holdDlopenPath: string;
  let concurrentLoadFixturePath: string;
  let workerEndsDuringLoadFixturePath: string;

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

    // Registers a context-aware V8 module REGISTRATIONS times. exports.inits counts the init calls of one load.
    // Bun runs every registration of a library. Node.js keeps the last one only, so it runs one.
    const registersV8Source = `
#include <node.h>

namespace demo {

using v8::Context;
using v8::Isolate;
using v8::Local;
using v8::Number;
using v8::Object;
using v8::String;
using v8::Value;

void Initialize(Local<Object> exports, Local<Value> module, Local<Context> context, void* priv) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<String> key = String::NewFromUtf8(isolate, "inits").ToLocalChecked();
  Local<Value> inits = exports->Get(context, key).ToLocalChecked();
  double count = inits->IsNumber() ? inits.As<Number>()->Value() : 0;
  exports->Set(context, key, Number::New(isolate, count + 1)).Check();
}

static node::node_module registration = {
  NODE_MODULE_VERSION, 0, nullptr, __FILE__, nullptr, Initialize, "registers_v8", nullptr, nullptr,
};

struct RegisterAll {
  RegisterAll() {
    for (int i = 0; i < REGISTRATIONS; i++) node::node_module_register(&registration);
  }
};
static RegisterAll register_all;

}  // namespace demo
`;

    // The same with napi_module_register, which addons built with older Node-API headers call from a static constructor.
    const registersNapiSource = `
#include <node_api.h>

static napi_value Initialize(napi_env env, napi_value exports) {
  bool has_inits = false;
  int32_t count = 0;
  napi_value inits;
  napi_has_named_property(env, exports, "inits", &has_inits);
  if (has_inits) {
    napi_get_named_property(env, exports, "inits", &inits);
    napi_get_value_int32(env, inits, &count);
  }
  napi_create_int32(env, count + 1, &inits);
  napi_set_named_property(env, exports, "inits", inits);
  return exports;
}

static napi_module registration = {
  NAPI_MODULE_VERSION, 0, __FILE__, Initialize, "registers_napi", nullptr, {nullptr},
};

struct RegisterAll {
  RegisterAll() {
    for (int i = 0; i < REGISTRATIONS; i++) napi_module_register(&registration);
  }
};
static RegisterAll register_all;
`;

    // Registers nothing: process.dlopen finds the init function by its symbol. It calls exports.duringInit() if the test set one.
    const bySymbolSource = `
#include <node_api.h>

static napi_value Hello(napi_env env, napi_callback_info info) {
  napi_value world;
  napi_create_string_utf8(env, "world", NAPI_AUTO_LENGTH, &world);
  return world;
}

NAPI_MODULE_INIT() {
  napi_value during_init, result, hello;
  napi_valuetype type;
  napi_get_named_property(env, exports, "duringInit", &during_init);
  napi_typeof(env, during_init, &type);
  if (type == napi_function && napi_call_function(env, exports, during_init, 0, NULL, &result) != napi_ok) {
    return NULL;
  }
  napi_create_function(env, "hello", NAPI_AUTO_LENGTH, Hello, NULL, &hello);
  napi_set_named_property(env, exports, "hello", hello);
  return exports;
}
`;

    // Its static constructor, which runs inside dlopen(), calls globalThis.duringConstructor().
    const callsJsInConstructorSource = `
#include <node.h>

namespace demo {

using v8::Context;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

void Hello(const FunctionCallbackInfo<Value>& args) {
  args.GetReturnValue().Set(String::NewFromUtf8(args.GetIsolate(), "world").ToLocalChecked());
}

void Initialize(Local<Object> exports, Local<Value> module, Local<Context> context, void* priv) {
  NODE_SET_METHOD(exports, "hello", Hello);
}

static node::node_module registration = {
  NODE_MODULE_VERSION, 0, nullptr, __FILE__, nullptr, Initialize, "calls_js_in_constructor", nullptr, nullptr,
};

struct CallJS {
  CallJS() {
    node::node_module_register(&registration);
    Isolate* isolate = Isolate::GetCurrent();
    HandleScope scope(isolate);
    Local<Context> context = isolate->GetCurrentContext();
    Local<Object> global = context->Global();
    Local<Value> callback =
        global->Get(context, String::NewFromUtf8(isolate, "duringConstructor").ToLocalChecked()).ToLocalChecked();
    if (callback->IsFunction()) callback.As<Function>()->Call(context, global, 0, nullptr).ToLocalChecked();
  }
};
static CallJS call_js;

}  // namespace demo
`;

    // An LD_PRELOAD library. It keeps the thread that first loads an addon in the directory $HOLD_DLOPEN_IN inside
    // dlopen(), after the real dlopen() has returned.
    //
    // With $HOLD_DLOPEN_FIFO, until the test has opened that FIFO for writing and closed it.
    //
    // Without it, until $HOLD_DLOPEN_CALLS more dlopen() calls of that addon have returned. A process.dlopen that lets
    // no other thread into dlopen() before the first one is done never gets there, so the wait also ends after 100 ms.
    // It then appends the number of calls that did return to $HOLD_DLOPEN_REPORT.
    const holdDlopenSource = `
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <dlfcn.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t returned = PTHREAD_COND_INITIALIZER;
static struct { char* path; int calls; } addons[16];

static int* calls_of(const char* path) {
  int i = 0;
  while (addons[i].path && strcmp(addons[i].path, path) != 0) i++;
  if (!addons[i].path) addons[i].path = strdup(path);
  return &addons[i].calls;
}

static void hold(int* calls) {
  const char* fifo = getenv("HOLD_DLOPEN_FIFO");
  if (fifo) {
    pthread_mutex_unlock(&mutex);
    int fd = open(fifo, O_RDONLY);
    char byte;
    while (read(fd, &byte, 1) > 0) {}
    close(fd);
    pthread_mutex_lock(&mutex);
    return;
  }
  int others = atoi(getenv("HOLD_DLOPEN_CALLS"));
  struct timespec deadline;
  clock_gettime(CLOCK_REALTIME, &deadline);
  deadline.tv_nsec += 100000000;
  deadline.tv_sec += deadline.tv_nsec / 1000000000;
  deadline.tv_nsec %= 1000000000;
  while (*calls <= others && pthread_cond_timedwait(&returned, &mutex, &deadline) == 0) {}
  FILE* report = fopen(getenv("HOLD_DLOPEN_REPORT"), "a");
  fprintf(report, "%d\\n", *calls - 1);
  fclose(report);
}

void* dlopen(const char* file, int mode) {
  void* (*real_dlopen)(const char*, int) = (void* (*)(const char*, int))dlsym(RTLD_NEXT, "dlopen");
  const char* directory = getenv("HOLD_DLOPEN_IN");
  if (!file || !directory || strncmp(file, directory, strlen(directory)) != 0) return real_dlopen(file, mode);

  // The mutex makes the thread that loads the addon the first one to count its call.
  pthread_mutex_lock(&mutex);
  void* handle = real_dlopen(file, mode);
  int* calls = calls_of(file);
  if ((*calls)++ == 0) hold(calls);
  pthread_cond_broadcast(&returned);
  pthread_mutex_unlock(&mutex);
  return handle;
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
      "target_name": "registers_v8",
      "sources": [ "registers_v8.cpp" ],
      "defines": [ "REGISTRATIONS=${registrations}" ]
    },
    {
      "target_name": "registers_napi",
      "sources": [ "registers_napi.cpp" ],
      "defines": [ "REGISTRATIONS=${registrations}" ]
    },
    {
      "target_name": "registers_napi_once",
      "sources": [ "registers_napi.cpp" ],
      "defines": [ "REGISTRATIONS=1" ]
    },
    {
      "target_name": "by_symbol",
      "sources": [ "by_symbol.c" ]
    },
    {
      "target_name": "calls_js_in_constructor",
      "sources": [ "calls_js_in_constructor.cpp" ]
    }
  ],
  "conditions": [
    ["OS=='linux'", {
      "targets": [
        {
          "target_name": "hold_dlopen",
          "sources": [ "hold_dlopen.c" ]
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

    // Every Worker loads the addons at $ADDON_PATHS (a JSON array), one per round. The Workers start a round at the
    // same moment. Prints, for each round, how many loads had each result.
    const concurrentLoadFixture = `
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

function load(path) {
  const m = { exports: {} };
  try {
    process.dlopen(m, path);
  } catch (e) {
    return (e.code ?? e.name) + ": " + e.message.replace(path, "<addon>");
  }
  return m.exports.inits ?? "loaded";
}

if (!isMainThread) {
  const { round, paths } = workerData;
  let result = "ready";
  // The last turn loads nothing. It keeps the Worker alive until the main thread has every result, because a Worker
  // that ends gives up the non-context-aware addons that it owns.
  for (let i = 0; i <= paths.length; i++) {
    parentPort.postMessage(result);
    // Blocks until the main thread starts round i.
    Atomics.wait(round, 0, i);
    if (i < paths.length) result = load(paths[i]);
  }
} else {
  const paths = JSON.parse(process.env.ADDON_PATHS);
  const round = new Int32Array(new SharedArrayBuffer(4));
  const rounds = [];
  let results = {};
  let waiting = 0;
  for (let i = 0; i < ${concurrentWorkers}; i++) {
    const worker = new Worker(__filename, { workerData: { round, paths } });
    worker.on("error", error => {
      console.error(error);
      process.exit(1);
    });
    worker.on("message", result => {
      if (result !== "ready") results[result] = (results[result] ?? 0) + 1;
      if (++waiting < ${concurrentWorkers}) return;
      // Every Worker has reported its last load and waits for the next round.
      waiting = 0;
      if (Atomics.load(round, 0) > 0) rounds.push(results);
      results = {};
      if (Atomics.add(round, 0, 1) === paths.length) console.log(JSON.stringify(rounds));
      Atomics.notify(round, 0);
    });
  }
}
`;

    // A Worker loads the addon at $ADDON_PATH, and hold_dlopen.c keeps it inside process.dlopen until the FIFO at
    // $HOLD_DLOPEN_FIFO has been opened for writing and closed. Another Worker ends during that time.
    const workerEndsDuringLoadFixture = `
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const { closeSync, openSync } = require("node:fs");

if (isMainThread) {
  const events = [];
  const idle = new Worker(__filename);
  idle.once("message", () => {
    const loader = new Worker(__filename, { workerData: process.env.ADDON_PATH });
    loader.once("message", result => {
      events.push("the load ended: " + result);
      console.log(JSON.stringify(events));
    });
    // Opening a FIFO for writing waits for a reader, so the other Worker is inside process.dlopen when this returns.
    const fifo = openSync(process.env.HOLD_DLOPEN_FIFO, "w");
    idle.once("exit", () => {
      events.push("the other Worker ended");
      closeSync(fifo);
    });
    idle.postMessage("end");
  });
} else if (workerData) {
  const m = { exports: {} };
  process.dlopen(m, workerData);
  parentPort.postMessage(typeof m.exports.hello);
} else {
  parentPort.postMessage("ready");
  parentPort.once("message", () => {});
}
`;

    const dir = tempDirWithFiles("dlopen-duplicate-test", {
      "addon.cpp": addonSource,
      "non_context_aware.cpp": nonContextAwareSource,
      "registers_v8.cpp": registersV8Source,
      "registers_napi.cpp": registersNapiSource,
      "by_symbol.c": bySymbolSource,
      "calls_js_in_constructor.cpp": callsJsInConstructorSource,
      "hold_dlopen.c": holdDlopenSource,
      "worker-fixture.js": workerFixture,
      "concurrent-load-fixture.js": concurrentLoadFixture,
      "worker-ends-during-load-fixture.js": workerEndsDuringLoadFixture,
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
    registersV8Path = join(dir, "build", "Release", "registers_v8.node");
    registersNapiPath = join(dir, "build", "Release", "registers_napi.node");
    registersNapiOncePath = join(dir, "build", "Release", "registers_napi_once.node");
    bySymbolPath = join(dir, "build", "Release", "by_symbol.node");
    callsJsInConstructorPath = join(dir, "build", "Release", "calls_js_in_constructor.node");
    holdDlopenPath = join(dir, "build", "Release", "hold_dlopen.node");
    concurrentLoadFixturePath = join(dir, "concurrent-load-fixture.js");
    workerEndsDuringLoadFixturePath = join(dir, "worker-ends-during-load-fixture.js");
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

    // process.dlopen takes a lock to load the library. Every kind of init function can still load an addon.
    test.each([
      [
        "the init function of an addon that is already loaded",
        `process.dlopen({ exports: {} }, addon);
         const outer = { exports: {}, duringInit() { process.dlopen(inner, addonCopy); } };
         process.dlopen(outer, addon);`,
      ],
      [
        // Node.js holds its lock while it runs this kind of init function, and the nested call never returns there.
        "an init function that is found by its symbol",
        `const outer = { exports: { duringInit() { process.dlopen(inner, addonCopy); } } };
         process.dlopen(outer, bySymbol);`,
      ],
    ])("both modules get their exports when %s loads another addon", async (_, load) => {
      const testScript = `
      const addon = ${JSON.stringify(addonPath)};
      const addonCopy = ${JSON.stringify(addonCopyPath)};
      const bySymbol = ${JSON.stringify(bySymbolPath)};
      const inner = { exports: {} };
      ${load}
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

  // The two blocks below are not concurrent. A child of theirs can wait forever when its test fails, and the test
  // runner ends the child of a test that timed out only if the tests run one at a time.

  describe("process.dlopen nested in a static constructor", () => {
    // A static constructor runs inside dlopen(), where process.dlopen holds its lock. The load that it starts from
    // there must not wait for that lock. Node.js aborts on an assertion when a static constructor gets to process.dlopen.
    // On Windows a static constructor runs inside DllMain, which must not load a library.
    test.skipIf(isWindows)(
      "both modules get their exports when a static constructor calls JS that loads another addon",
      async () => {
        // The static constructor calls V8 functions, which need a handle scope. An init function has one open.
        const script = `
          const inner = { exports: {} };
          globalThis.duringConstructor = () => process.dlopen(inner, process.env.INNER);
          const outer = { exports: {} };
          const bySymbol = { exports: { duringInit: () => process.dlopen(outer, process.env.OUTER) } };
          process.dlopen(bySymbol, process.env.BY_SYMBOL);
          console.log(JSON.stringify({ outer: typeof outer.exports.hello, inner: typeof inner.exports.hello }));
        `;
        const env = { BY_SYMBOL: bySymbolPath, OUTER: callsJsInConstructorPath, INNER: addonCopyPath };
        expect(await runJsonFixture([bunExe(), "-e", script], env)).toEqual({ outer: "function", inner: "function" });
      },
    );
  });

  describe("process.dlopen of one addon by several threads at the same moment", () => {
    const everyWorker = (result: string | number) => ({ [result]: concurrentWorkers });
    const oneWorker = {
      loaded: 1,
      "ERR_DLOPEN_FAILED: Module did not self-register: '<addon>'.": concurrentWorkers - 1,
    };

    // Every round loads a copy of an addon, which is a library that no thread has loaded yet. `held` preloads
    // hold_dlopen.c, and the result then has what it reported: a line for each round.
    async function loadInWorkers(exe: string, addons: string[], held = false) {
      using copies = tempDir("dlopen-concurrent-test", {});
      const directory = String(copies);
      const paths = addons.map((_, round) => join(directory, `${round}.node`));
      addons.forEach((addon, round) => copyFileSync(addon, paths[round]));
      const env: Record<string, string> = { ADDON_PATHS: JSON.stringify(paths) };
      if (held) {
        env.LD_PRELOAD = bunEnv.LD_PRELOAD ? `${holdDlopenPath}:${bunEnv.LD_PRELOAD}` : holdDlopenPath;
        env.HOLD_DLOPEN_IN = directory;
        env.HOLD_DLOPEN_CALLS = String(concurrentWorkers - 1);
        env.HOLD_DLOPEN_REPORT = join(directory, "report");
      }
      const rounds = await runJsonFixture([exe, concurrentLoadFixturePath], env);
      return held ? { rounds, returnedWhileHeld: readFileSync(env.HOLD_DLOPEN_REPORT, "utf8") } : { rounds };
    }

    test.each([
      { name: "every Worker loads a context-aware V8 addon", path: () => addonPath, round: everyWorker("loaded") },
      {
        name: "every Worker loads a Node-API addon that registers itself",
        path: () => registersNapiOncePath,
        round: everyWorker(1),
      },
      {
        name: "one Worker of a round loads a non-context-aware addon",
        path: () => nonContextAwarePath,
        round: oneWorker,
      },
    ])("$name, as in Node.js", async ({ path, round }) => {
      const addons = Array(20).fill(path());
      const bun = await loadInWorkers(bunExe(), addons);
      expect(bun).toEqual({ rounds: addons.map(() => round) });
      expect(await loadInWorkers(await nodeExeMatchingAbi(), addons)).toEqual(bun);
    });

    // Node.js runs one registration of a library, so these two have no Node.js run.
    test.each([
      { api: "V8", path: () => registersV8Path },
      { api: "Node-API", path: () => registersNapiPath },
    ])("every Worker runs all of the $api modules that an addon registers", async ({ path }) => {
      const addons = Array(5).fill(path());
      expect(await loadInWorkers(bunExe(), addons)).toEqual({ rounds: addons.map(() => everyWorker(registrations)) });
    });

    // The two tests below preload hold_dlopen.c, which wraps the dlopen() of the C library.

    // No other dlopen() call of an addon returns while hold_dlopen.c holds the first one.
    test.skipIf(!isLinux)("no Worker gets a library before the first one has saved what it registered", async () => {
      const addons = [addonPath, registersNapiOncePath, registersV8Path, registersNapiPath, nonContextAwarePath];
      expect(await loadInWorkers(bunExe(), addons, true)).toEqual({
        rounds: [
          everyWorker("loaded"),
          everyWorker(1),
          everyWorker(registrations),
          everyWorker(registrations),
          oneWorker,
        ],
        returnedWhileHeld: "0\n0\n0\n0\n0\n",
      });
    });

    // process.dlopen holds its lock while hold_dlopen.c holds the load. The end of a Worker must not wait for it.
    test.skipIf(!isLinux)("a Worker ends while another thread is inside process.dlopen", async () => {
      using held = tempDir("dlopen-held-test", {});
      const addon = join(String(held), "addon.node");
      copyFileSync(addonPath, addon);
      const fifo = join(String(held), "fifo");
      mkfifo(fifo);
      const events = await runJsonFixture([bunExe(), workerEndsDuringLoadFixturePath], {
        ADDON_PATH: addon,
        LD_PRELOAD: bunEnv.LD_PRELOAD ? `${holdDlopenPath}:${bunEnv.LD_PRELOAD}` : holdDlopenPath,
        HOLD_DLOPEN_IN: String(held),
        HOLD_DLOPEN_FIFO: fifo,
      });
      expect(events).toEqual(["the other Worker ended", "the load ended: function"]);
    });
  });
});
