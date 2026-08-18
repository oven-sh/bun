import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import assert from "node:assert";
import { constants as fsConstants } from "node:fs";
import { constants as osConstants } from "node:os";
import { inspect } from "node:util";

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

// The constants objects are backed by static property tables: a constant is
// answered from the table and is only stored on the object once something
// materializes the whole table (spread, Object.entries, delete, ...). Everything
// below must hold anyway, exactly as it does for the plain objects node uses.
describe("constants objects behave like plain objects", () => {
  async function runInFreshProcess(source: string): Promise<any> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  test.concurrent("reading the constants does not store them on the object", async () => {
    // The child must not name a variable after a builtin module: `bun -e` loads
    // the builtins it sees named in the source, and node:zlib freezes its table.
    const result = await runInFreshProcess(`
      const { estimateShallowMemoryUsageOf } = require("bun:jsc");
      const table = process.binding("constants").zlib;
      const keys = Object.keys(table);
      let numbers = 0;
      for (const key of keys) numbers += typeof table[key] === "number" ? 1 : 0;
      const plain = Object.create(null);
      for (const key of keys) plain[key] = table[key];
      console.log(JSON.stringify({
        keys: keys.length,
        numbers,
        size: estimateShallowMemoryUsageOf(table),
        plainSize: estimateShallowMemoryUsageOf(plain),
      }));
    `);
    expect(result.keys).toBeGreaterThan(100);
    expect(result.numbers).toBe(result.keys);
    // A plain object holding the same constants needs a slot per constant. The
    // binding object, even after every constant was read, stays a bare object.
    expect(result.size * 4).toBeLessThan(result.plainSize);
  });

  test.concurrent("enumeration order does not depend on which properties were read first", async () => {
    const result = await runInFreshProcess(`
      const table = process.binding("constants").fs;
      const expected = Object.keys(table);
      // Read a few properties in an order that differs from the table order.
      void table.S_IFMT;
      void table.O_APPEND;
      void table.UV_FS_SYMLINK_DIR;
      const forIn = [];
      for (const key in table) forIn.push(key);
      const orders = {
        keys: Object.keys(table),
        names: Object.getOwnPropertyNames(table),
        ownKeys: Reflect.ownKeys(table),
        forIn,
        json: Object.keys(JSON.parse(JSON.stringify(table))),
        entries: Object.entries(table).map(([key]) => key),
        values: Object.values(table),
        spread: Object.keys({ ...table }),
        assign: Object.keys(Object.assign({}, table)),
        structuredClone: Object.keys(structuredClone(table)),
      };
      // node:zlib freezes its table after reading some of it.
      Object.freeze(table);
      orders.keysAfterFreeze = Object.keys(table);
      orders.entriesAfterFreeze = Object.entries(table).map(([key]) => key);
      orders.frozen = Object.isFrozen(table);
      console.log(JSON.stringify({ expected, expectedValues: expected.map(key => table[key]), orders }));
    `);
    const { expected, expectedValues, orders } = result;
    expect(expected.slice(0, 5)).toEqual([
      "UV_FS_SYMLINK_DIR",
      "UV_FS_SYMLINK_JUNCTION",
      "O_RDONLY",
      "O_WRONLY",
      "O_RDWR",
    ]);
    expect(orders).toEqual({
      keys: expected,
      names: expected,
      ownKeys: expected,
      forIn: expected,
      json: expected,
      entries: expected,
      values: expectedValues,
      spread: expected,
      assign: expected,
      structuredClone: expected,
      keysAfterFreeze: expected,
      entriesAfterFreeze: expected,
      frozen: true,
    });
  });

  test.concurrent("properties are writable, enumerable and configurable data properties", async () => {
    const result = await runInFreshProcess(`
      const signals = process.binding("constants").os.signals;
      const before = Object.keys(signals);
      const descriptor = Object.getOwnPropertyDescriptor(signals, "SIGTERM");
      signals.SIGINT = 1234;
      signals.EXTRA = 1;
      const deleted = delete signals.SIGKILL;
      const strictDelete = (() => { "use strict"; return delete signals.SIGTERM; })();
      console.log(JSON.stringify({
        before,
        descriptor,
        SIGINT: signals.SIGINT,
        after: Object.keys(signals),
        hasSIGKILL: "SIGKILL" in signals,
        deleted,
        strictDelete,
        SIGTERMAfterDelete: signals.SIGTERM,
      }));
    `);
    expect(result.descriptor).toEqual({
      value: osConstants.signals.SIGTERM,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(result.SIGINT).toBe(1234);
    expect(result.deleted).toBe(true);
    expect(result.strictDelete).toBe(true);
    expect(result.hasSIGKILL).toBe(false);
    expect(result.SIGTERMAfterDelete).toBeUndefined();
    // Overwritten properties keep their position, deleted ones disappear, new ones go last.
    expect(result.after).toEqual([
      ...result.before.filter((key: string) => key !== "SIGKILL" && key !== "SIGTERM"),
      "EXTRA",
    ]);
  });

  test("structuredClone accepts them", () => {
    expect(structuredClone(osConstants.signals)).toEqual({ ...osConstants.signals });
    expect(structuredClone(fsConstants)).toEqual({ ...fsConstants });
    /* @ts-ignore */
    const constants = process.binding("constants");
    const clone = structuredClone(constants.os);
    expect(clone).toEqual({ ...constants.os });
    expect(clone.errno).toEqual({ ...constants.os.errno });
  });

  test("inspect prints them like null-prototype objects", () => {
    const priority = osConstants.priority;
    const plain = Object.assign(Object.create(null), priority);
    expect(Bun.inspect(priority)).toBe(Bun.inspect(plain));
    expect(inspect(priority)).toBe(inspect(plain));
    expect(Bun.inspect(priority)).toStartWith("[Object: null prototype] {");
    expect(Object.prototype.toString.call(priority)).toBe("[object Object]");
    expect(Object.getPrototypeOf(priority)).toBeNull();
  });

  test("deepStrictEqual against a null-prototype copy", () => {
    const errno = osConstants.errno;
    const copy = Object.create(null);
    for (const key of Object.keys(errno)) copy[key] = errno[key];
    assert.deepStrictEqual(errno, copy);
    assert.deepStrictEqual(copy, errno);
    expect(errno).toStrictEqual(copy);
  });

  test("process.binding('uv') keeps its functions and key order", () => {
    /* @ts-ignore */
    const uv = process.binding("uv");
    const keys = Object.keys(uv);
    expect(keys[0]).toBe("errname");
    expect(keys.at(-1)).toBe("getErrorMap");
    expect(keys.slice(1, -1).every((key: string) => key.startsWith("UV_") && typeof uv[key] === "number")).toBe(true);
    expect(uv.errname).toBe(uv.errname);
    expect([uv.errname.name, uv.errname.length, uv.getErrorMap.name, uv.getErrorMap.length]).toEqual([
      "errname",
      1,
      "getErrorMap",
      0,
    ]);
    expect(Object.getPrototypeOf(uv)).toBe(Object.prototype);
    expect(Object.keys({ ...uv })).toEqual(keys);
    expect(Bun.inspect(uv)).toBe(Bun.inspect({ ...uv }));
  });
});
