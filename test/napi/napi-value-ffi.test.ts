import { spawnSync } from "bun";
import { cc, dlopen } from "bun:ffi";
import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons, isASAN, isOhos, isWindows, tempDir } from "harness";
import { join, resolve } from "path";

import source from "./napi-app/ffi_addon_1.c" with { type: "file" };

// The napi-app fixture needs a toolchain that can compile the reported
// Node headers.
// OHOS blocks runtime dlopen of native addons, so skip these on isOhos.
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
};

let cc1, cc2;

const nodeApiHeadersInclude = join(__dirname, "napi-app/node_modules/node-api-headers/include");

function needsInstall(): boolean {
  return !existsSync(nodeApiHeadersInclude);
}

beforeAll(() => {
  if (isFFIUnavailable) return;

  if (needsInstall()) {
    // build gyp
    const install = spawnSync({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: join(__dirname, "napi-app"),
      stderr: "inherit",
      env: bunEnv,
      stdout: "inherit",
      stdin: "inherit",
    });
    if (!install.success) {
      throw new Error("build failed");
    }
  }
  // TinyCC's setjmp/longjmp error handling conflicts with ASan.
  // Skip cc() calls on ASan, and catch errors on Windows.
  if (!isASAN) {
    try {
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
    } catch (e) {
      // ignore compilation failure on Windows
      if (!isWindows) throw e;
    }
  }
});

describe.skipIf(isFFIUnavailable || isOhos)("cc() bundled N-API headers", () => {
  it.todoIf(isWindows || isASAN)("resolves <node_api.h> without any -I flag", () => {
    const { symbols } = cc({
      source: join(__dirname, "napi-app/bundled_napi_headers.c"),
      symbols: { passthrough: { args: ["napi_env", "napi_value"], returns: "napi_value" } },
    });
    const marker = { marker: 42 };
    expect(symbols.passthrough(undefined, marker)).toBe(marker);
  });

  it.todoIf(isWindows || isASAN)("provides the Node 26 type surface and NAPI_MODULE_INIT()", () => {
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

  it.todoIf(isWindows || isASAN)("compiles with NAPI_EXPERIMENTAL defined", () => {
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
describe.skipIf(isWindows || !systemCC || isOhos)("in-tree N-API headers", () => {
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

describe.skipIf(isFFIUnavailable || isOhos)("cc napi integration", () => {
  // fails on windows as TCC can't link the napi_ functions
  // TinyCC's setjmp/longjmp error handling conflicts with ASan.
  it.todoIf(isWindows || isASAN)("has a different napi_env for each cc invocation", () => {
    cc1.set_instance_data(undefined, 5);
    cc2.set_instance_data(undefined, 6);
    expect(cc1.get_instance_data()).toBe(5);
    expect(cc2.get_instance_data()).toBe(6);
  });

  // broken
  it.todo("passes values correctly", () => {
    expect(cc1.get_type(undefined, 123).toString()).toBe("number");
    expect(cc1.get_type(undefined, "hello").toString()).toBe("string");
    expect(cc1.get_type(undefined, 190n).toString()).toBe("bigint");
  });
});
