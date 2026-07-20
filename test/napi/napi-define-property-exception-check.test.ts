import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { join } from "path";

// In-repo N-API headers (node_api.h / js_native_api.h) so we don't depend on node-gyp.
const napiHeaderDir = join(import.meta.dir, "..", "..", "src", "runtime", "napi");

const cc = Bun.which("cc") ?? Bun.which("clang") ?? Bun.which("gcc");

// napi_define_class with method/getter/setter/accessor properties. Each of these descriptor
// kinds makes Napi::defineProperty call NapiClass::create (which opens and closes its own
// ThrowScope) immediately before defineOwnProperty. The validator requires the exception
// state to be observed between those two calls.
const defineClassSource = /* c */ `
#include <node_api.h>
#include <stddef.h>

static napi_value Noop(napi_env env, napi_callback_info info) { return NULL; }

NAPI_MODULE_INIT() {
  napi_property_descriptor props[] = {
    {"m", NULL, Noop, NULL, NULL, NULL, napi_default, NULL},
    {"g", NULL, NULL, Noop, NULL, NULL, napi_default, NULL},
    {"s", NULL, NULL, NULL, Noop, NULL, napi_default, NULL},
    {"a", NULL, NULL, Noop, Noop, NULL, napi_default, NULL},
  };
  napi_value cls;
  napi_define_class(env, "Thing", NAPI_AUTO_LENGTH, Noop, NULL, 4, props, &cls);
  return cls;
}
`;

// Same property descriptor shapes via napi_define_properties (the other Napi::defineProperty caller).
const definePropertiesSource = /* c */ `
#include <node_api.h>
#include <stddef.h>

static napi_value Noop(napi_env env, napi_callback_info info) { return NULL; }

NAPI_MODULE_INIT() {
  napi_property_descriptor props[] = {
    {"m", NULL, Noop, NULL, NULL, NULL, napi_default, NULL},
    {"g", NULL, NULL, Noop, NULL, NULL, napi_default, NULL},
    {"s", NULL, NULL, NULL, Noop, NULL, napi_default, NULL},
    {"a", NULL, NULL, Noop, Noop, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, 4, props);
  return exports;
}
`;

async function loadAddonWithValidator(tag: string, addonSource: string, loadJs: string, expectedStdout: string) {
  using dir = tempDir(tag, { "addon.c": addonSource, "load.js": loadJs });

  await using compile = Bun.spawn({
    cmd: [
      cc!,
      "-shared",
      "-fPIC",
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
  const [compileStderr, compileExit] = await Promise.all([compile.stderr.text(), compile.exited]);
  expect({ exitCode: compileExit, stderr: compileStderr }).toMatchObject({ exitCode: 0 });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "load.js"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Keep stderr in the received object so the abort report shows up in the failure diff,
  // but don't assert it exactly (debug builds emit unrelated noise).
  expect({ stdout, stderr, exitCode }).toMatchObject({ stdout: expectedStdout, exitCode: 0 });
}

test.concurrent.skipIf(isWindows || !cc)(
  "napi_define_class with method/getter/setter runs under BUN_JSC_validateExceptionChecks",
  async () => {
    await loadAddonWithValidator(
      "napi-define-class-exception-check",
      defineClassSource,
      `const Thing = require("./addon.node");\nconsole.log("loaded", typeof Thing, Thing.name);\n`,
      "loaded function Thing\n",
    );
  },
);

test.concurrent.skipIf(isWindows || !cc)(
  "napi_define_properties with method/getter/setter runs under BUN_JSC_validateExceptionChecks",
  async () => {
    await loadAddonWithValidator(
      "napi-define-properties-exception-check",
      definePropertiesSource,
      `const m = require("./addon.node");\nconsole.log("loaded", Object.getOwnPropertyNames(m).sort().join(","));\n`,
      "loaded a,exports,g,m,s\n",
    );
  },
);
