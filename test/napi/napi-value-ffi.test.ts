import { spawnSync } from "bun";
import { cc } from "bun:ffi";
import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons, isASAN, isWindows } from "harness";
import { join } from "path";

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

describe.skipIf(isFFIUnavailable)("cc() bundled N-API headers", () => {
  it.todoIf(isWindows || isASAN)("resolves <node_api.h> without any -I flag", () => {
    const { symbols } = cc({
      source: join(__dirname, "napi-app/bundled_napi_headers.c"),
      symbols: { passthrough: { args: ["napi_env", "napi_value"], returns: "napi_value" } },
    });
    const marker = { marker: 42 };
    expect(symbols.passthrough(undefined, marker)).toBe(marker);
  });
});

describe.skipIf(isFFIUnavailable)("cc napi integration", () => {
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
