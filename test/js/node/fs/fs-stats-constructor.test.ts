import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { Stats, statSync } from "node:fs";

// Node.js's Stats constructor signature (deprecated, DEP0180):
//   Stats(dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeMs, mtimeMs, ctimeMs, birthtimeMs)
const args = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const expected = {
  dev: 0,
  mode: 1,
  nlink: 2,
  uid: 3,
  gid: 4,
  rdev: 5,
  blksize: 6,
  ino: 7,
  size: 8,
  blocks: 9,
  atimeMs: 10,
  mtimeMs: 11,
  ctimeMs: 12,
  birthtimeMs: 13,
};

test("new Stats(...) assigns fields in Node's order", () => {
  // @ts-expect-error DEP0180
  expect({ ...new Stats(...args) }).toMatchObject(expected);
});

test("Stats(...) without new assigns fields in Node's order", () => {
  // Regression: callJSStatsFunction used to write putDirectOffset slots in
  // argument order, but the structure's slot layout differs, so .ino returned
  // the mode argument etc.
  // @ts-expect-error DEP0180
  expect({ ...Stats(...args) }).toMatchObject(expected);
});

test("Stats instances share Stats.prototype", () => {
  // Regression: initJSStatsClassStructure created two JSStatsPrototype objects,
  // so Object.getPrototypeOf(instance) !== Stats.prototype and instanceof failed.
  const fromSync = statSync(import.meta.path);
  // @ts-expect-error DEP0180
  const fromNew = new Stats(...args);
  // @ts-expect-error DEP0180
  const fromCall = Stats(...args);

  expect(fromSync instanceof Stats).toBe(true);
  expect(fromNew instanceof Stats).toBe(true);
  expect(fromCall instanceof Stats).toBe(true);
  expect(Object.getPrototypeOf(fromSync)).toBe(Stats.prototype);
  expect(Object.getPrototypeOf(fromNew)).toBe(Stats.prototype);
  expect(Object.getPrototypeOf(fromCall)).toBe(Stats.prototype);

  const bigint = statSync(import.meta.path, { bigint: true });
  expect(Object.getPrototypeOf(bigint).constructor.name).toBe("BigIntStats");
  expect(bigint instanceof Object.getPrototypeOf(bigint).constructor).toBe(true);
});

// A call resolved through a binding that a closure captures is compiled with the scope object
// itself in the this slot, and native functions see it raw. isFile() and friends used to read
// `mode` out of that scope object (the date getters, once pulled out of their property descriptor,
// `atimeMs` and so on): a missing binding produced a bogus answer, and a binding still in its
// temporal dead zone crashed the process. Such a receiver now gets the same answer as any other
// non-object receiver.
describe("Stats methods and accessors called without a receiver", () => {
  test("a mode method called through a captured binding is treated like an undefined receiver", () => {
    const stats = statSync(import.meta.path);
    const bigintStats = statSync(import.meta.dir, { bigint: true });
    const { isFile } = stats;
    const { isDirectory } = bigintStats;
    function keep() {
      return [isFile, isDirectory];
    }
    expect({
      bare: [isFile(), isDirectory()],
      undefinedReceiver: [isFile.call(undefined), isDirectory.call(undefined)],
      statsReceiver: [isFile.call(stats), isDirectory.call(bigintStats)],
    }).toEqual({
      bare: [undefined, undefined],
      undefinedReceiver: [undefined, undefined],
      statsReceiver: [true, true],
    });
    expect(keep()).toEqual([isFile, isDirectory]);
  });

  test("a date getter called through a captured binding is treated like an undefined receiver", () => {
    const stats = statSync(import.meta.path);
    const bigintStats = statSync(import.meta.path, { bigint: true });
    const atime = Object.getOwnPropertyDescriptor(Stats.prototype, "atime")!.get!;
    const bigintMtime = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(bigintStats), "mtime")!.get!;
    function keep() {
      return [atime, bigintMtime];
    }
    expect({
      bare: [atime(), bigintMtime()],
      undefinedReceiver: [atime.call(undefined), bigintMtime.call(undefined)],
      statsReceiver: [atime.call(stats), bigintMtime.call(bigintStats)],
    }).toEqual({
      bare: [undefined, undefined],
      undefinedReceiver: [undefined, undefined],
      statsReceiver: [stats.atime, bigintStats.mtime],
    });
    expect(keep()).toEqual([atime, bigintMtime]);
  });

  test("calls through a scope whose `mode` and `atimeMs` bindings are in their TDZ do not crash", async () => {
    const src = `
      const { Stats, statSync } = require("node:fs");
      const { isFile } = statSync(${JSON.stringify(import.meta.path)});
      const { isDirectory } = statSync(${JSON.stringify(import.meta.dir)}, { bigint: true });
      const atime = Object.getOwnPropertyDescriptor(Stats.prototype, "atime").get;
      console.log(isFile(), isDirectory(), atime());
      let mode = 0;
      let atimeMs = 0;
      function keep() {
        return [isFile, isDirectory, atime, mode, atimeMs];
      }
      keep();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "undefined undefined undefined\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

// Node's date accessors end in setOwnProperty(this, name, value), that is Object.defineProperty().
// The native accessors used to write the property onto the receiver directly, which skipped the
// receiver's own [[DefineOwnProperty]]: a frozen object gained a property, a Proxy saw no trap, and
// a WebAssembly GC reference aborted the process.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/utils.js#L472-L517
describe("Stats date accessors define the property the way Object.defineProperty does", () => {
  const fields = ["atime", "mtime", "ctime", "birthtime"] as const;
  // [name, prototype, a value for the `${field}Ms` property that the getter reads]
  const kinds = [
    ["Stats", Stats.prototype, 5],
    ["BigIntStats", Object.getPrototypeOf(statSync(import.meta.path, { bigint: true })), 5n],
  ] as const;
  const dataProperty = (value: unknown) => ({ value, writable: true, enumerable: true, configurable: true });

  test.each(kinds)("%s: an ordinary receiver gets a writable, enumerable, configurable property", (_, proto, ms) => {
    const bigint = typeof ms === "bigint";
    // The first read takes the class structure fast path, the others the generic path.
    const read: any = statSync(import.meta.path, { bigint });
    for (const field of fields) {
      const date = read[field];
      expect(date).toBeInstanceOf(Date);
      expect(Object.getOwnPropertyDescriptor(read, field)).toEqual(dataProperty(date));
    }

    const assigned: any = statSync(import.meta.path, { bigint });
    for (const field of fields) {
      assigned[field] = 42;
      expect(Object.getOwnPropertyDescriptor(assigned, field)).toEqual(dataProperty(42));
    }

    const inherited = Object.create(proto);
    inherited.mtimeMs = ms;
    expect(inherited.mtime).toEqual(new Date(5));
    expect(Object.getOwnPropertyDescriptor(inherited, "mtime")).toEqual(dataProperty(new Date(5)));
  });

  test("the prototype as the receiver keeps its accessor", () => {
    expect(Stats.prototype.mtime.getTime()).toBeNaN();
    expect(Object.getOwnPropertyDescriptor(Stats.prototype, "mtime")!.get).toBeFunction();
  });

  test.each(kinds)("%s: a receiver that is not extensible rejects the property", (_, proto, ms) => {
    for (const lock of [Object.freeze, Object.seal, Object.preventExtensions]) {
      for (const field of fields) {
        const { get, set } = Object.getOwnPropertyDescriptor(proto, field)!;
        const receiver = lock({ [`${field}Ms`]: ms });
        expect(() => set!.call(receiver, new Date(0))).toThrow(TypeError);
        expect(() => get!.call(receiver)).toThrow(TypeError);
        expect(Reflect.ownKeys(receiver)).toEqual([`${field}Ms`]);
      }
    }

    // Node also throws for the read of a frozen Stats object.
    const frozen: any = Object.freeze(statSync(import.meta.path, { bigint: typeof ms === "bigint" }));
    expect(() => frozen.mtime).toThrow(TypeError);
    expect(() => {
      frozen.mtime = new Date(0);
    }).toThrow(TypeError);
    expect(() => Reflect.set(proto, "mtime", new Date(0), frozen)).toThrow(TypeError);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.hasOwn(frozen, "mtime")).toBe(false);
  });

  test("an own property that is not configurable is not redefined", () => {
    const { get, set } = Object.getOwnPropertyDescriptor(Stats.prototype, "mtime")!;
    const receiver = Object.defineProperty({ mtimeMs: 5 }, "mtime", { value: 1 });
    expect(() => set!.call(receiver, 2)).toThrow(TypeError);
    expect(() => get!.call(receiver)).toThrow(TypeError);
    expect(Object.getOwnPropertyDescriptor(receiver, "mtime")).toEqual({
      value: 1,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  });

  test("a Proxy receiver gets its defineProperty trap called", () => {
    const { get, set } = Object.getOwnPropertyDescriptor(Stats.prototype, "mtime")!;
    const calls: unknown[] = [];
    const target: { mtimeMs: number; mtime?: unknown } = { mtimeMs: 5 };
    const proxy = new Proxy(target, {
      defineProperty(target, key, descriptor) {
        calls.push([key, descriptor]);
        return Reflect.defineProperty(target, key, descriptor);
      },
    });

    set!.call(proxy, 42);
    expect(calls).toEqual([["mtime", dataProperty(42)]]);
    expect(target).toEqual({ mtimeMs: 5, mtime: 42 });

    calls.length = 0;
    delete target.mtime;
    const date = get!.call(proxy);
    expect(calls).toEqual([["mtime", dataProperty(new Date(5))]]);
    expect(target.mtime).toBe(date);

    const refusing = new Proxy({ mtimeMs: 5 }, { defineProperty: () => false });
    expect(() => set!.call(refusing, 42)).toThrow(TypeError);
    expect(() => get!.call(refusing)).toThrow(TypeError);
  });

  test("a Stats object frozen while the getter converts the timestamp stays frozen", () => {
    const freezeDuringConversion = {
      valueOf() {
        Object.freeze(stats);
        return 5;
      },
    };
    // @ts-expect-error DEP0180
    const stats = new Stats(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, freezeDuringConversion, 11, 12, 13);
    expect(() => stats.atime).toThrow(TypeError);
    expect(Object.isFrozen(stats)).toBe(true);
    expect(Object.hasOwn(stats, "atime")).toBe(false);
  });

  // In a subprocess because this aborted the process.
  test("a WebAssembly GC reference as the receiver of a setter throws a TypeError", async () => {
    const src = `
      // (module (type $s (struct (field (mut i32))))
      //   (func (export "mk") (result (ref null $s)) struct.new_default $s))
      const bytes = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x0a, 0x02, 0x5f, 0x01, 0x7f, 0x01, 0x60, 0x00, 0x01, 0x63, 0x00,
        0x03, 0x02, 0x01, 0x01,
        0x07, 0x06, 0x01, 0x02, 0x6d, 0x6b, 0x00, 0x00,
        0x0a, 0x07, 0x01, 0x05, 0x00, 0xfb, 0x01, 0x00, 0x0b,
      ]);
      const ref = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.mk();
      const { Stats, statSync } = require("node:fs");
      const prototypes = {
        Stats: Stats.prototype,
        BigIntStats: Object.getPrototypeOf(statSync(${JSON.stringify(import.meta.path)}, { bigint: true })),
      };
      const result = {};
      for (const [name, proto] of Object.entries(prototypes)) {
        for (const field of ["atime", "mtime", "ctime", "birthtime"]) {
          const { set } = Object.getOwnPropertyDescriptor(proto, field);
          try {
            set.call(ref, new Date(0));
            result[name + "." + field] = "no error";
          } catch (e) {
            result[name + "." + field] = e.constructor.name;
          }
        }
      }
      console.log(JSON.stringify(result));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      "Stats.atime": "TypeError",
      "Stats.mtime": "TypeError",
      "Stats.ctime": "TypeError",
      "Stats.birthtime": "TypeError",
      "BigIntStats.atime": "TypeError",
      "BigIntStats.mtime": "TypeError",
      "BigIntStats.ctime": "TypeError",
      "BigIntStats.birthtime": "TypeError",
    });
    expect(exitCode).toBe(0);
  });
});
