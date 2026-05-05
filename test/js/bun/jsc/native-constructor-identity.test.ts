// Regression coverage for the Windows /OPT:ICF → /OPT:SAFEICF linker change.
//
// Aggressive COMDAT folding (/OPT:ICF) merged JSC native host functions whose
// bodies were byte-identical — e.g. callBigIntConstructor and
// constructWithBigIntConstructor both just throw. JSC's InternalFunction
// decides "is this a constructor" by comparing those two function pointers
// for identity, so after folding `new BigInt()` stopped throwing the right
// error and `expect.any(Ctor)` matchers broke (commit 218430c731).
//
// /OPT:SAFEICF skips address-taken functions, so these pointer-identity
// checks must keep working on Windows release builds. The assertions below
// are cheap to run everywhere and act as the trip-wire if ICF is ever made
// aggressive again.

import { describe, expect, test } from "bun:test";

describe("native constructor identity survives ICF", () => {
  test("BigInt is callable but not constructable", () => {
    expect(BigInt(1)).toBe(1n);
    expect(() => new (BigInt as any)(1)).toThrow(TypeError);
    // Symbol has the same call/construct split in JSC.
    expect(typeof Symbol("x")).toBe("symbol");
    expect(() => new (Symbol as any)("x")).toThrow(TypeError);
  });

  test("expect.any distinguishes builtin constructors with identical bodies", () => {
    // These asymmetric matchers walk the prototype chain via each
    // constructor's [[Prototype]]. If ICF merged the constructor host
    // functions, the positive cases still pass but the negative cases
    // would start matching the wrong type.
    expect(1n).toEqual(expect.any(BigInt));
    expect(1n).not.toEqual(expect.any(Number));
    expect("s").toEqual(expect.any(String));
    expect("s").not.toEqual(expect.any(Number));
    expect(true).toEqual(expect.any(Boolean));
    expect(true).not.toEqual(expect.any(BigInt));

    expect(new Map()).toEqual(expect.any(Map));
    expect(new Map()).not.toEqual(expect.any(Set));
    expect(new WeakMap()).toEqual(expect.any(WeakMap));
    expect(new WeakMap()).not.toEqual(expect.any(WeakSet));
  });

  test("typed array constructors remain distinct", () => {
    // All the JSGenericTypedArrayViewConstructor instantiations share
    // near-identical code; make sure each still resolves to its own type.
    const ctors = [
      Int8Array,
      Uint8Array,
      Uint8ClampedArray,
      Int16Array,
      Uint16Array,
      Int32Array,
      Uint32Array,
      Float32Array,
      Float64Array,
      BigInt64Array,
      BigUint64Array,
    ] as const;

    for (let i = 0; i < ctors.length; i++) {
      const a = new ctors[i](1);
      for (let j = 0; j < ctors.length; j++) {
        if (i === j) {
          expect(a).toBeInstanceOf(ctors[j]);
          expect(a).toEqual(expect.any(ctors[j]));
        } else {
          expect(a).not.toBeInstanceOf(ctors[j]);
        }
      }
    }
  });

  test("Bun native class constructors remain distinct", () => {
    // Generated ZigGeneratedClasses constructors are highly repetitive and
    // prime candidates for folding.
    expect(new Request("http://x/")).toBeInstanceOf(Request);
    expect(new Request("http://x/")).not.toBeInstanceOf(Response);
    expect(new Response("")).toBeInstanceOf(Response);
    expect(new Response("")).not.toBeInstanceOf(Request);
    expect(new Blob([])).toBeInstanceOf(Blob);
    expect(new Blob([])).not.toBeInstanceOf(Response);
  });
});
