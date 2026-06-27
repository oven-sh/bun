import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// Path to the in-repo copies of node_api.h / js_native_api.h.
const napiHeaderDir = join(import.meta.dir, "..", "..", "src", "runtime", "napi");

// A plain C compiler is enough: the addon below only needs the N-API C ABI.
const cc = Bun.which("cc") ?? Bun.which("clang") ?? Bun.which("gcc");

// The canonical two-line module Init that every N-API tutorial and the
// node-addon-api template emit. Each napi_* call opens a JSC exception scope;
// the scope opened by napi_create_function must not require the addon's C code
// (which cannot participate in JSC's exception-check discipline) to have
// "checked" it before napi_set_named_property opens the next one. Under
// BUN_JSC_validateExceptionChecks=1 on an assert-enabled build, getting this
// wrong aborts the process at module load with "ERROR: Unchecked JS exception".
const addonSource = /* c */ `
#include <node_api.h>

static napi_value Method(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_int32(env, 42, &result);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, NULL, 0, Method, NULL, &fn);
  napi_set_named_property(env, exports, "hello", fn);
  return exports;
}
`;

test.skipIf(isWindows || !cc)(
  "N-API module Init runs under BUN_JSC_validateExceptionChecks",
  async () => {
    using dir = tempDir("napi-exception-check", {
      "addon.c": addonSource,
      "load.js": `const addon = require("./addon.node");\nconsole.log("loaded", addon.hello());\n`,
    });

    const compile = Bun.spawnSync({
      cmd: [cc!, "-shared", "-fPIC", `-I${napiHeaderDir}`, "-o", "addon.node", "addon.c"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(compile.stderr.toString()).toBe("");
    expect(compile.exitCode).toBe(0);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "load.js"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect({ stdout, exitCode }).toEqual({ stdout: "loaded 42\n", exitCode: 0 });
    expect(stderr).not.toContain("Unchecked JS exception");
  },
);
