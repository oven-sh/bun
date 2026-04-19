import { spawnSync } from "bun";
import { cc, dlopen } from "bun:ffi";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows } from "harness";
import { join } from "path";

import source from "./napi-app/ffi_addon_1.c" with { type: "file" };

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

let addon1, addon2, cc1, cc2;

beforeAll(() => {
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
  addon1 = dlopen(join(__dirname, `napi-app/build/Debug/ffi_addon_1.node`), symbols).symbols;
  addon2 = dlopen(join(__dirname, `napi-app/build/Debug/ffi_addon_2.node`), symbols).symbols;
  // TinyCC's setjmp/longjmp error handling conflicts with ASan.
  // Skip cc() calls on ASan, and catch errors on Windows.
  if (!isASAN) {
    try {
      cc1 = cc({
        source,
        symbols,
        flags: `-I${join(__dirname, "napi-app/node_modules/node-api-headers/include")}`,
      }).symbols;
      cc2 = cc({
        source,
        symbols,
        flags: `-I${join(__dirname, "napi-app/node_modules/node-api-headers/include")}`,
      }).symbols;
    } catch (e) {
      // ignore compilation failure on Windows
      if (!isWindows) throw e;
    }
  }
});

describe("ffi napi integration", () => {
  it("has a different napi_env for each ffi library", () => {
    addon1.set_instance_data(undefined, 5);
    addon2.set_instance_data(undefined, 6);
    expect(addon1.get_instance_data()).toBe(5);
    expect(addon2.get_instance_data()).toBe(6);
  });

  // broken
  it.todo("passes values correctly", () => {
    expect(addon1.get_type(undefined, 123).toString()).toBe("number");
    expect(addon1.get_type(undefined, "hello").toString()).toBe("string");
    expect(addon1.get_type(undefined, 190n).toString()).toBe("bigint");
  });
});

describe("cc napi integration", () => {
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
