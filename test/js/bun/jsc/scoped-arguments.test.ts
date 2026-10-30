import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Coverage for oven-sh/WebKit#948. A test file is a module and its functions are strict, so the sloppy functions
// here come from the Function constructor. JavaScriptCore has two classes for the `arguments` object of a sloppy
// function: DirectArguments, and ScopedArguments when a closure, a direct eval or a `with` can reach a parameter.
// ScopedArguments took the count of declared parameters (2 in every function here) where the count of arguments
// belongs: for the `length` it stores, and for the size of its record of changed property descriptors.

type Arguments = IArguments & Record<PropertyKey, any>;
type Make = (...values: unknown[]) => Arguments;

const kinds: Record<string, Make> = {
  "DirectArguments": new Function("a", "b", "return arguments;") as Make,
  "ScopedArguments (closure)": new Function("a", "b", "(function () { return a + b; }); return arguments;") as Make,
  "ScopedArguments (direct eval)": new Function("a", "b", "eval(''); return arguments;") as Make,
  "ScopedArguments (with)": new Function("a", "b", "with ({}) {} return arguments;") as Make,
  "ScopedArguments (generator)": new Function(
    "a",
    "b",
    "return (function* (a, b) { yield arguments; }).apply(null, arguments).next().value;",
  ) as Make,
};

// None of these stores a `length`. Each one makes the engine turn `length`, `callee` and `Symbol.iterator` into
// ordinary properties of the object, and ScopedArguments stored the wrong `length` then.
const overrides: Record<string, (args: Arguments) => unknown> = {
  "delete arguments.callee": args => delete args.callee,
  "delete arguments[Symbol.iterator]": args => delete args[Symbol.iterator],
  "arguments.callee = 1": args => (args.callee = 1),
  "arguments[Symbol.iterator] = Array.prototype.values": args => (args[Symbol.iterator] = Array.prototype.values),
  "Reflect.set(arguments, 'callee', 1, {})": args => Reflect.set(args, "callee", 1, {}),
  "Object.create(arguments).callee = 1": args => (Object.create(args).callee = 1),
  "Object.defineProperty(arguments, 'callee', { value: 1 })": args =>
    Object.defineProperty(args, "callee", { value: 1 }),
  "Object.defineProperty(arguments, 'length', { writable: false })": args =>
    Object.defineProperty(args, "length", { writable: false }),
  "Object.freeze(arguments)": args => Object.freeze(args),
  "Object.seal(arguments)": args => Object.seal(args),
};

// More arguments than parameters, as many, and fewer.
const argumentLists = [[1, 2, 3, 4, 5], [1, 2, 3], [1, 2], [1], []];

function count() {
  return arguments.length;
}

function enumerated(object: object) {
  const keys: string[] = [];
  for (const key in object) keys.push(key);
  return keys.sort();
}

describe.each(Object.keys(kinds))("%s", kind => {
  const make = kinds[kind];

  test.each(Object.keys(overrides))("length is the number of arguments after %s", name => {
    for (const values of argumentLists) {
      const args = make(...values);
      overrides[name](args);
      expect({
        length: args.length,
        descriptor: Object.getOwnPropertyDescriptor(args, "length")!.value,
        apply: count.apply(null, args),
        slice: Array.prototype.slice.call(args),
        from: Symbol.iterator in args ? Array.from(args) : values,
      }).toEqual({
        length: values.length,
        descriptor: values.length,
        apply: values.length,
        slice: values,
        from: values,
      });
    }
  });

  // Index 0 has a parameter. Index 3 is an argument past the parameters.
  describe.each([0, 3])("the argument at index %d", index => {
    test("stays non-enumerable", () => {
      const args = make(1, 2, 3, 4);
      Object.defineProperty(args, index, { enumerable: false });
      expect(Object.getOwnPropertyDescriptor(args, index)).toEqual({
        value: index + 1,
        writable: true,
        enumerable: false,
        configurable: true,
      });
      expect(enumerated(args)).toEqual(["0", "1", "2", "3"].filter(key => key !== String(index)));
    });

    test("stays non-configurable", () => {
      const args = make(1, 2, 3, 4);
      Object.defineProperty(args, index, { configurable: false });
      expect(Object.getOwnPropertyDescriptor(args, index)).toEqual({
        value: index + 1,
        writable: true,
        enumerable: true,
        configurable: false,
      });
      expect(Reflect.deleteProperty(args, index)).toBe(false);
      expect(args[index]).toBe(index + 1);
      expect(() => Object.defineProperty(args, index, { configurable: true })).toThrow(TypeError);
      expect(() => Object.defineProperty(args, index, { enumerable: false })).toThrow(TypeError);
      expect(Reflect.defineProperty(args, index, { configurable: true })).toBe(false);
    });

    test("is gone after a delete that follows a defineProperty", () => {
      const args = make(1, 2, 3, 4);
      Object.defineProperty(args, index, { value: "defined" });
      args[index] = "stored";
      expect(Reflect.deleteProperty(args, index)).toBe(true);
      expect({ has: index in args, value: args[index] }).toEqual({ has: false, value: undefined });
    });
  });

  test("Object.seal seals every argument", () => {
    const args = make(1, 2, 3, 4);
    Object.seal(args);
    expect(Object.isSealed(args)).toBe(true);
    expect([0, 1, 2, 3].map(index => Reflect.deleteProperty(args, index))).toEqual([false, false, false, false]);
    for (let index = 0; index < 4; index++) args[index] = -index;
    expect(Array.prototype.slice.call(args)).toEqual([-0, -1, -2, -3]);
  });

  test("Object.freeze freezes every argument", () => {
    const args = make(1, 2, 3, 4);
    Object.freeze(args);
    expect(Object.isFrozen(args)).toBe(true);
    for (let index = 0; index < 4; index++) Reflect.set(args, index, 9);
    expect(Array.prototype.slice.call(args)).toEqual([1, 2, 3, 4]);
  });
});

test("arguments.length of a function in a CommonJS module after delete arguments.callee", async () => {
  using dir = tempDir("scoped-arguments", {
    "index.cjs": `
      function scoped(a) {
        const read = () => a;
        read();
        return arguments;
      }
      const more = scoped(1, 2, 3);
      delete more.callee;
      const fewer = (function (a, b, c) {
        const read = () => a + b + c;
        read();
        return arguments;
      })(1);
      delete fewer.callee;
      console.log(JSON.stringify([more.length, Array.from(more), fewer.length, Array.from(fewer)]));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("[3,[1,2,3],1,[1]]\n");
  expect(exitCode).toBe(0);
});
