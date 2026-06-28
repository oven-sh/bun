import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { join } from "path";

// Path to the in-repo copies of node_api.h / js_native_api.h.
const napiHeaderDir = join(import.meta.dir, "..", "..", "src", "runtime", "napi");

// A plain C compiler is enough: the addons below only need the N-API C ABI.
const cc = Bun.which("cc") ?? Bun.which("clang") ?? Bun.which("gcc");

// The canonical two-call Init that every N-API template emits. Addon C code cannot
// satisfy JSC's exception-check discipline between the two napi_* calls; on an
// assert-enabled build with the validator on, getting that wrong aborts at module load.
const twoCallInitSource = /* c */ `
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

// A class with a getter+setter property creates two NapiClass objects back to back
// inside Napi::defineProperty, which is a second place the exception-check discipline
// has to be satisfied (this is the shape every node-addon-api ObjectWrap accessor has).
const accessorClassSource = /* c */ `
#include <node_api.h>
#include <stddef.h>

static napi_value Ctor(napi_env env, napi_callback_info info) {
  napi_value this_arg;
  napi_get_cb_info(env, info, NULL, NULL, &this_arg, NULL);
  return this_arg;
}

static napi_value Getter(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_int32(env, 42, &result);
  return result;
}

static napi_value Setter(napi_env env, napi_callback_info info) {
  return NULL;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor prop = {"value", NULL, NULL, Getter, Setter, NULL, napi_default, NULL};
  napi_value cls;
  napi_define_class(env, "Thing", NAPI_AUTO_LENGTH, Ctor, NULL, 1, &prop, &cls);
  napi_set_named_property(env, exports, "Thing", cls);
  return exports;
}
`;

async function loadAddonWithValidator(name: string, addonSource: string, loadJs: string, expectedStdout: string) {
  using dir = tempDir(name, { "addon.c": addonSource, "load.js": loadJs });

  const compile = Bun.spawnSync({
    cmd: [
      cc!,
      "-shared",
      "-fPIC",
      // The napi_* symbols are resolved from the host process at dlopen time.
      // Linux ld allows undefined symbols in shared objects by default; macOS
      // ld64 errors on them unless told to defer, which is what node-gyp does.
      ...(isMacOS ? ["-undefined", "dynamic_lookup"] : []),
      `-I${napiHeaderDir}`,
      "-o",
      "addon.node",
      "addon.c",
    ],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  // Don't require an empty stderr: ld64 may warn about dynamic_lookup.
  expect({ exitCode: compile.exitCode, stderr: compile.stderr.toString() }).toMatchObject({ exitCode: 0 });

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
  expect({ stdout, stderr, exitCode }).toMatchObject({ stdout: expectedStdout, exitCode: 0 });
  expect(stderr).not.toContain("Unchecked JS exception");
}

test.concurrent.skipIf(isWindows || !cc)("N-API module Init runs under BUN_JSC_validateExceptionChecks", async () => {
  await loadAddonWithValidator(
    "napi-exception-check",
    twoCallInitSource,
    `const addon = require("./addon.node");\nconsole.log("loaded", addon.hello());\n`,
    "loaded 42\n",
  );
});

test.concurrent.skipIf(isWindows || !cc)(
  "napi_define_class accessors run under BUN_JSC_validateExceptionChecks",
  async () => {
    await loadAddonWithValidator(
      "napi-exception-check-class",
      accessorClassSource,
      `const { Thing } = require("./addon.node");\nconsole.log("value", new Thing().value);\n`,
      "value 42\n",
    );
  },
);
