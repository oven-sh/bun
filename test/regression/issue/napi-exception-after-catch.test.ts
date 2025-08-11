import { test, expect } from "bun:test";
import { bunExe } from "harness";
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

test("NAPI exception after catch should not cause assertion failure", async () => {
  // Create a temporary directory for our test
  const testDir = join(tmpdir(), "napi-exception-after-catch-test");
  mkdirSync(testDir, { recursive: true });

  // Create package.json
  writeFileSync(join(testDir, "package.json"), JSON.stringify({
    name: "napi-exception-after-catch-test",
    version: "1.0.0",
    gypfile: true
  }));

  // Create C++ source file
  const cppSource = `
#include <napi.h>

Napi::Value ThrowAfterCatch(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    try {
        Napi::Error::New(env, "First throw").ThrowAsJavaScriptException();
    } catch (...) {
        // Caught the first exception in C++
    }
    
    // This second throw causes assertion failure in Bun
    Napi::Error::New(env, "Second throw").ThrowAsJavaScriptException();
    
    return env.Null();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "throwAfterCatch"), 
                Napi::Function::New(env, ThrowAfterCatch));
    return exports;
}

NODE_API_MODULE(test_module, Init)
`;

  writeFileSync(join(testDir, "test.cpp"), cppSource);

  // Create binding.gyp
  const bindingGyp = `
{
  "targets": [
    {
      "target_name": "test_module",
      "sources": ["test.cpp"],
      "include_dirs": ["<!@(node -p \\"require('node-addon-api').include\\")"],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ]
    }
  ]
}
`;

  writeFileSync(join(testDir, "binding.gyp"), bindingGyp);

  // Create test JavaScript file
  const jsTest = `
const testModule = require('./build/Release/test_module.node');

try {
    testModule.throwAfterCatch();
    console.log("ERROR: Expected exception to be thrown");
    process.exit(1);
} catch (e) {
    console.log("SUCCESS: Caught exception:", e.message);
    process.exit(0);
}
`;

  writeFileSync(join(testDir, "test.js"), jsTest);

  // Install node-addon-api and build the module
  await using proc1 = Bun.spawn({
    cmd: ["npm", "install", "node-addon-api"],
    cwd: testDir,
  });
  await proc1.exited;

  await using proc2 = Bun.spawn({
    cmd: ["node-gyp", "configure", "build"],
    cwd: testDir,
  });
  await proc2.exited;

  // Test with Bun - this should not crash
  await using proc3 = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe"
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc3.stdout.text(),
    proc3.stderr.text(),
    proc3.exited
  ]);

  // The bug causes an assertion failure (abort), so we expect exit code 134 or similar
  // When the bug is fixed, we expect exit code 0 and "SUCCESS" message
  console.log("stdout:", stdout);
  console.log("stderr:", stderr);
  console.log("exitCode:", exitCode);

  // For now, we expect this to fail with assertion error until the bug is fixed
  // When this test starts passing, the bug has been fixed!
  expect(exitCode).toBe(0); // This will fail until the bug is fixed
  expect(stdout).toContain("SUCCESS: Caught exception: Second throw");
}, 30000);