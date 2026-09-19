import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { totalmem } from "node:os";
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

describe("lineOffset/columnOffset validation (Node's validateInt32)", () => {
  // JSC boxes these as doubles even though they are integers: -0 is what
  // `lineOffset: -n` produces when n is 0, and double arithmetic / Float64Array
  // reads produce integral doubles. Derived at runtime so nothing folds them
  // back into int32 literals. Validation must look at the value, like Node.
  const half = Number("1.5");
  const threeAsDouble = half + half;
  const fourAsDouble = new Float64Array([4])[0];

  const source = "new Error().stack";
  const location = (stack: unknown) => {
    const match = String(stack).match(/offsets\.js:\d+:\d+/);
    if (!match) throw new Error(`no offsets.js frame in:\n${stack}`);
    return match[0];
  };
  const entryPoints: Record<string, (options: Record<string, unknown>) => unknown> = {
    "new Script(code, options).runInThisContext()": options => new Script(source, options).runInThisContext(),
    "new Script(code, options).runInContext(context, options)": options =>
      new Script(source, options).runInContext(createContext(), options),
    "vm.runInThisContext": options => runInThisContext(source, options),
    "vm.runInContext": options => runInContext(source, createContext(), options),
    "vm.runInNewContext": options => runInNewContext(source, {}, options),
    // compileFunction does not apply columnOffset to runtime frames yet, so
    // for this entry only the line half of the comparisons is discriminating.
    "vm.compileFunction": options => compileFunction(`return ${source}`, [], options)(),
  };

  test.each(Object.keys(entryPoints))("%s accepts -0 and integral doubles and applies them as the integer", name => {
    const run = (options: Record<string, unknown>) =>
      location(entryPoints[name]({ filename: "offsets.js", ...options }));

    expect(run({ lineOffset: -0, columnOffset: -0 })).toBe(run({ lineOffset: 0, columnOffset: 0 }));
    const shifted = run({ lineOffset: threeAsDouble, columnOffset: fourAsDouble });
    expect(shifted).toBe(run({ lineOffset: 3, columnOffset: 4 }));
    expect(shifted).toMatch(/^offsets\.js:4:\d+$/);
  });

  // Both int32 bounds are accepted whichever way they are boxed. Compiling at
  // INT32_MAX overflows JSC's line counter (#38228), and the run-side options
  // are validated without compiling anything, so the bounds are checked there.
  test.each(["lineOffset", "columnOffset"])("%s accepts INT32_MIN and INT32_MAX as int32 or double", option => {
    const script = new Script("1");
    const bounds = [-2147483648, 2147483647];
    const boundsAsDoubles = new Float64Array(bounds);
    for (let i = 0; i < bounds.length; i++) {
      expect(script.runInThisContext({ [option]: bounds[i] })).toBe(1);
      expect(script.runInThisContext({ [option]: boundsAsDoubles[i] })).toBe(1);
    }
  });

  test("-0 and integral doubles position errors like the integers they equal", () => {
    const header = (options: Record<string, unknown>) => {
      try {
        new Script("%%", { filename: "offsets.js", ...options });
      } catch (e: any) {
        return e.stack.split("\n", 1)[0];
      }
      throw new Error("expected a SyntaxError");
    };
    expect(header({ lineOffset: -0, columnOffset: -0 })).toBe("offsets.js:1");
    expect(header({ lineOffset: threeAsDouble, columnOffset: fourAsDouble })).toBe("offsets.js:4");
  });

  // Expected outcomes are what Node v26 reports for the same values.
  const int32Range = ">= -2147483648 && <= 2147483647";
  const ok = () => "ok";
  const outOfRange = (must: string, received: string) => (name: string) =>
    `RangeError ERR_OUT_OF_RANGE: The value of "${name}" is out of range. It must be ${must}. Received ${received}`;
  const invalidType = (received: string) => (name: string) =>
    `TypeError ERR_INVALID_ARG_TYPE: The "${name}" property must be of type number. Received ${received}`;
  const cases: [label: string, value: unknown, expected: (name: string) => string][] = [
    ["-0", -0, ok],
    ["integral double", threeAsDouble, ok],
    ["Float64Array element", fourAsDouble, ok],
    // Only the lower bound is compiled at; see the INT32_MAX test above.
    ["INT32_MIN", -2147483648, ok],
    ["INT32_MIN as a double", new Float64Array([-2147483648])[0], ok],
    ["undefined", undefined, ok],
    ["INT32_MAX + 1", 2147483648, outOfRange(int32Range, "2147483648")],
    ["INT32_MIN - 1", -2147483649, outOfRange(int32Range, "-2147483649")],
    ["2 ** 32", 2 ** 32, outOfRange(int32Range, "4294967296")],
    // Past JSC's int52 range, but an integer to Node, so it gets the range
    // message rather than "an integer".
    ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER, outOfRange(int32Range, "9_007_199_254_740_991")],
    ["0.1", 0.1, outOfRange("an integer", "0.1")],
    ["NaN", NaN, outOfRange("an integer", "NaN")],
    ["Infinity", Infinity, outOfRange("an integer", "Infinity")],
    ["null", null, invalidType("null")],
    ["string", "1", invalidType("type string ('1')")],
    ["bigint", 1n, invalidType("type bigint (1n)")],
    ["array", [1], invalidType("an instance of Array")],
  ];

  const outcome = (fn: () => unknown) => {
    try {
      fn();
      return "ok";
    } catch (e: any) {
      return `${e.name} ${e.code}: ${e.message}`;
    }
  };

  const compilers: Record<string, (options: Record<string, unknown>) => unknown> = {
    "new Script": options => new Script("1", options),
    "vm.compileFunction": options => compileFunction("return 1", [], options),
  };

  test.each(
    Object.keys(compilers).flatMap(compiler =>
      ["lineOffset", "columnOffset"].map(option => [compiler, option] as const),
    ),
  )("%s validates %s like Node", (compiler, option) => {
    const expected = cases.map(([label, , expectedFor]) => [label, expectedFor(`options.${option}`)]);
    const actual = cases.map(([label, value]) => [label, outcome(() => compilers[compiler]({ [option]: value }))]);
    expect(actual).toEqual(expected);
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

// The realm of a function defined in a context is the context's global object. That is not
// the Bun global that holds the File and fs.Stats structures.
describe.concurrent("File and fs.Stats accept a newTarget that belongs to a context", () => {
  const prelude = /*js*/ `
    const vm = require("node:vm");
    const fs = require("node:fs");
    const BigIntStats = fs.statSync(".", { bigint: true }).constructor;
    const bigintArgs = [1n, 0o100644n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 2000000n, 0n, 0n, 0n];
  `;

  test.each([
    {
      name: "class extends File",
      script: /*js*/ `
        const context = vm.createContext({ File });
        const [Upload, upload] = vm.runInContext(
          'class Upload extends File { get custom() { return 42; } }; [Upload, new Upload(["abc"], "a.txt")]',
          context,
        );
        console.log(JSON.stringify({
          prototype: Object.getPrototypeOf(upload) === Upload.prototype,
          instanceof: upload instanceof File,
          name: upload.name,
          size: upload.size,
          custom: upload.custom,
        }));
      `,
      expected: { prototype: true, instanceof: true, name: "a.txt", size: 3, custom: 42 },
    },
    {
      name: "class extends fs.Stats",
      script: /*js*/ `
        const context = vm.createContext({ Stats: fs.Stats });
        const [S, stats] = vm.runInContext(
          "class S extends Stats { get custom() { return 42; } }; [S, new S(1, 0o100644)]",
          context,
        );
        console.log(JSON.stringify({
          prototype: Object.getPrototypeOf(stats) === S.prototype,
          instanceof: stats instanceof fs.Stats,
          isFile: stats.isFile(),
          mode: stats.mode,
          custom: stats.custom,
        }));
      `,
      expected: { prototype: true, instanceof: true, isFile: true, mode: 0o100644, custom: 42 },
    },
    {
      name: "class extends BigIntStats",
      script: /*js*/ `
        const context = vm.createContext({ BigIntStats, bigintArgs });
        const [S, stats] = vm.runInContext(
          "class S extends BigIntStats { get custom() { return 42; } }; [S, new S(...bigintArgs)]",
          context,
        );
        console.log(JSON.stringify({
          prototype: Object.getPrototypeOf(stats) === S.prototype,
          instanceof: stats instanceof BigIntStats,
          isFile: stats.isFile(),
          atimeNs: String(stats.atimeNs),
          custom: stats.custom,
        }));
      `,
      expected: { prototype: true, instanceof: true, isFile: true, atimeNs: "2000000", custom: 42 },
    },
    {
      // A bound function has no "prototype", so the object gets the prototype of the constructor.
      name: "Reflect.construct with a function, a bound function, and a Proxy",
      script: /*js*/ `
        const context = vm.createContext({});
        const constructors = [[File, [["abc"], "a.txt"]], [fs.Stats, [1, 0o100644]], [BigIntStats, bigintArgs]];
        const result = {};
        for (const source of ["(function F() {})", "(function F() {}).bind(null)", "new Proxy(function F() {}, {})"]) {
          const newTarget = vm.runInContext(source, context);
          result[source] = constructors.map(([C, args]) => {
            const object = Reflect.construct(C, args, newTarget);
            return Object.getPrototypeOf(object) === (newTarget.prototype ?? C.prototype);
          });
        }
        console.log(JSON.stringify(result));
      `,
      expected: {
        "(function F() {})": [true, true, true],
        "(function F() {}).bind(null)": [true, true, true],
        "new Proxy(function F() {}, {})": [true, true, true],
      },
    },
  ])("$name", async ({ script, expected }) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: JSON.stringify(expected),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
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

// Several SourceTextModules with one identifier and one source text are several records of the same module. Each reads
// the bindings of the module it was linked to, whatever that module's text is, including from functions that were
// already hot when the next record was made.
test.each([
  ["the main context", false],
  ["a new context", true],
])(
  "SourceTextModules with the same identifier and source keep their own import bindings in %s",
  async (_, inNewContext) => {
    const context = inNewContext ? createContext({}) : undefined;
    const importerSource = `
      import { x, shape, bump as bumpDep } from "dep";
      export function read() { return [x, shape].join(); }
      export function loop(n) { let r; for (let i = 0; i < n; i++) r = read(); return r; }
      export function bump() { bumpDep(); }
    `;
    const dep1 = `export let x = 0; export const shape = 1; export function bump() { x++; }`;
    // The same names at other places in the module's environment.
    const dep2 = `export let w = "w"; export let x = 100; export const shape = 2; export function bump() { x++; }`;
    const make = async (depSource: string) => {
      const dep = new SourceTextModule(depSource, { identifier: "dep", context });
      const importer = new SourceTextModule(importerSource, { identifier: "importer", context });
      await importer.link(() => dep);
      await importer.evaluate();
      return importer.namespace as { read(): string; loop(n: number): string; bump(): void };
    };
    const a = await make(dep1);
    const before = a.loop(20000);
    const b = await make(dep1);
    const c = await make(dep2);
    const d = await make(dep2);
    const e = await make(dep1);
    b.bump();
    c.bump();
    c.bump();
    d.bump();
    d.bump();
    d.bump();
    expect([before, ...[a, b, c, d, e].map(m => m.loop(20000))]).toEqual([
      "0,1",
      "0,1",
      "1,1",
      "102,2",
      "103,2",
      "0,1",
    ]);
  },
);

// NodeVMSourceTextModule::createModuleRecord pairs import declarations with requestedModules() by position, but JSC lists
// a specifier once however many declarations name it: builds with assertions enabled abort on "More attributes nodes
// than requests" (other builds go on, with the attributes lined up by that position). In a subprocess, since the abort
// would take the test runner with it.
test.todoIf(isDebug || isASAN)("SourceTextModule with several import declarations for one specifier", async () => {
  const script = `
    const { SourceTextModule } = require("node:vm");
    (async () => {
      const dep = new SourceTextModule("export let x = 1; export function bump() { x++; }", { identifier: "dep" });
      const importer = new SourceTextModule(
        'import { x } from "dep"; import * as ns from "dep"; export { bump } from "dep"; export const read = () => [x, ns.x].join();',
        { identifier: "importer" },
      );
      await importer.link(() => dep);
      await importer.evaluate();
      importer.namespace.bump();
      console.log(importer.namespace.read(), JSON.stringify(importer.moduleRequests));
    })();
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr: stderr.trim() }).toEqual({
    stdout: '2,2 [{"specifier":"dep","attributes":{},"phase":"evaluation"}]',
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// JSC decodes a code block's function bodies one at a time, the first time each body runs,
// reading the cachedData payload through the Decoder until then. The three entry points
// lent JSC a span over a temporary WTF::Vector copy of the caller's buffer that died with
// the call, so the first call of a function compiled from accepted cachedData read freed
// memory. Keeping the caller's Buffer alive does not help: the dangling span is over bun's
// copy of it.
describe("a compile from cachedData keeps the payload alive", () => {
  // Malloc=1 routes WTF's allocator through the system allocator so ASAN sees the freed
  // payload. Without the fix the child aborts at the first case.
  test.skipIf(!isASAN)("does not decode function bodies out of freed memory", async () => {
    const fixture = String.raw`
      const vm = require("node:vm");
      const out = [];

      // compileFunction: the compiled function's own body decodes on its first call.
      {
        const source = "return a + 1234;";
        const produced = vm.compileFunction(source, ["a"], { produceCachedData: true });
        const fn = vm.compileFunction(source, ["a"], { cachedData: produced.cachedData });
        out.push("compileFunction rejected=" + fn.cachedDataRejected + " call=" + fn(1));
      }

      // An inner function decodes later still, on its own first call.
      {
        const source = "function inner() { return 42 }\nreturn inner;";
        const produced = vm.compileFunction(source, [], { produceCachedData: true });
        const fn = vm.compileFunction(source, [], { cachedData: produced.cachedData });
        out.push("inner rejected=" + fn.cachedDataRejected + " call=" + fn()());
      }

      // vm.Script holds its cachedData in a member the garbage collector owns.
      {
        const source = "(function inner() { return 7 })()";
        const cachedData = new vm.Script(source).createCachedData();
        const script = new vm.Script(source, { cachedData });
        out.push("Script rejected=" + script.cachedDataRejected + " run=" + script.runInThisContext());
      }

      // vm.SourceTextModule passes a span over a stack local, like compileFunction.
      {
        const source = "function inner() { return 9 }\nexport default inner();";
        const cachedData = new vm.SourceTextModule(source, { identifier: "m" }).createCachedData();
        const mod = new vm.SourceTextModule(source, { identifier: "m", cachedData });
        await mod.link(() => {});
        await mod.evaluate();
        out.push("SourceTextModule default=" + mod.namespace.default);
      }

      console.log(out.join("\n"));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: {
        ...bunEnv,
        ...(isWindows ? {} : { Malloc: "1" }),
        // symbolize=0: symbolizing a failure report outlasts the test timeout.
        // detect_leaks=0: Malloc=1 exposes JSC's never-freed startup allocations to LSAN.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr first: the failure this test guards against aborts the child, so the sanitizer
    // report is the diagnostic. An empty-stdout diff is not.
    expect(stderr).not.toContain("ERROR: AddressSanitizer");
    expect(stdout).toBe(
      [
        "compileFunction rejected=false call=1235",
        "inner rejected=false call=42",
        "Script rejected=false run=7",
        "SourceTextModule default=9",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(0);
  });

  // The same bug with no sanitizer. Work between the compile and the first call reuses the
  // freed payload's memory, and roughly two unfixed processes in five then die with
  // "Segmentation fault at address 0x0". It is down to heap layout (an ES module on disk
  // shows it, `-e` and CommonJS do not), so several children run.
  test.skipIf(isASAN)("runs the compiled functions after the payload's memory is reused", async () => {
    const fixture = String.raw`
      import vm from "node:vm";
      const out = [];
      for (let i = 0; i < 20; i++) {
        const source = 'function inner(x){ return x * ' + (i + 2) + ' + 1 } return [inner(7), "k' + i + '".repeat(3)]';
        const produced = vm.compileFunction(source, [], { produceCachedData: true });
        const junk = Array.from({ length: 50 }, (_, j) => new Uint8Array(produced.cachedData.length).fill(j));
        const fn = vm.compileFunction(source, [], { cachedData: produced.cachedData });
        const want = JSON.stringify(produced());
        let got;
        try {
          got = JSON.stringify(fn());
        } catch (e) {
          got = "threw " + e.message;
        }
        out.push(fn.cachedDataRejected + ":" + (got === want ? "ok" : "WRONG " + got));
      }
      console.log(out.join(" "));
    `;

    using dir = tempDir("vm-cached-data-reuse", { "reuse-fixture.mjs": fixture });
    const children = 8;
    const runs = await Promise.all(
      Array.from({ length: children }, async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "reuse-fixture.mjs"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode, signalCode: proc.signalCode };
      }),
    );

    const clean = { stdout: Array(20).fill("false:ok").join(" ") + "\n", stderr: "", exitCode: 0, signalCode: null };
    expect(runs).toEqual(Array(children).fill(clean));
  });
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

describe("a run option rejected with a vm context's global", () => {
  // Script#runInContext and Script#runInNewContext validate displayErrors,
  // timeout and breakOnSigint with the context's global object, which is not a
  // Bun global. The message renders the rejected value through the console
  // formatter, and the formatter needs a Bun global, so it read past the end of
  // the context's cell: ASAN reports a heap-buffer-overflow and a release build
  // segfaults. Each case gets its own process.
  //
  // The vm.* wrappers build the Script first, and that rejects a bad timeout
  // with the main global, so only the Script methods reach the bug with it.
  const types = { displayErrors: "boolean", timeout: "number", breakOnSigint: "boolean" } as const;
  type Option = keyof typeof types;
  const entryPoints: [name: string, call: string, options: Option[]][] = [
    ["vm.runInContext()", `vm.runInContext("1", vm.createContext({}), options)`, ["displayErrors", "breakOnSigint"]],
    ["vm.runInNewContext()", `vm.runInNewContext("1", {}, options)`, ["displayErrors", "breakOnSigint"]],
    [
      "Script#runInContext()",
      `new vm.Script("1").runInContext(vm.createContext({}), options)`,
      ["displayErrors", "timeout", "breakOnSigint"],
    ],
    [
      "Script#runInNewContext()",
      `new vm.Script("1").runInNewContext({}, options)`,
      ["displayErrors", "timeout", "breakOnSigint"],
    ],
  ];

  async function run(fixture: string) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // A custom inspect function reaches the Bun global's inspect builtins. The
  // function reports what it was handed, so a wrong global is visible in the
  // output instead of only as a crash. It sits on the null-prototype object
  // itself because Node renders the value with `depth: -1`, which runs no
  // nested inspect function, so this message is Node's byte for byte.
  test.concurrent.each(
    entryPoints.flatMap(([name, call, options]) => options.map(option => [name, option, call] as const)),
  )("%s renders a bad %s through a custom inspect function", async (_, option, call) => {
    const { stdout, stderr, exitCode } = await run(`
      const vm = require("node:vm");
      const util = require("node:util");
      const seen = [];
      const bad = Object.create(null);
      bad[util.inspect.custom] = function (depth, opts, inspect) {
        seen.push(typeof opts, typeof opts.stylize, typeof inspect, opts.colors);
        return "CUSTOM";
      };
      const options = { ${option}: bad };
      try {
        ${call};
      } catch (e) {
        console.log([e.code, e.message, seen.join(",")].join(" | "));
      }
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      `ERR_INVALID_ARG_TYPE | The "options.${option}" property must be of type ${types[option]}. ` +
        `Received CUSTOM | object,function,function,false\n`,
    );
    expect(exitCode).toBe(0);
  });

  // A value that owns a DOM wrapper reaches a second Bun-global-only read:
  // printing one builds its wrapper, which needs the global's DOM world. These
  // need no user hook. The rendering of the value itself is not asserted, only
  // that the message is produced and the process lives.
  test.concurrent.each([
    ["a Response", `new Response("body")`],
    ["a Request", `new Request("http://127.0.0.1:9/")`],
    ["a Response.json", `Response.json({ a: 1 })`],
  ])("renders a bad displayErrors holding %s", async (_, valueExpression) => {
    const { stdout, stderr, exitCode } = await run(`
      const vm = require("node:vm");
      const bad = Object.create(null);
      bad.value = ${valueExpression};
      try {
        vm.runInContext("1", vm.createContext({}), { displayErrors: bad });
      } catch (e) {
        console.log([e.code, e.message].join(" | "));
      }
    `);
    expect(stderr).toBe("");
    expect(stdout).toStartWith(
      `ERR_INVALID_ARG_TYPE | The "options.displayErrors" property must be of type boolean. Received `,
    );
    expect(exitCode).toBe(0);
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

describe("defineProperty errors use vm-realm global", () => {
  test("data descriptor on sandbox-only property", () => {
    const sandbox = {};
    Object.defineProperty(sandbox, "locked", { value: 1, writable: false, configurable: false });
    createContext(sandbox);

    const result = runInContext(
      `
        let err;
        try {
          Object.defineProperty(this, "locked", { value: 2, configurable: true });
        } catch (e) { err = e; }
        ({
          isVmRealmTypeError: err instanceof TypeError,
          hostFunction: err && err.constructor && err.constructor.constructor,
        });
      `,
      sandbox,
    );

    expect(result.isVmRealmTypeError).toBe(true);
    expect(result.hostFunction === Function).toBe(false);
    expect(typeof result.hostFunction).toBe("function");
    expect(result.hostFunction("return typeof process")()).toBe("undefined");
  });

  test("accessor descriptor", () => {
    const sandbox = {};
    Object.defineProperty(sandbox, "locked", { value: 1, writable: false, configurable: false });
    createContext(sandbox);

    const result = runInContext(
      `
        let err;
        try {
          Object.defineProperty(this, "locked", { get() { return 2; }, configurable: true });
        } catch (e) { err = e; }
        ({
          isVmRealmTypeError: err instanceof TypeError,
          hostFunction: err && err.constructor && err.constructor.constructor,
        });
      `,
      sandbox,
    );

    expect(result.isVmRealmTypeError).toBe(true);
    expect(result.hostFunction === Function).toBe(false);
    expect(result.hostFunction("return typeof process")()).toBe("undefined");
  });

  test("data descriptor on a property not on the sandbox (non-extensible sandbox)", () => {
    // preventExtensions makes the define of a new key throw from the sandbox itself.
    const sandbox = {};
    Object.preventExtensions(sandbox);
    createContext(sandbox);

    const result = runInContext(
      `
        let err;
        try {
          Object.defineProperty(this, "newKey", { value: 1 });
        } catch (e) { err = e; }
        ({
          isVmRealmTypeError: err instanceof TypeError,
          hostFunction: err && err.constructor && err.constructor.constructor,
        });
      `,
      sandbox,
    );

    expect(result.isVmRealmTypeError).toBe(true);
    expect(result.hostFunction === Function).toBe(false);
    expect(result.hostFunction("return typeof process")()).toBe("undefined");
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

// node:vm joins strings that come from JS into a program text, into an error message, and into the
// arrow header (`<filename>:<line>`, the source line, the caret) that goes in front of the stack of an
// error from a vm script. Past `WTF::String::MaxLength` (2**31 - 1 characters) each join aborted the
// process (`panic(main thread): abort() called`, exit code 134), also inside try/catch. A program text
// or a message that does not fit is now `RangeError: Out of memory`, like `new Function`. An error
// whose header does not fit keeps the stack it has.
//
// The length is what is under test, so the child needs a string of about 2 GiB and the test skips on
// small machines. One child runs every case, so that string is allocated once. `repeat` of one
// character is used instead of `Buffer.alloc(n, fill).toString()`: JSC fills it in one pass, and it does
// not hold a second 2 GiB (1.2 s and 2.4 GB against 2.6 s and 4.4 GB in a debug ASAN build).
//
// The child touches about 3.5 GB of pages, which takes 2 to 3 seconds in a debug ASAN build and more
// on a loaded machine. That is too close to the default 5 second limit, so this one test carries its
// own ceiling.
//
// Inside a container totalmem() reports the host's RAM. process.constrainedMemory() reports the
// cgroup limit there. This is the gate blob-oom.test.ts uses.
const memoryForLongStrings = Math.min(totalmem(), process.constrainedMemory() || Infinity);
test.skipIf(memoryForLongStrings < 10 * 1024 ** 3)(
  "node:vm does not abort the process when text it joins passes the string length limit",
  async () => {
    const fixture = `
      const vm = require("node:vm");
      const long = "q".repeat(2 ** 31 - 10);

      // Each case prints its line as soon as it finishes. If a case aborts the child, the diff shows which one.
      async function report(name, run) {
        try {
          console.log(name + ": " + (await run()));
        } catch (e) {
          console.log(name + ": " + e.name + ": " + e.message);
        }
      }

      // Joined, the two params are 2**31 + 2 characters. slice() shares the characters of \`long\`.
      const half = long.slice(0, 2 ** 30);
      await report("compileFunction params", () => typeof vm.compileFunction("", [half, half]));

      // The message names the export that the module does not have.
      await report("SyntheticModule#setExport", () => new vm.SyntheticModule([], () => {}).setExport(long, 1));

      // Without importModuleDynamically, import() in a context rejects with a message that names the specifier.
      await report("import() in a context", () => vm.runInNewContext("Function")("s", "return import(s)")(long));

      const keptItsStack = (error, name) =>
        error.name === name && error.stack === long ? name + " with the stack it had" : error.name + " with another stack";

      // A stack this long leaves no room for the header in front of it.
      function thrownBy(code) {
        const error = new Error("x");
        error.stack = long;
        try {
          new vm.Script(code).runInNewContext({ error });
        } catch (e) {
          if (e !== error) throw e;
          return keptItsStack(e, "Error");
        }
        return "did not throw";
      }
      await report("error thrown by a script", () => thrownBy("throw error"));
      // A source line over 1024 characters is left out of the header. A second join builds that header.
      await report("error thrown from a line too long for the header", () => thrownBy("throw error;" + Buffer.alloc(2000, " ").toString()));

      // The header of a compile-time SyntaxError goes in front of what Error.prepareStackTrace returned.
      await report("SyntaxError from new Script", () => {
        const prepareStackTrace = Error.prepareStackTrace;
        Error.prepareStackTrace = () => long;
        try {
          new vm.Script("%%");
        } catch (e) {
          return keptItsStack(e, "SyntaxError");
        } finally {
          Error.prepareStackTrace = prepareStackTrace;
        }
        return "did not throw";
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
      stdout: [
        "compileFunction params: RangeError: Out of memory",
        "SyntheticModule#setExport: RangeError: Out of memory",
        "import() in a context: RangeError: Out of memory",
        "error thrown by a script: Error with the stack it had",
        "error thrown from a line too long for the header: Error with the stack it had",
        "SyntaxError from new Script: SyntaxError with the stack it had",
      ],
      stderr: "",
      exitCode: 0,
    });
  },
  30_000,
);
