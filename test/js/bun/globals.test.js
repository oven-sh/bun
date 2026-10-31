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

  // The flag is the process's, as in Node.js, where it is V8's: each global object made in a process that has it has
  // `gc`.
  describe.concurrent("in each global object of the process", () => {
    /**
     * @param {string[]} cmd
     * @param {{ cwd?: string, env?: Record<string, string> }} [options]
     */
    const run = async (cmd, { cwd, env } = {}) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...cmd],
        env: { ...bunEnv, BUN_OPTIONS: undefined, ...env },
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    };

    const withAndWithoutTheFlag = [
      { flags: ["--expose-gc"], type: "function" },
      { flags: [], type: "undefined" },
    ];

    const typeofGcInEachKind = /* js */ `
      const vm = require("node:vm");
      const { Worker } = require("node:worker_threads");
      const inWorker = options => {
        const { promise, resolve, reject } = Promise.withResolvers();
        const source = "require('node:worker_threads').parentPort.postMessage(typeof gc)";
        new Worker(source, { eval: true, ...options }).once("message", resolve).once("error", reject);
        return promise;
      };
      const [worker, workerWithOwnExecArgv] = await Promise.all([inWorker({}), inWorker({ execArgv: [] })]);
      console.log(
        JSON.stringify({
          main: typeof gc,
          shadowRealm: new ShadowRealm().evaluate("typeof gc"),
          vmNewContext: vm.runInNewContext("typeof gc"),
          vmContext: vm.runInContext("typeof gc", vm.createContext({})),
          vmSandboxKey: vm.runInNewContext("typeof gc", { gc: 1 }),
          worker,
          workerWithOwnExecArgv,
        }),
      );
    `;

    it.each(withAndWithoutTheFlag)("typeof gc is $type with the flags $flags", async ({ flags, type }) => {
      expect(await run([...flags, "-e", typeofGcInEachKind])).toEqual({
        stdout: JSON.stringify({
          main: type,
          shadowRealm: type,
          vmNewContext: type,
          vmContext: type,
          // A name of the sandbox hides the one of the global object.
          vmSandboxKey: "number",
          worker: type,
          workerWithOwnExecArgv: type,
        }),
        stderr: "",
        exitCode: 0,
      });
    });

    it.each(withAndWithoutTheFlag)("bun repl: typeof gc is $type with the flags $flags", async ({ flags, type }) => {
      expect(await run(["repl", ...flags, "-e", "console.log(typeof gc)"])).toEqual({
        stdout: type,
        stderr: "",
        exitCode: 0,
      });
    });

    it("gc() returns where the global object is not the main one", async () => {
      const script = /* js */ `
        const vm = require("node:vm");
        const { Worker } = require("node:worker_threads");
        const returned = [vm.runInNewContext("typeof gc()"), new ShadowRealm().evaluate("typeof gc()")];
        const source = "require('node:worker_threads').parentPort.postMessage(typeof gc())";
        new Worker(source, { eval: true }).once("message", inWorker => console.log([...returned, inWorker].join()));
      `;
      expect(await run(["--expose-gc", "-e", script])).toEqual({
        stdout: "undefined,undefined,undefined",
        stderr: "",
        exitCode: 0,
      });
    });

    // test/harness.ts defines its own `gc` over this one.
    it("is writable and configurable, and not enumerable", async () => {
      const descriptor = "JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, 'gc'))";
      expect(await run(["--expose-gc", "-p", descriptor])).toEqual({
        stdout: JSON.stringify({ writable: true, enumerable: false, configurable: true }),
        stderr: "",
        exitCode: 0,
      });
    });

    describe("of bun test", () => {
      const files = {
        "preload.ts": `console.log("preload:", typeof gc);`,
        "a.test.ts": `
          import { test } from "bun:test";
          test("a", () => {
            console.log("a:", typeof gc);
            // The next file reads this only where it runs in the same global object.
            globalThis.gc = "replaced";
          });
        `,
        "b.test.ts": `
          import { test } from "bun:test";
          test("b", () => console.log("b:", typeof gc));
        `,
        "node.test.mjs": `
          import { test } from "node:test";
          test("node", () => console.log("node:", typeof gc));
        `,
        "runner.mjs": `
          import { run } from "node:test";
          const events = run({ files: ["./a.test.ts"], execArgv: ["--expose-gc"] });
          events.on("test:stdout", ({ message }) => process.stdout.write(message));
        `,
      };

      /**
       * The lines that the preload and the test files print.
       * @param {string[]} cmd
       * @param {Record<string, string>} [env]
       */
      const typeofGcInTestFiles = async (cmd, env) => {
        using dir = tempDir("expose-gc-bun-test", files);
        const { stdout, stderr, exitCode } = await run(cmd, { cwd: String(dir), env });
        // The output of a --parallel worker is relayed on the coordinator's stderr.
        const printed = `${stdout}\n${stderr}`.split(/\r?\n/).filter(line => /^(preload|a|b|node): /.test(line));
        return { printed, exitCode };
      };

      it.each([
        { where: "before `test`", cmd: ["--expose-gc", "test", "./a.test.ts"] },
        { where: "after `test`", cmd: ["test", "--expose-gc", "./a.test.ts"] },
        { where: "after the file", cmd: ["test", "./a.test.ts", "--expose-gc"] },
      ])("the flag $where", async ({ cmd }) => {
        expect(await typeofGcInTestFiles(cmd)).toEqual({ printed: ["a: function"], exitCode: 0 });
      });

      it("the flag in BUN_OPTIONS", async () => {
        const ran = await typeofGcInTestFiles(["test", "./a.test.ts"], { BUN_OPTIONS: "--expose-gc" });
        expect(ran).toEqual({ printed: ["a: function"], exitCode: 0 });
      });

      it("no flag", async () => {
        expect(await typeofGcInTestFiles(["test", "./a.test.ts"])).toEqual({ printed: ["a: undefined"], exitCode: 0 });
      });

      it("a node:test file", async () => {
        const ran = await typeofGcInTestFiles(["test", "--expose-gc", "./node.test.mjs"]);
        expect(ran).toEqual({ printed: ["node: function"], exitCode: 0 });
      });

      it("a preload and the files share one global object", async () => {
        const cmd = ["test", "--expose-gc", "--preload", "./preload.ts", "./a.test.ts", "./b.test.ts"];
        expect(await typeofGcInTestFiles(cmd)).toEqual({
          printed: ["preload: function", "a: function", "b: string"],
          exitCode: 0,
        });
      });

      it("--isolate gives the global object of each file its own", async () => {
        const cmd = ["test", "--expose-gc", "--isolate", "--preload", "./preload.ts", "./a.test.ts", "./b.test.ts"];
        expect(await typeofGcInTestFiles(cmd)).toEqual({
          printed: ["preload: function", "a: function", "preload: function", "b: function"],
          exitCode: 0,
        });
      });

      it.each(withAndWithoutTheFlag)("--parallel workers with the flags $flags", async ({ flags, type }) => {
        const cmd = ["test", ...flags, "--parallel=2", "--preload", "./preload.ts", "./a.test.ts", "./b.test.ts"];
        const { printed, exitCode } = await typeofGcInTestFiles(cmd, { BUN_TEST_PARALLEL_SCALE_MS: "0" });
        expect({ printed: printed.sort(), exitCode }).toEqual({
          printed: [`a: ${type}`, `b: ${type}`, `preload: ${type}`, `preload: ${type}`],
          exitCode: 0,
        });
      });

      it("a file that node:test run() starts with the flag in execArgv", async () => {
        expect(await typeofGcInTestFiles(["runner.mjs"])).toEqual({ printed: ["a: function"], exitCode: 0 });
      });
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
});
