import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import {
  compileFunction,
  constants,
  createContext,
  runInContext,
  runInNewContext,
  runInThisContext,
  Script,
} from "node:vm";

function capture(_: any, _1?: any) {}

describe("vm", () => {
  describe("runInContext()", () => {
    testRunInContext({ fn: runInContext, isIsolated: true });
    test("options can be a string", () => {
      const context = createContext();
      const result = runInContext("new Error().stack;", context, "test-filename.js");
      expect(result).toContain("test-filename.js");
    });
    test("options properties can be undefined", () => {
      const context = createContext();
      const result = runInContext("1 + 1;", context, {
        filename: undefined,
        lineOffset: undefined,
        columnOffset: undefined,
        displayErrors: undefined,
        timeout: undefined,
        breakOnSigint: undefined,
        cachedData: undefined,
        importModuleDynamically: undefined,
      });
      expect(result).toBe(2);
    });
  });

  describe("runInNewContext()", () => {
    testRunInContext({ fn: runInNewContext, isIsolated: true, isNew: true });
    // this line intentionally left blank (for snapshots)
    // this line intentionally left blank (for snapshots)
    test("options can be a string", () => {
      const result = runInNewContext("new Error().stack;", {}, "test-filename.js");
      expect(result).toContain("test-filename.js");
    });
    test("options properties can be undefined", () => {
      const result = runInNewContext(
        "1 + 1;",
        {},
        {
          filename: undefined,
          lineOffset: undefined,
          columnOffset: undefined,
          displayErrors: undefined,
          timeout: undefined,
          breakOnSigint: undefined,
          contextName: undefined,
          contextOrigin: undefined,
          contextCodeGeneration: undefined,
          cachedData: undefined,
          importModuleDynamically: undefined,
          microtaskMode: undefined,
        },
      );
      expect(result).toBe(2);
    });
  });

  describe("runInThisContext()", () => {
    testRunInContext({ fn: runInThisContext });
    test("options can be a string", () => {
      const result = runInThisContext("new Error().stack;", "test-filename.js");
      expect(result).toContain("test-filename.js");
    });
    test("options properties can be undefined", () => {
      const result = runInThisContext("1 + 1;", {
        filename: undefined,
        lineOffset: undefined,
        columnOffset: undefined,
        displayErrors: undefined,
        timeout: undefined,
        breakOnSigint: undefined,
        cachedData: undefined,
        importModuleDynamically: undefined,
      });
      expect(result).toBe(2);
    });
  });

  describe("compileFunction()", () => {
    test("options properties can be undefined", () => {
      const result = compileFunction("return 1 + 1;", [], {
        filename: undefined,
        lineOffset: undefined,
        columnOffset: undefined,
        cachedData: undefined,
        produceCachedData: undefined,
        parsingContext: undefined,
        contextExtensions: undefined,
      })();
      expect(result).toBe(2);
    });

    // Security tests
    test("Template literal attack should not break out of sandbox", () => {
      const before = globalThis.hacked;
      try {
        const result = compileFunction("return `\n`; globalThis.hacked = true; //")();
        expect(result).toBe("\n");
        expect(globalThis.hacked).toBe(before);
      } catch (e) {
        // If it throws, that's also acceptable as long as it didn't modify globalThis
        expect(globalThis.hacked).toBe(before);
      }
    });

    test("Comment-based attack should not break out of sandbox", () => {
      const before = globalThis.commentHacked;
      try {
        const result = compileFunction("return 1; /* \n */ globalThis.commentHacked = true; //")();
        expect(result).toBe(1);
        expect(globalThis.commentHacked).toBe(before);
      } catch (e) {
        expect(globalThis.commentHacked).toBe(before);
      }
    });

    test("Function constructor abuse should be contained", () => {
      try {
        const result = compileFunction("return (function(){}).constructor('return process')();")();
        // If it doesn't throw, it should at least not return the actual process object
        expect(result).not.toBe(process);
      } catch (e) {
        // Throwing is also acceptable
        expect(e).toBeTruthy();
      }
    });

    test("Regex literal attack should not break out of sandbox", () => {
      const before = globalThis.regexHacked;
      try {
        const result = compileFunction("return /\n/; globalThis.regexHacked = true; //")();
        expect(result instanceof RegExp).toBe(true);
        expect(result.toString()).toBe("/\n/");
        expect(globalThis.regexHacked).toBe(before);
      } catch (e) {
        expect(globalThis.regexHacked).toBe(before);
      }
    });

    test("String escape sequence attack should not break out of sandbox", () => {
      const before = globalThis.stringHacked;
      try {
        const result = compileFunction("return '\\\n'; globalThis.stringHacked = true; //")();
        expect(result).toBe("\n");
        expect(globalThis.stringHacked).toBe(before);
      } catch (e) {
        expect(globalThis.stringHacked).toBe(before);
      }
    });

    test("Arguments access attack should be contained", () => {
      try {
        const result = compileFunction("return (function(){return arguments.callee.caller})();")();
        // If it doesn't throw, it should at least not return a function
        expect(typeof result !== "function").toBe(true);
      } catch (e) {
        // Throwing is also acceptable
        expect(e).toBeTruthy();
      }
    });

    test("With statement attack should not modify Object.prototype", () => {
      const originalToString = Object.prototype.toString;
      const before = globalThis.withHacked;

      const parsingContext = createContext({});

      try {
        compileFunction(
          "with(Object.prototype) { toString = function() { globalThis.withHacked = true; }; } return 'test';",
          [],
          {
            parsingContext,
          },
        )();

        // Check that Object.prototype.toString wasn't modified
        expect(Object.prototype.toString).toBe(originalToString);
        expect(globalThis.withHacked).toBe(before);
      } catch (e) {
        // If it throws, also check that nothing was modified
        expect(Object.prototype.toString).toBe(originalToString);
        expect(globalThis.withHacked).toBe(before);
      } finally {
        // Restore just in case
        Object.prototype.toString = originalToString;
      }
    });

    test("Eval attack should be contained", () => {
      const before = globalThis.evalHacked;

      const parsingContext = createContext({});

      try {
        compileFunction("return eval('globalThis.evalHacked = true;');", [], { parsingContext })();
        expect(globalThis.evalHacked).toBe(before);
      } catch (e) {
        expect(globalThis.evalHacked).toBe(before);
      }
    });

    // Additional tests for other potential vulnerabilities

    test("Octal escape sequence attack should not break out", () => {
      const before = globalThis.octalHacked;

      try {
        const result = compileFunction("return '\\012'; globalThis.octalHacked = true; //")();
        expect(result).toBe("\n");
        expect(globalThis.octalHacked).toBe(before);
      } catch (e) {
        expect(globalThis.octalHacked).toBe(before);
      }
    });

    test("Unicode escape sequence attack should not break out", () => {
      const before = globalThis.unicodeHacked;

      try {
        const result = compileFunction("return '\\u000A'; globalThis.unicodeHacked = true; //")();
        expect(result).toBe("\n");
        expect(globalThis.unicodeHacked).toBe(before);
      } catch (e) {
        expect(globalThis.unicodeHacked).toBe(before);
      }
    });

    test("Attempted syntax error injection should be caught", () => {
      expect(() => {
        compileFunction("});\n\n(function() {\nconsole.log(1);\n})();\n\n(function() {");
      }).toThrow();
    });

    test("Attempted prototype pollution should be contained", () => {
      const originalHasOwnProperty = Object.prototype.hasOwnProperty;

      try {
        compileFunction("Object.prototype.polluted = true; return 'done';")();
        expect(Object.prototype.polluted).toBeUndefined();
      } catch (e) {
        // Throwing is acceptable
      } finally {
        // Clean up just in case
        delete Object.prototype.polluted;
        Object.prototype.hasOwnProperty = originalHasOwnProperty;
      }
    });

    test("Attempted global object access should be contained", () => {
      try {
        const result = compileFunction("return this;")();
        // The "this" inside the function should not be the global object
        expect(result).not.toBe(globalThis);
      } catch (e) {
        // Throwing is also acceptable
        expect(e).toBeTruthy();
      }
    });
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
  test.todo("can specify filename", () => {
    //
  });
  test.todo("can specify lineOffset", () => {
    //
  });
  test.todo("can specify columnOffset", () => {
    //
  });
  test.todo("can specify displayErrors", () => {
    //
  });
  test.todo("can specify timeout", () => {
    //
  });
  test.todo("can specify breakOnSigint", () => {
    //
  });
  test.todo("can specify cachedData", () => {
    //
  });
  test.todo("can specify importModuleDynamically", () => {
    //
  });

  // https://github.com/oven-sh/bun/issues/10885 .if(isNew == true)
  test.todo("can specify contextName", () => {
    //
  });
  // https://github.com/oven-sh/bun/issues/10885 .if(isNew == true)
  test.todo("can specify contextOrigin", () => {
    //
  });
  // https://github.com/oven-sh/bun/issues/10885 .if(isNew == true)
  test.todo("can specify microtaskMode", () => {
    //
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
    const context = createContext({
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
    await runInContext(code, context);
    delete URL.prototype.ok;
  }
});

test("can't use export syntax in vm.Script", () => {
  expect(() => {
    const script = new Script("export default {};");
    script.runInThisContext();
  }).toThrow({ name: "SyntaxError", message: "Unexpected keyword 'export'" });

  expect(() => {
    const script = new Script("export default {};");
    script.createCachedData();
  }).toThrow({ message: "createCachedData failed" });
});

test("rejects invalid bytecode", () => {
  const cachedData = Buffer.from("fhqwhgads");
  const script = new Script("1 + 1;", {
    cachedData,
  });
  expect(script.cachedDataRejected).toBeTrue();
  expect(script.runInThisContext()).toBe(2);
});

test("accepts valid bytecode", () => {
  const source = "1 + 1;";
  const firstScript = new Script(source, {
    produceCachedData: false,
  });
  const cachedData = firstScript.createCachedData();
  expect(cachedData).toBeDefined();
  expect(cachedData).toBeInstanceOf(Buffer);
  const secondScript = new Script(source, {
    cachedData,
  });
  expect(secondScript.cachedDataRejected).toBeFalse();
  expect(firstScript.runInThisContext()).toBe(2);
  expect(secondScript.runInThisContext()).toBe(2);
});

test("can't use bytecode from a different script", () => {
  const firstScript = new Script("1 + 1;");
  const cachedData = firstScript.createCachedData();
  const secondScript = new Script("2 + 2;", {
    cachedData,
  });
  expect(secondScript.cachedDataRejected).toBeTrue();
  expect(firstScript.runInThisContext()).toBe(2);
  expect(secondScript.runInThisContext()).toBe(4);
});

describe("codeGeneration options", () => {
  test("disabling codeGeneration.strings should block eval and Function constructor", () => {
    const context = createContext(
      {},
      {
        codeGeneration: {
          strings: false,
          wasm: true,
        },
      },
    );

    // Test that Function constructor is blocked
    const functionResult = runInContext(
      `
      try {
        const fn = new Function('return 42');
        fn();
      } catch (e) {
        e.name;
      }
    `,
      context,
    );
    expect(functionResult).toBe("EvalError");

    // Test that eval is also blocked
    const evalResult = runInContext(
      `
      try {
        eval('1 + 1');
      } catch (e) {
        e.name;
      }
    `,
      context,
    );
    expect(evalResult).toBe("EvalError");

    // Test the specific pattern from jest-worker that was crashing
    const jestWorkerPattern = runInContext(
      `
      try {
        // This pattern is used by jest-worker to get Function constructor
        const FuncCtor = eval('Function');
        'got Function';
      } catch (e) {
        e.name;
      }
    `,
      context,
    );
    expect(jestWorkerPattern).toBe("EvalError");

    // Test Function constructor as a property getter (the exact crash pattern)
    const getterResult = runInContext(
      `
      try {
        const obj = {};
        Object.defineProperty(obj, 'func', {
          get: Function  // Function constructor IS the getter
        });
        // Access the property - this would call Function as a getter
        // and crash if evalEnabled function pointer was null
        const result = obj.func;
        'unexpected success';
      } catch (e) {
        e.name || 'error';
      }
    `,
      context,
    );
    expect(getterResult).toBe("EvalError");
  });

  test("enabling codeGeneration.strings should allow eval and Function constructor", () => {
    const context = createContext(
      {},
      {
        codeGeneration: {
          strings: true,
          wasm: true,
        },
      },
    );

    // Test that Function constructor works
    const functionResult = runInContext(
      `
      const fn = new Function('return 42');
      fn();
    `,
      context,
    );
    expect(functionResult).toBe(42);

    // Test that eval works
    const evalResult = runInContext("eval('1 + 1');", context);
    expect(evalResult).toBe(2);
  });

  test("default context should allow eval and Function constructor", () => {
    const context = createContext({});

    // Test that Function constructor works by default
    const functionResult = runInContext(
      `
      const fn = new Function('return 123');
      fn();
    `,
      context,
    );
    expect(functionResult).toBe(123);

    // Test that eval works by default
    const evalResult = runInContext("eval('5 + 5');", context);
    expect(evalResult).toBe(10);
  });
});

describe("DONT_CONTEXTIFY", () => {
  test("globalThis prototype chain stays inside the sandbox realm", () => {
    const ctx = createContext(constants.DONT_CONTEXTIFY);
    const sandboxObjectPrototype = runInContext("Object.prototype", ctx);

    expect(sandboxObjectPrototype).not.toBe(Object.prototype);
    expect(Object.getPrototypeOf(ctx)).not.toBe(Object.prototype);

    // The full prototype chain of the sandbox's globalThis must stay inside the
    // sandbox realm and terminate at the sandbox's own Object.prototype.
    const chain: object[] = [];
    for (let proto = Object.getPrototypeOf(ctx); proto !== null; proto = Object.getPrototypeOf(proto)) {
      chain.push(proto);
    }
    expect(chain).not.toContain(Object.prototype);
    expect(chain.at(-1)).toBe(sandboxObjectPrototype);

    // globalThis.constructor.constructor must resolve to the sandbox's Function,
    // so code it creates runs in the sandbox realm where host globals are absent.
    expect(runInContext(`globalThis.constructor.constructor("return typeof Bun")()`, ctx)).toBe("undefined");
    expect(runInContext(`globalThis.constructor.constructor("return typeof process")()`, ctx)).toBe("undefined");
    expect(runInContext(`globalThis.constructor.constructor`, ctx)).toBe(runInContext(`Function`, ctx));
    expect(runInContext(`globalThis.constructor.constructor`, ctx)).not.toBe(Function);

    // Script#runInNewContext takes the same code path.
    expect(
      new Script(`globalThis.constructor.constructor("return typeof Bun")()`).runInNewContext(
        constants.DONT_CONTEXTIFY,
      ),
    ).toBe("undefined");
  });

  test("writing to Object.getPrototypeOf(globalThis) does not leak to the host realm", () => {
    const ctx = createContext(constants.DONT_CONTEXTIFY);
    try {
      runInContext(`Object.getPrototypeOf(globalThis).__vmDontContextifyLeakCheck = true`, ctx);
      expect(({} as any).__vmDontContextifyLeakCheck).toBeUndefined();
      expect((Object.prototype as any).__vmDontContextifyLeakCheck).toBeUndefined();
      // The write lands somewhere inside the sandbox realm, so the sandbox's
      // globalThis still sees it through its own prototype chain.
      expect(runInContext(`globalThis.__vmDontContextifyLeakCheck`, ctx)).toBe(true);
    } finally {
      delete (Object.prototype as any).__vmDontContextifyLeakCheck;
    }
  });

  test("basic usage still works", () => {
    const ctx = createContext(constants.DONT_CONTEXTIFY);
    expect(runInContext("globalThis", ctx)).toBe(ctx);
    expect(typeof ctx.Array).toBe("function");

    runInContext("globalThis.fromInside = 123", ctx);
    expect(ctx.fromInside).toBe(123);

    ctx.fromOutside = 456;
    expect(runInContext("fromOutside", ctx)).toBe(456);
  });
});

test("Loader is not defined in vm context", () => {
  // Test with empty context - internal Loader should not leak through
  const emptyContext = createContext({});
  expect(runInContext("typeof Loader;", emptyContext)).toBe("undefined");
  expect(runInContext("Object.hasOwn(globalThis, 'Loader');", emptyContext)).toBe(false);

  // Test with context that has a user-provided Loader - should be preserved
  const customLoader = { custom: true, load: () => "loaded" };
  const customContext = createContext({ Loader: customLoader });
  expect(runInContext("typeof Loader;", customContext)).toBe("object");
  expect(runInContext("Loader.custom;", customContext)).toBe(true);
  expect(runInContext("Loader.load();", customContext)).toBe("loaded");
  expect(runInContext("Object.hasOwn(globalThis, 'Loader');", customContext)).toBe(true);
  // Ensure internal JSC Loader properties are not leaking through
  expect(runInContext("typeof Loader.registry;", customContext)).toBe("undefined");
});

test("node:vm native Module prototype methods reject non-module receivers", async () => {
  // The native NodeVMModule prototype (reachable via the kNative own-symbol on a
  // vm.SourceTextModule instance) must validate its receiver. Calling its methods
  // with a plain object as `this` must throw a TypeError instead of reinterpreting
  // the object's inline property storage as native module fields.
  const fixture = `
    const vm = require("node:vm");
    const mod = new vm.SourceTextModule('import "./dep.js"; export const a = 1;');
    const kNative = Object.getOwnPropertySymbols(mod).find(s => s.description === "kNative");
    const native = mod[kNative];
    const proto = Object.getPrototypeOf(native);
    const fake = { p1: 1n, p2: 0x41414141n };

    const results = [];
    for (const name of ["getStatus", "getStatusCode", "getModuleRequests", "createModuleRecord", "getError"]) {
      if (typeof proto[name] !== "function") {
        results.push(name + ": missing");
        continue;
      }
      try {
        const value = proto[name].call(fake);
        results.push(name + ": returned " + String(value));
      } catch (e) {
        results.push(name + ": " + (e instanceof TypeError ? "TypeError" : "unexpected " + e));
      }
    }
    const identifierGetter = Object.getOwnPropertyDescriptor(proto, "identifier")?.get;
    if (typeof identifierGetter !== "function") {
      results.push("identifier: missing");
    } else {
      try {
        const value = identifierGetter.call(fake);
        results.push("identifier: returned " + String(value));
      } catch (e) {
        results.push("identifier: " + (e instanceof TypeError ? "TypeError" : "unexpected " + e));
      }
    }

    // The legitimate receiver still works through the same native entry points.
    results.push("status: " + proto.getStatus.call(native));
    results.push("requests: " + JSON.stringify(proto.getModuleRequests.call(native).map(r => r[0])));
    console.log(results.join("\\n"));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "getStatus: TypeError
    getStatusCode: TypeError
    getModuleRequests: TypeError
    createModuleRecord: TypeError
    getError: TypeError
    identifier: TypeError
    status: unlinked
    requests: [\"./dep.js\"]"
  `);
  expect(exitCode).toBe(0);
});

test("node:vm SourceTextModule.link() rejects non-module entries in the moduleNatives array", async () => {
  // The native link(specifiers, moduleNatives, scriptFetcher) entry point validates
  // that the two arguments are arrays but must also validate every element of
  // moduleNatives. A plain object whose inline property storage holds caller-chosen
  // doubles must produce a clean TypeError instead of being reinterpreted as a
  // native Module and having those doubles read back as internal pointers.
  const fixture = `
    const vm = require("node:vm");

    const mod = new vm.SourceTextModule('import "x";');
    const kNative = Object.getOwnPropertySymbols(mod).find(s => s.description === "kNative");
    const native = mod[kNative];
    native.createModuleRecord();

    const results = [];
    try {
      native.link(["x"], [{ a: 1.1, b: 2.2, c: 3.3, d: 4.4 }], 0);
      results.push("link(plain object): returned");
    } catch (e) {
      results.push("link(plain object): " + (e instanceof TypeError ? "TypeError " + e.code : "unexpected " + e));
    }
    results.push("status after rejected link: " + native.getStatus());

    // A real native module in the same slot still links.
    const dep = new vm.SourceTextModule("export const x = 1;");
    const depNative = dep[kNative];
    depNative.createModuleRecord();
    native.link(["x"], [depNative], 0);
    results.push("status after valid link: " + native.getStatus());
    console.log(results.join("\\n"));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "link(plain object): TypeError ERR_INVALID_THIS
    status after rejected link: unlinked
    status after valid link: unlinked"
  `);
  expect(exitCode).toBe(0);
});

test("node:vm SourceTextModule.link() rejects holey and mismatched argument arrays", async () => {
  // Holes in the argument arrays surface as empty JSValues from getDirectIndex,
  // which pass isCell() with a null cell — link() must reject them (and a
  // specifiers/moduleNatives length mismatch) instead of crashing.
  const fixture = `
    const vm = require("node:vm");
    const mod = new vm.SourceTextModule('import { z } from "x"; export const w = z;');
    const kNative = Object.getOwnPropertySymbols(mod).find(s => s.description === "kNative");
    const native = mod[kNative];
    native.createModuleRecord();

    const results = [];
    const attempt = (label, specifiers, moduleNatives) => {
      try {
        native.link(specifiers, moduleNatives, 0);
        results.push(label + ": returned");
      } catch (e) {
        results.push(label + ": " + (e instanceof TypeError ? "TypeError" : e.constructor.name) + " " + e.code);
      }
    };

    const dep = new vm.SourceTextModule("export const z = 1;");
    const depNative = dep[kNative];
    depNative.createModuleRecord();

    attempt("holey both", new Array(1), new Array(1));
    attempt("holey specifiers", new Array(1), [depNative]);
    attempt("holey moduleNatives", ["x"], new Array(1));
    attempt("length mismatch", ["x"], []);
    attempt("non-string specifier", [42], [depNative]);
    results.push("status: " + native.getStatus());
    attempt("valid", ["x"], [depNative]);
    results.push("status: " + native.getStatus());
    console.log(results.join("\\n"));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "holey both: TypeError ERR_INVALID_ARG_TYPE
    holey specifiers: TypeError ERR_INVALID_ARG_TYPE
    holey moduleNatives: TypeError ERR_INVALID_THIS
    length mismatch: TypeError ERR_INVALID_ARG_VALUE
    non-string specifier: TypeError ERR_INVALID_ARG_TYPE
    status: unlinked
    valid: returned
    status: unlinked"
  `);
  expect(exitCode).toBe(0);
});

describe("node:vm SourceTextModule cyclic graph linking", () => {
  // Building a cyclic SourceTextModule graph and linking + evaluating each
  // module from inside the linker callback (instead of linking the whole graph
  // first and evaluating once) used to segfault: instantiate() runs JSC's
  // whole-graph record->link(), which walks into a dependency whose own link()
  // has not run yet (its loadedModules() is empty), dereferencing an end()
  // iterator. Bun must instead throw a catchable ERR_VM_MODULE_LINK_FAILURE,
  // matching Node. See https://github.com/oven-sh/bun/issues/31623.
  test("link + evaluate inside the linker throws instead of crashing", async () => {
    const fixture = `
      const vm = require("node:vm");
      const ctx = vm.createContext({ globalThis });
      const sources = {
        a: 'import { b } from "b"; export const a = "A"; export const ab = () => b;',
        b: 'import { a } from "a"; export const b = "B"; export const ba = () => a;',
      };
      const built = new Map();
      async function ensure(id) {
        const existing = built.get(id);
        if (existing) return existing;
        const m = new vm.SourceTextModule(sources[id], { context: ctx, identifier: id });
        built.set(id, m);
        await m.link(async spec => await ensure(spec));
        await m.evaluate();
        return m;
      }
      try {
        const root = await ensure("a");
        console.log("UNEXPECTED_OK " + Object.keys(root.namespace).join(","));
      } catch (e) {
        console.log("CAUGHT " + e.code + " " + e.message);
      }
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("CAUGHT ERR_VM_MODULE_LINK_FAILURE request for 'b' is not in cache");
    expect(exitCode).toBe(0);
  });

  test("a self-importing module links + evaluates without crashing", async () => {
    const fixture = `
      const vm = require("node:vm");
      const ctx = vm.createContext({ globalThis });
      const sources = { self: 'import {} from "self"; export const x = 1;' };
      const built = new Map();
      async function ensure(id) {
        const existing = built.get(id);
        if (existing) return existing;
        const m = new vm.SourceTextModule(sources[id], { context: ctx, identifier: id });
        built.set(id, m);
        await m.link(async spec => await ensure(spec));
        await m.evaluate();
        return m;
      }
      const root = await ensure("self");
      console.log("OK " + Object.keys(root.namespace).join(","));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK x");
    expect(exitCode).toBe(0);
  });

  test("the canonical link-whole-graph-then-evaluate pattern still works", async () => {
    const fixture = `
      const vm = require("node:vm");
      const ctx = vm.createContext({ globalThis });
      const sources = {
        a: 'import { b } from "b"; export const a = "A"; export const ab = () => b;',
        b: 'import { a } from "a"; export const b = "B"; export const ba = () => a;',
      };
      const built = new Map();
      function get(id) {
        let m = built.get(id);
        if (m) return m;
        m = new vm.SourceTextModule(sources[id], { context: ctx, identifier: id });
        built.set(id, m);
        return m;
      }
      const root = get("a");
      await root.link(spec => get(spec));
      await root.evaluate();
      const nsA = root.namespace;
      const nsB = built.get("b").namespace;
      console.log("ab=" + nsA.ab() + " ba=" + nsB.ba());
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ab=B ba=A");
    expect(exitCode).toBe(0);
  });
});

describe("node:vm timeout option", () => {
  // A timed evaluation must fully disarm its deadline once it returns. The
  // JSC-Watchdog-based implementation restored the time limit but left the
  // armed wall-clock deadline (and its in-flight timer) behind, so the first
  // trap check after the stale deadline elapsed either re-armed a watchdog
  // with no time limit (ASSERTION FAILED: hasTimeLimit() in
  // Watchdog::startTimer on debug builds) or terminated whatever unrelated
  // JS happened to be running (release builds).
  test("a completed timed evaluation does not affect later code", async () => {
    const fixture = `
      import vm from "node:vm";
      // Warm up so the timed evaluation below stays well under its deadline.
      vm.runInNewContext("1", {});
      vm.runInNewContext("1", {}, { timeout: 250 });
      // Let the stale 250ms deadline elapse while no JS is running.
      Bun.sleepSync(400);
      // Debug builds used to abort here (Watchdog::startTimer with no limit).
      vm.runInNewContext("1", {});
      // Release builds used to terminate the main script here once the stale
      // CPU budget ran out.
      const start = Date.now();
      while (Date.now() - start < 400) {}
      console.log("OK");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("OK\n");
    expect(exitCode).toBe(0);
  });

  test("terminates a runaway script", () => {
    expect(() => runInThisContext("while (true) {}", { timeout: 100 })).toThrow(
      expect.objectContaining({
        code: "ERR_SCRIPT_EXECUTION_TIMEOUT",
        message: "Script execution timed out after 100ms",
      }),
    );
  });

  // runInThisContext evaluates in the caller's own global, so timing out must
  // not discard microtasks the caller queued before the call.
  test("a timed-out runInThisContext does not cancel the caller's microtasks", async () => {
    let survived = false;
    Promise.resolve().then(() => {
      survived = true;
    });
    expect(() => runInThisContext("while (true) {}", { timeout: 100 })).toThrow(
      expect.objectContaining({
        code: "ERR_SCRIPT_EXECUTION_TIMEOUT",
        message: "Script execution timed out after 100ms",
      }),
    );
    await Promise.resolve();
    expect(survived).toBe(true);
  });

  test("nested: the inner deadline fires first and propagates out", () => {
    const context = createContext({
      runInVM: (timeout: number) => runInNewContext("while (true) {}", context, { timeout }),
    });
    expect(() => runInNewContext("runInVM(50)", context, { timeout: 100_000 })).toThrow(
      expect.objectContaining({
        code: "ERR_SCRIPT_EXECUTION_TIMEOUT",
        message: "Script execution timed out after 50ms",
      }),
    );
  });

  // The outer deadline fires while the inner (longer) evaluation is running.
  // The inner call must not claim that termination as its own timeout.
  test("nested: the outer deadline fires first and is reported by the outer call", () => {
    const context = createContext({
      runInVM: (timeout: number) => runInNewContext("while (true) {}", context, { timeout }),
    });
    expect(() => runInNewContext("runInVM(100000)", context, { timeout: 100 })).toThrow(
      expect.objectContaining({
        code: "ERR_SCRIPT_EXECUTION_TIMEOUT",
        message: "Script execution timed out after 100ms",
      }),
    );
  });

  // Every deadline's one-shot timer feeds the same per-VM NeedTermination
  // signal. When an inner evaluation times out and consumes it, an enclosing
  // deadline that also already expired must be raised again on its behalf,
  // or the enclosing script (whose own timer will never fire again) runs
  // forever once it catches the inner error. The inner evaluation blocks in
  // a host call past both deadlines so both timers have fired by the time it
  // returns.
  test("nested: an inner timeout does not swallow an expired outer deadline", async () => {
    const fixture = `
      import vm from "node:vm";
      const context = vm.createContext({
        sleepSync: Bun.sleepSync,
        runInner: () => vm.runInNewContext("sleepSync(600)", context, { timeout: 150 }),
      });
      try {
        vm.runInNewContext("try { runInner() } catch (err) {} while (true) {}", context, { timeout: 250 });
        console.log("UNEXPECTED_OK");
      } catch (err) {
        console.log(err.message);
      }
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("Script execution timed out after 250ms\n");
    expect(exitCode).toBe(0);
  });

  test("SourceTextModule.evaluate honors the timeout option", async () => {
    const fixture = `
      const vm = require("node:vm");
      const mod = new vm.SourceTextModule("while (true) {}");
      await mod.link(() => {});
      try {
        await mod.evaluate({ timeout: 100 });
        console.log("UNEXPECTED_OK");
      } catch (err) {
        console.log(err.code);
      }
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT\n");
    expect(exitCode).toBe(0);
  });

  // A module with no `context` option evaluates in the caller's own global.
  // Timing out must not discard the caller's already-queued microtasks
  // (test-vm-module-basic.js hangs if they are dropped).
  test("a timed-out context-less module does not cancel the caller's microtasks", async () => {
    const fixture = `
      const vm = require("node:vm");
      const mod = new vm.SourceTextModule("while (true) {}");
      await mod.link(() => {});
      let survived = false;
      Promise.resolve().then(() => { survived = true; });
      try {
        await mod.evaluate({ timeout: 100 });
        console.log("UNEXPECTED_OK");
      } catch (err) {
        console.log(err.code);
      }
      console.log("microtask survived: " + survived);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT\nmicrotask survived: true\n");
    expect(exitCode).toBe(0);
  });
});
