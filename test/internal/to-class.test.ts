import { toClassForTesting } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

// $toClass(fn, name, base?, prototype?) gives a function of a built-in module its `prototype`.
// toClassForTesting calls it on a new function that is declared as `function Target() {}`.

const descriptor = Object.getOwnPropertyDescriptor;
const prototypeAttributes = { writable: true, enumerable: false, configurable: false };
const constructorAttributes = { writable: true, enumerable: false, configurable: true };
const nameAttributes = { writable: false, enumerable: false, configurable: true };

class Base {}
class Other {}

describe("$toClass creates the prototype", () => {
  test.each([
    ["no base", undefined, () => Function.prototype, () => Object.prototype],
    ["a class as the base", Base, () => Base, () => Base.prototype],
    ["null as the base", null, () => Function.prototype, () => Object.prototype],
    ["a number as the base", 5, () => Function.prototype, () => Object.prototype],
  ] as const)("%s", (_label, base, parent, prototypeParent) => {
    const Target = toClassForTesting("Target", base);
    expect(descriptor(Target, "prototype")).toEqual({ value: Target.prototype, ...prototypeAttributes });
    expect(Object.getPrototypeOf(Target.prototype)).toBe(prototypeParent());
    expect(Reflect.ownKeys(Target.prototype)).toEqual(["constructor"]);
    expect(descriptor(Target.prototype, "constructor")).toEqual({ value: Target, ...constructorAttributes });
    expect(Object.getPrototypeOf(Target)).toBe(parent());
    expect(descriptor(Target, "name")).toEqual({ value: "Target", ...nameAttributes });
  });

  test("a base whose `prototype` is not an object: the new prototype inherits from Object.prototype", () => {
    function base() {}
    base.prototype = null as any;
    const Target = toClassForTesting("Target", base);
    expect(Object.getPrototypeOf(Target.prototype)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(Target)).toBe(base);
  });

  test("a base with no `prototype` property is a TypeError", () => {
    expect(() => toClassForTesting("Target", () => {})).toThrow(
      new TypeError("Base class must have a prototype property"),
    );
  });

  test("an exception from the `prototype` getter of the base propagates", () => {
    const error = new RangeError("from the getter");
    const base = {
      get prototype() {
        throw error;
      },
    };
    expect(() => toClassForTesting("Target", base)).toThrow(error);
  });

  test("a fourth argument that is not an object is ignored", () => {
    const Target = toClassForTesting("Target", Base, 5);
    expect(Object.getPrototypeOf(Target.prototype)).toBe(Base.prototype);
    expect(descriptor(Target.prototype, "constructor")).toEqual({ value: Target, ...constructorAttributes });
  });
});

describe("$toClass installs an existing prototype", () => {
  test("the object keeps its `constructor`", () => {
    const Target = toClassForTesting("Target", undefined, Other.prototype);
    expect(descriptor(Target, "prototype")).toEqual({ value: Other.prototype, ...prototypeAttributes });
    expect(descriptor(Other.prototype, "constructor")).toEqual({ value: Other, ...constructorAttributes });
    expect(Object.getPrototypeOf(Target)).toBe(Function.prototype);
  });

  test("an object with no `constructor` of its own is not written to", () => {
    const existing = Object.create(Other.prototype);
    const Target = toClassForTesting("Target", undefined, existing);
    expect(Target.prototype).toBe(existing);
    expect(Reflect.ownKeys(existing)).toEqual([]);
  });

  test("the base gives the parent of the function only", () => {
    const Target = toClassForTesting("Target", Base, Other.prototype);
    expect(Target.prototype).toBe(Other.prototype);
    expect(Object.getPrototypeOf(Target)).toBe(Base);
    expect(Object.getPrototypeOf(Other.prototype)).toBe(Object.prototype);
  });
});

describe("$toClass sets the name", () => {
  // The bundler can rename a function declaration, and JSC takes the `name` of a function in a
  // built-in module from its declaration on the first lookup.
  test.each([
    ["before a lookup of `name`", false],
    ["after a lookup of `name`", true],
  ])("the argument is the name: %s", (_label, readNameFirst) => {
    const Target = toClassForTesting("Renamed", undefined, undefined, readNameFirst);
    expect(descriptor(Target, "name")).toEqual({ value: "Renamed", ...nameAttributes });
    expect(Target.bind(null).name).toBe("bound Renamed");
  });

  test("one call site reads the same name from two functions each time", () => {
    const first = toClassForTesting("First");
    const second = toClassForTesting("Second");
    const nameOf = (fn: Function) => fn.name;
    const names = new Set<string>();
    for (let i = 0; i < 20_000; i++) names.add(nameOf(i & 1 ? second : first));
    expect([...names].sort()).toEqual(["First", "Second"]);
  });
});
