import { describeArray, describe as describeObject } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Object.freeze / seal / preventExtensions and a read-only "length" keep the elements of an
// array in the ArrayStorage vector (oven-sh/bun#44305). Before the fix every element moved
// into the sparse map: the vector length dropped to 0 and every read became a hash lookup.

function vectorLength(a: unknown[]): number {
  const m = /vector length: (\d+)/.exec(describeArray(a));
  if (!m) throw new Error(`no vector length in ${describeArray(a)}`);
  return Number(m[1]);
}

function ints(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

const locks: [string, (a: unknown[]) => unknown[]][] = [
  ["Object.freeze", a => Object.freeze(a)],
  ["Object.seal", a => Object.seal(a)],
  ["Object.preventExtensions", a => Object.preventExtensions(a)],
  ["non-writable length", a => Object.defineProperty(a, "length", { writable: false })],
];

const inputs: [string, () => unknown[], unknown[]][] = [
  ["int32", () => ints(16), ints(16)],
  ["double", () => [0.5, 1.5, 2.5], [0.5, 1.5, 2.5]],
  ["contiguous", () => ["a", null, 1], ["a", null, 1]],
  ["holey", () => [1, , 3], [1, , 3]],
  [
    "length beyond the vector",
    () => {
      const a = [1, 2, 3];
      a.length = 1000;
      return a;
    },
    Object.assign(new Array(1000), [1, 2, 3]),
  ],
];

describe("frozen arrays keep their elements in the vector", () => {
  describe.each(locks)("%s", (name, lock) => {
    test.each(inputs)("%s", (_input, make, expected) => {
      const a = lock(make());
      expect(describeObject(a)).toContain("ArrayWithSlowPutArrayStorage");
      // The vector keeps its capacity, which is at least the number of elements.
      expect(vectorLength(a)).toBeGreaterThanOrEqual(Math.min(a.length, 3));
      expect(a).toEqual(expected);
      expect(Object.keys(a)).toEqual(Object.keys(expected));
      expect(Object.isExtensible(a)).toBe(name === "non-writable length");
      expect(Object.getOwnPropertyDescriptor(a, "length")!.writable).toBe(
        name === "Object.seal" || name === "Object.preventExtensions",
      );
    });

    test("an array that already owns a sparse map entry", () => {
      "use strict";
      const b = [1, 2, 3];
      b[100000] = 4;
      lock(b);
      expect(b[0]).toBe(1);
      expect(b[100000]).toBe(4);
      expect(b.length).toBe(100001);
      // A hole between the vector and the map entry cannot be filled on a non-extensible array.
      if (Object.isExtensible(b)) {
        b[50000] = 5;
        expect(b[50000]).toBe(5);
      } else {
        expect(() => {
          b[50000] = 5;
        }).toThrow(TypeError);
        expect(Object.hasOwn(b, 50000)).toBe(false);
      }
      expect(() => {
        b[200000] = 5;
      }).toThrow(TypeError);
      expect(b.length).toBe(100001);
    });
  });

  test("double and contiguous arrays", () => {
    const d = Object.freeze([0.5, 1.5, 2.5]);
    expect(vectorLength(d)).toBeGreaterThanOrEqual(3);
    expect(d[0] + d[1] + d[2]).toBe(4.5);
    const c = Object.freeze(["a", {}, 1]);
    expect(vectorLength(c)).toBeGreaterThanOrEqual(3);
    expect(c[0]).toBe("a");
  });

  test("frozen semantics hold on the vector", () => {
    "use strict";
    const a = Object.freeze(ints(4));
    expect(() => {
      a[0] = 9;
    }).toThrow(TypeError);
    expect(() => {
      a[4] = 9;
    }).toThrow(TypeError);
    expect(() => a.push(9)).toThrow(TypeError);
    expect(() => a.pop()).toThrow(TypeError);
    expect(() => {
      a.length = 0;
    }).toThrow(TypeError);
    expect(() => {
      delete a[0];
    }).toThrow(TypeError);
    expect(Object.getOwnPropertyDescriptor(a, 0)).toEqual({
      value: 0,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    expect(Object.isFrozen(a)).toBe(true);
    expect([...a]).toEqual([0, 1, 2, 3]);
    expect(vectorLength(a)).toBeGreaterThanOrEqual(4);
  });

  test("sealed semantics hold on the vector", () => {
    "use strict";
    const a = Object.seal(ints(4));
    a[0] = 9;
    expect(a[0]).toBe(9);
    expect(() => {
      delete a[0];
    }).toThrow(TypeError);
    expect(() => a.pop()).toThrow(TypeError);
    expect(() => {
      a.length = 1;
    }).toThrow(TypeError);
    expect(a.length).toBe(4);
    expect(() => a.push(9)).toThrow(TypeError);
    expect(Object.getOwnPropertyDescriptor(a, 0)).toEqual({
      value: 9,
      writable: true,
      enumerable: true,
      configurable: false,
    });
    expect(Object.isSealed(a)).toBe(true);
    expect(Object.isFrozen(a)).toBe(false);
    expect(vectorLength(a)).toBeGreaterThanOrEqual(4);
  });

  test("a frozen array on the prototype chain rejects inherited writes", () => {
    "use strict";
    const proto = Object.freeze(ints(3));
    const child = Object.create(proto);
    expect(() => {
      child[0] = 9;
    }).toThrow(TypeError);
    expect(child[0]).toBe(0);
    expect(Object.hasOwn(child, 0)).toBe(false);

    // Frozen after it became a prototype, with a plain child and an array child with a hole.
    const late = ints(3);
    const plainChild = Object.create(late);
    const arrayChild = [9, , 9];
    Object.setPrototypeOf(arrayChild, late);
    Object.freeze(late);
    expect(() => {
      plainChild[1] = 9;
    }).toThrow(TypeError);
    expect(Object.hasOwn(plainChild, 1)).toBe(false);
    expect(() => {
      arrayChild[1] = 9;
    }).toThrow(TypeError);
    expect(Object.hasOwn(arrayChild, 1)).toBe(false);
    expect(arrayChild[1]).toBe(1);

    // Object.setPrototypeOf to an array frozen earlier.
    const grown = [9, , 9];
    Object.setPrototypeOf(grown, proto);
    expect(() => {
      grown[1] = 9;
    }).toThrow(TypeError);
    expect(grown[1]).toBe(1);
    grown[3] = 3;
    expect(grown.length).toBe(4);

    // A sealed prototype does not stop the child from shadowing.
    const sealed = Object.seal([7, 8, 9]);
    const shadow = Object.create(sealed);
    shadow[0] = 77;
    expect(shadow[0]).toBe(77);
    expect(sealed[0]).toBe(7);
  });

  test("a store site warmed on a writable non-extensible array rejects a frozen one", () => {
    function store(a: number[], i: number, v: number) {
      "use strict";
      a[i] = v;
    }
    const writable = Object.preventExtensions(ints(8));
    for (let i = 0; i < 100_000; i++) store(writable, i & 7, i);
    const frozen = Object.freeze(ints(8));
    for (let i = 0; i < 1000; i++) {
      expect(() => store(frozen, i & 7, -1)).toThrow(TypeError);
      store(writable, i & 7, -1);
    }
    expect(frozen).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(writable).toEqual([-1, -1, -1, -1, -1, -1, -1, -1]);
  });

  test("defineProperty on one element moves the array to the sparse map with exact descriptors", () => {
    const a = Object.seal(ints(3));
    Object.defineProperty(a, 0, { writable: false });
    expect(Object.getOwnPropertyDescriptor(a, 0)).toEqual({
      value: 0,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    expect(Object.getOwnPropertyDescriptor(a, 1)).toEqual({
      value: 1,
      writable: true,
      enumerable: true,
      configurable: false,
    });
    expect(vectorLength(a)).toBe(0);
    expect(() => Object.defineProperty(a, 1, { configurable: true })).toThrow(TypeError);
  });

  test("freezing one literal leaves the next literal from the same site writable", async () => {
    // A separate process: another test file can put this realm in "having a bad time" mode, and
    // then every array is SlowPutArrayStorage.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { describe } = require("bun:jsc");
         function make() { return [1, 2, 3, 4]; }
         function build(n) { const a = []; for (let i = 0; i < n; i++) a.push(i); return a; }
         let slow = 0;
         for (let i = 0; i < 200; i++) {
           const a = Object.freeze(make());
           const b = make();
           b[0] = 9;
           b.push(5);
           if (b.join() !== "9,2,3,4,5" || a.join() !== "1,2,3,4") throw new Error("bad values");
           if (describe(b).includes("SlowPutArrayStorage")) slow++;
           Object.freeze(build(8));
           if (describe(build(8)).includes("SlowPutArrayStorage")) slow++;
         }
         console.log(slow);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("0\n");
    expect(exitCode).toBe(0);
  });

  test("freezing Array.prototype keeps it blank", async () => {
    // A separate process, so the rest of the test run keeps a writable Array.prototype.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { describe } = require("bun:jsc");
         Object.freeze(Array.prototype);
         let threw = false;
         try { Array.prototype.push.call(Array.prototype, 1); } catch (e) { threw = e instanceof TypeError; }
         console.log(JSON.stringify({ threw, frozen: Object.isFrozen(Array.prototype), blank: describe(Array.prototype).includes("ArrayClass") }));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ threw: true, frozen: true, blank: true });
    expect(exitCode).toBe(0);
  });
});
