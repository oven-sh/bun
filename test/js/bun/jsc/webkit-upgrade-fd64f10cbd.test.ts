import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Coverage for the WebKit fd64f10cbd sync. A test that names an upstream commit pins what that commit changed, and
// fails on the JavaScriptCore before it. The others pin what had to stay the same in code that the sync rewrote, or
// that the fork changed to keep it the same.
// The sources that depend on how JavaScriptCore compiles go through `new Function`, so that Bun's transpiler leaves
// them alone.

describe("WebKit fd64f10cbd upgrade", () => {
  test("a default value of a parameter reads the outer variable that the body declares again (419e6e4204)", () => {
    // The parameter list and the body share a scope in the parser, and the body's `var x` hid the name from the
    // function between `g` and `outer`. This was a ReferenceError.
    const outer = new Function(`
      var x = 1;
      return (function () {
        function g(a = x) {
          var x;
          return a;
        }
        return g();
      })();
    `);
    expect(outer()).toBe(1);

    const throughArrow = new Function(`
      let seen = "outer";
      return (() => {
        const g = (a = () => seen) => {
          var seen = "inner";
          return a() + "," + seen;
        };
        return g();
      })();
    `);
    expect(throughArrow()).toBe("outer,inner");
  });

  test("an object below a typed array asks the typed array about an index (890b90dce3)", () => {
    const child = Object.create(new Uint8Array(4));
    // Past the end of the typed array: its [[Set]] takes the store and defines nothing. It defined `10` on `child`.
    child[10] = 99;
    expect(Object.hasOwn(child, 10)).toBe(false);
    expect(child[10]).toBeUndefined();
    // Inside it, an ordinary [[Set]] with `child` as the receiver defines the element there.
    child[1] = 5;
    expect(Object.hasOwn(child, 1)).toBe(true);
    expect(child[1]).toBe(5);
    expect(Object.getPrototypeOf(child)[1]).toBe(0);
    // A subclass instance keeps the rule.
    class Bytes extends Uint8Array {}
    const belowSubclass = Object.create(new Bytes(2));
    belowSubclass[7] = 1;
    expect(Reflect.ownKeys(belowSubclass)).toEqual([]);
  });

  test("new WebAssembly.Suspending(f) is an object that cannot be called (a2bc1ad990)", () => {
    const Suspending = (WebAssembly as any).Suspending;
    const wrapped = () => 1;
    const suspending = new Suspending(wrapped);
    // It was a function whose prototype was Function.prototype, and a call of it threw a SuspendError.
    expect(typeof suspending).toBe("object");
    expect(Object.getPrototypeOf(suspending)).toBe(Suspending.prototype);
    expect(suspending.constructor).toBe(Suspending);
    expect(() => suspending()).toThrow(TypeError);
    expect(Reflect.ownKeys(suspending)).toEqual([]);
    expect(() => Suspending(wrapped)).toThrow(TypeError);
    expect(() => new Suspending({})).toThrow(TypeError);
  });

  test("%TypedArray%.prototype.join gives what Array.prototype.join gives for the same numbers", () => {
    // Upstream's new join (d336a98ee3) reads an integer view twice, to size the string and to write it. Bun's WebKit
    // reads each element once for every view, since another thread or process can write to a view that is not shared.
    const views = [
      new Int8Array([0, -1, 127, -128, 9, 10, 99, 100]),
      new Uint8Array([0, 1, 9, 10, 99, 100, 255]),
      new Uint8ClampedArray([0, 255, 128]),
      new Int16Array([0, -1, 32767, -32768, 999, 1000]),
      new Uint16Array([0, 65535, 9999, 10000]),
      new Int32Array([0, -1, 2147483647, -2147483648, 999999999, 1000000000]),
      new Uint32Array([0, 4294967295, 999999999, 1000000000]),
      new BigInt64Array([0n, -1n, 9223372036854775807n, -9223372036854775808n]),
      new BigUint64Array([0n, 18446744073709551615n, 9999999999n]),
      new Float32Array([0, -0, 1.5, -2.25, Infinity, NaN, 16777216]),
      new Float64Array([0, -0, 1.5, 1e21, 1e-7, -Infinity, NaN, 0.1 + 0.2]),
      new Float16Array([0, 1.5, -0.25, Infinity, NaN]),
    ];
    for (const view of views) {
      for (const separator of [undefined, "", ",", "--", "\u2713", "a\u2713b"]) {
        const expected = Array.from(view as any).join(separator);
        expect(view.join(separator)).toBe(expected);
      }
      expect(String(view)).toBe(Array.from(view as any).join(","));
      expect((view as any).subarray(1, 3).join("|")).toBe(
        Array.from(view as any)
          .slice(1, 3)
          .join("|"),
      );
    }
    expect(new Uint8Array(0).join("x")).toBe("");
    expect(new Int32Array([-7]).join("x")).toBe("-7");

    // A buffer that shrinks while join() converts the separator: the length was read before, so the elements behind
    // the new end are written as empty strings.
    const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
    const tracking = new Uint8Array(buffer);
    tracking.set([1, 2, 3, 4]);
    const fixed = new Uint8Array(buffer, 0, 4);
    const shrink = {
      toString() {
        buffer.resize(2);
        return ",";
      },
    };
    expect(tracking.join(shrink as any)).toBe("1,2,,");
    buffer.resize(4);
    expect(fixed.join(shrink as any)).toBe(",,,");
    // After it: the view that tracks the length has two elements, and the one of a fixed length is out of bounds.
    expect(tracking.join()).toBe("1,2");
    expect(() => fixed.join()).toThrow(TypeError);

    const big = new Uint8Array(100_000);
    for (let i = 0; i < big.length; i++) big[i] = i * 7;
    expect(big.join("")).toBe(Array.from(big).join(""));
  });

  test("JSON.stringify of arrays of objects of one shape", () => {
    // Upstream writes an object whose Structure it saw before through a second writer (aeca1a989f). The fork's
    // limits and its watch for an object inside itself are in that writer too.
    const make = (i: number) => ({
      id: i,
      name: "row " + i,
      ratio: i / 3,
      flag: i % 2 === 0,
      none: null,
      list: [i, "x"],
    });
    const rows = Array.from({ length: 500 }, (_, i) => make(i));
    const reference = (value: any): string => {
      if (value === null) return "null";
      if (Array.isArray(value)) return "[" + value.map(v => (v === undefined ? "null" : reference(v))).join(",") + "]";
      if (typeof value === "object") {
        return (
          "{" +
          Object.keys(value)
            .filter(key => value[key] !== undefined)
            .map(key => JSON.stringify(key) + ":" + reference(value[key]))
            .join(",") +
          "}"
        );
      }
      return typeof value === "string" ? JSON.stringify(value) : String(value);
    };
    for (let round = 0; round < 3; round++) expect(JSON.stringify(rows)).toBe(reference(rows));
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);

    // undefined in an array is null, and a property that is undefined is left out, also behind a seen Structure.
    const withHoles = [{ a: 1, b: undefined }, { a: 2, b: undefined }, undefined, { a: undefined, b: 3 }];
    expect(JSON.stringify(withHoles)).toBe('[{"a":1},{"a":2},null,{"b":3}]');
    // Doubles, negative zero and numbers that need an exponent.
    const numbers = [
      { v: 0.1 },
      { v: -0 },
      { v: 1e21 },
      { v: 5e-324 },
      { v: 123456789.125 },
      { v: NaN },
      { v: -Infinity },
    ];
    expect(JSON.stringify(numbers)).toBe(
      '[{"v":0.1},{"v":0},{"v":1e+21},{"v":5e-324},{"v":123456789.125},{"v":null},{"v":null}]',
    );
    // A string that needs 16 bits, late in a long text and early in a short one.
    const narrow = Buffer.alloc(9000, "a").toString();
    const wide = [{ s: narrow }, { s: narrow }, { s: "\u2713" }];
    expect(JSON.stringify(wide)).toBe('[{"s":"' + narrow + '"},{"s":"' + narrow + '"},{"s":"\u2713"}]');
    expect(JSON.stringify([{ s: "\u2713" }, { s: "b" }])).toBe('[{"s":"\u2713"},{"s":"b"}]');
    // The same late string behind two long results of 8-bit characters: the third call begins in another buffer.
    const narrowRows = [{ s: narrow }, { s: "b" }];
    const narrowText = '[{"s":"' + narrow + '"},{"s":"b"}]';
    for (let round = 0; round < 2; round++) {
      for (let call = 0; call < 3; call++) expect(JSON.stringify(narrowRows)).toBe(narrowText);
      expect(JSON.stringify(wide)).toBe('[{"s":"' + narrow + '"},{"s":"' + narrow + '"},{"s":"\u2713"}]');
    }
    // With an indent the second writer counts the depth as the first does.
    expect(JSON.stringify([{ a: { b: 1 } }, { a: { b: 2 } }], null, 1)).toBe(
      '[\n {\n  "a": {\n   "b": 1\n  }\n },\n {\n  "a": {\n   "b": 2\n  }\n }\n]',
    );

    // One value in two places is no cycle, in a short text and in one past 64 KB.
    const mk = (v: unknown) => ({ a: v });
    const shared = [1];
    expect(JSON.stringify([mk(0), shared, mk(shared)])).toBe('[{"a":0},[1],{"a":[1]}]');
    const long = Buffer.alloc(200_000, "x").toString();
    expect(JSON.stringify([mk(0), long, shared, mk(shared)])).toBe('[{"a":0},"' + long + '",[1],{"a":[1]}]');
    // A cycle through an object of a seen shape is still found, also behind long results.
    const cyclic: any[] = [mk(0), mk(1)];
    cyclic.push(mk(cyclic));
    expect(() => JSON.stringify(cyclic)).toThrow(TypeError);
    const selfHolder: any = { a: null };
    selfHolder.a = selfHolder;
    expect(() => JSON.stringify([mk(0), selfHolder])).toThrow(TypeError);
    const longRows = [long, long];
    expect(JSON.stringify(longRows).length).toBe(2 * long.length + 7);
    expect(JSON.stringify(longRows).length).toBe(2 * long.length + 7);
    expect(() => JSON.stringify([mk(0), selfHolder])).toThrow(TypeError);
    expect(() => JSON.stringify({ pad: long, self: selfHolder })).toThrow(TypeError);

    // Deep nests of one shape: the same text as a loop writes, at a depth that fits every build.
    let nested: any = { leaf: true };
    let expected = '{"leaf":true}';
    for (let depth = 0; depth < 300; depth++) {
      nested = [{ next: nested }, { next: 0 }];
      expected = '[{"next":' + expected + '},{"next":0}]';
    }
    expect(JSON.stringify(nested)).toBe(expected);

    // toJSON and a getter are seen on every object, not only on the first of a shape.
    let calls = 0;
    const withToJSON = Array.from({ length: 5 }, (_, i) => ({
      i,
      toJSON() {
        calls++;
        return { seen: i };
      },
    }));
    expect(JSON.stringify(withToJSON)).toBe('[{"seen":0},{"seen":1},{"seen":2},{"seen":3},{"seen":4}]');
    expect(calls).toBe(5);
    let reads = 0;
    const withGetter = Array.from({ length: 5 }, (_, i) =>
      Object.defineProperty({ i }, "g", {
        get() {
          reads++;
          return i * 2;
        },
        enumerable: true,
      }),
    );
    expect(JSON.stringify(withGetter)).toBe('[{"i":0,"g":0},{"i":1,"g":2},{"i":2,"g":4},{"i":3,"g":6},{"i":4,"g":8}]');
    expect(reads).toBe(5);
  });

  test("JSON.parse of arrays of objects and of numbers", () => {
    // Upstream parses the objects of an array in the frame of the array (c8e6298f1a) and scans a double once
    // (d24e80edb5). The fork's caches of names and strings are in that code.
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      id: i,
      name: "name" + (i % 7),
      tags: ["a", "b"],
      nested: { k: i % 3 },
    }));
    const text = JSON.stringify(rows);
    for (let round = 0; round < 3; round++) expect(JSON.parse(text)).toEqual(rows);
    // The same text as UTF-16 and with a key that needs 16 bits.
    const wideRows = rows.slice(0, 50).map(row => ({ ...row, "\u2713": "\u00e9" + row.name }));
    expect(JSON.parse(JSON.stringify(wideRows))).toEqual(wideRows);

    const numbers = [
      "0",
      "-0",
      "1",
      "-1",
      "0.1",
      "1e21",
      "1E+21",
      "1e-7",
      "5e-324",
      "1.7976931348623157e308",
      "2e308",
      "123456789012345678901234567890",
      "9007199254740993",
      "0.30000000000000004",
      "4.35",
      "1.5e+3",
      "-2.5E-3",
      "1234567.125",
      "4294967296",
      "-2147483649",
      "0.000001",
      "100000000000000000000",
    ];
    for (const number of numbers) {
      // toBe() tells -0 from 0.
      const expected = Number(number);
      expect(JSON.parse(number)).toBe(expected);
      expect(JSON.parse(`[${number}]`)[0]).toBe(expected);
      expect(JSON.parse(`[{"n":${number}},{"n":${number}}]`)[1].n).toBe(expected);
      expect(JSON.parse(` { "n" : ${number} } `).n).toBe(expected);
    }
    for (const bad of [
      "[1,]",
      "[{,}]",
      '[{"a":1,}]',
      "[01]",
      "[1.]",
      "[.5]",
      "[1e]",
      "[-]",
      '[{"a":1}{"a":2}]',
      "[+1]",
    ]) {
      expect(() => JSON.parse(bad)).toThrow(SyntaxError);
    }
    // A reviver sees every object of the array.
    const seen: number[] = [];
    JSON.parse('[{"a":1},{"a":2},{"a":3}]', function (key, value) {
      if (key === "a") seen.push(value);
      return value;
    });
    expect(seen).toEqual([1, 2, 3]);
    // __proto__ as a key is an own property of each object.
    const protos = JSON.parse('[{"__proto__":1},{"__proto__":2}]');
    expect(protos.map((o: object) => Object.getOwnPropertyDescriptor(o, "__proto__")?.value)).toEqual([1, 2]);
  });

  test("elements far apart in an array are found, removed and found again", () => {
    // Such elements are in a WTF::HashTable, which upstream rewrote (53bedf6450): a status byte for each bucket.
    const array: number[] = [];
    const model = new Map<number, number>();
    const indexAt = (i: number) => 100_000 + i * 7919;
    for (let i = 0; i < 3000; i++) {
      array[indexAt(i)] = i;
      model.set(indexAt(i), i);
    }
    const check = () => {
      for (let i = 0; i < 3000; i++) {
        const index = indexAt(i);
        if (array[index] !== model.get(index))
          throw new Error(`array[${index}] is ${array[index]}, expected ${model.get(index)}`);
        if (index in array !== model.has(index)) throw new Error(`${index} in array is ${index in array}`);
        if (array[index + 1] !== undefined) throw new Error(`array[${index + 1}] is ${array[index + 1]}`);
      }
      expect(Object.keys(array).length).toBe(model.size);
    };
    check();
    for (let i = 0; i < 3000; i += 3) {
      delete array[indexAt(i)];
      model.delete(indexAt(i));
    }
    check();
    for (let i = 0; i < 3000; i += 6) {
      array[indexAt(i)] = -i;
      model.set(indexAt(i), -i);
    }
    check();
    expect(array.length).toBe(indexAt(2999) + 1);
    const keys = Object.keys(array).map(Number);
    expect(keys).toEqual([...model.keys()].sort((a, b) => a - b));
  });

  test("the bytes of a Float16 are the same through a Float16Array and a DataView", () => {
    const view = new Float16Array(1);
    const data = new DataView(new ArrayBuffer(2));
    data.setFloat16(0, 1.337, true);
    expect(data.getUint16(0, true)).toBe(0x3d59);
    view[0] = 1.337;
    expect(new Uint16Array(view.buffer)[0]).toBe(0x3d59);
    view[0] = NaN;
    expect(view[0]).toBeNaN();
    expect(Math.f16round(NaN)).toBeNaN();
  });
});

// Each of these needs code of the DFG or the FTL. A child compiles on its main thread and early, so the tier is
// reached at the same call in every run.
describe.concurrent("WebKit fd64f10cbd upgrade, in optimized code", () => {
  async function runOptimized(source: string, env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: {
        ...bunEnv,
        BUN_JSC_useConcurrentJIT: "0",
        BUN_JSC_thresholdForJITAfterWarmUp: "20",
        BUN_JSC_thresholdForOptimizeAfterWarmUp: "200",
        BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "2000",
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test("a spread of an array from another realm asks the iterator of that realm (7f7e759a49)", async () => {
    // The DFG watched the realm of the code for a changed iterator protocol, and not the realm of the array. The
    // iterator of the other realm yields once, and the fast path copied three elements.
    const source = `
      const other = require("node:vm").runInNewContext("globalThis");
      other.eval("const theArray = [1.1, 2.2, 3.3]; globalThis.inner = function () { return theArray; };");
      other.eval("Array.prototype[Symbol.iterator] = function* () { yield 42; };");
      const spreadIt = new Function("inner", "arr", "const x = arr[0], a = inner(); if (arr) return [...a].length + x * 0.0; return -1;");
      let wrong = 0;
      for (let i = 0; i < 5000; i++) {
        if (spreadIt(other.inner, [1.1, 2.2, 3.3]) !== 1) wrong++;
      }
      console.log(wrong);
    `;
    expect(await runOptimized(source)).toEqual({ stdout: "0", stderr: "", exitCode: 0 });
  });

  test("a hole of an array with sparse storage is read from the typed array above it (890b90dce3)", async () => {
    // The store far behind the end gives the array the storage that the DFG read wrongly: array[1] was undefined.
    const source = `
      const readHole = new Function("array", "return array[1];");
      const array = [1, , 3];
      array[100000] = 4;
      Object.setPrototypeOf(array, new Uint8Array([10, 20, 30]));
      let wrong = 0;
      for (let i = 0; i < 20000; i++) {
        if (readHole(array) !== 20) wrong++;
      }
      console.log(wrong);
    `;
    expect(await runOptimized(source)).toEqual({ stdout: "0", stderr: "", exitCode: 0 });
  });

  test("the FTL keeps a double alive across o[i] through an inline cache that reads a Float64Array (c57b5cead7)", async () => {
    // The patchpoint of the inline cache did not say that it uses the floating-point scratch register. A value that
    // the FTL kept there became NaN: with Bun 1.4.3 most of the calls below return NaN.
    const source = `
      const names = Array.from({ length: 40 }, (_, i) => "a" + i);
      const body = names.map((name, i) => "const " + name + " = src[" + i + "];").join("") + "const v = o[3]; return v + " + names.join(" + ");
      const getSum = new Function("src", "o", body);
      const src = Float64Array.from(names, (_, i) => i + 0.5);
      const typedArray = new Float64Array(40).fill(7.25);
      const plainObject = { 3: 7.25 };
      let wrong = 0;
      for (let i = 0; i < 200000; i++) {
        if (getSum(src, i % 8 ? typedArray : plainObject) !== 807.25) wrong++;
      }
      console.log(wrong);
    `;
    expect(await runOptimized(source)).toEqual({ stdout: "0", stderr: "", exitCode: 0 });
  });

  test("Float16Array stores and Math.f16round round as the conversion in C++ does", async () => {
    // On x86-64 the JIT converts with F16C now (60af4b364c). Before, it called a function for each store. The last
    // three inputs are beside the middle of two neighbours, where a conversion through a float rounds twice.
    const source = `
      const cases = [
        [0, 0], [-0, -0], [1, 1], [1.337, 1.3369140625], [-1.337, -1.3369140625],
        [65504, 65504], [65520, Infinity], [-65520, -Infinity],
        [5.960464477539063e-8, 5.960464477539063e-8], [2.9802322387695312e-8, 0],
        [2.98023223876953125e-8 * 1.0000001, 5.960464477539063e-8],
        [0.1, 0.0999755859375], [1 / 3, 0.333251953125], [Infinity, Infinity], [-Infinity, -Infinity],
        [1 + 2 ** -11 + 2 ** -40, 1.0009765625], [1 + 3 * 2 ** -11 - 2 ** -40, 1.0009765625],
        [2 ** -25 * (1 + 2 ** -30), 5.960464477539063e-8],
      ];
      const store = new Function("view", "value", "view[0] = value; return view[0];");
      const round = new Function("value", "return Math.f16round(value);");
      const view = new Float16Array(1);
      const wrong = [];
      for (let i = 0; i < 30006; i++) {
        const [input, expected] = cases[i % cases.length];
        const stored = store(view, input);
        const rounded = round(input);
        if ((!Object.is(stored, expected) || !Object.is(rounded, expected)) && wrong.length < 5)
          wrong.push({ input, stored, rounded, expected, call: i });
      }
      console.log(JSON.stringify(wrong));
    `;
    expect(await runOptimized(source)).toEqual({ stdout: "[]", stderr: "", exitCode: 0 });
  });

  test("BUN_JSC_useSharedArrayBuffer=0 still takes SharedArrayBuffer away (9e3f76240a)", async () => {
    // Upstream renamed the option to alwaysUseSharedArrayBuffer. The old name is an alias in Bun's WebKit: a name
    // that is no option stops Bun with "invalid JSC environment variable".
    const source = "console.log(typeof SharedArrayBuffer)";
    const [byDefault, oldName, newName] = await Promise.all([
      runOptimized(source),
      runOptimized(source, { BUN_JSC_useSharedArrayBuffer: "0" }),
      runOptimized(source, { BUN_JSC_alwaysUseSharedArrayBuffer: "0" }),
    ]);
    expect({ byDefault, oldName, newName }).toEqual({
      byDefault: { stdout: "function", stderr: "", exitCode: 0 },
      oldName: { stdout: "undefined", stderr: "", exitCode: 0 },
      newName: { stdout: "undefined", stderr: "", exitCode: 0 },
    });
  });
});
