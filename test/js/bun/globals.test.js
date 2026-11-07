import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

describe.concurrent("builtin modules read the native classes and objects, not the properties of globalThis", () => {
  async function run(script) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  it("every module loads with all those globals replaced and exports the native ones", async () => {
    const result = await run(`
      const ecmascript = new Set(require("node:vm").runInNewContext("Object.getOwnPropertyNames(globalThis)"));
      const names = Object.getOwnPropertyNames(globalThis).filter(name =>
        ecmascript.has(name)
          ? /.Array$|ArrayBuffer$/.test(name)
          : name !== "Bun" && /^[A-Z]|^(crypto|navigator|performance)$/.test(name),
      );
      const natives = {};
      for (const name of names) natives[name] = globalThis[name];
      for (const name of names) {
        globalThis[name] = class {
          constructor() {
            throw new Error(name + " was read from globalThis");
          }
        };
      }
      const ofTheirOwn = ["cluster.Worker", "worker_threads.Worker", "perf_hooks.PerformanceObserver", "ws.WebSocket"];
      const exported = [];
      const replaced = [];
      for (const id of require("node:module").builtinModules) {
        if (/^bun|^_|^(wasi|repl|inspector|trace_events)/.test(id)) continue;
        const exports = require(id);
        for (const name of names) {
          if (!Object.hasOwn(exports, name) || ofTheirOwn.includes(id + "." + name)) continue;
          // undici's WebSocket extends the native one.
          const isNative = exports[name] === natives[name] || Object.getPrototypeOf(exports[name]) === natives[name];
          (isNative ? exported : replaced).push(id + "." + name);
        }
      }
      console.log(JSON.stringify({ names, exported, replaced }));
    `);
    expect(result.replaced).toEqual([]);
    expect(result.names).toContain("Blob");
    expect(result.names).toContain("Uint8Array");
    expect(result.names).toContain("navigator");
    expect(result.exported).toContain("buffer.Blob");
    expect(result.exported).toContain("http.WebSocket");
    expect(result.exported).toContain("perf_hooks.Performance");
    expect(result.exported).toContain("stream/web.TextDecoderStream");
    expect(result.exported).toContain("undici.WebSocket");
    expect(result.exported).toContain("url.URL");
    expect(result.exported).toContain("util.TextDecoder");
    expect(result.exported).toContain("worker_threads.MessageChannel");
  });

  it("each realm uses its own native classes", async () => {
    expect(
      await run(`
        const NativeURL = URL;
        globalThis.URL = class {};
        const { pathToFileURL } = require("node:url");
        const inRealm = \`
          const NativeURL = URL;
          globalThis.URL = class {};
          const check = url => url.URL === NativeURL && url.pathToFileURL("/x") instanceof NativeURL;
        \`;
        const worker = new (require("node:worker_threads").Worker)(
          inRealm + 'require("node:worker_threads").parentPort.postMessage(check(require("node:url")))',
          { eval: true },
        );
        Promise.all([
          require("node:vm").runInNewContext("pathToFileURL('/x')", { pathToFileURL }) instanceof NativeURL,
          new Promise(new ShadowRealm().evaluate("resolve => {" + inRealm + 'import("node:url").then(url => resolve(check(url))) }')),
          new Promise((resolve, reject) => worker.on("message", resolve).on("error", reject)),
        ]).then(([calledFromContext, inShadowRealm, inWorker]) =>
          console.log(JSON.stringify({ calledFromContext, inShadowRealm, inWorker })),
        );
      `),
    ).toEqual({ calledFromContext: true, inShadowRealm: true, inWorker: true });
  });

  it("without creating classes that nothing has used", async () => {
    expect(
      await run(`
        for (const id of ["fs", "path", "events", "os", "timers"]) require("node:" + id);
        const { objectTypeCounts } = require("bun:jsc").heapStats();
        const classes = ["AbortController", "Blob", "Event", "Headers", "Performance", "Response", "TextDecoder", "URL"];
        const before = classes.filter(name => objectTypeCounts[name]);
        require("node:url").pathToFileURL("/x");
        console.log(JSON.stringify({ before, after: classes.filter(name => require("bun:jsc").heapStats().objectTypeCounts[name]) }));
      `),
    ).toEqual({ before: [], after: ["URL"] });
  });

  it("from an object user code can't reach", async () => {
    expect(
      await run(`
        // This script is in process.execArgv.
        const className = "Native" + "Globals";
        const receivers = [];
        for (const name of ["natives", "@natives", "Blob", "URL", "TextDecoder", "performance", "navigator"]) {
          Object.defineProperty(Object.prototype, name, {
            get() {
              receivers.push(this);
            },
            set() {
              receivers.push(this);
            },
          });
        }
        for (const Class of [URL, Blob, TextDecoder]) {
          Object.defineProperty(Class, Symbol.hasInstance, {
            value() {
              receivers.push(this);
              return false;
            },
          });
        }
        const { blob, text } = require("node:stream/consumers");
        const { Readable } = require("node:stream");
        Promise.all([blob(Readable.from([Buffer.from("a")])), text(Readable.from([Buffer.from("a")]))]).then(() => {
          require("node:url").pathToFileURL("/x");
          try {
            require("node:url").fileURLToPath({});
          } catch {}
          require("node:os").availableParallelism();
          require("node:perf_hooks").performance.timerify(() => {})();
          console.log(
            JSON.stringify({
              objects: require("bun:jsc").heapStats().objectTypeCounts[className],
              isKey: Reflect.ownKeys(globalThis).some(key => String(key.description ?? key).includes("natives")),
              isPrinted: Bun.inspect(globalThis, { showHidden: true, depth: 1 }).includes(className),
              isReceiver: receivers.some(receiver => Object.getPrototypeOf(Object(receiver)) === null),
              receivers: receivers.map(receiver => receiver.name),
            }),
          );
        });
      `),
    ).toEqual({ objects: 1, isKey: false, isPrinted: false, isReceiver: false, receivers: ["URL"] });
  });

  // One at a time, after the tests above: those take seconds in a debug build when more processes run beside them.
  describe.serial("and the native timers, atob and btoa", () => {
    const timers = ["setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate"];
    const names = [...timers, "atob", "btoa"];

    it("node:timers and node:buffer export them after the globals were replaced", async () => {
      expect(
        await run(`
          const exported = { timers: ${JSON.stringify(timers)}, buffer: ["atob", "btoa"] };
          const natives = {};
          for (const name of ${JSON.stringify(names)}) {
            natives[name] = globalThis[name];
            globalThis[name] = function replaced() {
              throw new Error(name + " was read from globalThis");
            };
          }
          const whose = (name, value) =>
            value === natives[name] ? "native" : value === globalThis[name] ? "replaced" : typeof value;
          const result = {};
          for (const [id, names] of Object.entries(exported)) {
            for (const name of names) result[id + "." + name] = whose(name, require("node:" + id)[name]);
          }
          Promise.all([import("node:timers"), import("node:buffer")]).then(([timers, buffer]) => {
            result["import { setTimeout }"] = whose("setTimeout", timers.setTimeout);
            result["import { atob }"] = whose("atob", buffer.atob);
            console.log(JSON.stringify(result));
          });
        `),
      ).toEqual({
        "timers.setTimeout": "native",
        "timers.setInterval": "native",
        "timers.setImmediate": "native",
        "timers.clearTimeout": "native",
        "timers.clearInterval": "native",
        "timers.clearImmediate": "native",
        "buffer.atob": "native",
        "buffer.btoa": "native",
        "import { setTimeout }": "native",
        "import { atob }": "native",
      });
    });

    it.each([
      ["assigned", "globalThis[name] = function replaced() {}"],
      ["deleted", "delete globalThis[name]"],
      [
        "made getters that throw",
        `Object.defineProperty(globalThis, name, {
          get() {
            getters++;
            throw new Error(name + " was read from globalThis");
          },
          configurable: true,
        })`,
      ],
    ])("also when the globals were %s before anything read them", async (_, replace) => {
      expect(
        await run(`
          const names = ${JSON.stringify(names)};
          let getters = 0;
          for (const name of names) ${replace};
          // Not named \`timers\` and \`buffer\`: with -e those are globals, and declaring them loads the modules before this script runs.
          const nodeTimers = require("node:timers");
          const nodeBuffer = require("node:buffer");
          const fired = [];
          const interval = nodeTimers.setInterval(() => (fired.push("interval"), nodeTimers.clearInterval(interval)), 1);
          nodeTimers.clearTimeout(nodeTimers.setTimeout(() => fired.push("cleared timeout"), 1));
          nodeTimers.clearImmediate(nodeTimers.setImmediate(() => fired.push("cleared immediate")));
          nodeTimers.setImmediate(() => fired.push("immediate"));
          nodeTimers.setTimeout(() => fired.push("timeout"), 1);
          process.on("exit", () =>
            console.log(
              JSON.stringify({
                exported: names.map(name => (nodeTimers[name] ?? nodeBuffer[name])?.name),
                fired: fired.sort(),
                base64: [nodeBuffer.btoa("hi"), nodeBuffer.atob("aGk=")],
                getters,
              }),
            ),
          );
        `),
      ).toEqual({ exported: names, fired: ["immediate", "interval", "timeout"], base64: ["aGk=", "hi"], getters: 0 });
    });

    it("node:timers/promises schedules with them after the globals were replaced", async () => {
      expect(
        await run(`
          const fakes = [];
          for (const name of ${JSON.stringify(timers)}) globalThis[name] = () => void fakes.push(name);
          const timersPromises = require("node:timers/promises");
          const settled = [];
          const settle = value => void settled.push(value);
          timersPromises.setTimeout(1, "setTimeout").then(settle);
          timersPromises.setImmediate("setImmediate").then(settle);
          timersPromises.scheduler.wait(1).then(() => settle("scheduler.wait"));
          timersPromises.scheduler.yield().then(() => settle("scheduler.yield"));
          (async () => {
            for await (const value of timersPromises.setInterval(1, "setInterval")) return settle(value);
          })();
          require("node:util").promisify(require("node:timers").setTimeout)(1, "promisify").then(settle);
          require("node:timers").promises.setTimeout(1, "timers.promises").then(settle);
          // A real timer that the abort doesn't clear keeps the process alive for a day.
          const controller = new AbortController();
          timersPromises.setTimeout(86_400_000, null, { signal: controller.signal }).catch(error => settle(error.name));
          controller.abort();
          process.on("exit", () => console.log(JSON.stringify({ settled: settled.sort(), fakes })));
        `),
      ).toEqual({
        settled: [
          "AbortError",
          "promisify",
          "scheduler.wait",
          "scheduler.yield",
          "setImmediate",
          "setInterval",
          "setTimeout",
          "timers.promises",
        ],
        fakes: [],
      });
    });

    it("each realm exports its own", async () => {
      expect(
        await run(`
          const inRealm = \`(() => {
            const native = setTimeout;
            globalThis.setTimeout = () => {};
            return require("node:timers").setTimeout === native;
          })()\`;
          const inMain = eval(inRealm);
          const worker = new (require("node:worker_threads").Worker)(
            'require("node:worker_threads").parentPort.postMessage(' + inRealm + ")",
            { eval: true },
          );
          worker.on("message", inWorker => console.log(JSON.stringify({ inMain, inWorker })));
        `),
      ).toEqual({ inMain: true, inWorker: true });
    });

    it.each([
      ["the modules", "[exported(), globals()]"],
      ["the globals", "[globals(), exported()].reverse()"],
    ])("they are the functions on globalThis, with %s read first", async (_, inOrder) => {
      expect(
        await run(`
          const names = ${JSON.stringify(names)};
          const exported = () => names.map(name => (require("node:timers")[name] ?? require("node:buffer")[name]));
          const globals = () => names.map(name => globalThis[name]);
          const [fromModules, fromGlobalThis] = ${inOrder};
          console.log(
            JSON.stringify({
              different: names.filter((name, i) => fromModules[i] !== fromGlobalThis[i]),
              properties: [...names, "queueMicrotask"].map(name => {
                const { value, ...attributes } = Object.getOwnPropertyDescriptor(globalThis, name);
                return [value.name, value.length, ...Object.keys(attributes).filter(key => attributes[key])].join(" ");
              }),
              keys: Object.keys(globalThis).filter(key => names.includes(key) || key === "queueMicrotask"),
            }),
          );
        `),
      ).toEqual({
        different: [],
        properties: [...names, "queueMicrotask"].map(name => `${name} 1 writable enumerable configurable`),
        keys: [...names, "queueMicrotask"].sort(),
      });
    });

    it("a static import gets them after a preload replaced the globals", async () => {
      using dir = tempDir("native-functions-preload", {
        "preload.js": `
          globalThis.natives = {};
          for (const name of ${JSON.stringify(names)}) {
            natives[name] = globalThis[name];
            globalThis[name] = function replaced() {
              throw new Error(name + " was read from globalThis");
            };
          }
        `,
        "main.mjs": `
          import { atob, btoa } from "node:buffer";
          import * as timers from "node:timers";
          import { setTimeout as sleep } from "node:timers/promises";
          console.log(
            JSON.stringify({
              replaced: Object.keys(natives).filter(name => ({ ...timers, atob, btoa })[name] !== natives[name]),
              slept: await sleep(1, "slept"),
            }),
          );
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--preload", "./preload.js", "main.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: JSON.stringify({ replaced: [], slept: "slept" }) + "\n",
        stderr: "",
        exitCode: 0,
      });
    });
  });
});
