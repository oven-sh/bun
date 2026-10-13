import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// BUN_JSC_immutableGlobals is a comma-separated list: `*` is every built-in of JavaScriptCore's own, any other entry
// is the name of a global. Each listed object stops changing when its global object is created, along with the
// functions it holds and, for a constructor, its prototype.

async function run(immutableGlobals: string | undefined, args: string[], cwd?: string, stdin?: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: { ...bunEnv, BUN_JSC_immutableGlobals: immutableGlobals },
    cwd,
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Prints one line per expression, evaluated as strict code: the name of the error it threw, or "ok".
const attempts = (expressions: string[]) => `
  for (const expression of ${JSON.stringify(expressions)}) {
    let outcome = "ok";
    try {
      (0, eval)('"use strict";' + expression);
    } catch (error) {
      outcome = error.name;
    }
    console.log(outcome.padEnd(12) + expression);
  }
`;

describe.concurrent("BUN_JSC_immutableGlobals", () => {
  test("`*` covers JavaScriptCore's built-ins and what Bun adds to them, names cover Bun's globals", async () => {
    const { stdout, stderr, exitCode } = await run("*,Headers,Response,Bun", [
      "-e",
      attempts([
        // JavaScriptCore's
        "Array.prototype.map = 1",
        "Array.prototype.fresh = 1",
        "delete Array.prototype.map",
        "Array.prototype.map.call = 1",
        "Object.defineProperty(Object.prototype, 'polluted', { value: 1 })",
        "Object.getPrototypeOf(Uint8Array).prototype.map = 1",
        "Object.getPrototypeOf([][Symbol.iterator]()).next = 1",
        "Object.getPrototypeOf(async function () {}).fresh = 1",
        "TypeError.prototype.name = 'x'",
        "JSON.parse = 1",
        "parseInt.fresh = 1",
        "Intl.DateTimeFormat.prototype.format = 1",
        // Bun's additions to them
        "Error.captureStackTrace = 1",
        "Error.captureStackTrace.fresh = 1",
        "Error.stackTraceLimit = 1",
        "Error.prepareStackTrace = () => {}",
        "Error.prepareStackTrace.fresh = 1",
        // Bun's globals that are listed
        "Headers.prototype.get = 1",
        "Headers.prototype.get.call = 1",
        "Response.json = 1",
        "Response.prototype.fresh = 1",
        "Bun.serve = 1",
        "Bun.serve.fresh = 1",
        "Bun.fresh = 1",
        // Bun's globals that are not, and the global object
        "Request.prototype.fresh = 1",
        "Request.fresh = 1",
        "Buffer.prototype.fresh = 1",
        "process.fresh = 1",
        "fetch.fresh = 1",
        "globalThis.fresh = 1",
        "globalThis.Array = Array",
        // What inherits from a built-in
        "({}).toString = 1",
        "(class extends Array {}).prototype.map = 1",
        "new Error('x').name = 'y'",
        "(function () {}).call = 1",
      ]),
    ]);
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
      "TypeError   Array.prototype.map = 1
      TypeError   Array.prototype.fresh = 1
      TypeError   delete Array.prototype.map
      TypeError   Array.prototype.map.call = 1
      TypeError   Object.defineProperty(Object.prototype, 'polluted', { value: 1 })
      TypeError   Object.getPrototypeOf(Uint8Array).prototype.map = 1
      TypeError   Object.getPrototypeOf([][Symbol.iterator]()).next = 1
      TypeError   Object.getPrototypeOf(async function () {}).fresh = 1
      TypeError   TypeError.prototype.name = 'x'
      TypeError   JSON.parse = 1
      TypeError   parseInt.fresh = 1
      TypeError   Intl.DateTimeFormat.prototype.format = 1
      TypeError   Error.captureStackTrace = 1
      TypeError   Error.captureStackTrace.fresh = 1
      TypeError   Error.stackTraceLimit = 1
      TypeError   Error.prepareStackTrace = () => {}
      TypeError   Error.prepareStackTrace.fresh = 1
      TypeError   Headers.prototype.get = 1
      TypeError   Headers.prototype.get.call = 1
      TypeError   Response.json = 1
      TypeError   Response.prototype.fresh = 1
      TypeError   Bun.serve = 1
      TypeError   Bun.serve.fresh = 1
      TypeError   Bun.fresh = 1
      ok          Request.prototype.fresh = 1
      ok          Request.fresh = 1
      ok          Buffer.prototype.fresh = 1
      ok          process.fresh = 1
      ok          fetch.fresh = 1
      ok          globalThis.fresh = 1
      ok          globalThis.Array = Array
      ok          ({}).toString = 1
      ok          (class extends Array {}).prototype.map = 1
      ok          new Error('x').name = 'y'
      ok          (function () {}).call = 1
      "
    `);
    expect(exitCode).toBe(0);
  });

  test("without the option nothing is immutable", async () => {
    const { stdout, exitCode } = await run(undefined, [
      "-e",
      attempts([
        "Array.prototype.fresh = 1",
        "Array.prototype.map.fresh = 1",
        "Headers.prototype.fresh = 1",
        "Bun.fresh = 1",
      ]),
    ]);
    expect(stdout).toMatchInlineSnapshot(`
      "ok          Array.prototype.fresh = 1
      ok          Array.prototype.map.fresh = 1
      ok          Headers.prototype.fresh = 1
      ok          Bun.fresh = 1
      "
    `);
    expect(exitCode).toBe(0);
  });

  test("`globalThis` is the global object", async () => {
    using dir = tempDir("immutable-globals-global-object", {
      "index.mjs":
        `import { runInThisContext } from "node:vm";` +
        attempts([
          "globalThis.fresh = 1",
          "globalThis.Array = 1",
          "globalThis.fetch = 1",
          "delete globalThis.Bun",
          "fetch.fresh = 1",
          "Request.prototype.fresh = 1",
          "Bun.fresh = 1",
          "Math.fresh = 1",
        ]) +
        attempts([
          "var declared",
          "function declared() {}",
          "let declared",
          "class declared {}",
          "{ let inBlock }",
        ]).replace(`(0, eval)('"use strict";' + expression)`, `runInThisContext(expression)`),
    });
    const { stdout, stderr, exitCode } = await run("globalThis", ["index.mjs"], String(dir));
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
      "TypeError   globalThis.fresh = 1
      TypeError   globalThis.Array = 1
      TypeError   globalThis.fetch = 1
      TypeError   delete globalThis.Bun
      TypeError   fetch.fresh = 1
      TypeError   Request.prototype.fresh = 1
      ok          Bun.fresh = 1
      ok          Math.fresh = 1
      TypeError   var declared
      TypeError   function declared() {}
      SyntaxError let declared
      SyntaxError class declared {}
      ok          { let inBlock }
      "
    `);
    expect(exitCode).toBe(0);
  });

  test("`*` reaches every object and function reachable from a standard global", async () => {
    const { stdout, stderr, exitCode } = await run("*", [
      "-e",
      `
      const names = ["Object", "Function", "Array", "Number", "Boolean", "String", "Symbol", "BigInt", "Date", "Promise", "RegExp",
        "Error", "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError", "SuppressedError",
        "ArrayBuffer", "SharedArrayBuffer", "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
        "Int32Array", "Uint32Array", "Float16Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
        "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry", "Proxy", "Iterator", "DisposableStack", "AsyncDisposableStack",
        "ShadowRealm", "Atomics", "JSON", "Math", "Reflect", "Intl", "Temporal", "WebAssembly",
        "eval", "isFinite", "isNaN", "parseFloat", "parseInt", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent", "escape", "unescape"];
      const values = [function* () {}, async function () {}, async function* () {}, Object.getPrototypeOf((function* () {})()),
        Object.getPrototypeOf((async function* () {})()), [][Symbol.iterator](), new Map().entries(), new Set().values(), ""[Symbol.iterator](),
        "a".matchAll(/a/g), Iterator.from({ next() {} }), [].values().map(x => x), new Intl.Segmenter().segment("a"),
        new Intl.Segmenter().segment("a")[Symbol.iterator](), Temporal.Now.instant(), new WebAssembly.Memory({ initial: 1 })];
      const seen = new Set();
      const queue = [];
      const visit = (value, path) => {
        if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) return;
        seen.add(value);
        queue.push([value, path]);
      };
      for (const name of names) visit(globalThis[name], name);
      values.forEach((value, index) => visit(Object.getPrototypeOf(value), "value " + index + ".__proto__"));
      const extensible = [];
      while (queue.length) {
        const [object, path] = queue.pop();
        if (Object.isExtensible(object)) extensible.push(path);
        visit(Object.getPrototypeOf(object), path + ".__proto__");
        for (const key of Reflect.ownKeys(object)) {
          const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
          visit(descriptor.value, path + "." + String(key));
          visit(descriptor.get, "get " + path + "." + String(key));
          visit(descriptor.set, "set " + path + "." + String(key));
        }
      }
      console.log(JSON.stringify({ enough: seen.size > 1000, extensible }));
      `,
    ]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ enough: true, extensible: [] });
    expect(exitCode).toBe(0);
  });

  test("applies to node:vm contexts, workers and ShadowRealms", async () => {
    const { stdout, stderr, exitCode } = await run("*,Headers", [
      "-e",
      `
      const attempt = '"use strict"; try { Array.prototype.map.call = 1; "ok"; } catch (error) { error.name; }';
      const vm = require("node:vm");
      console.log("vm", vm.runInNewContext(attempt), vm.runInContext(attempt, vm.createContext({})));
      console.log("vm global", vm.runInNewContext('"use strict"; globalThis.fresh = 1; var declared = 2; fresh + declared'));
      console.log("ShadowRealm", new ShadowRealm().evaluate(attempt));
      const worker = new Worker(
        "data:text/javascript," +
          encodeURIComponent('"use strict"; const results = []; for (const f of [() => { Array.prototype.map = 1; }, () => { Headers.prototype.get = 1; }, () => { Request.prototype.fresh = 1; }]) { try { f(); results.push("ok"); } catch (error) { results.push(error.name); } } postMessage(results.join());'),
      );
      worker.onerror = event => {
        console.log("worker error", event.message);
        process.exit(1);
      };
      worker.onmessage = event => {
        console.log("worker", event.data);
        worker.terminate();
      };
      `,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
      "vm TypeError TypeError
      vm global 3
      ShadowRealm TypeError
      worker TypeError,TypeError,ok
      "
    `);
    expect(exitCode).toBe(0);
  });

  test("node:vm contexts can be created when `globalThis` is listed", async () => {
    using dir = tempDir("immutable-globals-vm", {
      "index.mjs": `
        import vm from "node:vm";
        console.log(vm.runInContext("typeof globalThis", vm.createContext(vm.constants.DONT_CONTEXTIFY)));
        console.log(vm.runInContext("typeof globalThis", vm.createContext({})));
        console.log(vm.runInNewContext("typeof globalThis"));
      `,
    });
    expect(await run("*,globalThis", ["index.mjs"], String(dir))).toEqual({
      stdout: "object\nobject\nobject\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("Bun's additions to console work when console is immutable", async () => {
    const source = `
      console.write("written\\n");
      console.write("twice\\n");
      const { Console } = console;
      console.log(Console === console.Console, new Console(process.stdout) instanceof console.Console);
      for await (const line of console) {
        console.log("first loop", line);
        break;
      }
      for await (const line of console) console.log("second loop", line);
    `;
    const immutable = await run("*", ["-e", source], undefined, "a\nb\nc\n");
    expect(immutable).toEqual({
      stdout: "written\ntwice\ntrue true\nfirst loop a\nsecond loop b\nsecond loop c\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await run(undefined, ["-e", source], undefined, "a\nb\nc\n")).toEqual(immutable);
    expect(
      await run("*", ["-e", attempts(["console.log = 1", "console.write.fresh = 1", "console.Console.fresh = 1"])]),
    ).toEqual({
      stdout:
        "TypeError   console.log = 1\nTypeError   console.write.fresh = 1\nTypeError   console.Console.fresh = 1\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("node:test's Date mock works when Date is immutable", async () => {
    expect(
      await run("*", [
        "-e",
        `const { mock } = require("node:test"); mock.timers.enable({ apis: ["Date"], now: 1000 }); console.log(Date.now(), new Date().toUTCString()); mock.timers.reset();`,
      ]),
    ).toEqual({ stdout: "1000 Thu, 01 Jan 1970 00:00:01 GMT\n", stderr: "", exitCode: 0 });
  });

  test("Error.captureStackTrace() throws for an object with immutable properties", async () => {
    const { stdout, stderr, exitCode } = await run("Error,Map", [
      "-e",
      attempts([
        "Error.captureStackTrace(Map.prototype)",
        "Error.captureStackTrace(Map)",
        "Error.captureStackTrace(Error.prototype)",
        "Error.captureStackTrace({})",
        "Error.captureStackTrace(new Error('x'))",
        "Error.captureStackTrace(Set.prototype); delete Set.prototype.stack",
      ]) + `console.log("stack" in Map.prototype, "stack" in Map, Object.hasOwn(Error.prototype, "stack"));`,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
      "TypeError   Error.captureStackTrace(Map.prototype)
      TypeError   Error.captureStackTrace(Map)
      TypeError   Error.captureStackTrace(Error.prototype)
      ok          Error.captureStackTrace({})
      ok          Error.captureStackTrace(new Error('x'))
      ok          Error.captureStackTrace(Set.prototype); delete Set.prototype.stack
      false false false
      "
    `);
    expect(exitCode).toBe(0);
  });

  test("setters that keep their value outside the object refuse every route when their owner is immutable", async () => {
    const source = `
      (function () {
        "use strict";
        const read = () => [Bun.main, process.argv, process.execArgv, process.title, process.debugPort, process.exitCode];
        const before = read();
        const routes = {
          "owner.key = value": (owner, key, value) => { owner[key] = value; },
          "inheritor.key = value": (owner, key, value) => { Object.create(owner)[key] = value; },
          "proxy.key = value": (owner, key, value) => { new Proxy(owner, {})[key] = value; },
          "Reflect.set(inheritor, key, value, owner)": (owner, key, value) => { Reflect.set(Object.create(owner), key, value, owner); },
          "setter.call(owner, value)": (owner, key, value) => { Object.getOwnPropertyDescriptor(owner, key).set.call(owner, value); },
          "setter.call({}, value)": (owner, key, value) => { Object.getOwnPropertyDescriptor(owner, key).set.call({}, value); },
        };
        for (const route in routes) {
          const outcomes = [];
          for (const [owner, key, value] of [[Bun, "main", "/other.js"], [process, "argv", []], [process, "execArgv", []], [process, "title", "other"], [process, "debugPort", 1234], [process, "exitCode", 0]]) {
            try {
              routes[route](owner, key, value);
              outcomes.push("ok");
            } catch (error) {
              outcomes.push(error.name);
            }
          }
          console.log(route + ": " + outcomes.join(" "));
        }
        console.log("unchanged: " + read().map((value, index) => value === before[index]).join(" "));
      })();
    `;
    const immutable = await run("Bun,process", ["-e", source]);
    expect(immutable.stderr).toBe("");
    expect(immutable.stdout).toMatchInlineSnapshot(`
      "owner.key = value: TypeError TypeError TypeError TypeError TypeError TypeError
      inheritor.key = value: TypeError TypeError TypeError TypeError TypeError ok
      proxy.key = value: TypeError TypeError TypeError TypeError TypeError ok
      Reflect.set(inheritor, key, value, owner): TypeError TypeError TypeError TypeError TypeError TypeError
      setter.call(owner, value): TypeError TypeError TypeError TypeError TypeError TypeError
      setter.call({}, value): TypeError TypeError TypeError TypeError TypeError ok
      unchanged: true true true true true true
      "
    `);
    expect(immutable.exitCode).toBe(0);

    const mutable = await run(undefined, ["-e", source]);
    expect(mutable.stderr).toBe("");
    expect(mutable.stdout).toMatchInlineSnapshot(`
      "owner.key = value: ok ok ok ok ok ok
      inheritor.key = value: ok ok ok ok ok ok
      proxy.key = value: ok ok ok ok ok ok
      Reflect.set(inheritor, key, value, owner): ok ok ok ok ok ok
      setter.call(owner, value): ok ok ok ok ok ok
      setter.call({}, value): ok ok ok ok ok ok
      unchanged: false false false false false false
      "
    `);
    expect(mutable.exitCode).toBe(0);
  });

  test("spyOn() throws for a target with immutable properties", async () => {
    using dir = tempDir("immutable-globals-spyon", {
      "spy.test.ts": `
        import { expect, spyOn, test } from "bun:test";
        test("spyOn", () => {
          const map = Array.prototype.map;
          expect(() => spyOn(Array.prototype, "map")).toThrow(TypeError);
          expect(() => spyOn(Array.prototype, "fresh")).toThrow(TypeError);
          expect(() => spyOn(Math, "max")).toThrow("immutable properties");
          expect(Array.prototype.map).toBe(map);
          expect("fresh" in Array.prototype).toBe(false);
          const list = [1, 2];
          const spy = spyOn(list, "map");
          list.map(x => x);
          expect(spy).toHaveBeenCalledTimes(1);
        });
      `,
    });
    const { stderr, exitCode } = await run("*", ["test", "spy.test.ts"], String(dir));
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  // Each of these used to assign Error.stackTraceLimit or Error.prepareStackTrace and put the old value back.
  const usesOfTheStack = `
    const util = require("node:util");
    const assert = require("node:assert");
    function outer() { return util.getCallSites(2); }
    const sites = outer();
    console.log("getCallSites(2)", sites.length, sites[0].functionName, typeof sites[0].lineNumber, sites[0].scriptName === __filename);
    console.log("getCallSites(1)", util.getCallSites(1).length);
    process.on("warning", warning => console.log("warning", warning.code));
    require("node:url").parse("http://example.com/");
    let error;
    try {
      (function failing() { assert.strictEqual(1, 2); })();
    } catch (e) {
      error = e;
    }
    console.log("AssertionError", error.name, error.code, error.stack.split("\\n").find(line => line.startsWith("    at ")).includes("failing"));
    console.log("new AssertionError", new assert.AssertionError({ message: "m" }).stack.split("\\n")[0]);
    try {
      assert.deepStrictEqual({ get a() { return new Error("made while the message is rendered"); } }, { a: 2 });
    } catch (e) {
      console.log(e.message.split("\\n").filter(line => line.includes("Getter")).join());
    }
    console.log("afterwards", String(new Error("x").stack).includes("    at "));
  `;

  test("built-in modules that look at the stack work when Error is immutable", async () => {
    using dir = tempDir("immutable-globals-stack", { "index.cjs": usesOfTheStack });
    const immutable = await run("*", ["index.cjs"], String(dir));
    const mutable = await run(undefined, ["index.cjs"], String(dir));
    expect(immutable.stdout).toMatchInlineSnapshot(`
      "getCallSites(2) 2 outer number true
      getCallSites(1) 1
      AssertionError AssertionError ERR_ASSERTION true
      new AssertionError AssertionError [ERR_ASSERTION]: m
      +   a: [Getter] [Error: made while the message is rendered]
      afterwards true
      warning DEP0169
      "
    `);
    expect(mutable.stdout).toBe(immutable.stdout);
    expect(immutable.exitCode).toBe(0);
  });

  test("built-in modules do not assign Error.stackTraceLimit or Error.prepareStackTrace", async () => {
    using dir = tempDir("immutable-globals-writes", {
      "index.cjs": `
        const writes = [];
        for (const key of ["stackTraceLimit", "prepareStackTrace"]) {
          let value = Error[key];
          Object.defineProperty(Error, key, { configurable: true, get: () => value, set(v) { writes.push(key); value = v; } });
        }
        ${usesOfTheStack}
        console.log("writes", JSON.stringify(writes));
      `,
    });
    const { stdout, exitCode } = await run(undefined, ["index.cjs"], String(dir));
    expect(stdout).toContain("new AssertionError");
    expect(stdout).toContain("writes []\n");
    expect(exitCode).toBe(0);
  });

  test("--trace-env-js-stack works when Error is immutable", async () => {
    using dir = tempDir("immutable-globals-trace-env", {
      "index.cjs": `function reader() { return process.env.TRACED; }\nreader();`,
    });
    const immutable = await run("*", ["--trace-env", "--trace-env-js-stack", "index.cjs"], String(dir));
    const mutable = await run(undefined, ["--trace-env", "--trace-env-js-stack", "index.cjs"], String(dir));
    const trace = (stderr: string) =>
      stderr.slice(stderr.indexOf('[--trace-env] get "TRACED"')).split("\n").slice(0, 2);
    expect(trace(immutable.stderr)).toEqual(['[--trace-env] get "TRACED"', expect.stringContaining("at reader (")]);
    expect(trace(mutable.stderr)).toEqual(trace(immutable.stderr));
    expect(immutable.exitCode).toBe(0);
  });

  test("node:repl reports an await that SIGINT interrupts when Error is immutable", async () => {
    const source = `
      const { PassThrough } = require("node:stream");
      const input = new PassThrough(), output = new PassThrough();
      let text = "";
      output.on("data", chunk => {
        text += chunk;
        if (text.includes("interrupted") && text.endsWith("> ")) {
          console.log(JSON.stringify(text));
          process.exit(0);
        }
      });
      const repl = require("node:repl").start({ input, output, terminal: false, breakEvalOnSigint: true, useGlobal: false });
      repl.context.interrupt = () => repl.emit("SIGINT");
      input.write("await new Promise(() => { setImmediate(interrupt); })\\n");
    `;
    const immutable = await run("*", ["-e", source]);
    const mutable = await run(undefined, ["-e", source]);
    expect(immutable.stdout).toMatchInlineSnapshot(`
      ""> Uncaught Error: Script execution was interrupted by \`SIGINT\`\\n> "
      "
    `);
    expect(mutable.stdout).toBe(immutable.stdout);
    expect(immutable.exitCode).toBe(0);
  });
});
