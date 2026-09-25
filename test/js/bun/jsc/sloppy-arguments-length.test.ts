import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Coverage for oven-sh/WebKit#731. The `arguments` object of a sloppy function whose `length` was overwritten is an
// ordinary array-like: a consumer converts the length with ToLength. JavaScriptCore converted it with ToUint32, so
// -1 was 4294967295 and 2 ** 32 + 1 was 1. A test file is a module, so the sloppy functions here come from the
// Function constructor.

type Make = (...values: unknown[]) => IArguments;

const kinds: Record<string, Make> = {
  // Nothing captures a parameter.
  DirectArguments: new Function("return arguments;") as Make,
  // A closure captures a parameter.
  ScopedArguments: new Function("a", "b", "(function () { return a + b; }); return arguments;") as Make,
};

function withLength(make: Make, length: unknown) {
  const object = make(1, 2);
  (object as any).length = length;
  return object;
}

function plainWithLength(length: unknown) {
  return { 0: 1, 1: 2, length } as unknown as IArguments;
}

function count(this: unknown) {
  return arguments.length;
}

function Count(this: { count: number }) {
  this.count = arguments.length;
}

function outcome(fn: () => unknown) {
  try {
    return fn();
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

// Each of these ends at once for every length below, also where the length wraps. Reflect.construct is not here: for
// a plain object it reads every element before it looks at the length.
const operations: Record<string, (object: IArguments) => unknown> = {
  "f.apply": object => count.apply(null, object as any),
  "Function.prototype.apply.call": object => Function.prototype.apply.call(count, null, object),
  "Reflect.apply": object => Reflect.apply(count, null, object),
  "Math.max.apply": object => Math.max.apply(null, object as any),
  "String.fromCharCode.apply": object => String.fromCharCode.apply(null, object as any).length,
  "slice(0, 3)": object => Array.prototype.slice.call(object, 0, 3),
  "slice(-1)": object => Array.prototype.slice.call(object, -1),
  "indexOf(2)": object => Array.prototype.indexOf.call(object, 2),
  "lastIndexOf(1, 3)": object => Array.prototype.lastIndexOf.call(object, 1, 3),
  "includes(undefined)": object => Array.prototype.includes.call(object, undefined),
  "with(0, 9)": object => Array.prototype.with.call(object, 0, 9),
  "toReversed()": object => Array.prototype.toReversed.call(object),
  "push(7)": object => [Array.prototype.push.call(object, 7), object.length, object[0]],
  "pop()": object => [Array.prototype.pop.call(object), object.length, object[1]],
  "unshift()": object => [Array.prototype.unshift.call(object), object.length],
  "splice(0, 0)": object => [Array.prototype.splice.call(object, 0, 0), object.length],
  "fill(7, 0, 2)": object => (Array.prototype.fill.call(object, 7, 0, 2), [object[0], object[1]]),
};

// ToUint32 and ToLength differ for the first six.
const lengths = [-1, -(2 ** 31), 2 ** 32, 2 ** 32 + 1, 2 ** 53, Infinity, 0, 1, 3, 1.9, "3", NaN];

function table(make: (length: unknown) => IArguments) {
  const rows: Record<string, unknown> = {};
  for (const [name, run] of Object.entries(operations)) {
    for (const length of lengths) {
      rows[`${name}, length ${String(length)}`] = outcome(() => run(make(length)));
    }
  }
  return rows;
}

describe.each(Object.keys(kinds))("%s with an overwritten length", kind => {
  const make = kinds[kind];

  test("a length of 2 ** 32 or more is too long for a call", () => {
    for (const length of [2 ** 32, 2 ** 32 + 1, 2 ** 53, Infinity]) {
      expect(() => count.apply(null, withLength(make, length) as any)).toThrow(RangeError);
      expect(() => Reflect.apply(count, null, withLength(make, length))).toThrow(RangeError);
      expect(() => Reflect.construct(Count, withLength(make, length))).toThrow(RangeError);
    }
  });

  test("a negative length is 0", () => {
    for (const length of [-1, -(2 ** 31), -Infinity]) {
      expect(count.apply(null, withLength(make, length) as any)).toBe(0);
      expect(Reflect.apply(count, null, withLength(make, length))).toBe(0);
      expect(Array.prototype.slice.call(withLength(make, length), 0, 3)).toEqual([]);
      expect(Array.prototype.indexOf.call(withLength(make, length), 1)).toBe(-1);
      expect(Array.prototype.push.call(withLength(make, length), 7)).toBe(1);
    }
  });

  test("every operation gives what it gives for a plain object with that length", () => {
    expect(table(length => withLength(make, length))).toEqual(table(plainWithLength));
  });

  test("the length is read once and converted once", () => {
    for (const value of [1, -1, 2 ** 32 + 1]) {
      for (const [name, run] of Object.entries(operations)) {
        // These store the length, which a getter without a setter does not allow.
        if (["push(7)", "pop()", "unshift()", "splice(0, 0)"].includes(name)) continue;
        const calls = { get: 0, valueOf: 0 };
        const object = make(1, 2);
        Object.defineProperty(object, "length", {
          get() {
            calls.get++;
            return {
              valueOf() {
                calls.valueOf++;
                return value;
              },
            };
          },
        });
        outcome(() => run(object));
        expect({ name, value, ...calls }).toEqual({ name, value, get: 1, valueOf: 1 });
      }
    }
  });
});

test("arguments.length-- in a call without arguments makes the length 0", () => {
  const decrement = new Function(`
    arguments.length--;
    return {
      length: arguments.length,
      apply: (function () { return arguments.length; }).apply(null, arguments),
      slice: Array.prototype.slice.call(arguments, 0, 3),
    };
  `);
  expect(decrement(1, 2)).toEqual({ length: 1, apply: 1, slice: [1] });
  expect(decrement()).toEqual({ length: -1, apply: 0, slice: [] });
});

test("the arguments object of a CommonJS module", async () => {
  using dir = tempDir("sloppy-arguments-length", {
    "index.cjs": `
      function count() { return arguments.length; }
      function outcome(fn) { try { return fn(); } catch (error) { return error.constructor.name; } }
      const result = { actual: arguments.length };
      arguments.length = 2 ** 32 + 1;
      result.over = outcome(() => count.apply(null, arguments));
      arguments.length = -1;
      result.negative = outcome(() => count.apply(null, arguments));
      result.slice = outcome(() => Array.prototype.slice.call(arguments, 0, 3));
      console.log(JSON.stringify(result));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ actual: 5, over: "RangeError", negative: 0, slice: [] });
  expect(exitCode).toBe(0);
});
