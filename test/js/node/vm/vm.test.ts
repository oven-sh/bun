import { describe, test, expect } from "bun:test";
import { createContext, runInContext, runInNewContext, runInThisContext, Script } from "node:vm";

function capture(_: any, _1?: any) {}
describe("runInContext()", () => {
  testRunInContext(runInContext, { isIsolated: true });
});

describe("runInNewContext()", () => {
  testRunInContext(runInNewContext, { isIsolated: true, isNew: true });
});

describe("runInThisContext()", () => {
  testRunInContext(runInThisContext);
});

describe("Script", () => {
  describe("runInContext()", () => {
    testRunInContext(
      (code, context, options) => {
        // @ts-expect-error
        const script = new Script(code, options);
        return script.runInContext(context);
      },
      { isIsolated: true },
    );
  });
  describe("runInNewContext()", () => {
    testRunInContext(
      (code, context, options) => {
        // @ts-expect-error
        const script = new Script(code, options);
        return script.runInNewContext(context);
      },
      { isIsolated: true, isNew: true },
    );
  });
  describe("runInThisContext()", () => {
    testRunInContext((code, context, options) => {
      // @ts-expect-error
      const script = new Script(code, options);
      return script.runInThisContext(context);
    });
  });
});

function testRunInContext(
  fn: typeof runInContext,
  {
    isIsolated,
    isNew,
  }: {
    isIsolated?: boolean;
    isNew?: boolean;
  } = {},
) {
  test("can do nothing", () => {
    const context = createContext({});
    const result = fn("", context);
    expect(result).toBeUndefined();
  });
  test("can return a value", () => {
    const context = createContext({});
    const result = fn("1 + 1;", context);
    expect(result).toBe(2);
  });
  test("can return a complex value", () => {
    const context = createContext({});
    const result = fn("new Set([1, 2, 3]);", context);
    expect(result).toStrictEqual(new Set([1, 2, 3]));
  });
  test("can return the last value", () => {
    const context = createContext({});
    const result = fn("1 + 1; 2 * 2; 3 / 3", context);
    expect(result).toBe(1);
  });
  test("can return a function", () => {
    const context = createContext({});
    const result = fn("() => 'bar';", context);
    expect(typeof result).toBe("function");
    expect(result()).toBe("bar");
  });
  test.skip("can throw a syntax error", () => {
    const context = createContext({});
    const result = () => fn("!?", context);
    expect(result).toThrow({
      name: "SyntaxError",
      message: "Unexpected token '?'",
    });
  });
  test("can throw an error", () => {
    const context = createContext({});
    const result = () => fn("throw new TypeError('Oops!');", context);
    expect(result).toThrow({
      name: "TypeError",
      message: "Oops!",
    });
  });
  test("can resolve a promise", async () => {
    const context = createContext({});
    const result = fn("Promise.resolve(true);", context);
    expect(await result).toBe(true);
  });
  test("can reject a promise", () => {
    const context = createContext({});
    const result = fn("Promise.reject(new TypeError('Oops!'));", context);
    expect(async () => await result).toThrow({
      name: "TypeError",
      message: "Oops!",
    });
  });
  test("can access the context", () => {
    const context = createContext({
      foo: "bar",
      fizz: (n: number) => "buzz".repeat(n),
    });
    const result = fn("foo + fizz(2);", context);
    expect(result).toBe("barbuzzbuzz");
  });
  test("can modify the context", () => {
    const context = createContext({
      foo: "bar",
      baz: ["a", "b", "c"],
    });
    const result = fn("foo = 'baz'; delete baz[0];", context);
    expect(context.foo).toBe("baz");
    expect(context.baz).toEqual([undefined, "b", "c"]);
    expect(result).toBe(true);
  });
  test("can access `globalThis`", () => {
    const context = createContext({});
    const result = fn("typeof globalThis;", context);
    expect(result).toBe("object");
  });
  test("cannot access local scope", () => {
    var foo = "bar"; // intentionally unused
    capture(foo, foo);
    const context = createContext({});
    const result = fn("typeof foo;", context);
    expect(result).toBe("undefined");
  });
  if (isIsolated) {
    test("cannot access `process`", () => {
      const context = createContext({});
      const result = fn("typeof process;", context);
      expect(result).toBe("undefined");
    });
    test("cannot access this context", () => {
      const prop = randomProp();
      // @ts-expect-error
      globalThis[prop] = "fizz";
      try {
        const context = createContext({});
        const result = fn(`typeof ${prop};`, context);
        expect(result).toBe("undefined");
      } finally {
        // @ts-expect-error
        delete globalThis[prop];
      }
    });
  } else {
    test("can access `process`", () => {
      const context = createContext({});
      const result = fn("typeof process;", context);
      expect(result).toBe("object");
    });
    test("can access this context", () => {
      const prop = randomProp();
      // @ts-expect-error
      globalThis[prop] = "fizz";
      try {
        const context = createContext({});
        const result = fn(`${prop};`, context);
        expect(result).toBe("fizz");
      } finally {
        // @ts-expect-error
        delete globalThis[prop];
      }
    });
    test.skip("can specify an error on SIGINT", () => {
      const context = createContext({});
      const result = () =>
        fn("process.kill(process.pid, 'SIGINT');", context, {
          breakOnSigint: true,
        });
      // TODO: process.kill() is not implemented
      expect(result).toThrow();
    });
  }
  test("can specify a filename", () => {
    const context = createContext({});
    const result = fn("new Error().stack;", context, {
      filename: "foo.js",
    });
    expect(result).toContain("foo.js");
  });
  test.skip("can specify a line offset", () => {
    // TODO: use test.todo
  });
  test.skip("can specify a column offset", () => {
    // TODO: use test.todo
  });
  test.skip("can specify a timeout", () => {
    const context = createContext({});
    const result = () =>
      fn("while (true) {};", context, {
        timeout: 1,
      });
    expect(result).toThrow(); // TODO: does not timeout
  });
}

function randomProp() {
  return "prop" + crypto.randomUUID().replace(/-/g, "");
}
