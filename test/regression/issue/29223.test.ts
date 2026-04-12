// Regression test for https://github.com/oven-sh/bun/issues/29223
//
// Issue: `ffi-napi`'s NAPI addon calls `uv_thread_self()` from inside its
// module-init path. `uv_thread_self` was a stubbed libuv symbol on POSIX,
// so Bun would panic with "unsupported uv function: uv_thread_self" and
// the addon (and therefore the user's program) crashed before a single
// FFI call was made.
//
// Fix: implement `uv_thread_self` on POSIX as a pthread_self() wrapper
// (matches upstream libuv src/unix/thread.c).
//
// This regression test builds a minimal NAPI addon that calls
// `uv_thread_self()` from its Init function — the exact shape of the
// ffi-napi crash — and asserts that requiring it does not crash.
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, makeTree, tempDirWithFiles } from "harness";
import path from "node:path";

// Windows uses real libuv; the POSIX-stub code path does not apply there.
describe.if(!isWindows)("issue #29223", () => {
  let tempdir: string = "";

  // Build the addon once in beforeAll (same pattern as test/napi/uv.test.ts).
  beforeAll(async () => {
    const addonSource = `
#include <node_api.h>
#include <pthread.h>
#include <uv.h>

napi_value Init(napi_env env, napi_value exports) {
  // This is what ffi-napi does: call uv_thread_self() while the NAPI
  // module is being constructed. Before the fix this panicked Bun.
  uv_thread_t self = uv_thread_self();

  // Also check that calling it twice from the same thread agrees with
  // pthread_self() — proves we actually implemented it rather than
  // returning a garbage value.
  uv_thread_t again = uv_thread_self();
  int equal = pthread_equal(self, again) != 0 && pthread_equal(self, pthread_self()) != 0;

  napi_value equal_js;
  napi_get_boolean(env, equal, &equal_js);
  napi_set_named_property(env, exports, "equal", equal_js);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
`;

    const files = {
      "addon.c": addonSource,
      "package.json": JSON.stringify({
        name: "issue-29223-addon",
        version: "0.0.0",
        private: true,
        scripts: { "build:napi": "node-gyp configure && node-gyp build" },
        dependencies: { "node-gyp": "10.2.0" },
      }),
      "binding.gyp": `{
  "targets": [
    {
      "target_name": "addon",
      "sources": [ "addon.c" ],
      "include_dirs": [ ".", "./libuv" ],
      "cflags": ["-fPIC"],
      "ldflags": ["-Wl,--export-dynamic"]
    }
  ]
}`,
      "index.js": `const addon = require("./build/Release/addon.node");
if (addon.equal !== true) {
  console.error("FAIL: uv_thread_self returned inconsistent results");
  process.exit(2);
}
console.log("OK");
`,
    };

    tempdir = tempDirWithFiles("issue-29223", files);
    await makeTree(tempdir, files);

    // node-gyp uses the libuv headers we vendor for the stubs.
    const libuvDir = path.join(import.meta.dir, "../../../src/bun.js/bindings/libuv");
    await Bun.$`cp -R ${libuvDir} ${path.join(tempdir, "libuv")}`.env(bunEnv);
    await Bun.$`${bunExe()} install && ${bunExe()} run build:napi`.env(bunEnv).cwd(tempdir);
  });

  test("NAPI addon calling uv_thread_self during Init does not crash", () => {
    // spawnSync because the baseline (pre-fix) crashes via panic + abort;
    // spawn + proc.exited can hang on such aborts under the test runner.
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: tempdir,
      stderr: "pipe",
      stdout: "pipe",
    });

    // The addon prints "OK" from index.js only if require() succeeded and
    // uv_thread_self() returned a thread id consistent with pthread_self().
    // Pre-fix, require() panics the process and stdout stays empty.
    expect(stdout.toString().trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });
});
