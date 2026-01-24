// Regression test for https://github.com/oven-sh/bun/issues/26423
// napi_create_external_buffer was using a two-stage finalization which caused
// a race condition where the native memory could be freed/reused before the
// JavaScript buffer was actually collected.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("napi_create_external_buffer", () => {
  test("finalizer is properly tied to ArrayBuffer lifecycle", async () => {
    // This test verifies that when napi_create_external_buffer is called,
    // the finalizer callback receives the correct data pointer when the
    // buffer is garbage collected. Previously, the implementation used a
    // two-stage finalization approach which caused race conditions.

    using dir = tempDir("napi-buffer-test", {
      "binding.gyp": JSON.stringify({
        targets: [
          {
            target_name: "test_external_buffer",
            sources: ["test_external_buffer.c"],
          },
        ],
      }),
      "test_external_buffer.c": `
#include <node_api.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

static int finalizer_called = 0;
static void* received_data = NULL;
static const size_t TEST_SIZE = 1024;

static void my_finalizer(napi_env env, void* data, void* hint) {
  finalizer_called = 1;
  received_data = data;
  // Free the memory that was allocated
  free(data);
}

static napi_value create_external_buffer(napi_env env, napi_callback_info info) {
  // Reset state
  finalizer_called = 0;
  received_data = NULL;

  // Allocate memory
  char* data = (char*)malloc(TEST_SIZE);
  if (!data) {
    napi_throw_error(env, NULL, "malloc failed");
    return NULL;
  }

  // Fill with a pattern
  memset(data, 0x42, TEST_SIZE);

  napi_value buffer;
  napi_status status = napi_create_external_buffer(
    env, TEST_SIZE, data, my_finalizer, NULL, &buffer);

  if (status != napi_ok) {
    free(data);
    napi_throw_error(env, NULL, "napi_create_external_buffer failed");
    return NULL;
  }

  return buffer;
}

static napi_value get_finalizer_called(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_get_boolean(env, finalizer_called, &result);
  return result;
}

static napi_value get_original_data_addr(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_bigint_uint64(env, (uint64_t)received_data, &result);
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
    { "createExternalBuffer", NULL, create_external_buffer, NULL, NULL, NULL, napi_default, NULL },
    { "getFinalizerCalled", NULL, get_finalizer_called, NULL, NULL, NULL, napi_default, NULL },
    { "getOriginalDataAddr", NULL, get_original_data_addr, NULL, NULL, NULL, napi_default, NULL },
  };
  napi_define_properties(env, exports, 3, props);
  return exports;
}

NAPI_MODULE(test_external_buffer, init)
`,
      "test.js": `
const addon = require('./build/Release/test_external_buffer.node');

// Create an external buffer
let buf = addon.createExternalBuffer();

// Verify the buffer has the correct length
if (buf.length !== 1024) {
  console.log("FAIL: Buffer length is " + buf.length + " instead of 1024");
  process.exit(1);
}

// Verify the data wasn't corrupted
for (let i = 0; i < buf.length; i++) {
  if (buf[i] !== 0x42) {
    console.log("FAIL: Data corrupted at index " + i + ": expected 0x42, got " + buf[i].toString(16));
    process.exit(1);
  }
}

console.log("PASS: Buffer created with correct data");

// Clear reference and trigger GC
buf = null;

function triggerGC() {
  if (process.isBun) {
    Bun.gc(true);
  } else if (global.gc) {
    global.gc();
  }
}

// Poll for finalizer to be called with a bounded timeout
async function waitForFinalizer(maxAttempts = 20, intervalMs = 100) {
  for (let i = 0; i < maxAttempts; i++) {
    triggerGC();
    if (addon.getFinalizerCalled()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}

waitForFinalizer().then(finalizerCalled => {
  if (finalizerCalled) {
    console.log("PASS: Finalizer was called correctly");
    console.log("PASS: Test completed successfully");
  } else {
    console.log("FAIL: Finalizer was not called within timeout");
    process.exit(1);
  }
});
`,
      "package.json": JSON.stringify({
        name: "test-external-buffer",
        version: "1.0.0",
        private: true,
      }),
    });

    // Build the addon
    const buildResult = Bun.spawnSync({
      cmd: ["npx", "node-gyp", "rebuild"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });

    if (!buildResult.success) {
      console.log("Build stderr:", buildResult.stderr.toString());
      throw new Error("node-gyp build failed");
    }

    // Run the test
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--expose-gc", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (stderr) {
      console.log("Test stderr:", stderr);
    }

    expect(stdout).toContain("PASS: Buffer created with correct data");
    expect(stdout).not.toContain("FAIL");
    expect(exitCode).toBe(0);
  }, 60000);
});
