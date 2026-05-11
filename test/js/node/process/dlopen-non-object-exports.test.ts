import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// This test verifies that Bun properly handles non-object exports when loading native modules
// Previously, this would cause a segfault when exports was null, undefined, or a primitive

describe("process.dlopen with non-object exports", () => {
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

    const dir = tempDirWithFiles("dlopen-non-object-exports", {
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
    expect(stdout).toContain("Type: string");
    expect(stdout).toContain("Value: primitive");
    expect(exitCode).toBe(0);
  });
});
