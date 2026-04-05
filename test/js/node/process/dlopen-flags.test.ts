import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

describe("process.dlopen flags argument", () => {
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

    const dir = tempDirWithFiles("dlopen-flags-test", {
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

  test("should work without flags argument (default RTLD_LAZY)", async () => {
    const testScript = `
      const m = { exports: {} };
      process.dlopen(m, "${addonPath.replace(/\\/g, "\\\\")}");
      console.log("result:", m.exports.hello());
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", testScript],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("result: world");
    expect(exitCode).toBe(0);
  });

  test("should accept explicit RTLD_LAZY flag", async () => {
    const testScript = `
      const os = require('os');
      const m = { exports: {} };
      process.dlopen(m, "${addonPath.replace(/\\/g, "\\\\")}", os.constants.dlopen.RTLD_LAZY);
      console.log("result:", m.exports.hello());
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", testScript],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("result: world");
    expect(exitCode).toBe(0);
  });

  test("should accept RTLD_NOW flag", async () => {
    const testScript = `
      const os = require('os');
      const m = { exports: {} };
      process.dlopen(m, "${addonPath.replace(/\\/g, "\\\\")}", os.constants.dlopen.RTLD_NOW);
      console.log("result:", m.exports.hello());
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", testScript],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("result: world");
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("should accept RTLD_LAZY | RTLD_GLOBAL flags", async () => {
    const testScript = `
      const os = require('os');
      const m = { exports: {} };
      const flags = os.constants.dlopen.RTLD_LAZY | os.constants.dlopen.RTLD_GLOBAL;
      process.dlopen(m, "${addonPath.replace(/\\/g, "\\\\")}", flags);
      console.log("result:", m.exports.hello());
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", testScript],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("result: world");
    expect(exitCode).toBe(0);
  });

  test("should throw TypeError for non-integer flags", async () => {
    const testScript = `
      const m = { exports: {} };
      try {
        process.dlopen(m, "${addonPath.replace(/\\/g, "\\\\")}", "not-an-integer");
        console.log("ERROR: should have thrown");
      } catch (e) {
        console.log("caught:", e.name);
        console.log("message:", e.message);
      }
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", testScript],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("caught: TypeError");
    expect(exitCode).toBe(0);
  });

  test("should accept undefined as flags (treat as default)", async () => {
    const testScript = `
      const m = { exports: {} };
      process.dlopen(m, "${addonPath.replace(/\\/g, "\\\\")}", undefined);
      console.log("result:", m.exports.hello());
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", testScript],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("result: world");
    expect(exitCode).toBe(0);
  });
});
