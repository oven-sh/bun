import { spawnSync } from "bun";
import { cc, dlopen } from "bun:ffi";
import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons, isWindows, tempDir } from "harness";
import { join, resolve } from "path";

import source from "./napi-app/ffi_addon_1.c" with { type: "file" };

// The napi-app fixture needs a toolchain that can compile the reported
// Node headers.
const isFFIUnavailable = !canBuildNodeAddons();

const symbols = {
  set_instance_data: {
    args: ["napi_env", "int"],
    returns: "void",
  },
  get_instance_data: {
    args: ["napi_env"],
    returns: "int",
  },
  get_type: {
    args: ["napi_env", "napi_value"],
    returns: "cstring",
  },
  default_napi_version: {
    args: [],
    returns: "int",
  },
};

// cc()-compiled napi code doesn't run on Windows (TCC can't link the napi_
// functions there), so skip the setup those tests need too. It does run
// under ASan: the FFI wrapper each un-close()d cc() call intentionally
// leaks is suppressed via leak:bun_ffi_cc in test/leaksan.supp.
const skipCC = isWindows;

let cc1, cc2;

const nodeApiHeadersInclude = join(__dirname, "napi-app/node_modules/node-api-headers/include");

function needsInstall(): boolean {
  return !existsSync(join(nodeApiHeadersInclude, "js_native_api.h"));
}

beforeAll(() => {
  if (isFFIUnavailable || skipCC) return;

  if (needsInstall()) {
    // The -I flag below pins cc1/cc2 to upstream node-api-headers instead of
    // the copy cc() bundles (which the first describe covers); that package
    // is all this file needs from the install. --ignore-scripts skips
    // napi-app's install script, a full node-gyp rebuild of every addon
    // target in binding.gyp (napi.test.ts runs it for the tests using those).
    const install = spawnSync({
      cmd: [bunExe(), "install", "--ignore-scripts"],
      cwd: join(__dirname, "napi-app"),
      stderr: "inherit",
      env: bunEnv,
      stdout: "inherit",
      stdin: "inherit",
    });
    if (!install.success || needsInstall()) {
      throw new Error("bun install --ignore-scripts did not produce node-api-headers in napi-app");
    }
  }
  // Identical compilations on purpose: "has a different napi_env for each cc
  // invocation" needs two separate cc() instances.
  cc1 = cc({
    source,
    symbols,
    flags: `-I${nodeApiHeadersInclude}`,
  }).symbols;
  cc2 = cc({
    source,
    symbols,
    flags: `-I${nodeApiHeadersInclude}`,
  }).symbols;
  // Explicit so a cache-cold package fetch outlasts the default 5s hook
  // timeout, but below CI's inherited per-test timeout and the runner's
  // outer file budget so a hung install still fails in-band with output.
}, 120_000);

describe.skipIf(isFFIUnavailable)("cc() bundled N-API headers", () => {
  it.todoIf(skipCC)("resolves <node_api.h> without any -I flag", () => {
    const { symbols } = cc({
      source: join(__dirname, "napi-app/bundled_napi_headers.c"),
      symbols: { passthrough: { args: ["napi_env", "napi_value"], returns: "napi_value" } },
    });
    const marker = { marker: 42 };
    expect(symbols.passthrough(undefined, marker)).toBe(marker);
  });

  it.todoIf(skipCC)("provides the Node 26 type surface and NAPI_MODULE_INIT()", () => {
    const { symbols } = cc({
      source: join(__dirname, "napi-app/bundled_napi_headers_node26.c"),
      symbols: {
        node_api_module_get_api_version_v1: { args: [], returns: "i32" },
        use_node26_types: { args: ["napi_env"], returns: "i32" },
      },
    });
    expect(symbols.node_api_module_get_api_version_v1()).toBe(10);
    expect(symbols.use_node26_types(undefined)).toBe(10);
  });

  it.todoIf(skipCC)("compiles with NAPI_EXPERIMENTAL defined", () => {
    const { symbols } = cc({
      source: join(__dirname, "napi-app/bundled_napi_headers_experimental.c"),
      symbols: { passthrough: { args: ["napi_env", "napi_value"], returns: "napi_value" } },
    });
    const marker = { marker: 42 };
    expect(symbols.passthrough(undefined, marker)).toBe(marker);
  });
});

// Bun's in-tree N-API headers (src/runtime/napi) are what napi.cpp compiles
// against and what cc() bundles for `#include <node_api.h>`. Compile a file
// that references the Node 26 type surface directly against them so the build
// asserts they stay in sync with upstream.
const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
describe.skipIf(isWindows || !systemCC)("in-tree N-API headers", () => {
  it("provide the Node 26 type surface and modern NAPI_MODULE_INIT()", async () => {
    const bunHeaders = resolve(__dirname, "../../src/runtime/napi");
    expect(existsSync(join(bunHeaders, "node_api.h"))).toBe(true);

    using dir = tempDir("napi-headers-node26", {});
    const out = join(String(dir), "addon.node");
    await using compile = Bun.spawn({
      cmd: [
        systemCC!,
        "-shared",
        "-fPIC",
        ...(process.platform === "darwin" ? ["-undefined", "dynamic_lookup"] : []),
        `-I${bunHeaders}`,
        join(__dirname, "napi-app/bundled_napi_headers_node26.c"),
        "-o",
        out,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      compile.stdout.text(),
      compile.stderr.text(),
      compile.exited,
    ]);
    expect(stderr).not.toContain("error:");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 0 });

    // NAPI_MODULE_INIT() must emit node_api_module_get_api_version_v1 returning
    // the header's default NAPI_VERSION; dlopen it and call it.
    const lib = dlopen(out, {
      node_api_module_get_api_version_v1: { args: [], returns: "i32" },
      use_node26_types: { args: ["ptr"], returns: "i32" },
    });
    try {
      expect(lib.symbols.node_api_module_get_api_version_v1()).toBe(10);
      expect(lib.symbols.use_node26_types(null)).toBe(10);
    } finally {
      lib.close();
    }
  });
});

describe.skipIf(isFFIUnavailable)("cc napi integration", () => {
  it.todoIf(skipCC)("compiles against upstream node-api-headers, not the bundled copy", () => {
    // Upstream node-api-headers defaults NAPI_VERSION to 8 where Bun's
    // bundled headers default to 10. TCC silently drops -I dirs that don't
    // exist, so without this check the cc1/cc2 compiles could quietly fall
    // back to the bundled headers and this file would stop exercising the
    // upstream ones.
    expect(cc1.default_napi_version()).toBe(8);
  });

  it.todoIf(skipCC)("has a different napi_env for each cc invocation", () => {
    cc1.set_instance_data(undefined, 5);
    cc2.set_instance_data(undefined, 6);
    expect(cc1.get_instance_data()).toBe(5);
    expect(cc2.get_instance_data()).toBe(6);
  });

  it.todoIf(skipCC)("passes values correctly", () => {
    const typeOf = (value: unknown) => cc1.get_type(undefined, value)?.toString();
    expect({
      undefined: typeOf(undefined),
      null: typeOf(null),
      booleans: [typeOf(true), typeOf(false)],
      numbers: [typeOf(123), typeOf(1.5)],
      string: typeOf("hello"),
      symbol: typeOf(Symbol("tag")),
      objects: [typeOf({}), typeOf([])],
      function: typeOf(() => {}),
      bigint: typeOf(190n),
    }).toEqual({
      undefined: "undefined",
      null: "null",
      booleans: ["boolean", "boolean"],
      numbers: ["number", "number"],
      string: "string",
      symbol: "symbol",
      objects: ["object", "object"],
      function: "function",
      bigint: "bigint",
    });
  });
});
