import { describe, it, expect, beforeAll, afterEach, jest } from "bun:test";
import { primordials } from "bun:internal-for-testing";

describe("makeSafe(unsafe, safe)", () => {
  const { makeSafe } = primordials;

  describe("when making a SafeMap", () => {
    let SafeMap: typeof Map;

    beforeAll(() => {
      SafeMap = makeSafe(
        Map,
        class SafeMap extends Map {
          constructor(x) {
            super(x);
          }
        },
      );
    });

    it("has a prototype with the same properties as the original", () => {
      expect(SafeMap.prototype).toEqual(expect.objectContaining(Map.prototype));
    });

    it("has a frozen prototype", () => {
      const desc = Object.getOwnPropertyDescriptor(SafeMap, "prototype");
      expect(desc).toBeDefined();
      expect(desc!.writable).toBeFalse();
    });
  }); // </when making a SafeMap>

  describe("given a custom unsafe iterable class", () => {
    class Unsafe implements Iterable<number> {
      *[Symbol.iterator]() {
        yield 1;
        yield 2;
        yield 3;
      }
      public foo() {
        throw new Error("foo");
      }
    }

    it("when a method throws, a prototype pollution message is thrown", () => {
      expect(() => makeSafe(Unsafe, class Safe extends Unsafe {})).toThrow(
        "Unsafe.prototype.foo thew an error while creating a safe version. This is likely due to prototype pollution.",
      );
    });
  }); // </given a custom unsafe iterable class>

  describe("given a custom unsafe non-iterable class", () => {
    let foo = jest.fn(function foo() {
      throw new Error("foo");
    });

    class Unsafe implements Iterable<number> {
      *[Symbol.iterator]() {
        yield 1;
        yield 2;
        yield 3;
      }
      public foo = foo;
    }

    afterEach(() => {
      foo.mockClear();
    });

    it("makeSafe() does not throw", () => {
      expect(() => makeSafe(Unsafe, class Safe extends Unsafe {})).not.toThrow(
        "Unsafe.prototype.foo thew an error while creating a safe version. This is likely due to prototype pollution.",
      );
    });

    it("Unsafe.foo() is never called()", () => {
      makeSafe(Unsafe, class Safe extends Unsafe {});
      expect(foo).not.toHaveBeenCalled();
    });
  });
}); // </makeSafe(unsafe, safe)>
