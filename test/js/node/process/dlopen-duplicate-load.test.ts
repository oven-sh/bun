import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// This test verifies that Bun can load the same native module multiple times
// Previously, the second load would fail with "symbol 'napi_register_module_v1' not found"
// because static constructors only run once, so the module registration wasn't replayed

describe("process.dlopen duplicate loads", () => {
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
          install: "node-gyp rebuild",
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
  });

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

    expect(stdout).toContain("m1.exports.hello: world");
    expect(stdout).toContain("m2.exports.initial: true");
    expect(stdout).toContain("m2.exports.hello: world");
    expect(exitCode).toBe(0);
  });
});
