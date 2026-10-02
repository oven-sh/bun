import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { join } from "path";

// Path to the in-repo copies of node_api.h / js_native_api.h.
const napiHeaderDir = join(import.meta.dir, "..", "..", "src", "runtime", "napi");

// A plain C compiler is enough: the addon below only needs the N-API C ABI.
const cc = Bun.which("cc") ?? Bun.which("clang") ?? Bun.which("gcc");

// Returns a value other than `exports`, so dlopen writes it to module.exports via
// JSObject::put, which must be exception-checked. Exports napi_register_module_v1
// directly (no NAPI_MODULE ctor) so dlopen takes the dlsym path, not self-registration.
const replaceExportsSource = /* c */ `
#include <node_api.h>

static napi_value Method(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_int32(env, 42, &result);
  return result;
}

NAPI_MODULE_EXPORT napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "exports", NAPI_AUTO_LENGTH, Method, NULL, &fn);
  return fn;
}
`;

test.skipIf(isWindows || !cc)(
  "process.dlopen writes a replaced exports value under BUN_JSC_validateExceptionChecks",
  async () => {
    using dir = tempDir("dlopen-replace-exports", {
      "addon.c": replaceExportsSource,
      "load.js": `const addon = require("./addon.node");\nconsole.log("loaded", addon());\n`,
    });

    await using compile = Bun.spawn({
      cmd: [
        cc!,
        "-shared",
        "-fPIC",
        // The napi_* symbols are resolved from the host process at dlopen time.
        ...(isMacOS ? ["-undefined", "dynamic_lookup"] : []),
        `-I${napiHeaderDir}`,
        "-o",
        "addon.node",
        "addon.c",
      ],
      cwd: String(dir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [compileStderr, compileExitCode] = await Promise.all([compile.stderr.text(), compile.exited]);
    expect({ exitCode: compileExitCode, stderr: compileStderr }).toMatchObject({ exitCode: 0 });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "load.js"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr is in the received object so the abort report shows up in the
    // failure diff, but its contents are not asserted (debug builds write noise).
    expect({ stdout, stderr, exitCode }).toMatchObject({ stdout: "loaded 42\n", exitCode: 0 });
  },
);
