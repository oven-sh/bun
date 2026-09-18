import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

// These tests share one node-gyp-built V8 addon (the compile dominates the wall
// time), covering four previously-broken paths:
// - duplicate loads: the second dlopen of the same module used to fail with
//   "symbol 'napi_register_module_v1' not found" because static constructors
//   only run once, so the module registration wasn't replayed
// - non-object exports: null/undefined/primitive exports used to segfault
// - nested calls: a dlopen made while the filename converts to a string, or
//   from an init function, used to take the registration of the outer call
// - static constructor order: the init function used to run inside dlopen(),
//   before the static constructors that follow the module registration

describe.skipIf(!canBuildNodeAddons())("process.dlopen native addon", () => {
  let addonPath: string;
  // The same addon at a second path. The loader treats it as another library.
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

// Set by the constructor of late_static, which is defined after the module registration.
static bool late_static_constructed = false;

void Hello(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  args.GetReturnValue().Set(String::NewFromUtf8(isolate, "world").ToLocalChecked());
}

static Local<Value> GetOption(Isolate* isolate, Local<Context> context, Local<Value> module, const char* name) {
  return module.As<Object>()->Get(context, String::NewFromUtf8(isolate, name).ToLocalChecked()).ToLocalChecked();
}

// The tests steer the init function with properties of the module object:
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

// The registration above runs from a static constructor. This one runs after it, like re2's addonDataMap.
struct LateStatic {
  LateStatic() { late_static_constructed = true; }
};
static LateStatic late_static;

}  // namespace demo
`;

    const bindingGyp = `
{
  "targets": [
    {
      "target_name": "addon",
      "sources": [ "addon.cpp" ]
    }
  ]
}
`;

    const dir = tempDirWithFiles("dlopen-duplicate-test", {
      "addon.cpp": addonSource,
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

    // Build the addon
    const build = spawnSync({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    if (!build.success) {
      throw new Error("Failed to build native addon");
    }

    addonPath = join(dir, "build", "Release", "addon.node");
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
    // https://github.com/oven-sh/bun/issues/20454
    test("runs after every static constructor of the addon", async () => {
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

    // The exception check validator of a debug build aborts if the throw is not checked on the way out.
    test("an exception thrown by it reaches the caller", async () => {
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

    // The crash handler records which addon is loading only on POSIX.
    describe.skipIf(isWindows)("a crash in it names the addon whose init function crashed", () => {
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
          // A debug build symbolizes the whole stack before it exits.
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
});
