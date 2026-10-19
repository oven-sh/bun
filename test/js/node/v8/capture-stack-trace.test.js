import { nativeFrameForTesting } from "bun:internal-for-testing";
import { noInline } from "bun:jsc";
import { afterEach, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { totalmem } from "node:os";
const origPrepareStackTrace = Error.prepareStackTrace;
afterEach(() => {
  Error.prepareStackTrace = origPrepareStackTrace;
});

test("Regular .stack", () => {
  var err;
  class Foo {
    constructor() {
      err = new Error("wat");
    }
  }

  new Foo();
  expect(err.stack).toMatch(/at new Foo/);
});

test("throw inside Error.prepareStackTrace doesnt crash", () => {
  Error.prepareStackTrace = function (err, stack) {
    Error.prepareStackTrace = null;
    throw new Error("wat");
  };

  expect(() => new Error().stack).toThrow("wat");
});

test("capture stack trace", () => {
  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    logErrorStackTrace();
  }

  function logErrorStackTrace() {
    let error = {};
    Error.captureStackTrace(error);
    expect(error.stack !== undefined).toBe(true);
  }

  f1();
});

test("capture stack trace with message", () => {
  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    logErrorStackTrace();
  }

  function logErrorStackTrace() {
    let e1 = { message: "bad error!" };
    Error.captureStackTrace(e1);
    expect(e1.message === "bad error!").toBe(true);

    let e2 = new Error("bad error!");
    Error.captureStackTrace(e2);
    expect(e2.message === "bad error!").toBe(true);
  }

  f1();
});

test("capture stack trace with constructor", () => {
  class S {
    constructor() {
      captureStackTrace();
    }
  }

  function captureStackTrace() {
    let e1 = {};
    Error.captureStackTrace(e1);
    expect(e1.stack.split("\n")[2].includes("new S")).toBe(true);
  }

  let s = new S();
});

test("capture stack trace limit", () => {
  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    f4();
  }

  function f4() {
    f5();
  }

  function f5() {
    f6();
  }

  function f6() {
    f7();
  }

  function f7() {
    f8();
  }

  function f8() {
    f9();
  }

  function f9() {
    f10();
  }

  function f10() {
    captureStackTrace();
  }

  var originalLimit = Error.stackTraceLimit;
  function captureStackTrace() {
    let e1 = {};
    Error.captureStackTrace(e1);

    expect(e1.stack.split("\n").length).toBe(11);

    let e2 = new Error();
    Error.captureStackTrace(e2);

    expect(e2.stack.split("\n").length).toBe(11);

    let e3 = {};
    Error.stackTraceLimit = 4;
    Error.captureStackTrace(e3);
    expect(e3.stack.split("\n").length).toBe(5);

    let e4 = new Error();
    Error.captureStackTrace(e4);
    expect(e4.stack.split("\n").length).toBe(5);

    let e5 = { stackTraceLimit: 2 };
    Error.captureStackTrace(e5);
    expect(e5.stack.split("\n").length).toBe(5);

    let e6 = {};
    Error.stackTraceLimit = Infinity;
    Error.captureStackTrace(e6);
    expect(e6.stack.split("\n").length).toBe(13);
  }
  try {
    f1();
  } finally {
    Error.stackTraceLimit = originalLimit;
  }
});

test("prepare stack trace", () => {
  function f1() {
    f2();
  }

  function f2() {
    let e = {};
    let prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, stack) => {
      return "custom stack trace";
    };
    Error.captureStackTrace(e);
    expect(e.stack).toBe("custom stack trace");
    Error.prepareStackTrace = prevPrepareStackTrace;
    f3();
  }

  function f3() {
    let e = { message: "bad error!" };
    let prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, s) => {
      expect(e.message === "bad error!").toBe(true);
      expect(s.length).toBe(4);
    };
    Error.stackTraceLimit = 10;
    Error.captureStackTrace(e);
    expect(e.stack === undefined).toBe(true);
    Error.prepareStackTrace = prevPrepareStackTrace;
  }

  f1();
});

test("capture stack trace second argument", () => {
  function f0() {
    let s = new S();
  }

  class S {
    constructor() {
      f1();
    }
  }

  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    f4();
  }

  function f4() {
    f5();
  }

  function f5() {
    f6();
  }

  function f6() {
    let e = { message: "bad error!" };
    Error.captureStackTrace(e);
    expect(e.stack.split("\n")[1].includes("at f6")).toBe(true);
    expect(e.stack.split("\n")[2].includes("at f5")).toBe(true);

    let e2 = {};
    Error.captureStackTrace(e2, f3);
    expect(e2.stack.split("\n")[1].includes("at f2")).toBe(true);
    expect(e2.stack.split("\n")[2].includes("at f1")).toBe(true);

    let e3 = {};
    Error.captureStackTrace(e3, f9);
    expect(e3.stack.split("\n").length).toBe(1);

    let e4 = { message: "exclude constructor!" };
    Error.captureStackTrace(e4, S.constructor);
    expect(e4.stack.split("\n").length).toBe(1);

    let e5 = { message: "actually exclude constructor!" };
    Error.captureStackTrace(e5, S);
    expect(e5.stack.split("\n")[1].includes("at f0")).toBe(true);
  }

  function f9() {
    // nothing
  }

  f0();
});

test("capture stack trace edge cases", () => {
  let e1 = {};
  Error.captureStackTrace(e1, null);
  expect(e1.stack !== undefined).toBe(true);

  let e2 = {};
  Error.captureStackTrace(e2, undefined);
  expect(e2.stack !== undefined).toBe(true);

  let e3 = {};
  Error.captureStackTrace(e3, 1);
  expect(e3.stack !== undefined).toBe(true);

  let e4 = {};
  Error.captureStackTrace(e4, "foo");
  expect(e4.stack !== undefined).toBe(true);

  let e5 = {};
  Error.captureStackTrace(e5, {});
  expect(e5.stack !== undefined).toBe(true);

  expect(Error.captureStackTrace({})).toBe(undefined);
  expect(Error.captureStackTrace({}, () => {})).toBe(undefined);
  expect(Error.captureStackTrace({}, undefined)).toBe(undefined);
  expect(Error.captureStackTrace({}, null)).toBe(undefined);
  expect(Error.captureStackTrace({}, 1)).toBe(undefined);
  expect(Error.captureStackTrace({}, "foo")).toBe(undefined);
  expect(Error.captureStackTrace({}, {})).toBe(undefined);
  expect(Error.captureStackTrace({}, [])).toBe(undefined);
  expect(Error.captureStackTrace({}, true)).toBe(undefined);
});

test("Error.captureStackTrace installs .stack as non-enumerable", () => {
  // V8 installs .stack with enumerable: false regardless of target type.
  const expectNonEnumerableStack = target => {
    const d = Object.getOwnPropertyDescriptor(target, "stack");
    expect({ enumerable: d.enumerable, configurable: d.configurable }).toEqual({
      enumerable: false,
      configurable: true,
    });
    // V8 installs an accessor (no `writable`), Bun installs a data property; both
    // must allow assignment. Only `writable: false` would be a regression.
    expect(d.writable).not.toBe(false);
    expect(Object.prototype.propertyIsEnumerable.call(target, "stack")).toBe(false);
  };

  // plain object target
  const o = { a: 1 };
  Error.captureStackTrace(o);
  expect(Object.keys(o)).toEqual(["a"]);
  expect(JSON.stringify(o)).toBe('{"a":1}');
  const forIn = [];
  for (const k in o) forIn.push(k);
  expect(forIn).toEqual(["a"]);
  expectNonEnumerableStack(o);
  expect(typeof o.stack).toBe("string");
  o.stack = "overwritten";
  expect(o.stack).toBe("overwritten");
  expectNonEnumerableStack(o);

  // plain object with Error.prepareStackTrace set. Inside the callback, .stack
  // holds the temporary default-formatted string; observing it there pins the
  // attribute on that write, which the final putDirect would otherwise mask.
  let insidePrepare;
  Error.prepareStackTrace = (err, sites) => {
    insidePrepare = {
      keys: Object.keys(err),
      enumerable: Object.getOwnPropertyDescriptor(err, "stack").enumerable,
    };
    return "from-prepare";
  };
  try {
    const o2 = {};
    Error.captureStackTrace(o2);
    expect(insidePrepare).toEqual({ keys: [], enumerable: false });
    expect(Object.keys(o2)).toEqual([]);
    expectNonEnumerableStack(o2);
    expect(o2.stack).toBe("from-prepare");
  } finally {
    Error.prepareStackTrace = origPrepareStackTrace;
  }

  // Object.keys must run before any descriptor lookup: getOwnPropertyDescriptor trips
  // ErrorInstance::materializeErrorInfoIfNeeded, which overwrites with its own DontEnum
  // and would mask the attribute captureStackTrace installed on the accessor path.
  const lazy = new Error("lazy");
  Error.captureStackTrace(lazy);
  expect(Object.keys(lazy)).toEqual([]);
  expectNonEnumerableStack(lazy);

  // ErrorInstance whose .stack has already been materialized
  const materialized = new Error("materialized");
  void materialized.stack;
  Error.captureStackTrace(materialized);
  expect(Object.keys(materialized)).toEqual([]);
  expectNonEnumerableStack(materialized);
  materialized.stack = "overwritten";
  expect(materialized.stack).toBe("overwritten");
  expectNonEnumerableStack(materialized);
});

test("prepare stack trace call sites", () => {
  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    let e = { message: "bad error!" };
    // let e = new Error("bad error!");
    let prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, s) => {
      expect(s[0].getThis !== undefined).toBe(true);
      expect(s[0].getTypeName !== undefined).toBe(true);
      expect(s[0].getFunction !== undefined).toBe(true);
      expect(s[0].getFunctionName !== undefined).toBe(true);
      expect(s[0].getMethodName !== undefined).toBe(true);
      expect(s[0].getFileName !== undefined).toBe(true);
      expect(s[0].getLineNumber !== undefined).toBe(true);
      expect(s[0].getColumnNumber !== undefined).toBe(true);
      expect(s[0].getEvalOrigin !== undefined).toBe(true);
      expect(s[0].isToplevel !== undefined).toBe(true);
      expect(s[0].isEval !== undefined).toBe(true);
      expect(s[0].isNative !== undefined).toBe(true);
      expect(s[0].isConstructor !== undefined).toBe(true);
      expect(s[0].isAsync !== undefined).toBe(true);
      expect(s[0].isPromiseAll !== undefined).toBe(true);
      expect(s[0].getPromiseIndex !== undefined).toBe(true);
    };
    Error.captureStackTrace(e);
    expect(e.stack === undefined).toBe(true);
    Error.prepareStackTrace = prevPrepareStackTrace;
  }

  f1();
});

test("sanity check", () => {
  function f1() {
    f2();
  }

  function f2() {
    f3();
  }

  function f3() {
    let e = new Error("bad error!");
    let prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, s) => {
      // getThis returns undefined in strict mode
      expect(s[0].getThis()).toBe(undefined);
      expect(s[0].getTypeName()).toBe("undefined");
      // getFunction returns undefined in strict mode
      expect(s[0].getFunction()).toBe(undefined);
      expect(s[0].getFunctionName()).toBe("f3");
      expect(s[0].getMethodName()).toBe("f3");
      expect(typeof s[0].getLineNumber()).toBe("number");
      expect(typeof s[0].getColumnNumber()).toBe("number");
      expect(s[0].getFileName().includes("capture-stack-trace.test.js")).toBe(true);

      expect(s[0].getEvalOrigin()).toBe(undefined);
      expect(s[0].isToplevel()).toBe(true);
      expect(s[0].isEval()).toBe(false);
      expect(s[0].isNative()).toBe(false);
      expect(s[0].isConstructor()).toBe(false);
      expect(s[0].isAsync()).toBe(false);
      expect(s[0].isPromiseAll()).toBe(false);
      expect(s[0].getPromiseIndex()).toBe(null);
    };
    Error.captureStackTrace(e);
    expect(e.stack === undefined).toBe(true);
    Error.prepareStackTrace = prevPrepareStackTrace;
  }

  f1();
});

test("CallFrame isEval works as expected", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;

  let name, fn;

  Error.prepareStackTrace = (e, s) => {
    return s;
  };

  name = "f1";
  const stack = eval(`(function ${name}() {
    return new Error().stack;
  })()`);

  Error.prepareStackTrace = prevPrepareStackTrace;
  // TODO: 0 and 1 should both return true here.
  expect(stack[1].isEval()).toBe(true);
  expect(stack[0].getFunctionName()).toBe(name);
});

test("CallFrame isTopLevel returns false for Function constructor", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;
  const sloppyFn = new Function("let e=new Error();Error.captureStackTrace(e);return e.stack");
  sloppyFn.displayName = "sloppyFnWow";
  noInline(sloppyFn);
  const that = {};

  Error.prepareStackTrace = (e, s) => {
    expect(s[0].getFunctionName()).toBe(sloppyFn.displayName);
    expect(s[0].getFunction()).toBe(sloppyFn);

    expect(s[0].isToplevel()).toBe(false);
    expect(s[0].isEval()).toBe(false);

    // Strict-mode functions shouldn't have getThis or getFunction
    // available.
    expect(s[1].getThis()).toBe(undefined);
    expect(s[1].getFunction()).toBe(undefined);
  };

  sloppyFn.call(that);

  Error.prepareStackTrace = prevPrepareStackTrace;
});

test("CallFrame.p.getThisgetFunction: strict/sloppy mode interaction", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;

  const strictFn = new Function('"use strict";let e=new Error();Error.captureStackTrace(e);return e.stack');
  const sloppyFn = new Function("x", "x()");
  const that = {};

  Error.prepareStackTrace = (e, s) => {
    // The first strict mode function encounted during stack unwinding
    // stops subsequent frames from having getThis\getFunction.
    for (const t of s) {
      expect(t.getThis()).toBe(undefined);
      expect(t.getFunction()).toBe(undefined);
    }
  };

  sloppyFn.call(that, strictFn);

  Error.prepareStackTrace = prevPrepareStackTrace;
});

test("CallFrame.p.isConstructor", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;

  class C {
    constructor() {
      Error.captureStackTrace(new Error(""));
    }
  }

  Error.prepareStackTrace = (e, s) => {
    expect(s[0].isConstructor()).toBe(true);
    // TODO: should be false: this is an instance of C
    expect(s[0].isToplevel()).toBe(true);
    // TODO: should return the class name
    // expect(s[0].getTypeName()).toBe('C');

    expect(s[1].isConstructor()).toBe(false);
    expect(s[1].isToplevel()).toBe(true);
  };
  new C();
  Error.prepareStackTrace = prevPrepareStackTrace;
});

test("CallFrame.p.isNative", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (e, s) => {
    expect(s[0].isNative()).toBe(false);
    expect(s[1].isNative()).toBe(true);
    expect(s[2].isNative()).toBe(false);
  };

  nativeFrameForTesting(() => {
    const err = new Error("");
    Error.captureStackTrace(err);
    return 0;
  });
  Error.prepareStackTrace = prevPrepareStackTrace;
});

// getFunction() must report undefined for a callee that user code could never
// have called: a host function, a builtin, an async or generator body function,
// a wasm frame, a program frame. A call to a body function crashed the process.
// `...Caller=self` rows: a frame below one of those keeps its own function.
// `...IsToplevel=false` rows: hiding a callee does not change isToplevel().
// The fixture is CommonJS because a strict frame already reports undefined.
test.concurrent("CallFrame.p.getFunction hides internal callees from sloppy code", async () => {
  using dir = tempDir("callsite-internal-callee", {
    "internal-callee-fixture.cjs": `
      const { nativeFrameForTesting } = require("bun:internal-for-testing");
      Error.prepareStackTrace = (e, sites) => sites;

      const out = [];
      const show = v => (typeof v === "function" ? "function/" + v.length : typeof v === "object" && v !== null ? "object" : String(v));
      const named = (sites, name) => sites.find(s => s.getFunctionName() === name);

      function sloppy() {
        out.push("sloppy=" + (new Error().stack[0].getFunction() === sloppy ? "self" : "?"));
      }
      sloppy();

      nativeFrameForTesting(function underNativeFrame() {
        const sites = new Error().stack;
        out.push("nativeIsNative=" + sites[1].isNative());
        out.push("native=" + show(sites[1].getFunction()));
        return 0;
      });

      function hostCaller() {
        [0].map(function underHostFunction() {
          const sites = new Error().stack;
          const host = named(sites, "map");
          out.push("hostFound=" + !!host);
          out.push("host=" + show(host && host.getFunction()));
          out.push("hostIsToplevel=" + (host && host.isToplevel()));
          const caller = named(sites, "hostCaller");
          out.push("hostCaller=" + (caller && caller.getFunction() === hostCaller ? "self" : show(caller && caller.getFunction())));
        });
      }
      hostCaller();

      // A program frame's callee is a JSCallee, not a function at all. Stock bun
      // handed the JSCallee object itself to getFunction().
      out.push("evalProgram=" + show(eval("new Error().stack")[0].getFunction()));

      // A wasm frame has no JSFunction callee either, and merely reading
      // getFunction() on one crashed stock bun.
      const wasmBytes = new Uint8Array([0,0x61,0x73,0x6d,1,0,0,0, 1,4,1,0x60,0,0, 2,7,1,1,0x65,1,0x66,0,0, 3,2,1,0, 7,7,1,3,0x72,0x75,0x6e,0,1, 10,6,1,4,0,0x10,0,0x0b]);
      function wasmCaller() {
        const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {
          e: {
            f() {
              const sites = new Error().stack;
              const wasmFrames = sites.filter(s => s.getFileName() === "[wasm code]");
              out.push("wasmFrames=" + (wasmFrames.length > 0));
              out.push("wasm=" + [...new Set(wasmFrames.map(s => show(s.getFunction())))].join(","));
              const caller = named(sites, "wasmCaller");
              out.push("wasmCaller=" + (caller && caller.getFunction() === wasmCaller ? "self" : show(caller && caller.getFunction())));
            },
          },
        });
        instance.exports.run();
      }
      wasmCaller();

      function asyncPrefixCaller() {
        // Read the stack before the first await: JSC runs even the synchronous
        // prefix of an async function in the body function.
        return (async function af() {
          const sites = new Error().stack;
          out.push("asyncPrefix=" + show(sites[0].getFunction()));
          out.push("asyncPrefixIsToplevel=" + sites[0].isToplevel());
          const caller = named(sites, "asyncPrefixCaller");
          out.push("asyncPrefixCaller=" + (caller && caller.getFunction() === asyncPrefixCaller ? "self" : show(caller && caller.getFunction())));
          await 1;

          const asyncBodySite = new Error().stack[0];
          const asyncBody = asyncBodySite.getFunction();
          out.push("asyncBody=" + show(asyncBody));
          out.push("asyncBodyIsToplevel=" + asyncBodySite.isToplevel());
          if (typeof asyncBody === "function") asyncBody();

          function* gen() {
            yield 1;
            const generatorBodySite = new Error().stack[0];
            const generatorBody = generatorBodySite.getFunction();
            out.push("generatorBody=" + show(generatorBody));
            out.push("generatorBodyIsToplevel=" + generatorBodySite.isToplevel());
            if (typeof generatorBody === "function") generatorBody();
          }
          const it = gen();
          it.next();
          it.next();

          console.log(out.join("\\n"));
        })();
      }
      asyncPrefixCaller();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "internal-callee-fixture.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim().split("\n")).toEqual([
    "sloppy=self",
    "nativeIsNative=true",
    "native=undefined",
    "hostFound=true",
    "host=undefined",
    "hostIsToplevel=false",
    "hostCaller=self",
    "evalProgram=undefined",
    "wasmFrames=true",
    "wasm=undefined",
    "wasmCaller=self",
    "asyncPrefix=undefined",
    "asyncPrefixIsToplevel=false",
    "asyncPrefixCaller=self",
    "asyncBody=undefined",
    "asyncBodyIsToplevel=false",
    "generatorBody=undefined",
    "generatorBodyIsToplevel=false",
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// Bun installs native promise reactions so that a pending user promise can
// resume native work. Each reaction reads its trailing argument as a native
// context, so each of the three below crashed the process when user code got
// hold of it and called it. Every fixture keeps the nameless native function
// that getFunction() reports and then calls it.
const grabNativeReaction = `
  let leaked;
  let namelessNativeSites = 0;
  function grabNativeReaction() {
    const previous = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, sites) => sites;
    for (const site of new Error().stack) {
      if (site.isNative() && !site.getFunctionName()) namelessNativeSites++;
      let fn;
      try {
        fn = site.getFunction();
      } catch {}
      if (typeof fn === "function" && site.isNative() && !fn.name) leaked = fn;
    }
    Error.prepareStackTrace = previous;
  }
  function reportAndCallLeaked() {
    // The reaction frame has to be on the stack, or "leaked=undefined" would
    // hold for a reason that has nothing to do with getFunction().
    console.log("reactionFrameSeen=" + (namelessNativeSites > 0));
    console.log("leaked=" + typeof leaked);
    if (typeof leaked === "function") leaked({}, undefined);
    console.log("survived");
  }
`;

async function runNativeReactionFixture(prefix, files) {
  using dir = tempDir(prefix, files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim().split("\n")).toEqual(["reactionFrameSeen=true", "leaked=undefined", "survived"]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}

test.concurrent("CallFrame.p.getFunction does not expose the HTMLRewriter reaction", async () => {
  await runNativeReactionFixture("callsite-rewriter-reaction", {
    "fixture.cjs": `
      ${grabNativeReaction}

      new HTMLRewriter()
        .on("p", {
          element() {
            grabNativeReaction();
            // The rewriter suspends only while this promise is pending. The
            // suspension installs the reaction whose frame the handler for the
            // second <p> can see.
            return new Promise(resolve => setTimeout(resolve, 1));
          },
        })
        .transform(new Response("<p>a</p><p>b</p>"))
        .text()
        .then(reportAndCallLeaked);
    `,
  });
});

test.concurrent("CallFrame.p.getFunction does not expose the serve reject reaction", async () => {
  await runNativeReactionFixture("callsite-serve-reaction", {
    "fixture.cjs": `
      ${grabNativeReaction}

      // error() runs under the reaction that rejected the fetch() promise.
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => new Promise((resolve, reject) => setTimeout(() => reject(new Error("x")), 1)),
        error() {
          grabNativeReaction();
          return new Response("e");
        },
      });

      fetch(server.url)
        .then(response => response.text())
        .then(async () => {
          await server.stop(true);
          reportAndCallLeaked();
        });
    `,
  });
});

test.concurrent("CallFrame.p.getFunction does not expose the module loader reaction", async () => {
  await runNativeReactionFixture("callsite-module-loader-reaction", {
    "mod.xyzzy": "",
    "fixture.cjs": `
      ${grabNativeReaction}

      // The reaction reads the plugin result object, so this getter runs under
      // its frame.
      Bun.plugin({
        name: "x",
        setup(build) {
          build.onLoad({ filter: /\\.xyzzy$/ }, () =>
            new Promise(resolve =>
              setTimeout(
                () =>
                  resolve({
                    get contents() {
                      grabNativeReaction();
                      return "export default 1";
                    },
                    loader: "js",
                  }),
                1,
              ),
            ),
          );
        },
      });

      import(require("path").join(__dirname, "mod.xyzzy")).then(reportAndCallLeaked);
    `,
  });
});

test("return non-strings from Error.prepareStackTrace", () => {
  // This behavior is allowed by V8 and used by the node-depd npm package.
  let prevPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (e, s) => s;
  const e = new Error();
  Error.captureStackTrace(e);
  expect(Array.isArray(e.stack)).toBe(true);
  Error.prepareStackTrace = prevPrepareStackTrace;
});

test("CallFrame.p.toString", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (e, s) => s;
  const e = new Error();
  Error.captureStackTrace(e);
  expect(e.stack[0].toString().includes("<anonymous>")).toBe(true);
});

// TODO: line numbers are wrong in a release build
test("err.stack should invoke prepareStackTrace", () => {
  var lineNumber = -1;
  var functionName = "";
  var parentLineNumber = -1;
  var referenceStack = "";
  // Line numbers of the first two frames of a default-formatted stack string.
  function defaultStackLineNumbers(stack) {
    return String(stack)
      .split("\n")
      .map(line => /:(\d+):\d+\)?\s*$/.exec(line))
      .filter(Boolean)
      .slice(0, 2)
      .map(match => Number(match[1]));
  }
  function functionWithAName() {
    // This is V8's behavior.
    let prevPrepareStackTrace = Error.prepareStackTrace;

    Error.prepareStackTrace = (e, s) => {
      lineNumber = s[0].getLineNumber();
      functionName = s[0].getFunctionName();
      parentLineNumber = s[1].getLineNumber();
      expect(s[0].getFileName().includes("capture-stack-trace.test.js")).toBe(true);
      expect(s[1].getFileName().includes("capture-stack-trace.test.js")).toBe(true);
    };
    // `reference` shares `e`'s line so the default formatter (consulted after the
    // hook is removed) must report the same call-site lines prepareStackTrace saw.
    const [reference, e] = [new Error(), new Error()];
    e.stack;
    Error.prepareStackTrace = prevPrepareStackTrace;
    referenceStack = reference.stack;
  }

  functionWithAName();

  const [expectedLineNumber, expectedParentLineNumber] = defaultStackLineNumbers(referenceStack);
  expect(referenceStack).toContain("at functionWithAName");
  expect(expectedLineNumber).toBeGreaterThan(0);
  expect(expectedParentLineNumber).toBeGreaterThan(expectedLineNumber);
  expect(functionName).toBe("functionWithAName");
  expect(lineNumber).toBe(expectedLineNumber);
  expect(parentLineNumber).toBe(expectedParentLineNumber);
});

test("Error.prepareStackTrace inside a node:vm works", () => {
  const { runInNewContext } = require("node:vm");
  Error.prepareStackTrace = null;
  const result = runInNewContext(
    `
    Error.prepareStackTrace = (err, stack) => {
      if (typeof err.stack !== "string") {
        throw new Error("err.stack is not a string");
      }

      return "custom stack trace";
    };

    const err = new Error();
    err.stack;
    `,
  );
  expect(result).toBe("custom stack trace");
  expect(Error.prepareStackTrace).toBeNull();
});

test("Error.captureStackTrace inside error constructor works", () => {
  class ExtendedError extends Error {
    constructor() {
      super();
      Error.captureStackTrace(this, ExtendedError);
    }
  }

  class AnotherError extends ExtendedError {}

  expect(() => {
    throw new AnotherError();
  }).toThrow();
});

import { bunRun } from "harness";
import { join } from "path";

test("Error.prepareStackTrace has a default implementation which behaves the same as being unset", async () => {
  expect(await bunRun(join(import.meta.dirname, "error-prepare-stack-default-fixture.js"))).toSpawn();
});

test("Error.prepareStackTrace returns a CallSite object", () => {
  Error.prepareStackTrace = function (err, stack) {
    return stack;
  };
  const error = new Error();
  expect(error.stack[0]).not.toBeString();
  expect(error.stack[0][Symbol.toStringTag]).toBe("CallSite");
});

test("Error.captureStackTrace updates the stack property each call, even if Error.prepareStackTrace is set", () => {
  const prevPrepareStackTrace = Error.prepareStackTrace;
  var didCallPrepareStackTrace = false;

  let error = new Error();
  const firstStack = error.stack;
  Error.prepareStackTrace = function (err, stack) {
    expect(err.stack).not.toBe(firstStack);
    didCallPrepareStackTrace = true;
    return stack;
  };
  function outer() {
    inner();
  }
  function inner() {
    Error.captureStackTrace(error);
  }
  outer();
  const secondStack = error.stack;
  expect(firstStack).not.toBe(secondStack);
  expect(firstStack).toBeString();
  expect(firstStack).not.toContain("outer");
  expect(firstStack).not.toContain("inner");
  expect(didCallPrepareStackTrace).toBe(true);
  expect(secondStack.find(a => a.getFunctionName() === "outer")).toBeTruthy();
  expect(secondStack.find(a => a.getFunctionName() === "inner")).toBeTruthy();
  Error.prepareStackTrace = prevPrepareStackTrace;
});

test("Error.captureStackTrace updates the stack property each call", () => {
  let error = new Error();
  const firstStack = error.stack;
  function outer() {
    inner();
  }
  function inner() {
    Error.captureStackTrace(error);
  }
  outer();
  const secondStack = error.stack;
  expect(firstStack).not.toBe(secondStack);
  expect(firstStack.length).toBeLessThan(secondStack.length);
  expect(firstStack).not.toContain("outer");
  expect(firstStack).not.toContain("inner");
  expect(secondStack).toContain("outer");
  expect(secondStack).toContain("inner");
});

test("calling .stack later uses the stored StackTrace", function hey() {
  let error = new Error();
  let stack;
  function outer() {
    inner();
  }
  function inner() {
    stack = error.stack;
  }
  outer();

  expect(stack).not.toContain("outer");
  expect(stack).not.toContain("inner");
  expect(stack).toContain("hey");
});

test("calling .stack on a non-materialized Error updates the stack properly", function hey() {
  let error = new Error();
  let stack;
  function outer() {
    inner();
  }
  function inner() {
    stack = error.stack;
  }
  function wrapped() {
    Error.captureStackTrace(error);
  }
  wrapped();
  outer();

  expect(stack).not.toContain("outer");
  expect(stack).not.toContain("inner");
  expect(stack).toContain("hey");
  expect(stack).toContain("wrapped");
});

test("Error.prepareStackTrace on an array with non-CallSite objects doesn't crash", () => {
  const result = Error.prepareStackTrace(new Error("ok"), [{ a: 1 }, { b: 2 }, { c: 3 }]);
  expect(result).toBe("Error: ok\n    at [object Object]\n    at [object Object]\n    at [object Object]");
});

test("Error.prepareStackTrace calls toString()", () => {
  const result = Error.prepareStackTrace(new Error("ok"), [
    { a: 1 },
    { b: 2 },
    {
      c: 3,
      toString() {
        return "potato";
      },
    },
  ]);
  expect(result).toBe("Error: ok\n    at [object Object]\n    at [object Object]\n    at potato");
});

test("Error.prepareStackTrace propagates exceptions", () => {
  expect(() =>
    Error.prepareStackTrace(new Error("ok"), [
      { a: 1 },
      { b: 2 },
      {
        c: 3,
        toString() {
          throw new Error("hi");
        },
      },
    ]),
  ).toThrow("hi");
});

// The header of the default formatter is Error.prototype.toString() of the error, as in V8: code that
// wraps the default (source-map-support, depd) calls it by hand, and error.stack inside a
// prepareStackTrace callback is what it returns.
test("the default Error.prepareStackTrace heads the stack with the error's name and message", () => {
  class Custom extends Error {}
  class Named extends Error {}
  Named.prototype.name = "Named";
  const shapes = {
    "TypeError: boom": () => new TypeError("boom"),
    "RangeError": () => new RangeError(),
    "Renamed: boom": () => Object.assign(new Error("boom"), { name: "Renamed" }),
    "boom": () => Object.assign(new Error("boom"), { name: "" }),
    "": () => Object.assign(new Error(""), { name: "" }),
    "Error: boom": () => new Custom("boom"),
    "Named: boom": () => new Named("boom"),
    "FromGetter: boom": () => Object.defineProperty(new Error("boom"), "name", { get: () => "FromGetter" }),
    "Error: undefined name": () => Object.assign(new Error("undefined name"), { name: undefined }),
    "7: boom": () => Object.assign(new Error("boom"), { name: 7 }),
    "Error: 42.5": () => Object.assign(new Error(), { message: 42.5 }),
    "Error": () => Object.assign(new Error("x"), { message: undefined }),
  };
  const byHand = {};
  const insideACallback = {};
  for (const [header, make] of Object.entries(shapes)) {
    Error.prepareStackTrace = (error, callSites) => origPrepareStackTrace(error, callSites);
    byHand[header] = make().stack.split("\n")[0];
    let seen;
    Error.prepareStackTrace = error => ((seen = error.stack), "");
    void make().stack;
    insideACallback[header] = seen.split("\n")[0];
  }
  const expected = Object.fromEntries(Object.keys(shapes).map(header => [header, header]));
  expect({ byHand, insideACallback }).toEqual({ byHand: expected, insideACallback: expected });
});

// As V8: a caller of the default formatter gets the throw, and the error.stack a prepareStackTrace
// callback sees describes it, so reading .stack does not throw because a callback is installed.
// A message that throws is read lazily here (V8 captured it at construction) and still throws.
test("a name that throws: the default Error.prepareStackTrace throws, error.stack inside a callback says so", () => {
  const shapes = {
    "name getter throws": () =>
      Object.defineProperty(new Error("boom"), "name", {
        get() {
          throw new RangeError("from name");
        },
      }),
    "name is a Symbol": () => Object.assign(new Error("boom"), { name: Symbol("s") }),
    "name.toString throws": () =>
      Object.assign(new Error("boom"), {
        name: {
          toString() {
            throw new RangeError("from toString");
          },
        },
      }),
    "message getter throws": () =>
      Object.defineProperty(new Error("boom"), "message", {
        get() {
          throw new RangeError("from message");
        },
      }),
    // What was thrown is described with Error.prototype.toString(), which does not call its toString().
    "name getter throws an object": () =>
      Object.defineProperty(new Error("boom"), "name", {
        get() {
          throw {
            message: "thrown object",
            toString() {
              throw 1;
            },
          };
        },
      }),
    "name getter throws a string": () =>
      Object.defineProperty(new Error("boom"), "name", {
        get() {
          throw "thrown string";
        },
      }),
    "describing the throw throws": () =>
      Object.defineProperty(new Error("boom"), "name", {
        get() {
          throw {
            get name() {
              throw 1;
            },
          };
        },
      }),
  };
  const byHand = {};
  const insideACallback = {};
  for (const [shape, make] of Object.entries(shapes)) {
    Error.prepareStackTrace = (error, callSites) => origPrepareStackTrace(error, callSites);
    try {
      void make().stack;
      byHand[shape] = "did not throw";
    } catch (thrown) {
      byHand[shape] = String(thrown?.message ?? typeof thrown);
    }
    let seen;
    Error.prepareStackTrace = error => ((seen = error.stack), "");
    try {
      void make().stack;
      insideACallback[shape] = seen.split("\n")[0];
      expect(seen.split("\n")[1]).toStartWith("    at ");
    } catch (thrown) {
      insideACallback[shape] = "threw " + thrown.message;
    }
  }
  expect({ byHand, insideACallback }).toEqual({
    byHand: {
      "name getter throws": "from name",
      "name is a Symbol": "Cannot convert a symbol to a string",
      "name.toString throws": "from toString",
      "message getter throws": "from message",
      "name getter throws an object": "thrown object",
      "name getter throws a string": "string",
      "describing the throw throws": "object",
    },
    insideACallback: {
      "name getter throws": "<error: RangeError: from name>",
      "name is a Symbol": "<error: TypeError: Cannot convert a symbol to a string>",
      "name.toString throws": "<error: RangeError: from toString>",
      "message getter throws": "threw from message",
      "name getter throws an object": "<error: Error: thrown object>",
      "name getter throws a string": "<error>",
      "describing the throw throws": "<error>",
    },
  });
});

test("CallFrame.p.getScriptNameOrSourceURL inside eval", () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;
  const prepare = mock((e, s) => {
    expect(s[0].getScriptNameOrSourceURL()).toBe("https://zombo.com/welcome-to-zombo.js");
    expect(s[1].getScriptNameOrSourceURL()).toBe("https://zombo.com/welcome-to-zombo.js");
    expect(s[2].getScriptNameOrSourceURL()).toBe("[native code]");
    expect(s[3].getScriptNameOrSourceURL()).toBe(import.meta.path);
    expect(s[4].getScriptNameOrSourceURL()).toBe(import.meta.path);
  });
  Error.prepareStackTrace = prepare;
  let evalScript = `(function() {
    throw new Error("bad error!");
  })() //# sourceURL=https://zombo.com/welcome-to-zombo.js`;

  try {
    function insideAFunction() {
      eval(evalScript);
    }
    insideAFunction();
  } catch (e) {
    e.stack;
  }
  Error.prepareStackTrace = prevPrepareStackTrace;

  expect(prepare).toHaveBeenCalledTimes(1);
});

test("CallFrame.p.isAsync", async () => {
  let prevPrepareStackTrace = Error.prepareStackTrace;
  const prepare = mock((e, s) => {
    expect(s[0].isAsync()).toBeFalse();
    expect(s[1].isAsync()).toBeTrue();
    expect(s[2].isAsync()).toBeTrue();
    expect(s[3].isAsync()).toBeTrue();
  });
  Error.prepareStackTrace = prepare;
  async function foo() {
    await bar();
  }
  async function bar() {
    await baz();
  }
  async function baz() {
    await 1;
    throw new Error("error from baz");
  }

  try {
    await foo();
  } catch (e) {
    e.stack;
  }
  Error.prepareStackTrace = prevPrepareStackTrace;

  expect(prepare).toHaveBeenCalledTimes(1);
});

test("captureStackTrace with constructor function not in stack returns error string", () => {
  // When the second argument to captureStackTrace is a function that isn't in
  // the call stack, all frames are filtered out and .stack should still return
  // the error name and message (matching Node.js behavior).
  function notInStack() {}

  // Case 1: stack not accessed before captureStackTrace
  {
    const e = new Error("test");
    Error.captureStackTrace(e, notInStack);
    expect(e.stack).toBe("Error: test");
  }

  // Case 2: stack accessed before captureStackTrace
  {
    const e = new Error("test");
    void e.stack;
    Error.captureStackTrace(e, notInStack);
    expect(e.stack).toBe("Error: test");
  }

  // Case 3: empty message
  {
    const e = new Error();
    Error.captureStackTrace(e, notInStack);
    expect(e.stack).toBe("Error");
  }

  // Case 4: custom error name
  {
    const e = new TypeError("bad type");
    Error.captureStackTrace(e, notInStack);
    expect(e.stack).toBe("TypeError: bad type");
  }
});

test("Error.captureStackTrace includes async frames from the await chain", async () => {
  async function innerAsync() {
    await new Promise(r => setImmediate(r));
    const err = new Error("async test");
    Error.captureStackTrace(err);
    return err;
  }
  noInline(innerAsync);

  async function outerAsync() {
    return await innerAsync();
  }
  noInline(outerAsync);

  const err = await outerAsync();
  expect(err.stack).toContain("at innerAsync");
  expect(err.stack).toContain("at async outerAsync");
});

test("Error.captureStackTrace with caller argument preserves async frames", async () => {
  async function innerAsync() {
    await new Promise(r => setImmediate(r));
    const err = new Error("async test");
    Error.captureStackTrace(err, innerAsync);
    return err;
  }
  noInline(innerAsync);

  async function middleAsync() {
    return await innerAsync();
  }
  noInline(middleAsync);

  async function outerAsync() {
    return await middleAsync();
  }
  noInline(outerAsync);

  const err = await outerAsync();
  // innerAsync should be filtered out, but async parents should remain
  expect(err.stack).not.toContain("at innerAsync");
  expect(err.stack).toContain("at async middleAsync");
  expect(err.stack).toContain("at async outerAsync");
});

test("Error.captureStackTrace with caller not in stack clears async frames too", async () => {
  function notInStack() {}

  async function innerAsync() {
    await new Promise(r => setImmediate(r));
    const err = new Error("async test");
    Error.captureStackTrace(err, notInStack);
    return err;
  }
  noInline(innerAsync);

  async function outerAsync() {
    return await innerAsync();
  }
  noInline(outerAsync);

  const err = await outerAsync();
  // When caller is not found, V8 clears everything
  expect(err.stack).toBe("Error: async test");
});

test("Error.captureStackTrace applies stackTraceLimit after caller removal", () => {
  // Build a deep call chain so the caller sits beyond stackTraceLimit.
  // If the limit were applied before removal, all collected frames would
  // be above the caller and get removed, yielding an empty trace.
  const origLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 3;
  try {
    function target() {
      const err = {};
      Error.captureStackTrace(err, target);
      return err;
    }
    noInline(target);

    function recurse(depth) {
      if (depth === 0) return target();
      // Not a tail call — keeps each frame on the stack.
      return recurse(depth - 1) || null;
    }
    noInline(recurse);

    const err = recurse(20);
    const frames = err.stack.split("\n").filter(l => l.includes("    at "));
    // Should have exactly 3 frames (the limit), all below target()
    expect(frames.length).toBe(3);
    expect(err.stack).not.toContain("at target");
    expect(err.stack).toContain("at recurse");
  } finally {
    Error.stackTraceLimit = origLimit;
  }
});

test("captureStackTrace does not crash when stackTraceLimit is non-numeric", () => {
  const origLimit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = "foo";
    const obj = {};
    expect(() => Error.captureStackTrace(obj)).not.toThrow();
    expect(typeof obj.stack).toBe("string");

    delete Error.stackTraceLimit;
    const obj2 = {};
    expect(() => Error.captureStackTrace(obj2)).not.toThrow();
    expect(typeof obj2.stack).toBe("string");
  } finally {
    Error.stackTraceLimit = origLimit;
  }
});

test.concurrent.each([
  ["NaN", `Error.stackTraceLimit = NaN;`],
  ["a string", `Error.stackTraceLimit = "foo";`],
  ["an accessor", `Object.defineProperty(Error, "stackTraceLimit", { get: () => 10 });`],
  ["deleted", `delete Error.stackTraceLimit;`],
])("Error.appendStackTrace does not crash when stackTraceLimit is %s", async (_, setup) => {
  // An error made under such a limit has no frames, so appendStackTrace captures them first.
  const src = `${setup}
    const source = new Error("source"), destination = new Error("destination");
    Error.appendStackTrace(source, destination);
    console.log(typeof destination.stack);`;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), signalCode: proc.signalCode }).toEqual({ stdout: "undefined", signalCode: null });
  expect(exitCode).toBe(0);
});

test("Error.stackTraceLimit default matches the limit captureStackTrace applies", async () => {
  // Run in a fresh process so nothing has written to Error.stackTraceLimit yet.
  const src = `
    function depth(n) {
      if (n) return 0 + depth(n - 1);
      const e = {};
      Error.captureStackTrace(e);
      return e.stack.split("\\n").length - 1;
    }
    const reported = Error.stackTraceLimit;
    const before = depth(30);
    Error.stackTraceLimit = Error.stackTraceLimit;
    const after = depth(30);
    process.stdout.write(JSON.stringify({ reported, before, after }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { reported, before, after } = JSON.parse(stdout);
  // Node.js defaults to 10 and the reported value must match the applied limit.
  expect({ reported, before, after, exitCode }).toEqual({ reported: 10, before: 10, after: 10, exitCode: 0 });
});

test("call sites inside a WebSocket message listener only contain script frames when the message arrives with the upgrade response", async () => {
  // Runs in its own process: which dispatch path delivers the message (and therefore
  // which frames are on the stack under the listener) depends on prior event-loop state.
  const src = [
    `const { createHash } = require("node:crypto");`,
    `const buffers = new Map();`,
    `const server = Bun.listen({`,
    `  hostname: "127.0.0.1",`,
    `  port: 0,`,
    `  socket: {`,
    `    data(socket, chunk) {`,
    `      const previous = buffers.get(socket) ?? Buffer.alloc(0);`,
    `      const request = Buffer.concat([previous, chunk]);`,
    `      buffers.set(socket, request);`,
    `      const text = request.toString("latin1");`,
    `      if (!text.includes("\\r\\n\\r\\n")) return;`,
    `      const key = /^Sec-WebSocket-Key:\\s*(.+?)\\r\\n/im.exec(text)?.[1];`,
    `      if (!key) { console.error("missing Sec-WebSocket-Key header"); process.exit(1); }`,
    `      const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");`,
    `      const response = "HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n";`,
    `      socket.write(Buffer.concat([Buffer.from(response, "latin1"), Buffer.from([0x81, 0x02, 0x68, 0x69])]));`,
    `    },`,
    `    error() { process.exit(1); },`,
    `  },`,
    `});`,
    `const ws = new WebSocket("ws://127.0.0.1:" + server.port);`,
    `ws.addEventListener("close", event => { console.error("closed " + event.code); process.exit(1); });`,
    `ws.addEventListener("message", event => {`,
    `  const previousPrepareStackTrace = Error.prepareStackTrace;`,
    `  let callSites;`,
    `  try {`,
    `    Error.prepareStackTrace = (_error, stack) => stack;`,
    `    const error = new Error();`,
    `    Error.captureStackTrace(error);`,
    `    callSites = error.stack;`,
    `  } finally {`,
    `    Error.prepareStackTrace = previousPrepareStackTrace;`,
    `  }`,
    `  console.log(event.data, callSites.filter(callSite => callSite.isNative()).length);`,
    `  process.exit(0);`,
    `});`,
  ].join("\n");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("hi 0");
  expect(exitCode).toBe(0);
});

test("printing an error whose message getter calls Error.captureStackTrace on itself prints normally", async () => {
  const fixture = [
    `const vm = require("node:vm");`,
    `let src = "function f0() {\\n";`,
    `src += "  const e = new Error('first');\\n";`,
    `src += "  Object.defineProperty(e, 'message', { get() { Error.captureStackTrace(e); return 'second'; } });\\n";`,
    `src += "  return e;\\n";`,
    `src += "}\\n";`,
    `for (let i = 1; i < 12; i++) src += "function f" + i + "() { return f" + (i - 1) + "(); }\\n";`,
    `src += "f11();\\n";`,
    `const err = vm.runInThisContext(src, { filename: "frame-index-fixture.js" });`,
    `console.log(err);`,
    `console.log("after");`,
  ].join("\n");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ lastLine: stdout.trimEnd().split("\n").pop(), exitCode }).toEqual({ lastLine: "after", exitCode: 0 });
});

// https://github.com/oven-sh/bun/issues/34095
test("lazy error-info materialization does not store an empty stack value when the compute hook throws", async () => {
  const src = `
    Error.prepareStackTrace = (e, s) => "custom-stack";
    const e = new Error("x");
    Object.defineProperty(e, "message", { get() { throw new TypeError("msg-boom"); } });
    let first = "no-throw";
    try { void e.stack; } catch (err) { first = err.message; }
    console.log(JSON.stringify({ first, secondType: typeof e.stack }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify({ first: "msg-boom", secondType: "undefined" }),
    signalCode: null,
  });
  expect(exitCode).toBe(0);
});

// An error holds the functions of its trace weakly. A collection that finds one of them dead in an unread
// trace detaches the trace: it keeps what the frames say and lets the functions go
// (ErrorInstance::reconcileWeakReferencesAtGCEnd). `.stack` is made from that when it is first needed, and
// must then read as it does when it is read while the frames are alive.
//
// Whether the collection detaches a given trace is not up to the test, so each shape makes several
// errors, each under its own functions that are garbage once they return, and each with a twin: a plain
// Error made under the same functions, so a collection that detaches the twin's trace (its frames are
// among the error's) detaches the error's too. The function that makes the twin is not strict, so its
// call site shows it while the frame is alive, and shows no function once the trace is detached: what
// a collection keeps of a trace has no function. The errors whose twin says that are the ones compared,
// and there must be one.
const detachedByACollection = `
  const SAMPLES = 8;
  const twins = new WeakMap();
  // The finally blocks keep every return out of tail position.
  const underDeadFunctions = 'function twin() { try { return new Error("twin"); } finally {} } function thrower() { "use strict"; try { return [make(), twin()]; } finally {} } try { return thrower(); } finally {}';
  const capture = make => {
    const [error, twin] = new Function("make", underDeadFunctions)(make);
    twins.set(error, twin);
    return error;
  };
  // One error that is read while its frames are alive and SAMPLES more from one call site, so every trace reads the same to the column.
  const captureAll = make => Array.from({ length: 1 + SAMPLES }, () => capture(make));
  const collect = async () => {
    await new Promise(resolve => setImmediate(resolve));
    Bun.gc(true);
  };
  const detached = error => {
    const builtin = Error.prepareStackTrace;
    Error.prepareStackTrace = (twin, callSites) => typeof callSites[0].getFunction();
    const functionOfTheTwin = twins.get(error).stack;
    Error.prepareStackTrace = builtin;
    return functionOfTheTwin !== "function";
  };
  // read(error) for each sample whose trace the collection detached.
  const readDetached = (samples, read) => samples.filter(detached).map(read);
`;

test.concurrent("the stack of a trace that a collection detached reads as the stack of live frames does", async () => {
  const src = `
    import vm from "node:vm";
    ${detachedByACollection}
    const shapes = {
      // How the name and the message are joined.
      "TypeError with a message": () => new TypeError("boom"),
      "no message": () => new Error(),
      "empty own name": () => Object.assign(new Error("boom"), { name: "" }),
      // They are read when the stack is first read, whichever way the frames were formatted.
      "message is a Symbol": () => Object.assign(new Error(), { message: Symbol("m") }),
      "message changed before the first read": () => new Error("boom"),
      "name is a Symbol": () => Object.assign(new Error("boom"), { name: Symbol("n") }),
      "name changed before the first read": () => new Error("boom"),
      "AggregateError": () => new AggregateError([new Error("inner")], "boom"),
      "SyntaxError": () => new SyntaxError("boom"),
      "with a cause": () => new RangeError("boom", { cause: new Error("why") }),
      "from a node:vm context": () => vm.runInNewContext("new TypeError('boom')"),
      // Frames whose text says more than a function name and a position.
      "created in a constructor": () => new (class Widget { constructor() { this.error = new Error("boom"); } })().error,
      "created by eval code": () => (0, eval)("new Error('boom')"),
      "created under a builtin": () => [0].map(() => { try { return new Error("boom"); } finally {} })[0],
      // How a frame's function is named.
      "created in a function whose name was redefined": () => {
        function original() { try { return new Error("boom"); } finally {} }
        Object.defineProperty(original, "name", { value: "renamed" });
        try { return original(); } finally {}
      },
      "created in a nameless function with a displayName": () => {
        const nameless = (() => function () { try { return new Error("boom"); } finally {} })();
        nameless.displayName = "Shown";
        try { return nameless(); } finally {}
      },
      "created in a function whose name is a getter": () => {
        function original() { try { return new Error("boom"); } finally {} }
        Object.defineProperty(original, "name", { get: () => "fromGetter" });
        try { return original(); } finally {}
      },
      "created in a bound function": () => {
        function target() { try { return new Error("boom"); } finally {} }
        const bound = target.bind(null);
        try { return bound(); } finally {}
      },
      "created in a method": () => {
        const holder = { method() { try { return new Error("boom"); } finally {} } };
        try { return holder.method(); } finally {}
      },
      "created in a static method": () => {
        class Factory { static make() { try { return new Error("boom"); } finally {} } }
        try { return Factory.make(); } finally {}
      },
      "created in an arrow function": () => {
        const arrow = () => { try { return new Error("boom"); } finally {} };
        try { return arrow(); } finally {}
      },
    };
    // The frames, from the top, whose text the test spells out.
    const framesToShow = {
      "created in a constructor": 1,
      "created by eval code": 1,
      "created under a builtin": 2,
      "created in a function whose name was redefined": 1,
      "created in a nameless function with a displayName": 1,
      "created in a function whose name is a getter": 1,
      "created in a bound function": 1,
      "created in a method": 1,
      "created in a static method": 1,
      "created in an arrow function": 1,
    };
    const beforeTheFirstRead = {
      "message changed before the first read": error => void (error.message = "changed"),
      "name changed before the first read": error => void (error.name = "Renamed"),
    };
    const read = shape => error => {
      beforeTheFirstRead[shape]?.(error);
      try {
        return error.stack;
      } catch (thrown) {
        return "throws " + thrown.message;
      }
    };
    const cases = Object.entries(shapes).map(([shape, make]) => {
      const [onAccess, ...samples] = captureAll(make);
      return { shape, expected: read(shape)(onAccess), samples };
    });
    await collect();
    const rows = {};
    for (const { shape, expected, samples } of cases) {
      const texts = readDetached(samples, read(shape));
      const lines = (texts[0] ?? "").split("\\n");
      const frames = lines.slice(1, 1 + (framesToShow[shape] ?? 0)).map(line => line.trim().replace(/ ?\\(.*$/, ""));
      rows[shape] = { detachedByACollection: texts.length > 0, header: lines[0], frames, sameText: texts.every(text => text === expected) };
    }
    console.log(JSON.stringify(rows));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const row = (header, frames = []) => ({ detachedByACollection: true, header, frames, sameText: true });
  const expectedRows = {
    "TypeError with a message": row("TypeError: boom"),
    "no message": row("Error"),
    "empty own name": row("boom"),
    "message is a Symbol": row("throws Cannot convert a symbol to a string"),
    "message changed before the first read": row("Error: changed"),
    "name is a Symbol": row("throws Cannot convert a symbol to a string"),
    "name changed before the first read": row("Renamed: boom"),
    "AggregateError": row("AggregateError: boom"),
    "SyntaxError": row("SyntaxError: boom"),
    "with a cause": row("RangeError: boom"),
    "from a node:vm context": row("TypeError: boom"),
    "created in a constructor": row("Error: boom", ["at new Widget"]),
    "created by eval code": row("Error: boom", ["at <anonymous>"]),
    "created under a builtin": row("Error: boom", ["at <anonymous>", "at map"]),
    "created in a function whose name was redefined": row("Error: boom", ["at renamed"]),
    "created in a nameless function with a displayName": row("Error: boom", ["at Shown"]),
    "created in a function whose name is a getter": row("Error: boom", ["at original"]),
    "created in a bound function": row("Error: boom", ["at target"]),
    "created in a method": row("Error: boom", ["at method"]),
    "created in a static method": row("Error: boom", ["at make"]),
    "created in an arrow function": row("Error: boom", ["at arrow"]),
  };
  expect(JSON.parse(stdout)).toEqual(expectedRows);
  expect(exitCode).toBe(0);
});

test.concurrent(
  "an error whose trace a collection detached behaves as one whose stack is made from live frames",
  async () => {
    const src = `
    ${detachedByACollection}
    const operations = {
      "line, column, sourceURL": error => [error.line, error.column, typeof error.sourceURL],
      "assign stack": error => ((error.stack = "assigned"), error.stack),
      "delete stack": error => [delete error.stack, error.stack ?? null],
      "define stack": error => (Object.defineProperty(error, "stack", { value: "defined" }), error.stack),
      // A clone is made from the complete string: it must not get a second first line.
      "structuredClone": error => structuredClone(error).stack.split("\\n").filter(line => line.includes("boom")),
      "Bun.inspect": error => Bun.inspect(error).split("\\n").filter(line => line.includes("boom")).map(line => line.trim()),
      "JSON.stringify": error => JSON.stringify(error),
    };
    const rows = {};
    for (const [name, operation] of Object.entries(operations)) {
      const [onAccess, ...samples] = captureAll(() => new TypeError("boom"));
      const expected = JSON.stringify(operation(onAccess));
      await collect();
      const results = readDetached(samples, error => JSON.stringify(operation(error)));
      rows[name] = { detachedByACollection: results.length > 0, same: results.every(result => result === expected), onAccess: JSON.parse(expected) };
    }
    console.log(JSON.stringify(rows));
  `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const row = onAccess => ({ detachedByACollection: true, same: true, onAccess });
    expect(JSON.parse(stdout)).toEqual({
      "line, column, sourceURL": row([expect.any(Number), expect.any(Number), "string"]),
      "assign stack": row("assigned"),
      "delete stack": row([true, null]),
      "define stack": row("defined"),
      "structuredClone": row(["TypeError: boom"]),
      "Bun.inspect": row([expect.stringContaining("TypeError: boom")]),
      "JSON.stringify": row(expect.any(String)),
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent("the stack of a trace that a collection detached reads the same in a Worker", async () => {
  const src = `
    import { Worker, isMainThread, parentPort } from "node:worker_threads";
    ${detachedByACollection}
    if (isMainThread) {
      const worker = new Worker(new URL(import.meta.url));
      const rows = await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      });
      await worker.terminate();
      console.log(JSON.stringify(rows));
    } else {
      const shapes = {
        "TypeError with a message": () => new TypeError("boom"),
        "created in a constructor": () => new (class Widget { constructor() { this.error = new Error("boom"); } })().error,
      };
      const rows = {};
      for (const [shape, make] of Object.entries(shapes)) {
        const [onAccess, ...samples] = captureAll(make);
        const expected = onAccess.stack;
        await collect();
        const texts = readDetached(samples, error => error.stack);
        rows[shape] = { detachedByACollection: texts.length > 0, firstTwoLines: (texts[0] ?? "").split("\\n").slice(0, 2).map(line => line.trim().replace(/ ?\\(.*$/, "")), sameText: texts.every(text => text === expected) };
      }
      parentPort.postMessage(rows);
    }
  `;
  using dir = tempDir("stack-materialized-in-worker", { "main.mjs": src });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    "TypeError with a message": {
      detachedByACollection: true,
      firstTwoLines: ["TypeError: boom", expect.any(String)],
      sameText: true,
    },
    "created in a constructor": {
      detachedByACollection: true,
      firstTwoLines: ["Error: boom", "at new Widget"],
      sameText: true,
    },
  });
  expect(exitCode).toBe(0);
});

// Materializing the stack can throw (a Symbol message). Asking for the property's descriptor must throw
// that, not report the property found with the exception still pending, however the stack is materialized.
test.concurrent(
  "Object.getOwnPropertyDescriptor(error, 'stack') throws what materializing the stack threw",
  async () => {
    const src = `
    ${detachedByACollection}
    const describe = error => {
      try {
        Object.getOwnPropertyDescriptor(error, "stack");
        return ["did not throw", typeof error.stack];
      } catch (thrown) {
        return [thrown.message, typeof error.stack];
      }
    };
    const [onAccess, ...samples] = captureAll(() => Object.assign(new Error(), { message: Symbol("m") }));
    const rows = { onAccess: describe(onAccess) };
    await collect();
    rows.afterACollection = [...new Set(readDetached(samples, describe).map(result => JSON.stringify(result)))];
    console.log(JSON.stringify(rows));
  `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      onAccess: ["Cannot convert a symbol to a string", "undefined"],
      afterACollection: [JSON.stringify(["Cannot convert a symbol to a string", "undefined"])],
    });
    expect(exitCode).toBe(0);
  },
);

// Error.captureStackTrace() replaces the trace. With no frames left after the constructor it names,
// the stack is the header alone, also for an error whose old frames a collection had already detached.
test.concurrent("Error.captureStackTrace replaces a trace that a collection detached", async () => {
  const src = `
    ${detachedByACollection}
    function notOnTheStack() {}
    const errors = captureAll(() => new TypeError("boom"));
    await collect();
    const stacks = new Set();
    for (const error of errors) {
      Error.captureStackTrace(error, notOnTheStack);
      stacks.add(error.stack);
    }
    // With frames left, they are the new ones.
    const recaptured = new Set();
    function recapture(error) {
      Error.captureStackTrace(error);
      const lines = error.stack.split("\\n");
      recaptured.add(JSON.stringify([lines[0], lines[1].trim().replace(/ ?\\(.*$/, ""), lines.some(line => line.includes("thrower"))]));
    }
    const more = captureAll(() => new TypeError("boom"));
    await collect();
    for (const error of more) recapture(error);
    console.log(JSON.stringify({ noFramesLeft: [...stacks], framesLeft: [...recaptured].map(row => JSON.parse(row)) }));
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    noFramesLeft: ["TypeError: boom"],
    framesLeft: [["TypeError: boom", "at recapture", false]],
  });
  expect(exitCode).toBe(0);
});

// An error holds the functions in its trace weakly. These functions are strict, so the call sites do
// not retain them either, and they are garbage by the time `.stack` is first read. The `finally`
// blocks keep each `return` out of tail position, so every frame stays in the trace.
const errorWithDeadFrames = `new Function('"use strict"; function inner() { try { return new Error("x"); } finally {} } try { return inner(); } finally {}')()`;
test.concurrent.each([
  [
    "Bun.gc(true) in Error.prepareStackTrace",
    `const e = ${errorWithDeadFrames};
     Error.prepareStackTrace = (err, callSites) => { Bun.gc(true); return "formatted " + callSites[0].getFunctionName(); };
     console.log(e.stack);`,
    "formatted inner",
  ],
  [
    "v8.getHeapStatistics() in Error.prepareStackTrace, error from an arrow that has returned",
    `import v8 from "node:v8";
     Error.prepareStackTrace = (err, callSites) => { v8.getHeapStatistics(); return "formatted " + callSites[1].getFunctionName(); };
     async function handler() {
       const e = (() => { try { return new Error("request failed"); } finally {} })();
       await 1;
       return e.stack;
     }
     console.log(await handler());`,
    "formatted handler",
  ],
  [
    "Bun.gc(true) in a message getter",
    `const e = ${errorWithDeadFrames};
     Object.defineProperty(e, "message", { get() { Bun.gc(true); return "from getter"; } });
     Error.prepareStackTrace = (err, callSites) => err.stack.split("\\n")[0] + " | " + callSites[0].getFunctionName();
     console.log(e.stack);`,
    "Error: from getter | inner",
  ],
  [
    "Bun.gc(true) in a node:vm Error.prepareStackTrace getter",
    `import vm from "node:vm";
     const context = vm.createContext({ collect: () => Bun.gc(true) });
     const e = vm.runInContext(${JSON.stringify(errorWithDeadFrames)}, context);
     vm.runInContext('Object.defineProperty(Error, "prepareStackTrace", { get() { collect(); } })', context);
     console.log(e.stack.split("\\n")[0] + " | " + /at (\\w+)/.exec(e.stack)[1]);`,
    "Error: x | inner",
  ],
  [
    "Error.appendStackTrace onto the error being formatted, then Bun.gc(true)",
    `const e = ${errorWithDeadFrames};
     const other = ${errorWithDeadFrames};
     Error.prepareStackTrace = (err, callSites) => { Error.appendStackTrace(other, err); Bun.gc(true); return "formatted " + callSites[0].getFunctionName(); };
     console.log(e.stack);
     Error.prepareStackTrace = undefined;
     console.log(/at (\\w+)/.exec(other.stack)[1]);`,
    "formatted inner\ninner",
  ],
  [
    "a node:vm Error.prepareStackTrace getter reads the lazy .stack accessor of the same error",
    `import vm from "node:vm";
     let e, entered = false;
     const context = vm.createContext({ readStack() { if (entered) return; entered = true; return e.stack; } });
     e = vm.runInContext('new Error("x")', context);
     (function capture() { Error.captureStackTrace(e); })();
     vm.runInContext('Object.defineProperty(Error, "prepareStackTrace", { get() { readStack(); } })', context);
     console.log(e.stack.split("\\n")[0] + " | " + /at (\\w+)/.exec(e.stack)?.[1]);`,
    "Error: x | capture",
  ],
])("user JS that runs while .stack is being formatted cannot invalidate the trace: %s", async (_, source, expected) => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), signalCode: proc.signalCode }).toEqual({ stdout: expected, signalCode: null });
  expect(exitCode).toBe(0);
});

test("Error.prepareStackTrace call sites keep their own file when a hidden frame is on the stack", async () => {
  // A bound function call is a frame with private implementation visibility. JSC omits it from the
  // trace unless showPrivateScriptsInStackTraces is on (debug builds turn it on); Bun then has to
  // drop it while building the CallSites, and the frames after it must keep their own file.
  using dir = tempDir("prepare-stack-trace-hidden-frame", {
    "main.cjs": [
      `const { outer, viaAsyncLocalStorage } = require("./callers.cjs");`,
      `function inner() {`,
      `  const error = new Error("boom");`,
      `  return error;`,
      `}`,
      `function main() {`,
      `  const error = outer(inner.bind(null));`,
      `  return error;`,
      `}`,
      `const { basename } = require("node:path");`,
      `const wanted = new Set(["inner", "outer", "main", "run", "viaAsyncLocalStorage"]);`,
      `Error.prepareStackTrace = (_error, callSites) =>`,
      `  callSites`,
      `    .filter(callSite => wanted.has(callSite.getFunctionName()))`,
      `    .map(callSite => ({`,
      `      name: callSite.getFunctionName(),`,
      `      file: basename(callSite.getFileName()),`,
      `      line: callSite.getLineNumber(),`,
      `    }));`,
      `console.log(JSON.stringify({ bound: main().stack, asyncLocalStorage: viaAsyncLocalStorage(inner.bind(null)).stack }));`,
    ].join("\n"),
    "callers.cjs": [
      `const { AsyncLocalStorage } = require("node:async_hooks");`,
      `exports.outer = function outer(callback) {`,
      `  const error = callback();`,
      `  return error;`,
      `};`,
      `const storage = new AsyncLocalStorage();`,
      `exports.viaAsyncLocalStorage = function viaAsyncLocalStorage(callback) {`,
      `  const error = storage.run("store", callback);`,
      `  return error;`,
      `};`,
    ].join("\n"),
  });

  const results = await Promise.all(
    ["0", "1"].map(async showPrivateScriptsInStackTraces => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.cjs"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_JSC_showPrivateScriptsInStackTraces: showPrivateScriptsInStackTraces },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { showPrivateScriptsInStackTraces, callSites: stdout && JSON.parse(stdout), stderr, exitCode };
    }),
  );

  const expected = {
    bound: [
      { name: "inner", file: "main.cjs", line: 3 },
      { name: "outer", file: "callers.cjs", line: 3 },
      { name: "main", file: "main.cjs", line: 7 },
    ],
    asyncLocalStorage: [
      { name: "inner", file: "main.cjs", line: 3 },
      { name: "run", file: "node:async_hooks", line: expect.any(Number) },
      { name: "viaAsyncLocalStorage", file: "callers.cjs", line: 8 },
    ],
  };
  expect(results).toEqual([
    { showPrivateScriptsInStackTraces: "0", callSites: expected, stderr: "", exitCode: 0 },
    { showPrivateScriptsInStackTraces: "1", callSites: expected, stderr: "", exitCode: 0 },
  ]);
});

// Error.prepareStackTrace is looked up when a stack is first needed and called then, also when a collection
// detached the trace before that. Its call sites are made from what the collection kept.
test.concurrent("Error.prepareStackTrace is called for a stack that is first read after a collection", async () => {
  const src = `
    import vm from "node:vm";
    ${detachedByACollection}
    const context = vm.createContext({});
    const shapes = {
      "never thrown": () => new Error("boom"),
      "thrown and caught": () => {
        try { throw new Error("boom"); } catch (error) { return error; }
      },
      "thrown and caught before another caught throw": () => {
        let kept;
        try { throw new Error("boom"); } catch (error) { kept = error; }
        try { throw 1; } catch {}
        return kept;
      },
      "thrown by the engine": () => {
        try { null.x; } catch (error) { return error; }
      },
      "Error.captureStackTrace(error)": () => {
        const error = new Error("boom");
        Error.captureStackTrace(error);
        return error;
      },
      "rejected in a promise executor": () => {
        let kept;
        new Promise((resolve, reject) => reject((kept = new Error("boom")))).catch(() => {});
        return kept;
      },
      "from a node:vm context": () => vm.runInContext("new Error('boom')", context),
    };
    Error.prepareStackTrace = () => "the formatter in place when the errors were made";
    const cases = Object.entries(shapes).map(([shape, make]) => ({ shape, samples: captureAll(make).slice(1) }));
    const withoutFormatter = captureAll(() => new Error("boom")).slice(1);
    const rejectedByAStream = captureAll(() => new Error("boom")).slice(1);
    await collect();

    // The formatter in place when the stack is read is the one that is called.
    let calls = 0;
    context.formatter = Error.prepareStackTrace = (error, callSites) => (calls++, callSites);
    vm.runInContext("Error.prepareStackTrace = formatter", context);
    const rows = {};
    for (const { shape, samples } of cases) {
      const detachedByACollection = samples.some(detached);
      const reads = samples.map(error => {
        calls = 0;
        const first = error.stack;
        const second = error.stack;
        return JSON.stringify({
          calls,
          callSites: Array.isArray(first) && first.length > 0 && first.every(callSite => Object.prototype.toString.call(callSite) === "[object CallSite]"),
          thrower: Array.isArray(first) && first.some(callSite => callSite.getFunctionName() === "thrower"),
          sameOnSecondRead: first === second,
        });
      });
      rows[shape] = { detachedByACollection, reads: [...new Set(reads)].map(read => JSON.parse(read)) };
    }

    Error.prepareStackTrace = undefined;
    calls = 0;
    const read = error => JSON.stringify([error.stack.split("\\n")[0], error.stack.includes("\\n    at thrower (")]);
    const withoutFormatterWasDetached = withoutFormatter.some(detached);
    rows["no formatter in place at the read"] = { detachedByACollection: withoutFormatterWasDetached, calls, stacks: [...new Set(withoutFormatter.map(read))].map(stack => JSON.parse(stack)) };

    // A stream rejects a pending read with the error. An error that has no stack gets the frames of the reader there.
    const rejectedByAStreamWasDetached = rejectedByAStream.some(detached);
    for (const error of rejectedByAStream) {
      let controller;
      const reader = new ReadableStream({ start(streamController) { controller = streamController; } }).getReader();
      const pending = (async () => { try { await reader.read(); } catch (caught) { return caught; } })();
      controller.error(error);
      if ((await pending) !== error) throw new Error("the read was not rejected with the error");
    }
    rows["rejected by a stream before the read"] = { detachedByACollection: rejectedByAStreamWasDetached, stacks: [...new Set(rejectedByAStream.map(read))].map(stack => JSON.parse(stack)) };
    console.log(JSON.stringify(rows));
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const row = {
    detachedByACollection: true,
    reads: [{ calls: 1, callSites: true, thrower: true, sameOnSecondRead: true }],
  };
  expect(JSON.parse(stdout)).toEqual({
    "never thrown": row,
    "thrown and caught": row,
    "thrown and caught before another caught throw": row,
    "thrown by the engine": row,
    "Error.captureStackTrace(error)": row,
    "rejected in a promise executor": row,
    "from a node:vm context": row,
    "no formatter in place at the read": { detachedByACollection: true, calls: 0, stacks: [["Error: boom", true]] },
    "rejected by a stream before the read": { detachedByACollection: true, stacks: [["Error: boom", true]] },
  });
  expect(exitCode).toBe(0);
});

// A call site made from what a collection kept answers as one made from a live frame does. Only getFunction()
// differs: the functions are not kept, so it is undefined, as it is for a strict function.
test.concurrent(
  "the call sites of a trace that a collection detached say what the call sites of live frames say",
  async () => {
    const src = `
    ${detachedByACollection}
    const describe = callSites =>
      JSON.stringify(
        callSites.map(callSite => ({
          getFunctionName: callSite.getFunctionName(),
          getMethodName: callSite.getMethodName(),
          getTypeName: callSite.getTypeName(),
          getThis: String(callSite.getThis()),
          getFileName: callSite.getFileName(),
          getScriptNameOrSourceURL: callSite.getScriptNameOrSourceURL(),
          // Each eval has a source of its own.
          getScriptId: callSite.isEval() ? typeof callSite.getScriptId() : callSite.getScriptId(),
          getLineNumber: callSite.getLineNumber(),
          getColumnNumber: callSite.getColumnNumber(),
          getEvalOrigin: String(callSite.getEvalOrigin()),
          isToplevel: callSite.isToplevel(),
          isEval: callSite.isEval(),
          isNative: callSite.isNative(),
          isConstructor: callSite.isConstructor(),
          isAsync: callSite.isAsync(),
          isPromiseAll: callSite.isPromiseAll(),
          getPromiseIndex: callSite.getPromiseIndex(),
          toString: callSite.toString(),
        })),
      );
    // Of the frames above thrower.
    const functions = callSites => callSites.slice(0, callSites.findIndex(callSite => callSite.getFunctionName() === "thrower")).map(callSite => typeof callSite.getFunction());
    // As capture() and captureAll(), with one source for all the samples: a frame then has the same script id in each.
    const sampler = new Function("return make => { " + underDeadFunctions + " };");
    const sample = make => {
      const [error, twin] = sampler()(make);
      twins.set(error, twin);
      return error;
    };
    const sampleAll = make => Array.from({ length: 1 + SAMPLES }, () => sample(make));
    const sloppy = new Function("return (function sloppy() { try { return new Error('boom'); } finally {} })()");
    const afterAnAwait = new Function('return () => { function twin() { try { return new Error("twin"); } finally {} } async function inner() { "use strict"; await 1; try { return [new Error("boom"), twin()]; } finally {} } async function thrower() { "use strict"; try { return await inner(); } finally {} } return thrower(); };');
    const shapes = {
      "a constructor": () => new (class Widget { constructor() { this.error = new Error("boom"); } })().error,
      "eval code": () => (0, eval)("new Error('boom')"),
      "a builtin": () => [0].map(() => { try { return new Error("boom"); } finally {} })[0],
      "a bound function": () => {
        function target() { try { return new Error("boom"); } finally {} }
        const bound = target.bind(null);
        try { return bound(); } finally {}
      },
      "a method": () => {
        const holder = { method() { try { return new Error("boom"); } finally {} } };
        try { return holder.method(); } finally {}
      },
      "a function with a displayName": () => {
        const nameless = (() => function () { try { return new Error("boom"); } finally {} })();
        nameless.displayName = "Shown";
        try { return nameless(); } finally {}
      },
      "sloppy functions": () => { try { return sloppy(); } finally {} },
    };

    Error.prepareStackTrace = (error, callSites) => callSites;
    const cases = Object.entries(shapes).map(([shape, make]) => ({ shape, errors: sampleAll(make) }));
    cases.push({ shape: "after an await", errors: (await Promise.all(Array.from({ length: 1 + SAMPLES }, () => afterAnAwait()()))).map(([error, twin]) => (twins.set(error, twin), error)) });
    for (const entry of cases) {
      const [alive, ...samples] = entry.errors;
      entry.samples = samples;
      entry.expected = describe(alive.stack);
      entry.functionsOfLiveFrames = functions(alive.stack);
      entry.asyncFrames = alive.stack.filter(callSite => callSite.isAsync()).length;
    }
    await collect();
    const rows = {};
    for (const { shape, samples, expected, functionsOfLiveFrames, asyncFrames } of cases) {
      const results = readDetached(samples, error => JSON.stringify([describe(error.stack) === expected, functions(error.stack)]));
      rows[shape] = {
        detachedByACollection: results.length > 0,
        sameCallSites: results.every(result => JSON.parse(result)[0]),
        functions: { ofLiveFrames: functionsOfLiveFrames, ofADetachedTrace: [...new Set(results.map(result => JSON.stringify(JSON.parse(result)[1])))].map(list => JSON.parse(list)) },
        asyncFrames,
      };
    }
    console.log(JSON.stringify(rows));
  `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // The frames of the module are strict, so they have no function either way.
    const row = (frames, asyncFrames = 0) => ({
      detachedByACollection: true,
      sameCallSites: true,
      functions: { ofLiveFrames: Array(frames).fill("undefined"), ofADetachedTrace: [Array(frames).fill("undefined")] },
      asyncFrames,
    });
    expect(JSON.parse(stdout)).toEqual({
      "a constructor": row(2),
      "eval code": row(2),
      "a builtin": row(3),
      "a bound function": row(2),
      "a method": row(2),
      "a function with a displayName": row(2),
      // The two sloppy functions are still alive. What the collection kept of the trace has no function at all.
      "sloppy functions": {
        ...row(3),
        functions: {
          ofLiveFrames: ["function", "function", "undefined"],
          ofADetachedTrace: [["undefined", "undefined", "undefined"]],
        },
      },
      "after an await": row(1, 1),
    });
    expect(exitCode).toBe(0);
  },
);

// A store to `stack`, a delete of it and a redefinition of it replace what a formatter would return, so none is
// called for them. The error printer shows the frames themselves and does not read `stack`.
test.concurrent(
  "an error whose trace a collection detached has the properties of one whose frames are alive",
  async () => {
    const src = `
    import vm from "node:vm";
    ${detachedByACollection}
    const own = error => JSON.stringify(Object.getOwnPropertyNames(error).sort().map(name => [name, name === "stack" ? error.stack.split("\\n")[0] : typeof error[name] === "string" ? "string" : error[name]]));
    let calls = 0;
    const formatter = () => (calls++, "formatted");
    const operations = {
      "read stack": error => [error.stack, error.line > 0, error.column > 0, typeof error.sourceURL, "originalLine" in error],
      "store to stack": error => ((error.stack = "stored"), [error.stack, error.line > 0]),
      "delete stack": error => [delete error.stack, error.stack ?? null, error.line > 0],
      "define stack": error => (Object.defineProperty(error, "stack", { value: "defined", configurable: true, writable: true }), [error.stack, error.line > 0]),
      "store to line": error => ((error.line = -1), [error.stack, error.line]),
      "Bun.inspect, then read stack": error => {
        const inspected = Bun.inspect(error);
        return [inspected.includes("boom"), inspected.includes("thrower"), calls, error.stack];
      },
    };
    const [alive, ...withoutFormatter] = captureAll(() => new TypeError("boom"));
    const expected = own(alive);
    const cases = Object.keys(operations).map(name => ({ name, samples: captureAll(() => new TypeError("boom")).slice(1) }));
    // The first frame is global code, which has no name. The printer then shows the error's sourceURL and line.
    const inGlobalCode = captureAll(() => vm.runInThisContext("new TypeError('boom')", { filename: "/printed-global-code.js" })).slice(1);
    await collect();

    const rows = {};
    const properties = readDetached(withoutFormatter, own);
    rows["no formatter"] = { detachedByACollection: properties.length > 0, same: properties.every(result => result === expected), whileFramesAreAlive: JSON.parse(expected) };
    Error.prepareStackTrace = formatter;
    for (const { name, samples } of cases) {
      const results = readDetached(samples, error => {
        calls = 0;
        return JSON.stringify({ result: operations[name](error), calls });
      });
      rows[name] = { detachedByACollection: results.length > 0, results: [...new Set(results)].map(result => JSON.parse(result)) };
    }
    const printed = readDetached(inGlobalCode, error => {
      calls = 0;
      const inspected = Bun.inspect(error);
      return JSON.stringify({ result: [inspected.includes("boom"), inspected.includes("/printed-global-code.js:1"), calls, error.stack], calls });
    });
    rows["Bun.inspect of an error of global code, then read stack"] = { detachedByACollection: printed.length > 0, results: [...new Set(printed)].map(result => JSON.parse(result)) };
    console.log(JSON.stringify(rows));
  `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const row = (result, calls) => ({ detachedByACollection: true, results: [{ result, calls }] });
    expect(JSON.parse(stdout)).toEqual({
      "no formatter": {
        detachedByACollection: true,
        same: true,
        whileFramesAreAlive: [
          ["column", expect.any(Number)],
          ["line", expect.any(Number)],
          ["message", "string"],
          ["originalColumn", expect.any(Number)],
          ["originalLine", expect.any(Number)],
          ["sourceURL", "string"],
          ["stack", "TypeError: boom"],
        ],
      },
      // line, column and sourceURL are those of the first frame, as they are without a formatter.
      "read stack": row(["formatted", true, true, "string", false], 1),
      "store to stack": row(["stored", true], 0),
      "delete stack": row([true, null, true], 0),
      "define stack": row(["defined", true], 0),
      "store to line": row(["formatted", -1], 1),
      "Bun.inspect, then read stack": row([true, true, 0, "formatted"], 1),
      "Bun.inspect of an error of global code, then read stack": row([true, true, 0, "formatted"], 1),
    });
    expect(exitCode).toBe(0);
  },
);

// The source map of a file is for the code that Bun made from the file. A node:vm script that names the file has
// positions of its own: they are shown as they are, also after a collection detached the trace.
test.concurrent("a node:vm frame that names a transpiled file keeps its position after a collection", async () => {
  using dir = tempDir("stack-detached-vm-frame", {
    "main.ts": `
      interface Removed {
        first: number;
        second: number;
        third: number;
      }
      import vm from "node:vm";
      ${detachedByACollection}
      const inVm = () => vm.runInNewContext("(function inVm() { try { return new Error('boom'); } finally {} })()", {}, { filename: import.meta.path });
      const frame = (error: Error) => /at inVm \\(.*main\\.ts:(\\d+):\\d+\\)/.exec(error.stack!)?.[1];
      const [alive, ...samples] = captureAll(inVm);
      const expected = alive.stack;
      await collect();
      const stacks = readDetached(samples, error => error.stack);
      console.log(JSON.stringify({ detachedByACollection: stacks.length > 0, sameText: stacks.every(stack => stack === expected), lineOfTheVmFrame: frame(alive) }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ detachedByACollection: true, sameText: true, lineOfTheVmFrame: "1" });
  expect(exitCode).toBe(0);
});

// What a collection keeps of a trace holds none of the trace's functions, so nothing they close over stays either.
test.concurrent("an unread error does not keep the functions of its stack trace alive", async () => {
  const src = `
    import { heapStats } from "bun:jsc";
    ${detachedByACollection}
    // Each error is made in a function that closes over an array of a type nothing else here uses.
    const make = () => {
      const held = new BigUint64Array(1);
      return capture(() => { try { return new Error(String(held.length)); } finally {} });
    };
    const errors = Array.from({ length: 100 }, make);
    await collect();
    const detachedByACollection = errors.filter(detached).length;
    Error.prepareStackTrace = (error, callSites) => callSites.length;
    console.log(JSON.stringify({ held: heapStats().objectTypeCounts.BigUint64Array ?? 0, detachedByACollection, errors: errors.length, frames: errors.every(error => error.stack > 0) }));
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ held: 0, detachedByACollection: 100, errors: 100, frames: true });
  expect(exitCode).toBe(0);
});

// JSC skips an already-seen nested function body via its SourceProviderCache. After skipping a body whose last token
// spans lines (a template literal ending an arrow's expression body) it used to resume on the line that token *started*
// on, so every position after it in the enclosing function was reported lines too early. Positions must be the same
// whether the body was skipped or parsed.
test.concurrent.each([[{}], [{ BUN_JSC_useSourceProviderCache: "0" }]])(
  "line numbers after a multi-line template literal ending an arrow body (%o)",
  async env => {
    const source = [
      "function outer() {", // 1
      "  const f = x => `a", // 2
      "b", // 3
      "c`;", // 4
      '  return new Error("here").stack.split("\\n")[1];', // 5
      "}",
      "console.log(outer());",
    ].join("\n");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toEndWith("[eval]:5:14)"); // 2:18 when the lexer resumed on the template literal's first line
    expect(exitCode).toBe(0);
  },
);

// The message and the frames of a stack trace come from JS. A trace past
// `WTF::String::MaxLength` (2**31 - 1 characters) aborted the process (exit code
// 134) while it was formatted. It now keeps the "name: message" header and drops
// the frames. The length is what is under test, so the child needs a string of
// about 2 GiB, and the test skips on small machines. The child touches about
// 6 GB of pages, which takes longer than the default limit in a debug build.
// `repeat` and not `Buffer.alloc(n, fill).toString()`: for one character at this
// size it is faster in a debug build (1.6 s against 3.3 s), and it does not hold
// a second 2 GiB.
test.skipIf(totalmem() < 10 * 1024 ** 3)(
  "a stack trace past the string length limit drops its frames instead of aborting the process",
  async () => {
    const length = 2 ** 31 - 10;
    const src = `
      const long = "q".repeat(${length});
      const describe = stack => typeof stack + " " + stack.length + " " + JSON.stringify(stack.slice(0, 9));
      console.log(".stack: " + describe(new Error(long).stack));
      Bun.gc(true);
      const frames = [{ toString: () => "frame" }];
      console.log("default Error.prepareStackTrace: " + describe(Error.prepareStackTrace(new Error(long), frames)));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
      stdout: [
        `.stack: string ${"Error: ".length + length} "Error: qq"`,
        `default Error.prepareStackTrace: string ${"Error: ".length + length} "Error: qq"`,
      ],
      stderr: "",
      exitCode: 0,
    });
  },
  30_000,
);
