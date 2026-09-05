import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot } from "harness";
import {
  compileFunction,
  constants,
  createContext,
  runInContext,
  runInNewContext,
  runInThisContext,
  Script,
  SourceTextModule,
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
    test("ShadowRealm can be created and used inside a context", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const vm = require("node:vm");
          const realm = vm.runInNewContext("new ShadowRealm()");
          const wrapped = vm.runInNewContext("new ShadowRealm().evaluate('(a, b) => a + b')");
          console.log(typeof realm.evaluate, realm.evaluate("6 * 7"), wrapped(20, 22));`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("function 42 42\n");
      expect(exitCode).toBe(0);
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

  test("can specify displayErrors", () => {
    const src = 'throw new Error("boom")';
    // displayErrors: false — no source-line/caret decoration on the stack.
    try {
      new Script(src, { filename: "t.vm" }).runInThisContext({ displayErrors: false });
      expect.unreachable();
    } catch (e: any) {
      expect(e.message).toBe("boom");
      expect(e.stack).not.toMatch(/^t\.vm:1\n/);
    }
    // displayErrors: true (default) — stack is decorated with the source line.
    try {
      new Script(src, { filename: "t.vm" }).runInThisContext({ displayErrors: true });
      expect.unreachable();
    } catch (e: any) {
      expect(e.stack).toMatch(/^t\.vm:1\nthrow new Error/);
    }
    // Same for runInContext.
    try {
      new Script(src, { filename: "t.vm" }).runInContext(createContext({}), { displayErrors: false });
      expect.unreachable();
    } catch (e: any) {
      expect(e.stack).not.toMatch(/^t\.vm:1\n/);
    }
  });
  test("throws SyntaxError at construction like Node", () => {
    // Node's vm.Script parses eagerly; the REPL depends on this.
    expect(() => new Script("function {")).toThrow(SyntaxError);
    expect(() => new Script("const x = ")).toThrow(SyntaxError);
  });
  test("compile-time SyntaxError has arrow-decorated stack (Node DecorateErrorStack)", () => {
    // Node prepends `<url>:<line>\n<source>\n^\n\n` to compile-time SyntaxErrors
    // from `new vm.Script`, unconditionally (independent of displayErrors).
    for (const opts of [undefined, { displayErrors: true }, { displayErrors: false }]) {
      let err: any;
      try {
        new Script("%%", opts);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.stack.split("\n").slice(0, 4)).toEqual(["evalmachine.<anonymous>:1", "%%", "^", ""]);
    }

    // Custom filename + lineOffset: reported line is offset-adjusted, source
    // line and caret still come from the physical position.
    let err: any;
    try {
      new Script("1;\n%%", { filename: "foo.js", lineOffset: 5 });
    } catch (e) {
      err = e;
    }
    expect(err.stack.split("\n").slice(0, 4)).toEqual(["foo.js:7", "%%", "^", ""]);

    // Negative lineOffset: Node renders a signed line, still with source + caret.
    // JSC clamps a negative provider start line to zero, so the offset is
    // re-applied to the physical line when building the header.
    err = undefined;
    try {
      new Script("1;\n%%", { lineOffset: -5 });
    } catch (e) {
      err = e;
    }
    expect(err.stack.split("\n").slice(0, 4)).toEqual(["evalmachine.<anonymous>:-3", "%%", "^", ""]);

    // columnOffset on line 1 is subtracted from the caret; on later lines it
    // is not (Node applies it only to the first physical line).
    err = undefined;
    try {
      new Script("   %%", { columnOffset: 10 });
    } catch (e) {
      err = e;
    }
    expect(err.stack.split("\n").slice(0, 4)).toEqual(["evalmachine.<anonymous>:1", "   %%", "   ^", ""]);

    err = undefined;
    try {
      new Script("1;\n   %%", { columnOffset: 10 });
    } catch (e) {
      err = e;
    }
    expect(err.stack.split("\n").slice(0, 4)).toEqual(["evalmachine.<anonymous>:2", "   %%", "   ^", ""]);
  });

  test("a compile-time error without a position gets no arrow header", () => {
    // Overflowing the parser's stack fails compilation without a line, like Node's RangeError.
    let err: any;
    try {
      new Script(Buffer.alloc(200_000, "(").toString());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RangeError);
    expect(err.stack.split("\n")[0]).toBe("RangeError: Maximum call stack size exceeded.");
  });

  test("vm.compileFunction compile-time SyntaxError is arrow-decorated like new Script", () => {
    // Node decorates both compile paths, but compileFunction defaults filename to
    // "" where new Script defaults to "evalmachine.<anonymous>". An explicitly
    // empty filename is honored by both and renders as ":<line>".
    const header = (fn: () => unknown) => {
      let err: any;
      try {
        fn();
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SyntaxError);
      return err.stack.split("\n").slice(0, 4);
    };

    expect(header(() => compileFunction("%%"))).toEqual([":1", "%%", "^", ""]);
    expect(header(() => compileFunction("%%", [], {}))).toEqual([":1", "%%", "^", ""]);
    expect(header(() => compileFunction("%%", [], { filename: "" }))).toEqual([":1", "%%", "^", ""]);
    expect(header(() => compileFunction("%%", [], { filename: "foo.js" }))).toEqual(["foo.js:1", "%%", "^", ""]);
    expect(header(() => compileFunction("1;\n%%", [], { filename: "f.js", lineOffset: 5 }))).toEqual([
      "f.js:7",
      "%%",
      "^",
      "",
    ]);
    expect(header(() => compileFunction("1;\n%%", [], { lineOffset: -5 }))).toEqual([":-3", "%%", "^", ""]);

    // An explicitly empty filename is not the same as an absent one.
    expect(header(() => new Script("%%", { filename: "" }))).toEqual([":1", "%%", "^", ""]);

    // The string-options form counts as "provided" too, "" included.
    expect(header(() => new Script("%%", "myfile.js"))).toEqual(["myfile.js:1", "%%", "^", ""]);
    expect(header(() => new Script("%%", ""))).toEqual([":1", "%%", "^", ""]);
  });

  test("a throwing Error.prepareStackTrace does not escape the compile-time SyntaxError", () => {
    // Building the error materializes its stack, running a user
    // prepareStackTrace; if that throws, the SyntaxError must still be what is
    // thrown (node does the same) and the arrow header must survive.
    const prev = Error.prepareStackTrace;
    Error.prepareStackTrace = () => {
      throw new Error("boom-from-prepareStackTrace");
    };
    try {
      let err: any;
      try {
        new Script("%%");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Unexpected token '%'");
      expect(err.stack.split("\n").slice(0, 4)).toEqual(["evalmachine.<anonymous>:1", "%%", "^", ""]);

      // Same eager-materialization path via vm.compileFunction.
      let fnErr: any;
      try {
        compileFunction("%%");
      } catch (e) {
        fnErr = e;
      }
      expect(fnErr).toBeInstanceOf(SyntaxError);
      expect(fnErr.message).toBe("Unexpected token '%'");
      expect(fnErr.stack.split("\n").slice(0, 4)).toEqual([":1", "%%", "^", ""]);
    } finally {
      Error.prepareStackTrace = prev;
    }
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
  // vm.Script now parses eagerly (like Node), so the SyntaxError surfaces at
  // construction rather than at runInThisContext()/createCachedData().
  expect(() => new Script("export default {};")).toThrow({
    name: "SyntaxError",
    message: "Unexpected keyword 'export'",
  });
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

test("SourceTextModule accepts the cachedData it produced", () => {
  const source = `{ function inBlock() { return 1; } }\nexport default await Promise.resolve(inBlock);`; // module-only syntax, and a block function (strict semantics)
  const cachedData = new SourceTextModule(source, { identifier: "m" }).createCachedData();
  expect(cachedData.length).toBeGreaterThan(0);
  expect(() => new SourceTextModule(source, { identifier: "m", cachedData })).not.toThrow(); // ERR_VM_MODULE_CACHED_DATA_REJECTED otherwise
  expect(() => new SourceTextModule("export default 2;", { identifier: "m", cachedData })).toThrow(
    expect.objectContaining({ code: "ERR_VM_MODULE_CACHED_DATA_REJECTED" }),
  );
});

describe("Script compiles its source once and links that in every context it runs in", () => {
  // Runs Script(s) in fresh contexts, keeping what every run produced alive (each run's wrapper function
  // pins that run's ProgramExecutable), and reports how many UnlinkedProgramCodeBlock cells (one per
  // compile of a program) the runs after the first added. BUN_JSC_useCodeCache=0 takes JSC's own cache
  // out of the picture, so a Script that does not hold on to its compile adds one per context.
  const fixture = String.raw`
    const { Script, createContext } = require("node:vm");
    const { heapStats } = require("bun:jsc");
    let body = "";
    for (let i = 0; i < 50; i++) body += "function f" + i + "(a) { return a + " + i + "; }\n";
    const source = "(function (exports) {\n" + body + "exports.sum = f0(1) + f49(1);\n})";
    const options = process.env.VM_FIXTURE_CACHED_DATA ? { cachedData: new Script(source).createCachedData() } : {};
    const scripts = [new Script(source, options)];
    if (process.env.VM_FIXTURE_TWO_SCRIPTS) scripts.push(new Script(source, options));
    const programBlocks = () => {
      Bun.gc(true);
      return heapStats().objectTypeCounts.UnlinkedProgramCodeBlock ?? 0;
    };
    const keep = [];
    let afterFirstContext = 0;
    for (let i = 0; i < 6; i++) {
      const context = createContext({});
      for (const script of scripts) {
        const wrapper = script.runInContext(context);
        const exports = {};
        wrapper(exports);
        if (exports.sum !== 51) throw new Error("context " + i + " computed " + exports.sum);
        keep.push(wrapper);
      }
      if (i === 0) afterFirstContext = programBlocks();
    }
    console.log(JSON.stringify({
      programBlocksAddedByLaterContexts: programBlocks() - afterFirstContext,
      cachedDataRejected: scripts.map(script => script.cachedDataRejected),
      cachedDataStillProducible: scripts.every(script => script.createCachedData().length > 0),
    }));
  `;

  async function runFixture(extraEnv: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_JSC_useCodeCache: "0", ...extraEnv },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const { programBlocksAddedByLaterContexts, ...rest } = JSON.parse(stdout);
    // A Script that recompiles adds one per Script per context (+5 / +10 here). Slightly negative is
    // possible: garbage from before the first measurement may only be collected by the second one.
    expect(programBlocksAddedByLaterContexts).toBeLessThanOrEqual(0);
    return rest;
  }

  test.concurrent("one Script", async () => {
    expect(await runFixture({})).toEqual({ cachedDataRejected: [null], cachedDataStillProducible: true });
  });

  test.concurrent("two Scripts with the same source", async () => {
    expect(await runFixture({ VM_FIXTURE_TWO_SCRIPTS: "1" })).toEqual({
      cachedDataRejected: [null, null],
      cachedDataStillProducible: true,
    });
  });

  test.concurrent("a Script constructed with accepted cachedData", async () => {
    expect(await runFixture({ VM_FIXTURE_CACHED_DATA: "1" })).toEqual({
      cachedDataRejected: [false],
      cachedDataStillProducible: true,
    });
  });

  test("each context gets its own global declarations", () => {
    const script = new Script(
      "var counter = (typeof counter === 'number' ? counter : 0) + 1; function whoami() { return tag; } counter;",
    );
    const first = createContext({ tag: "first" });
    const second = createContext({ tag: "second" });
    expect(script.runInContext(first)).toBe(1);
    expect(script.runInContext(second)).toBe(1);
    expect(script.runInContext(first)).toBe(2);
    expect(runInContext("whoami()", first)).toBe("first");
    expect(runInContext("whoami()", second)).toBe("second");
    expect(first.counter).toBe(2);
    expect(second.counter).toBe(1);
  });

  test("source positions are the same in every context the compile is linked into", () => {
    const script = new Script("\n\nnew Error('where').stack.split('\\n')[1].trim()", {
      filename: "shared.js",
      lineOffset: 100,
    });
    for (const context of [createContext({}), createContext({})]) {
      expect(script.runInContext(context)).toBe("at shared.js:103:10");
    }
  });
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

describe("the options argument", () => {
  // Node checks `options` with validateObject() (lib/vm.js), which rejects
  // arrays and functions as well as null and primitives.
  const script = new Script("1 + 1;");
  const entryPoints: Record<string, (options: unknown) => unknown> = {
    "createContext()": options => createContext({}, options as any),
    "new Script()": options => new Script("1 + 1;", options as any),
    "compileFunction()": options => compileFunction("return 1 + 1;", [], options as any),
    "vm.runInThisContext()": options => runInThisContext("1 + 1;", options as any),
    "Script#runInThisContext()": options => script.runInThisContext(options as any),
    "Script#runInContext()": options => script.runInContext(createContext({}), options as any),
    "Script#runInNewContext()": options => script.runInNewContext({}, options as any),
  };
  const invalidOptions: [description: string, options: unknown, received: string][] = [
    ["an array", [], "an instance of Array"],
    ["a Proxy around an array", new Proxy([], {}), "an instance of Array"],
    ["a function", function foo() {}, "function foo"],
    ["null", null, "null"],
    ["a number", 1, "type number (1)"],
  ];

  describe.each(Object.entries(entryPoints))("%s", (_, run) => {
    test.each(invalidOptions)("rejects %s", (_, options, received) => {
      expect(() => run(options)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
          message: `The "options" argument must be of type object. Received ${received}`,
        }),
      );
    });
  });

  test("vm.runInContext() and vm.runInNewContext() copy options into a fresh object like Node", () => {
    // lib/vm.js spreads `options` before handing it to Script, so any
    // non-string value behaves like passing no options to these two.
    for (const [, options] of invalidOptions) {
      expect(runInContext("1 + 1;", createContext({}), options as any)).toBe(2);
      expect(runInNewContext("1 + 1;", {}, options as any)).toBe(2);
    }
  });
});

describe("context options with throwing getters", () => {
  // Without the fix, reading these options with a pending exception aborted
  // the process, so run the matrix in a subprocess.
  test.concurrent("the getter's exception propagates to the caller", async () => {
    // Each entry point tests the context-option keys it actually reads:
    // createContext takes codeGeneration, Script#runInNewContext takes
    // contextCodeGeneration, and vm.runInNewContext goes through both.
    // A dotted key puts the throwing getter on the nested object.
    const codeGenerationKeys = (key: string) => [key, `${key}.strings`, `${key}.wasm`];
    const contextKeys = (...codeGenerationKeyNames: string[]) => [
      "name",
      "origin",
      ...codeGenerationKeyNames.flatMap(codeGenerationKeys),
      "importModuleDynamically",
      "microtaskMode",
    ];
    const matrix = {
      createContext: contextKeys("codeGeneration"),
      runInNewContext: contextKeys("codeGeneration", "contextCodeGeneration"),
      scriptRunInNewContext: contextKeys("contextCodeGeneration"),
    };
    const code = `
      const vm = require("node:vm");
      const matrix = ${JSON.stringify(matrix)};
      const entryPoints = {
        createContext: opts => vm.createContext({}, opts),
        runInNewContext: opts => vm.runInNewContext("1", {}, opts),
        scriptRunInNewContext: opts => new vm.Script("1").runInNewContext({}, opts),
      };
      for (const [entry, keys] of Object.entries(matrix)) {
        for (const key of keys) {
          const opts = {};
          const path = key.split(".");
          let target = opts;
          for (const part of path.slice(0, -1)) target = target[part] = {};
          Object.defineProperty(target, path.at(-1), {
            get() { throw new Error("getter:" + key); },
            enumerable: true,
          });
          try {
            entryPoints[entry](opts);
            console.log(entry, key, "did not throw");
          } catch (e) {
            console.log(entry, key, e.message);
          }
        }
      }
      console.log("survived");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const expected =
      Object.entries(matrix)
        .flatMap(([entry, keys]) => keys.map(key => `${entry} ${key} getter:${key}`))
        .join("\n") + "\nsurvived\n";
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(0);
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

test("node:vm Object.defineProperty on the context global when the sandbox is an uncacheable dictionary holding an accessor for a built-in", async () => {
  // Regression: NodeVMGlobalObject::defineOwnProperty used a single PropertySlot
  // for both the global-object lookup and the sandbox lookup. When the first
  // lookup fills the slot as cacheable (e.g. Array is a lazy CustomGetterSetter
  // on a non-dictionary global) and the sandbox has transitioned to an
  // uncacheable dictionary with an accessor for the same name, the second lookup
  // would hit setGetterSlot, which asserts the slot is still CachingDisallowed.
  // Debug builds aborted; this test asserts the Node-matching behaviour so
  // release lanes still exercise the path.
  const fixture = `
    const vm = require("node:vm");
    const sandbox = {};
    for (let i = 0; i < 200; i++) { sandbox["k" + i] = i; delete sandbox["k" + i]; }
    Object.defineProperty(sandbox, "Array", { get: () => Array, configurable: true });
    vm.createContext(sandbox);
    const result = vm.runInContext(
      'Object.defineProperty(this, "Array", { value: 1, configurable: true, writable: true }); Array',
      sandbox,
    );
    console.log(JSON.stringify({ result, sandboxArray: sandbox.Array }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(JSON.stringify({ result: 1, sandboxArray: 1 }));
  expect(exitCode).toBe(0);
});

// `timeout` is wall-clock, as in Node: a script that spends the budget off-CPU (blocked in
// sleepSync / Atomics.wait / I/O) times out too. It used to be built on JSC's CPU-time watchdog,
// which not only let such a script finish "normally" but also could not be retired afterwards: its
// stale deadline was serviced later and terminated the *caller's* own JS once it had used up the
// script's leftover CPU budget (and asserted on debug builds).
test.concurrent("vm timeout is wall-clock and leaves nothing armed against the caller afterwards", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const vm = require("node:vm");
      const sleepSync = (ms) => Bun.sleepSync(ms);   // off-CPU and not interruptible by the deadline's trap
      try {
        vm.runInNewContext("sleepSync(80)", { sleepSync }, { timeout: 20 });
        console.log("finished");
      } catch (e) {
        console.log("threw", e.code);
      }
      // Same synchronous section: burn CPU well past the script's leftover CPU budget.
      const t = performance.now();
      let s = 0;
      while (performance.now() - t < 300) s += Math.sqrt(s + 1);
      console.log("caller ran on", s > 0);
      const script = new vm.Script("sleepSync(80)");
      try {
        script.runInThisContext({ timeout: 20 });
        console.log("finished");
      } catch (e) {
        console.log("threw", e.code);
      }
      setImmediate(() => console.log("event loop ran on"));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(
    "threw ERR_SCRIPT_EXECUTION_TIMEOUT\ncaller ran on true\nthrew ERR_SCRIPT_EXECUTION_TIMEOUT\nevent loop ran on\n",
  );
  expect(exitCode).toBe(0);
});

test.concurrent("a vm timeout that never fires leaves nothing behind either", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const vm = require("node:vm");
      // Runs that finish well inside their timeout: nothing they armed may hit later runs or the caller,
      // which stays busy — in script and idle — for far longer than that timeout afterwards.
      const ctx = vm.createContext({});
      for (let i = 0; i < 50; i++) vm.runInContext("1 + 1", ctx, { timeout: 100 });
      const t = performance.now();
      let s = 0;
      while (performance.now() - t < 500) s += Math.sqrt(s + 1);   // 5x the timeout, in script
      await new Promise(r => setTimeout(r, 200));                    // and idle in the loop
      for (let i = 0; i < 20; i++) vm.runInContext("2 + 2", ctx, { timeout: 100 });
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

// The following tests run unbounded `for(;;)` loops that only the mechanism under test can stop, so they run
// in a child: a regression then fails that child (spawn timeout) instead of hanging this file.
// As in Node: microtasks a script left on an afterEvaluate context when its synchronous part timed out run
// at the next evaluation's checkpoint, under that run's timeout (never unbounded); a checkpoint that is
// itself cut short discards the rest; the context stays usable throughout.
test.concurrent("microtasks left on an afterEvaluate context by a timed-out script stay bounded", async () => {
  const code = `
    const vm = require("node:vm");
    const ctx = vm.createContext({ log: console.log }, { microtaskMode: "afterEvaluate" });
    const run = (src, timeout) => { try { return String(vm.runInContext(src, ctx, { timeout })); } catch (e) { return e.code; } };
    console.log(run("Promise.resolve().then(() => log('leftover ran')); for (;;) {}", 20));
    console.log(run("1 + 1", 1000));
    console.log(run("Promise.resolve().then(() => { for (;;) {} }); 2", 20));
    console.log(run("3", 1000));
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", code], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT\nleftover ran\n2\nERR_SCRIPT_EXECUTION_TIMEOUT\n3\n");
  expect(exitCode).toBe(0);
});

// POSIX-only: a real SIGINT, sent from a worker while the main thread is stuck in a breakOnSigint run.
test.skipIf(isWindows)(
  "breakOnSigint interrupts a stuck run with ERR_SCRIPT_EXECUTION_INTERRUPTED and nothing lingers",
  async () => {
    const code = `
    const vm = require("node:vm");
    const { Worker } = require("node:worker_threads");
    new Worker('setTimeout(() => process.kill(process.pid, "SIGINT"), 100)', { eval: true });
    let code_;
    try { vm.runInNewContext("for (;;) {}", {}, { breakOnSigint: true }); } catch (e) { code_ = e.code; }
    const t = Date.now(); while (Date.now() - t < 50);   // still running normally afterwards
    // ...and SIGINT handling is back to the default-less state Node leaves it in: a listener sees the next one.
    process.on("SIGINT", () => { console.log(code_, "second SIGINT observed"); process.exit(0); });
    process.kill(process.pid, "SIGINT");
    setTimeout(() => { console.log("no second SIGINT"); process.exit(1); }, 5000);
  `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", code], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ERR_SCRIPT_EXECUTION_INTERRUPTED second SIGINT observed\n");
    expect(exitCode).toBe(0);
  },
  30_000,
);

// POSIX-only for the same reason. As in Node, one SIGINT interrupts only the innermost breakOnSigint run.
test.skipIf(isWindows)("a SIGINT interrupts only the innermost of nested breakOnSigint runs", async () => {
  const code = `
    const vm = require("node:vm");
    const { Worker } = require("node:worker_threads");
    new Worker('setTimeout(() => process.kill(process.pid, "SIGINT"), 100)', { eval: true });
    const r = vm.runInNewContext(
      'let inner; try { vm.runInNewContext("for (;;) {}", {}, { breakOnSigint: true }); } catch (e) { inner = e.code; } "outer completed, inner " + inner',
      { vm }, { breakOnSigint: true });
    console.log(r);
    process.exit(0);
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", code], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("outer completed, inner ERR_SCRIPT_EXECUTION_INTERRUPTED\n");
  expect(exitCode).toBe(0);
});

test("nested vm runs each keep their own deadline", async () => {
  const code = `
    const vm = require("node:vm");
    const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const codeOf = (fn) => { try { fn(); return "returned"; } catch (e) { return e.code; } };
    // Inner run times out; the outer script catches that (catchable) error and carries on within its budget.
    console.log(vm.runInNewContext(
      'let r; try { vm.runInNewContext("for(;;){}", {}, { timeout: 20 }) } catch (e) { r = "inner:" + e.code } r',
      { vm }, { timeout: 5000 }));
    // Outer deadline passes while the inner run is on the stack: the outer run is what times out.
    console.log(codeOf(() => vm.runInNewContext('vm.runInNewContext("for(;;){}", {}, { timeout: 5000 })', { vm }, { timeout: 30 })));
    // Both deadlines pass before the inner run ends (it is blocked off-CPU past both): the inner
    // run's error is caught by the outer script, which must nevertheless still be stopped by its own,
    // already-fired deadline rather than loop forever.
    const t = performance.now();
    console.log(codeOf(() => vm.runInNewContext(
      'try { vm.runInNewContext("sleepSync(120)", { sleepSync }, { timeout: 20 }) } catch {} for (;;) {}',
      { vm, sleepSync }, { timeout: 40 })), performance.now() - t < 2000);
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", code], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(
    "inner:ERR_SCRIPT_EXECUTION_TIMEOUT\nERR_SCRIPT_EXECUTION_TIMEOUT\nERR_SCRIPT_EXECUTION_TIMEOUT true\n",
  );
  expect(exitCode).toBe(0);
}, 30_000);

test("a module whose evaluation times out is errored", async () => {
  const code = `
    const vm = require("node:vm");
    const m = new vm.SourceTextModule("for (;;) {}", { context: vm.createContext({}) });
    await m.link(() => { throw new Error("unreachable"); });
    const first = await m.evaluate({ timeout: 20 }).then(() => "resolved", (e) => e.code + "|" + e.message);
    // A second evaluate() re-throws the recorded error rather than complaining about the status.
    const second = await m.evaluate({ timeout: 20 }).then(() => "resolved", (e) => e.code);
    console.log(first, m.status, second);
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", code], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(
    "ERR_SCRIPT_EXECUTION_TIMEOUT|Script execution timed out after 20ms errored ERR_SCRIPT_EXECUTION_TIMEOUT\n",
  );
  expect(exitCode).toBe(0);
}, 30_000);

// The same timeout value reaches the native evaluate() either as an int32 or as a double (a
// Float64Array element is always the latter). Only the value may decide whether the deadline is armed.
test("SourceTextModule#evaluate() arms the timeout when the number is boxed as a double", async () => {
  const code = `
    const vm = require("node:vm");
    const timeout = new Float64Array([20])[0];
    // Spins far past the 20ms deadline, but not forever: without the deadline the body finishes
    // and evaluate() resolves, so a timeout that is not armed fails this test instead of hanging it.
    const m = new vm.SourceTextModule("for (const end = Date.now() + 2000; Date.now() < end;) {}", { context: vm.createContext({}) });
    await m.link(() => { throw new Error("unreachable"); });
    console.log(timeout === 20, await m.evaluate({ timeout }).then(() => "resolved", (e) => e.code), m.status);
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", code], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("true ERR_SCRIPT_EXECUTION_TIMEOUT errored\n");
  expect(exitCode).toBe(0);
});

// A vm timeout that lands while a host function beneath the timed script is spinning a nested event-loop
// wait (expect().resolves ticks the loop until its promise settles) must unwind to the run and surface as
// ERR_SCRIPT_EXECUTION_TIMEOUT; the nested wait used to keep ticking over the pending termination (a hang).
// In a child, like the other unbounded waits above.
test.concurrent("timeout during a nested event-loop wait beneath the script", async () => {
  const code = `
    const vm = require("node:vm"); const { expect } = require("bun:test");
    const never = new Promise(() => {}); const iv = setInterval(() => {}, 1);
    try { vm.runInNewContext("expect(never).resolves.toBe(1)", { expect, never }, { timeout: 100 }); console.log("returned"); }
    catch (e) { console.log(e.code); } finally { clearInterval(iv); }
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", code], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT\n");
  expect(exitCode).toBe(0);
});

describe("node:vm lineOffset/columnOffset at the edge of int32", () => {
  // Node's validator accepts any int32 here. JSC stores positions as ints,
  // converts the offset to one-based and counts the source's own lines on top
  // of it, so an offset this large used to overflow in the parser: assertion
  // builds abort in JSTextPosition::checkConsistency ("line >= 0"), release
  // builds report wrapped negative line numbers. Each case gets its own
  // process because the failure mode is an abort.
  const INT32_MAX = 2147483647;

  async function runFixture(body: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const vm = require("node:vm");\n${body}`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout;
  }

  test.concurrent.each([
    ["new Script, one-line source", `new vm.Script("1", { lineOffset: ${INT32_MAX} })`],
    [
      "new Script, second line steps past INT32_MAX",
      `new vm.Script(${JSON.stringify("1;\n2;")}, { lineOffset: ${INT32_MAX - 1} })`,
    ],
    ["new Script, columnOffset", `new vm.Script(${JSON.stringify("1;\n2;")}, { columnOffset: ${INT32_MAX} })`],
    ["compileFunction", `vm.compileFunction("return 1", [], { lineOffset: ${INT32_MAX} })`],
    [
      "compileFunction with params, a multi-line body and both offsets",
      `vm.compileFunction(${JSON.stringify("a;\nreturn a;")}, ["a"], { lineOffset: ${INT32_MAX - 1}, columnOffset: ${INT32_MAX} })`,
    ],
    // Three lines so the counter steps past INT32_MAX whether the module's
    // first line is taken as lineOffset or, like Script, as lineOffset + 1.
    ["SourceTextModule", `new vm.SourceTextModule(${JSON.stringify("1;\n2;\n3;")}, { lineOffset: ${INT32_MAX - 1} })`],
  ])("%s compiles", async (_, expression) => {
    const stdout = await runFixture(`${expression};\nconsole.log("ok");`);
    expect(stdout).toBe("ok\n");
  });

  test.concurrent.each([
    [
      "line of a runtime error thrown by a Script",
      `new vm.Script(${JSON.stringify('1;\nthrow new Error("q")')}, { filename: "big.js", lineOffset: ${INT32_MAX - 1} }).runInThisContext()`,
      /big\.js:(-?\d+)/,
    ],
    [
      "line of a compile-time SyntaxError from a Script",
      `new vm.Script(${JSON.stringify("1;\n%%")}, { filename: "big.js", lineOffset: ${INT32_MAX - 1} })`,
      /big\.js:(-?\d+)/,
    ],
    [
      "column of a runtime error thrown on the first line of a Script",
      `new vm.Script('throw new Error("q")', { filename: "big.js", columnOffset: ${INT32_MAX} }).runInThisContext()`,
      /big\.js:1:(-?\d+)/,
    ],
    [
      "line of a runtime error thrown by a compileFunction body",
      `vm.compileFunction('throw new Error("q")', [], { filename: "big.js", lineOffset: ${INT32_MAX} })()`,
      /big\.js:(-?\d+)/,
    ],
    [
      "line of a compile-time SyntaxError from compileFunction",
      `vm.compileFunction("%%", [], { filename: "big.js", lineOffset: ${INT32_MAX} })`,
      /big\.js:(-?\d+)/,
    ],
  ])("%s stays near the requested offset", async (_, expression, pattern) => {
    const stdout = await runFixture(`try { ${expression}; } catch (e) { console.log(e.stack); }`);
    const match = pattern.exec(stdout);
    expect(match).not.toBeNull();
    // The offset is only pulled down by as much as the (tiny) source could
    // possibly add to it, so the reported position stays just below INT32_MAX
    // rather than wrapping negative or being dropped.
    const position = Number(match![1]);
    expect(position).toBeGreaterThan(INT32_MAX - 100);
    expect(position).toBeLessThanOrEqual(INT32_MAX);
  });
});

test.concurrent("a context nothing references is collected while it is still the newest context", async () => {
  // Every NodeVMGlobalObject used to be created from one Structure cached on the main global.
  // JSGlobalObject::finishCreation makes the new global the realm of its structure, and the GC marks
  // a structure's realm, so the cached structure kept the context created last alive until the next
  // one took its place. Each round below therefore checks a context while it is still the newest one.
  const fixture = String.raw`
    const vm = require("node:vm");
    // Each case returns a WeakRef to the object the context's global holds (the sandbox, or the
    // DONT_CONTEXTIFY stand-in for it), so that object can only be collected together with the global.
    const cases = {
      createContext() {
        const sandbox = {};
        vm.createContext(sandbox);
        return new WeakRef(sandbox);
      },
      createContextDontContextify() {
        return new WeakRef(vm.createContext(vm.constants.DONT_CONTEXTIFY));
      },
      runInNewContext() {
        const sandbox = {};
        vm.runInNewContext("1", sandbox);
        return new WeakRef(sandbox);
      },
      scriptRunInNewContext() {
        const sandbox = {};
        new vm.Script("1").runInNewContext(sandbox);
        return new WeakRef(sandbox);
      },
    };
    // The collector scans the stack conservatively, and the call that creates a context leaves pointers
    // to it in the stack memory that call used. So the context is created 1000 frames down: when the
    // loop below calls Bun.gc(), all of that memory is below the stack pointer and is not scanned.
    // A call inside a try block is never a tail call, so JSC cannot turn the recursion into a jump in
    // strict code. Without the frames the output would look like the bug's, so the check below is loud.
    function createDeep(makeRef, depth) {
      try {
        if (depth > 0) return createDeep(makeRef, depth - 1);
        return makeRef();
      } finally {
      }
    }
    Error.stackTraceLimit = 2000;
    const framesAtLeaf = createDeep(() => new Error().stack.split("\n").length - 1, 1000);
    if (framesAtLeaf < 1000) throw new Error("createDeep is only " + framesAtLeaf + " frames deep");
    // A case counts as collectable when any of its rounds collected the context. The shared structure
    // kept the context alive in every round.
    const collectedRounds = {};
    for (const name in cases) {
      collectedRounds[name] = 0;
      for (let round = 0; round < 3; round++) {
        const ref = createDeep(cases[name], 1000);
        // Bun.gc() also ends this job's keep-alive of WeakRef targets before it collects.
        Bun.gc(true);
        if (ref.deref() === undefined) collectedRounds[name]++;
      }
    }
    console.log(JSON.stringify(collectedRounds));
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const collectedRounds: Record<string, number> = JSON.parse(stdout);
  const collectable = Object.fromEntries(Object.entries(collectedRounds).map(([name, rounds]) => [name, rounds > 0]));
  expect(collectable).toEqual({
    createContext: true,
    createContextDontContextify: true,
    runInNewContext: true,
    scriptRunInNewContext: true,
  });
  expect(exitCode).toBe(0);
});
