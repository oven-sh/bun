import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

it("ERR_INVALID_THIS", () => {
  try {
    Request.prototype.formData.call(undefined);
    expect.unreachable();
  } catch (e) {
    expect(e.code).toBe("ERR_INVALID_THIS");
    expect(e.name).toBe("TypeError");
    expect(e.message).toBe("Expected this to be instanceof Request");
  }

  try {
    Request.prototype.formData.call(null);
    expect.unreachable();
  } catch (e) {
    expect(e.code).toBe("ERR_INVALID_THIS");
    expect(e.name).toBe("TypeError");
    expect(e.message).toBe("Expected this to be instanceof Request, but received null");
  }

  try {
    Request.prototype.formData.call(new (class Boop {})());
    expect.unreachable();
  } catch (e) {
    expect(e.code).toBe("ERR_INVALID_THIS");
    expect(e.name).toBe("TypeError");
    expect(e.message).toBe("Expected this to be instanceof Request, but received an instance of Boop");
  }

  try {
    Request.prototype.formData.call("hellooo");
    expect.unreachable();
  } catch (e) {
    expect(e.code).toBe("ERR_INVALID_THIS");
    expect(e.name).toBe("TypeError");
    expect(e.message).toBe(`Expected this to be instanceof Request, but received type string ('hellooo')`);
  }

  // A bare call through a closure-captured binding hands the native function
  // the scope object as `this`; it must be reported like an undefined receiver.
  const { formData } = Request.prototype;
  function keep() {
    return formData;
  }
  try {
    formData();
    expect.unreachable();
  } catch (e) {
    expect(e.code).toBe("ERR_INVALID_THIS");
    expect(e.name).toBe("TypeError");
    expect(e.message).toBe("Expected this to be instanceof Request");
  }
  expect(keep()).toBe(formData);
});

it("extendable", () => {
  const classes = [Blob, TextDecoder, TextEncoder, Request, Response, Headers, HTMLRewriter, Bun.Transpiler, Buffer];
  for (let Class of classes) {
    var Foo = class extends Class {};
    var bar = Class === Request ? new Request({ url: "https://example.com" }) : new Foo();
    expect(bar instanceof Class).toBe(true);
    expect(!!Class.prototype).toBe(true);
    expect(typeof Class.prototype).toBe("object");
  }
  expect(true).toBe(true);
});

it("writable", () => {
  const classes = [
    ["TextDecoder", TextDecoder],
    ["Request", Request],
    ["Response", Response],
    ["Headers", Headers],
    ["Buffer", Buffer],
    ["Event", Event],
    ["DOMException", DOMException],
    ["EventTarget", EventTarget],
    ["ErrorEvent", ErrorEvent],
    ["CustomEvent", CustomEvent],
    ["CloseEvent", CloseEvent],
    ["File", File],
  ];
  for (let [name, Class] of classes) {
    globalThis[name] = 123;
    expect(globalThis[name]).toBe(123);
    globalThis[name] = Class;
    expect(globalThis[name]).toBe(Class);
  }
});

it("name", () => {
  const classes = [
    ["Blob", Blob],
    ["TextDecoder", TextDecoder],
    ["TextEncoder", TextEncoder],
    ["Request", Request],
    ["Response", Response],
    ["Headers", Headers],
    ["HTMLRewriter", HTMLRewriter],
    ["Transpiler", Bun.Transpiler],
    ["Buffer", Buffer],
    ["File", File],
  ];
  for (let [name, Class] of classes) {
    expect(Class.name).toBe(name);
  }
});

describe("File", () => {
  it("constructor", () => {
    const file = new File(["foo"], "bar.txt", { type: "text/plain;charset=utf-8" });
    expect(file.name).toBe("bar.txt");
    expect(file.type).toBe("text/plain;charset=utf-8");
    expect(file.size).toBe(3);
    expect(file.lastModified).toBeGreaterThan(0);
  });

  it("constructor with empty array", () => {
    const file = new File([], "empty.txt", { type: "text/plain;charset=utf-8" });
    expect(file.name).toBe("empty.txt");
    expect(file.size).toBe(0);
    expect(file.type).toBe("text/plain;charset=utf-8");
  });

  it("constructor with lastModified", () => {
    const file = new File(["foo"], "bar.txt", { type: "text/plain;charset=utf-8", lastModified: 123 });
    expect(file.name).toBe("bar.txt");
    expect(file.type).toBe("text/plain;charset=utf-8");
    expect(file.size).toBe(3);
    expect(file.lastModified).toBe(123);
  });

  it("constructor with undefined name", () => {
    const file = new File(["foo"], undefined);
    expect(file.name).toBe("undefined");
    expect(file.type).toBe("");
    expect(file.size).toBe(3);
    expect(file.lastModified).toBeGreaterThan(0);
  });

  it("constructor throws invalid args", () => {
    const invalid = [[], [undefined], [null], [Symbol(), "foo"], [Symbol(), Symbol(), Symbol()]];
    for (let args of invalid) {
      expect(() => new File(...args)).toThrow();
    }
  });

  it("constructor without new", () => {
    const result = () => File();
    expect(result).toThrow({
      name: "TypeError",
      message: "Class constructor File cannot be invoked without 'new'",
    });
  });

  it("instanceof", () => {
    const file = new File(["foo"], "bar.txt", { type: "text/plain;charset=utf-8" });
    expect(file instanceof File).toBe(true);
    expect(file instanceof Blob).toBe(true);
    expect(file instanceof Object).toBe(true);
    expect(file instanceof Function).toBe(false);
    const blob = new Blob(["foo"], { type: "text/plain;charset=utf-8" });
    expect(blob instanceof File).toBe(false);
  });

  it("extendable", async () => {
    class Foo extends File {
      constructor(...args) {
        super(...args);
      }

      bar() {
        return true;
      }

      text() {
        return super.text();
      }
    }
    const foo = new Foo(["foo"], "bar.txt", { type: "text/plain;charset=utf-8" });
    expect(foo instanceof File).toBe(true);
    expect(foo instanceof Blob).toBe(true);
    expect(foo instanceof Object).toBe(true);
    expect(foo instanceof Function).toBe(false);
    expect(foo instanceof Foo).toBe(true);
    expect(foo.bar()).toBe(true);
    expect(foo.name).toBe("bar.txt");
    expect(foo.type).toBe("text/plain;charset=utf-8");
    expect(foo.size).toBe(3);
    expect(foo.lastModified).toBeGreaterThanOrEqual(0);
    expect(await foo.text()).toBe("foo");
  });
});

it("globals are deletable", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "deletable-globals-fixture.js")],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(stdout.toString().trim().endsWith("--pass--")).toBe(true);
  expect(exitCode).toBe(0);
});

// Built-in modules schedule their own work (a socket's 'close', an observer's
// delivery, an abort listener) with setImmediate / clearImmediate /
// queueMicrotask. They reach them through private names, so fake timers or
// anything else that replaces or deletes the public globals cannot strand it.
// Node's lib/ keeps private references the same way.
describe.concurrent("built-in modules do not schedule through replaced globals", () => {
  /** Runs `source` in a fresh process and returns what it printed. */
  async function run(source) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  }

  it("an http2 session closes with setImmediate replaced", async () => {
    // A session whose close was handed to the replaced function never closes,
    // and the process hangs.
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const http2 = require("node:http2");
      globalThis.setImmediate = () => {};
      const server = http2.createServer();
      server.on("stream", stream => {
        stream.respond({ ":status": 200 });
        stream.end("ok");
      });
      server.on("close", () => console.log("server closed"));
      server.listen(0, "127.0.0.1", () => {
        const client = http2.connect("http://127.0.0.1:" + server.address().port);
        client.on("close", () => console.log("session closed"));
        const req = client.request({ ":path": "/" });
        req.resume();
        req.on("close", () => {
          console.log("stream closed");
          client.close();
          server.close();
        });
      });
    `);
    expect({ events: stdout.split("\n").sort(), stderr, exitCode }).toEqual({
      events: ["server closed", "session closed", "stream closed"],
      stderr: "",
      exitCode: 0,
    });
  });

  it("an http2 session over a Duplex keeps its write callbacks with setImmediate replaced", async () => {
    // Over a JS socket the session defers each write callback by one
    // setImmediate, a reference it takes when the session is constructed.
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const http2 = require("node:http2");
      const { duplexPair } = require("node:stream");
      globalThis.setImmediate = () => {};
      const [clientSide, serverSide] = duplexPair();
      const server = http2.createServer();
      server.on("stream", stream => {
        stream.respond({ ":status": 200 });
        stream.end("ok");
      });
      server.emit("connection", serverSide);
      const client = http2.connect("http://localhost", { createConnection: () => clientSide });
      client.on("close", () => console.log("session closed"));
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.end("hello", () => console.log("request body written"));
      req.resume();
      req.on("end", () => console.log("response ended"));
      req.on("close", () => {
        console.log("stream closed");
        client.close();
      });
    `);
    expect({ events: stdout.split("\n").sort(), stderr, exitCode }).toEqual({
      events: ["request body written", "response ended", "session closed", "stream closed"],
      stderr: "",
      exitCode: 0,
    });
  });

  // A PerformanceObserver hands its delivery to setImmediate. Prints the names
  // of the "function" entries it got by the time the process exits.
  const observeFunctionEntries = /* js */ `
    const seen = [];
    new PerformanceObserver(list => seen.push(...list.getEntries().map(entry => entry.name))).observe({
      entryTypes: ["function"],
    });
    process.on("exit", () => console.log(seen.join(",")));
  `;
  const requirePerfHooks = `const { PerformanceObserver, performance } = require("node:perf_hooks");`;

  it("a PerformanceObserver delivers entries queued while setImmediate was replaced, and later ones", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      ${requirePerfHooks}
      ${observeFunctionEntries}
      const realSetImmediate = setImmediate;
      globalThis.setImmediate = () => {};
      performance.timerify(function first() {})();
      globalThis.setImmediate = realSetImmediate;
      performance.timerify(function second() {})();
    `);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "first,second", stderr: "", exitCode: 0 });
  });

  it.each([
    ["deleted before node:perf_hooks is loaded", `delete globalThis.setImmediate; ${requirePerfHooks}`],
    ["set to a non-function", `${requirePerfHooks} globalThis.setImmediate = 1;`],
    [
      "mocked by node:test's mock.timers",
      `${requirePerfHooks} require("node:test").mock.timers.enable({ apis: ["setImmediate"] });`,
    ],
    [
      "replaced in an ES module",
      `import { PerformanceObserver, performance } from "node:perf_hooks"; globalThis.setImmediate = () => {};`,
    ],
  ])("a PerformanceObserver delivers with setImmediate %s", async (_, setup) => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      ${setup}
      ${observeFunctionEntries}
      performance.timerify(function first() {})();
    `);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "first", stderr: "", exitCode: 0 });
  });

  it.each([
    ["replaced", `globalThis.queueMicrotask = () => {};`],
    ["deleted", `delete globalThis.queueMicrotask;`],
    ["set to a non-function", `globalThis.queueMicrotask = 1;`],
  ])("events.addAbortListener() calls the listener of an aborted signal with queueMicrotask %s", async (_, setup) => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const { addAbortListener } = require("node:events");
      ${setup}
      let called = false;
      addAbortListener(AbortSignal.abort(), () => {
        called = true;
      });
      process.on("exit", () => console.log("listener called:", called));
    `);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "listener called: true", stderr: "", exitCode: 0 });
  });

  it("fs.watch() with an aborted signal emits 'close' with queueMicrotask replaced", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const fs = require("node:fs");
      globalThis.queueMicrotask = () => {};
      let closed = false;
      fs.watch(process.cwd(), { signal: AbortSignal.abort() }).on("close", () => {
        closed = true;
      });
      process.on("exit", () => console.log("close emitted:", closed));
    `);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "close emitted: true", stderr: "", exitCode: 0 });
  });

  it.each([
    ["replaced", `globalThis.setImmediate = globalThis.clearImmediate = () => {};`],
    ["deleted", `delete globalThis.setImmediate; delete globalThis.clearImmediate;`],
  ])("node:timers exports the original functions with the globals %s before it is loaded", async (_, setup) => {
    // The public globals keep their shape: same name, length and descriptor,
    // and the one function object that node:timers and the built-ins use.
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const util = require("node:util");
      const original = {};
      const shape = {};
      for (const name of ["setImmediate", "clearImmediate", "queueMicrotask"]) {
        const { value, ...flags } = Object.getOwnPropertyDescriptor(globalThis, name);
        original[name] = value;
        shape[name] = { name: value.name, length: value.length, ...flags };
      }
      const { get, ...promisifyFlags } = Object.getOwnPropertyDescriptor(original.setImmediate, util.promisify.custom);
      shape.promisifyCustom = { get: typeof get, ...promisifyFlags };
      ${setup}
      const timers = require("node:timers");
      const result = {
        shape,
        setImmediate: timers.setImmediate === original.setImmediate,
        clearImmediate: timers.clearImmediate === original.clearImmediate,
        promisified: util.promisify(original.setImmediate) === require("node:timers/promises").setImmediate,
        readline: typeof require("node:readline").createInterface,
      };
      require("node:timers/promises").setImmediate("resolved").then(value => {
        result.promises = value;
      });
      process.on("exit", () => console.log(JSON.stringify(result)));
    `);
    const global = { length: 1, writable: true, enumerable: true, configurable: true };
    expect({ result: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      result: {
        shape: {
          setImmediate: { name: "setImmediate", ...global },
          clearImmediate: { name: "clearImmediate", ...global },
          queueMicrotask: { name: "queueMicrotask", ...global },
          promisifyCustom: { get: "function", enumerable: true, configurable: false },
        },
        setImmediate: true,
        clearImmediate: true,
        promisified: true,
        readline: "function",
        promises: "resolved",
      },
      stderr: "",
      exitCode: 0,
    });
  });
});

it("self is a getter", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
  expect(descriptor.get).toBeInstanceOf(Function);
  expect(descriptor.set).toBeInstanceOf(Function);
  expect(descriptor.enumerable).toBe(true);
  expect(descriptor.configurable).toBe(true);
  expect(globalThis.self).toBe(globalThis);
});

it("errors thrown by native code should be TypeError", async () => {
  expect(() => Bun.dns.prefetch()).toThrowError(TypeError);
  expect(async () => await fetch("http://localhost", { body: "123" })).toThrowError(TypeError);
});

describe("globalThis.gc", () => {
  /**
   * @param {string} expr
   * @param {string[]} args
   * @returns {string}
   */
  const runAndPrint = (expr, ...args) => {
    const result = Bun.spawnSync([bunExe(), ...args, "--print", expr], {
      env: bunEnv,
    });
    if (!result.success) throw new Error(result.stderr.toString("utf8"));
    return result.stdout.toString("utf8").trim();
  };

  describe("when --expose-gc is not passed", () => {
    it("globalThis.gc === undefined", () => {
      expect(runAndPrint("typeof globalThis.gc")).toEqual("undefined");
    });
    it(".gc does not take up a property slot", () => {
      expect(runAndPrint("'gc' in globalThis")).toEqual("false");
    });
  });

  describe("when --expose-gc is passed", () => {
    it("is a function", () => {
      expect(runAndPrint("typeof globalThis.gc", "--expose-gc")).toEqual("function");
    });

    it("gc is the same as globalThis.gc", () => {
      expect(runAndPrint("gc === globalThis.gc", "--expose-gc")).toEqual("true");
    });

    it("cleans up memory", () => {
      const src = /* js */ `
      let arr = []
      for (let i = 0; i < 100; i++) {
        arr.push(new Array(100_000));
      }
      arr.length = 0;

      const before = process.memoryUsage().heapUsed;
      globalThis.gc();
      const after = process.memoryUsage().heapUsed;
      return before - after;
      `;
      const expr = /* js */ `(function() { ${src} })()`;

      const delta = Number.parseInt(runAndPrint(expr, "--expose-gc"));
      expect(delta).not.toBeNaN();
      expect(delta).toBeGreaterThanOrEqual(0);
    });
  });
});
