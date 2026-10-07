import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, canBuildNodeAddons, tempDirWithFiles } from "harness";
import { join } from "path";

// These tests share one node-gyp-built V8 addon (the compile dominates the wall
// time), covering two previously-broken paths:
// - duplicate loads: the second dlopen of the same module used to fail with
//   "symbol 'napi_register_module_v1' not found" because static constructors
//   only run once, so the module registration wasn't replayed
// - non-object exports: null/undefined/primitive exports used to segfault

describe.skipIf(!canBuildNodeAddons())("process.dlopen native addon", () => {
  let addonPath: string;

  beforeAll(() => {
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
});
