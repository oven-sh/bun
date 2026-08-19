import { describe, expect, test } from "bun:test";
import { constants as cryptoConstants } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { constants as osConstants } from "node:os";
import { constants as zlibConstants } from "node:zlib";

describe("process.binding", () => {
  test("process.binding('constants')", () => {
    /* @ts-ignore */
    const constants = process.binding("constants");
    expect(constants).toBeDefined();
    expect(constants).toHaveProperty("os");
    expect(constants).toHaveProperty("crypto");
    expect(constants).toHaveProperty("fs");
    expect(constants).toHaveProperty("trace");
    expect(constants).toHaveProperty("zlib");
  });
  test("process.binding('uv')", () => {
    /* @ts-ignore */
    const uv = process.binding("uv");
    expect(uv).toBeDefined();

    expect(uv).toHaveProperty("errname");
    expect(uv).toHaveProperty("UV_EACCES");
    // UV_EINTR is -4 on POSIX and a libuv-synthetic code on Windows.
    expect(uv.errname(uv.UV_EINTR)).toBe("EINTR");
    // force the number to be represented as a double
    expect(uv.errname(uv.UV_EINTR - 1.9 + Number("1.9"))).toBe("EINTR");
    expect(uv.errname(uv.UV_EINTR)).toBe("EINTR");

    expect(uv.errname(5)).toBe("Unknown system error 5");

    const map = uv.getErrorMap();
    expect(map).toBeDefined();
    expect(map.get(uv.UV_EISCONN)).toEqual(["EISCONN", "socket is already connected"]);
  });
});

// The objects are built from tables of rows (ProcessBindingConstants.cpp,
// ProcessBindingUV.cpp); these pin what the rows have to turn into.
describe("constants objects built from tables", () => {
  /* @ts-ignore */
  const constants = process.binding("constants");

  test("are the objects the node modules expose", () => {
    expect(osConstants).toBe(constants.os);
    expect(fsConstants).toBe(constants.fs);
    expect(cryptoConstants).toBe(constants.crypto);
    expect(zlibConstants).toBe(constants.zlib);
  });

  test("are plain null-prototype objects", () => {
    const { os, fs, crypto, zlib, trace } = constants;
    for (const object of [os, os.dlopen, os.errno, os.signals, os.priority, fs, crypto, zlib, trace]) {
      expect(Object.getPrototypeOf(object)).toBeNull();
      expect(Object.prototype.toString.call(object)).toBe("[object Object]");
    }
    expect(Object.getOwnPropertyDescriptor(os.signals, "SIGTERM")).toEqual({
      value: os.signals.SIGTERM,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(structuredClone(os.errno)).toEqual({ ...os.errno });
    expect(Bun.inspect(os.priority)).toBe(Bun.inspect(Object.assign(Object.create(null), os.priority)));
  });

  test("keep the table order", () => {
    expect(Object.keys(constants.os)).toEqual(["UV_UDP_REUSEADDR", "dlopen", "errno", "signals", "priority"]);
    expect(Object.keys(constants.fs).slice(0, 5)).toEqual([
      "UV_FS_SYMLINK_DIR",
      "UV_FS_SYMLINK_JUNCTION",
      "O_RDONLY",
      "O_WRONLY",
      "O_RDWR",
    ]);
    expect(Object.keys(constants.os.priority)).toEqual([
      "PRIORITY_LOW",
      "PRIORITY_BELOW_NORMAL",
      "PRIORITY_NORMAL",
      "PRIORITY_ABOVE_NORMAL",
      "PRIORITY_HIGH",
      "PRIORITY_HIGHEST",
    ]);
    expect(Object.keys(constants.zlib).slice(0, 3)).toEqual(["Z_NO_FLUSH", "Z_PARTIAL_FLUSH", "Z_SYNC_FLUSH"]);
  });

  test("rows that are not integers", () => {
    expect(constants.zlib.Z_MAX_CHUNK).toBe(Infinity);
    expect(constants.crypto.defaultCipherList).toStartWith("TLS_AES_256_GCM_SHA384:");
    expect(constants.crypto.defaultCoreCipherList).toBe(constants.crypto.defaultCipherList);
    const cryptoKeys = Object.keys(constants.crypto);
    expect(cryptoKeys.indexOf("defaultCoreCipherList")).toBe(cryptoKeys.indexOf("TLS1_VERSION") - 2);
    expect(cryptoKeys.at(-1)).toBe("POINT_CONVERSION_HYBRID");
  });

  test("process.binding('uv') has its functions first and last", () => {
    /* @ts-ignore */
    const uv = process.binding("uv");
    const keys = Object.keys(uv);
    expect(keys[0]).toBe("errname");
    expect(keys.at(-1)).toBe("getErrorMap");
    expect(keys.slice(1, -1).every((key: string) => key.startsWith("UV_") && typeof uv[key] === "number")).toBe(true);
    expect([uv.errname.name, uv.errname.length, uv.getErrorMap.name, uv.getErrorMap.length]).toEqual([
      "errname",
      1,
      "getErrorMap",
      0,
    ]);
    expect(Object.getPrototypeOf(uv)).toBe(Object.prototype);
    expect(Bun.inspect(uv)).toBe(Bun.inspect({ ...uv }));
  });
});
