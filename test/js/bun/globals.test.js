import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, bunRun, tempDir } from "harness";
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
// delivery, an abort listener) with setImmediate, clearImmediate and
// queueMicrotask. They reach them through private names, so fake timers or
// anything else that replaces or deletes the public globals cannot strand it.
describe("built-in modules keep their own setImmediate, clearImmediate and queueMicrotask", () => {
  /** Runs `source` as a file of that name in a fresh process. */
  async function run(file, source) {
    using dir = tempDir("globals-private-scheduling", { [file]: source });
    return await bunRun(path.join(String(dir), file));
  }
  const exitedCleanly = { stderr: "", exitCode: 0, signalCode: null };

  const requireModules = /* js */ `
    const { PerformanceObserver, performance } = require("node:perf_hooks");
    const events = require("node:events");
    const fs = require("node:fs");
    const timers = require("node:timers");
    const timersPromises = require("node:timers/promises");
  `;
  const importModules = /* js */ `
    import { PerformanceObserver, performance } from "node:perf_hooks";
    import events from "node:events";
    import fs from "node:fs";
    import timers from "node:timers";
    import timersPromises from "node:timers/promises";
  `;
  const keepOriginals = /* js */ `
    const original = { setImmediate, clearImmediate };
    const result = {};
  `;
  const replaceGlobals = /* js */ `
    result.callsToTheReplacements = { setImmediate: 0, clearImmediate: 0, queueMicrotask: 0 };
    for (const name in result.callsToTheReplacements) {
      globalThis[name] = () => void result.callsToTheReplacements[name]++;
    }
  `;
  const deleteGlobals = /* js */ `
    delete globalThis.setImmediate;
    delete globalThis.clearImmediate;
    delete globalThis.queueMicrotask;
  `;
  // Each built-in here hands work to one of the three functions. All of that
  // work is done by the time the process exits.
  const useBuiltins = /* js */ `
    new PerformanceObserver(list => {
      result.performanceObserver = list.getEntries().map(entry => entry.name);
    }).observe({ entryTypes: ["function"] });
    performance.timerify(function timerified() {})();

    events.addAbortListener(AbortSignal.abort(), () => {
      result.abortListener = "called";
    });

    fs.watch(process.cwd(), { signal: AbortSignal.abort() }).on("close", () => {
      result.watcher = "closed";
    });

    timersPromises.setImmediate("resolved").then(value => {
      result.timersPromises = value;
    });

    const controller = new AbortController();
    timersPromises.setImmediate("unreachable", { signal: controller.signal }).catch(error => {
      result.abortedTimersPromises = error.name;
    });
    controller.abort();

    result.nodeTimers = {
      setImmediate: timers.setImmediate === original.setImmediate,
      clearImmediate: timers.clearImmediate === original.clearImmediate,
    };
    process.on("exit", () => console.log(JSON.stringify(result)));
  `;
  const delivered = {
    performanceObserver: ["timerified"],
    abortListener: "called",
    watcher: "closed",
    timersPromises: "resolved",
    abortedTimersPromises: "AbortError",
    nodeTimers: { setImmediate: true, clearImmediate: true },
  };
  const deliveredPastTheReplacements = {
    ...delivered,
    callsToTheReplacements: { setImmediate: 0, clearImmediate: 0, queueMicrotask: 0 },
  };

  it.each([
    [
      "replaced after the modules are loaded",
      "entry.cjs",
      keepOriginals + requireModules + replaceGlobals + useBuiltins,
      deliveredPastTheReplacements,
    ],
    [
      "replaced before the modules are loaded",
      "entry.cjs",
      keepOriginals + replaceGlobals + requireModules + useBuiltins,
      deliveredPastTheReplacements,
    ],
    [
      "deleted before the modules are loaded",
      "entry.cjs",
      keepOriginals + deleteGlobals + requireModules + useBuiltins,
      delivered,
    ],
    [
      "replaced in an ES module",
      "entry.mjs",
      importModules + keepOriginals + replaceGlobals + useBuiltins,
      deliveredPastTheReplacements,
    ],
  ])("with the globals %s", async (_, file, source, expected) => {
    const { stdout, ...exit } = await run(file, source);
    expect({ result: stdout && JSON.parse(stdout), ...exit }).toEqual({ result: expected, ...exitedCleanly });
  });

  it("node:test's mock.timers for setImmediate does not hold back a PerformanceObserver", async () => {
    const result = await run(
      "entry.cjs",
      /* js */ `
        const { PerformanceObserver, performance } = require("node:perf_hooks");
        require("node:test").mock.timers.enable({ apis: ["setImmediate"] });
        new PerformanceObserver(list => {
          console.log(list.getEntries().map(entry => entry.name).join());
        }).observe({ entryTypes: ["function"] });
        performance.timerify(function timerified() {})();
      `,
    );
    expect(result).toEqual({ stdout: "timerified", ...exitedCleanly });
  });

  // A socket's 'close' is scheduled with setImmediate. The two close orders
  // are the tests of https://github.com/oven-sh/bun/pull/44366.
  it("a net.Socket emits 'close' with setImmediate replaced before node:net is loaded", async () => {
    const { stdout, ...exit } = await run(
      "entry.cjs",
      /* js */ `
        require("node:timers").setImmediate = globalThis.setImmediate = () => {};
        const net = require("node:net");
        const result = {};
        function closeOrder(name, onConnection, onConnect) {
          const seen = (result[name] = []);
          const server = net.createServer(socket => {
            server.close();
            socket.resume();
            onConnection(socket);
          });
          server.listen(0, "127.0.0.1", () => {
            const client = net.connect(server.address().port, "127.0.0.1");
            client.resume();
            client.on("connect", () => onConnect(client));
            client.on("end", () => seen.push("end"));
            client.on("finish", () => seen.push("finish"));
            client.on("close", hadError => seen.push("close:" + hadError));
          });
        }
        closeOrder(
          "ended by the peer",
          socket => socket.end("hello"),
          () => {},
        );
        closeOrder(
          "ended by the socket itself",
          socket => socket.on("end", () => socket.end()),
          client => client.end("hello"),
        );
        process.on("exit", () => console.log(JSON.stringify(result)));
      `,
    );
    expect({ result: stdout && JSON.parse(stdout), ...exit }).toEqual({
      result: {
        "ended by the peer": ["end", "finish", "close:false"],
        "ended by the socket itself": ["finish", "end", "close:false"],
      },
      ...exitedCleanly,
    });
  });

  it("http2 sessions over TCP and over a Duplex close with setImmediate replaced", async () => {
    // A session whose close was handed to the replaced function never closes
    // and keeps the process alive, so the child has a deadline. Over a Duplex
    // the session also defers each write callback by one setImmediate.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
          const http2 = require("node:http2");
          const { duplexPair } = require("node:stream");
          globalThis.setImmediate = () => {};
          const respond = stream => {
            stream.respond({ ":status": 200 });
            stream.end("ok");
          };

          const overTcp = http2.createServer().on("stream", respond);
          overTcp.on("close", () => console.log("tcp: server closed"));
          overTcp.listen(0, "127.0.0.1", () => {
            const client = http2.connect("http://127.0.0.1:" + overTcp.address().port);
            client.on("close", () => console.log("tcp: session closed"));
            const req = client.request({ ":path": "/" });
            req.resume();
            req.on("close", () => {
              console.log("tcp: stream closed");
              client.close();
              overTcp.close();
            });
          });

          const [clientSide, serverSide] = duplexPair();
          http2.createServer().on("stream", respond).emit("connection", serverSide);
          const client = http2.connect("http://localhost", { createConnection: () => clientSide });
          client.on("close", () => console.log("duplex: session closed"));
          const req = client.request({ ":path": "/", ":method": "POST" });
          req.end("hello", () => console.log("duplex: request body written"));
          req.resume();
          req.on("end", () => console.log("duplex: response ended"));
          req.on("close", () => {
            console.log("duplex: stream closed");
            client.close();
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      events: stdout.split(/\r?\n/).filter(Boolean).sort(),
      stderr: stderr.trim(),
      exitCode,
      signalCode: proc.signalCode,
    }).toEqual({
      events: [
        "duplex: request body written",
        "duplex: response ended",
        "duplex: session closed",
        "duplex: stream closed",
        "tcp: server closed",
        "tcp: session closed",
        "tcp: stream closed",
      ],
      ...exitedCleanly,
    });
  }, 30_000);

  it("the public globals keep their name, length and attributes", () => {
    const shape = {};
    for (const name of ["setImmediate", "clearImmediate", "queueMicrotask"]) {
      const { value, ...attributes } = Object.getOwnPropertyDescriptor(globalThis, name);
      shape[name] = { name: value.name, length: value.length, ...attributes };
    }
    const attributes = { length: 1, writable: true, enumerable: true, configurable: true };
    expect(shape).toEqual({
      setImmediate: { name: "setImmediate", ...attributes },
      clearImmediate: { name: "clearImmediate", ...attributes },
      queueMicrotask: { name: "queueMicrotask", ...attributes },
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
