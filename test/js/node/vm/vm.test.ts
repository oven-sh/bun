import { describe, expect, test } from "bun:test";
import { createContext, runInContext, runInNewContext, runInThisContext, Script } from "node:vm";

function capture(_: any, _1?: any) {}
describe("runInContext()", () => {
  testRunInContext({ fn: runInContext, isIsolated: true });
  test("options can be a string", () => {
    const context = createContext();
    const result = runInContext("new Error().stack;", context, "test-filename.js");
    expect(result).toContain("test-filename.js");
  });
});

describe("runInNewContext()", () => {
  testRunInContext({ fn: runInNewContext, isIsolated: true, isNew: true });
  test("options can be a string", () => {
    test("options can be a string", () => {
      const result = runInNewContext("new Error().stack;", {}, "test-filename.js");
      expect(result).toContain("test-filename.js");
    });
  });
});

describe("runInThisContext()", () => {
  testRunInContext({ fn: runInThisContext });
  test("options can be a string", () => {
    const result = runInThisContext("new Error().stack;", "test-filename.js");
    expect(result).toContain("test-filename.js");
  });
});

describe("Script", () => {
  describe("runInContext()", () => {
    testRunInContext({
      fn: (code, context, options) => {
        const script = new Script(code, options);
        return script.runInContext(context);
      },
      isIsolated: true,
    });
  });
  describe("runInNewContext()", () => {
    testRunInContext({
      fn: (code, context, options) => {
        const script = new Script(code, options);
        return script.runInNewContext(context);
      },
      isIsolated: true,
      isNew: true,
    });
  });
  describe("runInThisContext()", () => {
    testRunInContext({
      fn: (code: string, options: any) => {
        const script = new Script(code, options);
        return script.runInThisContext();
      },
    });
  });
  test("can throw without new", () => {
    // @ts-ignore
    const result = () => Script();
    expect(result).toThrow({
      name: "TypeError",
      message: "Class constructor Script cannot be invoked without 'new'",
    });
  });
});

type TestRunInContextArg =
  | { fn: typeof runInContext; isIsolated: true; isNew?: boolean }
  | { fn: typeof runInThisContext; isIsolated?: false; isNew?: boolean };

function testRunInContext({ fn, isIsolated, isNew }: TestRunInContextArg) {
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

  for (let View of [
    ArrayBuffer,
    SharedArrayBuffer,
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
  ]) {
    test(`new ${View.name}() in VM context doesn't crash`, () => {
      const context = createContext({});
      expect(fn(`new ${View.name}(2)`, context)).toHaveLength(2);
    });
  }

  test("can return a function", () => {
    const context = createContext({});
    const result = fn("() => 'bar';", context);
    expect(typeof result).toBe("function");
    expect(result()).toBe("bar");
  });
  test("can throw a syntax error", () => {
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
    expect(async () => await fn("Promise.reject(new TypeError('Oops!'));", context)).toThrow({
      name: "TypeError",
      message: "Oops!",
    });
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
    test("can access context", () => {
      const context = createContext({
        foo: "bar",
        fizz: (n: number) => "buzz".repeat(n),
      });
      const result = fn("foo + fizz(2);", context);
      expect(result).toBe("barbuzzbuzz");
    });
    test("can modify context", () => {
      const context = createContext({
        baz: ["a", "b", "c"],
      });
      const result = fn("foo = 'baz'; delete baz[0];", context);
      expect(context.foo).toBe("baz");
      expect(context.baz).toEqual([undefined, "b", "c"]);
      expect(result).toBe(true);
    });
    test("cannot access `process`", () => {
      const context = createContext({});
      const result = fn("typeof process;", context);
      expect(result).toBe("undefined");
    });
    test("cannot access global scope", () => {
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
    test("can specify a filename", () => {
      const context = createContext({});
      const result = fn("new Error().stack;", context, {
        filename: "foo.js",
      });
      expect(result).toContain("foo.js");
    });
  } else {
    test("can access global context", () => {
      const props = randomProps(2);
      // @ts-expect-error
      globalThis[props[0]] = "bar";
      // @ts-expect-error
      globalThis[props[1]] = (n: number) => "buzz".repeat(n);
      try {
        const result = fn(`${props[0]} + ${props[1]}(2);`);
        expect(result).toBe("barbuzzbuzz");
      } finally {
        for (const prop of props) {
          // @ts-expect-error
          delete globalThis[prop];
        }
      }
    });
    test("can modify global context", () => {
      const props = randomProps(3);
      // @ts-expect-error
      globalThis[props[0]] = ["a", "b", "c"];
      // @ts-expect-error
      globalThis[props[1]] = "initial value";
      try {
        const result = fn(`${props[1]} = 'baz'; ${props[2]} = 'bunny'; delete ${props[0]}[0];`);
        // @ts-expect-error
        expect(globalThis[props[1]]).toBe("baz");
        // @ts-expect-error
        expect(globalThis[props[2]]).toBe("bunny");
        // @ts-expect-error
        expect(globalThis[props[0]]).toEqual([undefined, "b", "c"]);
        expect(result).toBe(true);
      } finally {
        for (const prop of props) {
          // @ts-expect-error
          delete globalThis[prop];
        }
      }
    });
    test("can access `process`", () => {
      const result = fn("typeof process;");
      expect(result).toBe("object");
    });
    test("can access this context", () => {
      const prop = randomProp();
      // @ts-expect-error
      globalThis[prop] = "fizz";
      try {
        const result = fn(`${prop};`);
        expect(result).toBe("fizz");
      } finally {
        // @ts-expect-error
        delete globalThis[prop];
      }
    });
    test.skip("can specify an error on SIGINT", () => {
      const result = () =>
        fn("process.kill(process.pid, 'SIGINT');", {
          breakOnSigint: true,
        });
      // TODO: process.kill() is not implemented
      expect(result).toThrow();
    });
    test("can specify a filename", () => {
      const result = fn("new Error().stack;", {
        filename: "foo.js",
      });
      expect(result).toContain("foo.js");
    });
  }
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
function randomProps(propsNumber = 0) {
  const props = [];
  for (let i = 0; i < propsNumber; i++) {
    props.push(randomProp());
  }
  return props;
}

// https://github.com/oven-sh/bun/issues/13629
test("can extend generated globals & WebCore globals", async () => {
  const vm = require("vm");

  for (let j = 0; j < 100; j++) {
    const context = vm.createContext({
      URL,
      urlProto: URL.prototype,
      console,
      Response,
    });

    const code = /*js*/ `
class ExtendedDOMGlobal extends URL {
  constructor(url) {
    super(url);
  }

  get searchParams() {
    return super.searchParams;
  }
}

class ExtendedExtendedDOMGlobal extends ExtendedDOMGlobal {
  constructor(url) {
    super(url);
  }

  get wowSuchGetter() {
    return "wow such getter";
  }
}

const response = new Response();
class ExtendedZigGeneratedClass extends Response {
  constructor(body) {
    super(body);
  }

  get ok() {
    return super.ok;
  }

  get custom() {
    return true;
  }
}

class ExtendedExtendedZigGeneratedClass extends ExtendedZigGeneratedClass {
  constructor(body) {
    super(body);
  }

  get custom() {
    return 42;
  }
}

const resp = new ExtendedZigGeneratedClass("empty");
const resp2 = new ExtendedExtendedZigGeneratedClass("empty");

const url = new ExtendedDOMGlobal("https://example.com/path?foo=bar&baz=qux");
const url2 = new ExtendedExtendedDOMGlobal("https://example.com/path?foo=bar&baz=qux");
if (url.ok !== true) {
  throw new Error("bad");
}
  
if (url2.wowSuchGetter !== "wow such getter") {
  throw new Error("bad");
}

if (!response.ok) {
  throw new Error("bad");
}

URL.prototype.ok = false;

if (url.ok !== false) {
  throw new Error("bad");
}

url.searchParams.get("foo");

if (!resp.custom) {
  throw new Error("expected getter");
}

if (resp2.custom !== 42) {
  throw new Error("expected getter");
}

if (!resp2.ok) {
  throw new Error("expected ok");
}

if (!(resp instanceof ExtendedZigGeneratedClass)) {
  throw new Error("expected ExtendedZigGeneratedClass");
}

if (!(resp instanceof Response)) {
  throw new Error("expected Response");
}

if (!(resp2 instanceof ExtendedExtendedZigGeneratedClass)) {
  throw new Error("expected ExtendedExtendedZigGeneratedClass");
}

if (!(resp2 instanceof ExtendedZigGeneratedClass)) {
  throw new Error("expected ExtendedZigGeneratedClass");
}

if (!(resp2 instanceof Response)) {
  throw new Error("expected Response");
}

if (!resp.ok) {
  throw new Error("expected ok");
}

resp.text().then((a) => {
  if (a !== "empty") {
    throw new Error("expected empty");
  }
});

  `;
    URL.prototype.ok = true;
    await vm.runInContext(code, context);
    delete URL.prototype.ok;
  }
});
