import { spawnSync } from "bun";
import { beforeAll, describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { copyFileSync, existsSync, linkSync, realpathSync } from "node:fs";
import { basename, join } from "path";

// This test verifies that Bun can load the same native module multiple times
// Previously, the second load would fail with "symbol 'napi_register_module_v1' not found"
// because static constructors only run once, so the module registration wasn't replayed

describe("process.dlopen duplicate loads", () => {
  jest.setTimeout(60_000);
  const externalNodeExe = isWindows ? Bun.which("node") : null;
  let duplicateLoadAddon: string | undefined;
  function buildAddon(
    prefix: string,
    files: Record<string, string>,
    sources: string[],
    options: Record<string, string> = {},
  ) {
    const dir = tempDirWithFiles(prefix, {
      ...files,
      "binding.gyp": `
{
  "targets": [
    {
      "target_name": "addon",
      "sources": ${JSON.stringify(sources)},
      ${Object.entries(options)
        .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
        .join(",\n      ")}
    }
  ]
}
`,
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

    return {
      dir,
      addonPath: join(dir, "build", "Release", "addon.node"),
    };
  }

  test.skipIf(!isWindows || !externalNodeExe || basename(externalNodeExe!).toLowerCase() === "bun.exe")("should not bind node.exe imports to an external Node.js process", () => {
    const addonSource = `
#include <node_api.h>

static napi_value Hello(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_string_utf8(env, "world", NAPI_AUTO_LENGTH, &result);
  return result;
}

static napi_value Initialize(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "hello", NAPI_AUTO_LENGTH, Hello, 0, &fn);
  napi_set_named_property(env, exports, "hello", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
`;
    const { dir, addonPath } = buildAddon("dlopen-node-import-test", { "addon.c": addonSource }, ["addon.c"], {
      "win_delay_load_hook": "false",
    });

    expect(basename(externalNodeExe!).toLowerCase()).toBe("node.exe");
    expect(realpathSync(externalNodeExe!).toLowerCase()).not.toBe(realpathSync(bunExe()).toLowerCase());
    copyFileSync(externalNodeExe!, join(dir, "node.exe"));
    expect(existsSync(join(dir, "node.exe"))).toBe(true);
    const testScript = `
      const addon = require(${JSON.stringify(addonPath)});
      console.log("hello:", addon.hello());
    `;

    const proc = spawnSync({
      cmd: [bunExe(), "-e", testScript],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });

    expect(proc.stderr.toString()).toBe("");
    expect(proc.stdout.toString()).toBe("hello: world\n");
    expect(proc.exitCode).toBe(0);
  });

  test.skipIf(!isWindows)("should not remove an existing node.exe next to the addon", () => {
    const addonSource = `
#include <node_api.h>

static napi_value Initialize(napi_env env, napi_value exports) {
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
`;
    const { dir, addonPath } = buildAddon("dlopen-existing-node-test", { "addon.c": addonSource }, ["addon.c"], {
      "win_delay_load_hook": "false",
    });

    const existingNode = join(dir, "build", "Release", "node.exe");
    linkSync(bunExe(), existingNode);
    expect(existsSync(existingNode)).toBe(true);

    const proc = spawnSync({
      cmd: [bunExe(), "-e", `require(${JSON.stringify(addonPath)});`],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });

    expect(proc.stderr.toString()).toBe("");
    expect(existsSync(existingNode)).toBe(true);
    expect(proc.exitCode).toBe(0);
  });

  function duplicateLoadAddonPath() {
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

    return buildAddon("dlopen-duplicate-test", { "addon.cpp": addonSource }, ["addon.cpp"]).addonPath;
  }

  function getDuplicateLoadAddon() {
    return (duplicateLoadAddon ??= duplicateLoadAddonPath());
  }

  test.skipIf(!isWindows)("should load the same module twice successfully", { timeout: 60_000 }, async () => {
    const addonPath = getDuplicateLoadAddon();
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

  test.skipIf(!isWindows)("should load module with different exports objects", { timeout: 60_000 }, async () => {
    const addonPath = getDuplicateLoadAddon();
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
