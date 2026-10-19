import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `*` makes every built-in immutable; `,-name` after it leaves that global as it is and, if it is a function, its prototype.

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
  test("`*` covers every built-in", async () => {
    const { stdout, stderr, exitCode } = await run("*", [
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
        // Bun's
        "Headers.prototype.get = 1",
        "Headers.prototype.get.call = 1",
        "Response.json = 1",
        "Request.prototype.fresh = 1",
        "Buffer.from = 1",
        "Buffer.prototype.fresh = 1",
        "Bun.serve = 1",
        "Bun.serve.fresh = 1",
        "Bun.fresh = 1",
        "process.fresh = 1",
        "process.exit = 1",
        "fetch.fresh = 1",
        // The global object itself: no global can be added, replaced or deleted
        "globalThis.fresh = 1",
        "globalThis.Array = 1",
        "globalThis.JSON = {}",
        "globalThis.fetch = 1",
        "delete globalThis.Bun",
        // A program's own objects can still shadow what they inherit from a built-in
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
      TypeError   Request.prototype.fresh = 1
      TypeError   Buffer.from = 1
      TypeError   Buffer.prototype.fresh = 1
      TypeError   Bun.serve = 1
      TypeError   Bun.serve.fresh = 1
      TypeError   Bun.fresh = 1
      TypeError   process.fresh = 1
      TypeError   process.exit = 1
      TypeError   fetch.fresh = 1
      TypeError   globalThis.fresh = 1
      TypeError   globalThis.Array = 1
      TypeError   globalThis.JSON = {}
      TypeError   globalThis.fetch = 1
      TypeError   delete globalThis.Bun
      ok          ({}).toString = 1
      ok          (class extends Array {}).prototype.map = 1
      ok          new Error('x').name = 'y'
      ok          (function () {}).call = 1
      "
    `);
    expect(exitCode).toBe(0);
  });

  test("`,-name` leaves a global as it is", async () => {
    const { stdout, stderr, exitCode } = await run(
      "*,-globalThis,-process,-Response,-Error,-Math,-noSuchGlobal,-constructor",
      [
        "-e",
        attempts([
          "globalThis.fresh = 1",
          "globalThis.fetch = fetch",
          "process.fresh = 1",
          "process.exit = process.exit",
          "process.exit.fresh = 1",
          "Response.json = Response.json",
          "Response.prototype.fresh = 1",
          "Response.prototype.text.fresh = 1",
          "Error.stackTraceLimit = 20",
          "Error.prototype.fresh = 1",
          "Math.random = () => 0.5",
          // Everything else is covered.
          "Request.prototype.fresh = 1",
          "TypeError.prototype.fresh = 1",
          "Object.getPrototypeOf(process).fresh = 1",
          "fetch.fresh = 1",
          "Bun.fresh = 1",
          "JSON.parse = 1",
          // `constructor` is a name the global object only inherits.
          "Object.fresh = 1",
          "Object.prototype.fresh = 1",
        ]),
      ],
    );
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
      "ok          globalThis.fresh = 1
      ok          globalThis.fetch = fetch
      ok          process.fresh = 1
      ok          process.exit = process.exit
      ok          process.exit.fresh = 1
      ok          Response.json = Response.json
      ok          Response.prototype.fresh = 1
      ok          Response.prototype.text.fresh = 1
      ok          Error.stackTraceLimit = 20
      ok          Error.prototype.fresh = 1
      ok          Math.random = () => 0.5
      TypeError   Request.prototype.fresh = 1
      TypeError   TypeError.prototype.fresh = 1
      TypeError   Object.getPrototypeOf(process).fresh = 1
      TypeError   fetch.fresh = 1
      TypeError   Bun.fresh = 1
      TypeError   JSON.parse = 1
      TypeError   Object.fresh = 1
      TypeError   Object.prototype.fresh = 1
      "
    `);
    expect(exitCode).toBe(0);
  });

  test.each(["Array", "-Array", "*,Array", "* ,-Array", ",", ",*", "*,", "*,,-Array"])(
    "a value of another form is an error: %s",
    async value => {
      const { stdout, stderr, exitCode } = await run(value, ["-e", "console.log('ran')"]);
      expect(stderr).toContain(
        "ERROR: immutableGlobals is '*', followed by ',-name' for each global to leave mutable: " + value,
      );
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    },
  );

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

  test("a script cannot declare a global", async () => {
    using dir = tempDir("immutable-globals-global-object", {
      "index.mjs":
        `import { runInThisContext } from "node:vm";` +
        attempts([
          "var declared",
          "function declared() {}",
          "let declared",
          "class declared {}",
          "{ let inBlock }",
        ]).replace(`(0, eval)('"use strict";' + expression)`, `runInThisContext(expression)`),
    });
    const { stdout, stderr, exitCode } = await run("*", ["index.mjs"], String(dir));
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
      "TypeError   var declared
      TypeError   function declared() {}
      SyntaxError let declared
      SyntaxError class declared {}
      ok          { let inBlock }
      "
    `);
    expect(exitCode).toBe(0);
  });

  test("what Bun adds to the global object after it is created is there", async () => {
    expect(
      await run("*", [
        "--expose-gc",
        "-e",
        `console.log(typeof require("fs").readFileSync, typeof module, typeof fs.readFileSync, typeof gc, Object.isExtensible(gc))`,
      ]),
    ).toEqual({
      stdout: "function object function function false\n",
      stderr: "",
      exitCode: 0,
    });
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

  describe("what Bun creates on first use", () => {
    // Prints which of these are still extensible. Most have no global name, and do not exist when the option is applied.
    const fixture = /* js */ `
      import crypto from "node:crypto";
      import fs from "node:fs";
      import { File as FileOfNodeBuffer } from "node:buffer";
      import { createRequire } from "node:module";
      import net from "node:net";
      import "node:perf_hooks";
      import { MessagePort } from "node:worker_threads";
      const prototypeOf = Object.getPrototypeOf;
      const require = createRequire(import.meta.url);
      let nodeError;
      try { fs.readFileSync(1.5); } catch (error) { nodeError = error; }
      let element, sinkController;
      await new HTMLRewriter().on("p", { element(e) { element = e; } }).transform(new Response("<p>")).text();
      const direct = new ReadableStream({ type: "direct", pull(c) { sinkController = c; c.close(); } });
      await Bun.write(process.argv[2], new Response(direct));
      const timeout = setTimeout(() => {}, 0), immediate = setImmediate(() => {});
      clearTimeout(timeout), clearImmediate(immediate);
      const subprocess = Bun.spawn([process.execPath, "--version"], { stdout: "ignore" });
      await subprocess.exited;
      const objects = {
        "Headers iterator": prototypeOf(new Headers().entries()),
        "Headers iterator next()": prototypeOf(new Headers().entries()).next,
        "FormData iterator": prototypeOf(new FormData().entries()),
        "URLSearchParams iterator": prototypeOf(new URLSearchParams().entries()),
        "ReadableStream async iterator": prototypeOf(new ReadableStream().values()),
        "HTMLRewriter element": prototypeOf(element),
        "setTimeout() result": prototypeOf(timeout),
        "setImmediate() result": prototypeOf(immediate),
        "Bun.CookieMap iterator": prototypeOf(new Bun.CookieMap().entries()),
        "sink controller": prototypeOf(sinkController),
        "sink controller write()": prototypeOf(sinkController).write,
        "Bun.file().writer()": prototypeOf(Bun.file(process.argv[2]).writer()),
        "Bun.file().writer() constructor": prototypeOf(Bun.file(process.argv[2]).writer()).constructor,
        "Bun.spawn() result": prototypeOf(subprocess),
        "Bun.spawn() result kill()": prototypeOf(subprocess).kill,
        "fs.statSync() result": prototypeOf(fs.statSync(process.argv[2])),
        "fs.statfsSync() result": prototypeOf(fs.statfsSync(process.argv[2])),
        "require": prototypeOf(require),
        "require.resolve": prototypeOf(require.resolve),
        "ERR_INVALID_ARG_TYPE": prototypeOf(nodeError),
        "PublicKeyObject's parent": prototypeOf(prototypeOf(crypto.generateKeyPairSync("ed25519").publicKey)),
        "node:buffer's File": FileOfNodeBuffer,
        "node:buffer's File.prototype": FileOfNodeBuffer.prototype,
        // Built-in modules add to these as they load.
        "process's prototype": prototypeOf(process),
        "crypto.ECDH.prototype": crypto.ECDH.prototype,
        "crypto.ECDH.prototype.setPublicKey()": crypto.ECDH.prototype.setPublicKey,
        "Performance.prototype.timerify()": Performance.prototype.timerify,
        "MessagePort.prototype.close()": MessagePort.prototype.close,
        "MessagePort.prototype's parent": prototypeOf(MessagePort.prototype),
        "MessagePort.prototype's parent's on()": prototypeOf(MessagePort.prototype).on,
        "net.SocketAddress.prototype": net.SocketAddress.prototype,
        "net.BlockList.prototype": net.BlockList.prototype,
        "Bun.password": Bun.password,
        "Bun.password.hash()": Bun.password.hash,
        "Bun.dns": Bun.dns,
        "Bun.semver": Bun.semver,
        "Bun.TOML": Bun.TOML,
        "Bun.FFI": Bun.FFI,
        "Bun.FFI.read": Bun.FFI.read,
        "Bun.FFI.read.u8()": Bun.FFI.read.u8,
        "process.versions": process.versions,
        "process.report": process.report,
        "process.config.variables": process.config.variables,
        // These hold state, so they stay mutable.
        "Bun.env": Bun.env,
        "Bun.argv": Bun.argv,
        "Bun.stdout": Bun.stdout,
        "process.argv": process.argv,
        // Each of these follows the opt-out of its own global, not -Bun or -process.
        "Request.prototype": Request.prototype,
        "Buffer.prototype": Buffer.prototype,
        "Object.prototype": Object.prototype,
        "Function.prototype": Function.prototype,
      };
      const stillExtensible = Object.keys(objects).filter(name => Object.isExtensible(objects[name]));
      if (stillExtensible.length === Object.keys(objects).length) console.log("immutable: 0");
      else console.log(JSON.stringify(stillExtensible, null, 2));
    `;
    const state = ["Bun.env", "Bun.argv", "Bun.stdout", "process.argv"];
    const partOfBunOrProcess = [
      "Bun.password",
      "Bun.password.hash()",
      "Bun.dns",
      "Bun.semver",
      "Bun.TOML",
      "Bun.FFI",
      "Bun.FFI.read",
      "Bun.FFI.read.u8()",
      "process.versions",
      "process.report",
      "process.config.variables",
    ];

    test.each([
      ["*", state],
      ["*,-Bun,-process,-Request,-Object", [...partOfBunOrProcess, ...state, "Request.prototype", "Object.prototype"]],
    ])("is immutable: %s", async (immutableGlobals, stillExtensible) => {
      using dir = tempDir("immutable-globals", { "fixture.mjs": fixture, "file.txt": "" });
      const { stdout, stderr, exitCode } = await run(immutableGlobals, ["fixture.mjs", "file.txt"], String(dir));
      expect({ stillExtensible: JSON.parse(stdout), stderr, exitCode }).toEqual({
        stillExtensible,
        stderr: "",
        exitCode: 0,
      });
    });

    test("is not without the option", async () => {
      using dir = tempDir("immutable-globals", { "fixture.mjs": fixture, "file.txt": "" });
      const { stdout, stderr, exitCode } = await run(undefined, ["fixture.mjs", "file.txt"], String(dir));
      expect({ immutable: stdout.includes("immutable: 0\n"), stderr, exitCode }).toEqual({
        immutable: true,
        stderr: "",
        exitCode: 0,
      });
    });

    test("is immutable when a script has given its global another value", async () => {
      const script = `
        const headers = new Headers();
        globalThis.Headers = {};
        console.log(Object.isExtensible(Object.getPrototypeOf(headers.entries())));
      `;
      expect(await run("*,-globalThis", ["-e", script])).toEqual({ stdout: "false\n", stderr: "", exitCode: 0 });
    });

    test("covers what belongs to a global nothing has read, and a constructor only its prototype leads to", async () => {
      // The script reads no global of Bun's but Response and Request, so the others have not been created when it reaches their objects.
      const script = `
        const prototypeOf = Object.getPrototypeOf;
        const objects = {
          "Headers iterator": prototypeOf(new Response("").headers.entries()),
          "ReadableStream async iterator": prototypeOf(new Response("x").body.values()),
          "AbortSignal.prototype": prototypeOf(new Request("http://localhost").signal),
          "AbortSignal": prototypeOf(new Request("http://localhost").signal).constructor,
          "AbortSignal.timeout": prototypeOf(new Request("http://localhost").signal).constructor.timeout,
        };
        console.log(JSON.stringify(Object.keys(objects).filter(name => Object.isExtensible(objects[name]))));
      `;
      expect(await run("*", ["-e", script])).toEqual({ stdout: "[]\n", stderr: "", exitCode: 0 });
    });

    test("crypto.subtle is there", async () => {
      const script = `console.log(typeof crypto.subtle.digest, "subtle" in Crypto.prototype);`;
      expect(await run("*", ["-e", script])).toEqual({ stdout: "function true\n", stderr: "", exitCode: 0 });
    });

    test("covers a class that is first used internally", async () => {
      // fetch() needs Response before anything reads globalThis.Response.
      const script = `
        const response = await fetch("data:text/plain,hello");
        console.log(Object.isExtensible(Object.getPrototypeOf(response)));
      `;
      expect(await run("*", ["-e", script])).toEqual({ stdout: "false\n", stderr: "", exitCode: 0 });
    });

    test("expect.extend() works", async () => {
      using dir = tempDir("immutable-globals", {
        "extend.test.js": `
          import { expect, test } from "bun:test";
          expect.extend({ toBeSeven: received => ({ pass: received === 7, message: () => "not seven" }) });
          test("custom matcher", () => {
            expect(7).toBeSeven();
            expect(8).not.toBeSeven();
            expect({ n: 7 }).toEqual({ n: expect.toBeSeven() });
            expect(Object.isExtensible(expect.toBeSeven)).toBe(false);
          });
          test("a name that is an index", () => {
            expect(() => expect.extend({ 0: () => ({ pass: true }) })).toThrow(TypeError);
          });
        `,
      });
      const { stderr, exitCode } = await run("*", ["test", "extend.test.js"], String(dir));
      expect(stderr).toContain("2 pass");
      expect(exitCode).toBe(0);
    });

    test("jest.useFakeTimers() marks setTimeout", async () => {
      using dir = tempDir("immutable-globals", {
        "timers.test.js": `
          import { expect, jest, test } from "bun:test";
          test("marker", () => {
            jest.useFakeTimers();
            expect(Object.hasOwn(setTimeout, "clock")).toBe(true);
            jest.useRealTimers();
            expect(Object.hasOwn(setTimeout, "clock")).toBe(false);
            expect(() => { "use strict"; setTimeout.clock = true; }).toThrow(TypeError);
          });
        `,
      });
      const { stderr, exitCode } = await run("*", ["test", "timers.test.js"], String(dir));
      expect(stderr).toContain("1 pass");
      expect(exitCode).toBe(0);
    });

    test("built-in modules add to native classes as they load", async () => {
      const script = `
        import crypto from "node:crypto";
        import EventEmitter from "node:events";
        import { performance } from "node:perf_hooks";
        import { MessageChannel } from "node:worker_threads";
        import zlib from "node:zlib";
        import "bun:ffi";
        let calls = 0;
        process.on("custom", () => calls++);
        process.emit("custom");
        console.log(process instanceof EventEmitter, calls, typeof new MessageChannel().port1.on);
        console.log(typeof performance.eventLoopUtilization, "callback" in Bun.FFI);
        console.log(await new Promise(resolve => zlib.gzip("hello", (error, data) => resolve(zlib.gunzipSync(data).toString()))));
        process.on("warning", warning => console.log(warning.code));
        crypto.createECDH("prime256v1").setPublicKey(crypto.createECDH("prime256v1").generateKeys());
      `;
      const { stdout, exitCode } = await run("*", ["-e", script]);
      expect({ stdout, exitCode }).toEqual({
        stdout: "true 1 function\nfunction false\nhello\nDEP0031\n",
        exitCode: 0,
      });
    });

    // Counts the calls and records each one whose write to a built-in went through.
    const attempt = `
      "use strict";
      const wrote = [];
      let calls = 0;
      function attempt(where) {
        calls++;
        try {
          Array.prototype.fresh = 1;
          wrote.push(where);
        } catch {}
      }
    `;

    test("every built-in module loads, and a listener that is called meanwhile cannot write", async () => {
      using dir = tempDir("immutable-globals-modules", {
        "index.cjs": `
          ${attempt}
          const failed = [];
          let loading;
          for (const event of ["newListener", "removeListener"]) process.on(event, name => attempt(loading + ": " + event + " " + String(name)));
          for (loading of [...require("node:module").builtinModules, "node:quic", "bun:ffi", "bun:jsc", "bun:sqlite"]) {
            try {
              require(loading);
            } catch (error) {
              failed.push(loading + ": " + error.message);
            }
          }
          console.log(JSON.stringify({ failed, called: calls > 0, wrote }));
        `,
      });
      const { stdout, exitCode } = await run("*", ["index.cjs"], String(dir));
      expect(JSON.parse(stdout)).toEqual({ failed: [], called: true, wrote: [] });
      expect(exitCode).toBe(0);
    });

    // Each puts another built-in under the name of the class the module finishes.
    test.each([
      [
        "*",
        "node:quic",
        `require("node:net").SocketAddress = { get prototype() { attempt("net.SocketAddress"); return Array.prototype; } };`,
      ],
      [
        "*,-globalThis",
        "node:quic",
        `globalThis.Blob = { get prototype() { attempt("Blob"); return Array.prototype; } };`,
      ],
      [
        "*,-globalThis",
        "node:perf_hooks",
        `globalThis.Performance = { get prototype() { attempt("Performance"); return Array.prototype; } };`,
      ],
      ["*,-globalThis", "node:events", `globalThis.process = Object.create(Array.prototype);`],
    ])(
      "with %s, %s finishes its own class whatever a program puts in its place",
      async (immutableGlobals, module, plant) => {
        using dir = tempDir("immutable-globals-planted", {
          "index.cjs": `
          ${attempt}
          const log = console.log, before = Reflect.ownKeys(Array.prototype).length, parent = Object.getPrototypeOf(Array.prototype);
          ${plant}
          require(${JSON.stringify(module)});
          log(JSON.stringify({
            wrote,
            added: Reflect.ownKeys(Array.prototype).length - before,
            relinked: Object.getPrototypeOf(Array.prototype) !== parent,
          }));
        `,
        });
        const { stdout, exitCode } = await run(immutableGlobals, ["index.cjs"], String(dir));
        expect(JSON.parse(stdout)).toEqual({ wrote: [], added: 0, relinked: false });
        expect(exitCode).toBe(0);
      },
    );

    test("a trap that is called while bun:ffi loads cannot write", async () => {
      using dir = tempDir("immutable-globals-planted", {
        "index.cjs": `
          ${attempt}
          const traps = { deleteProperty(target, key) { attempt("Bun.FFI"); return true; } };
          Object.defineProperty(Bun, "FFI", { value: new Proxy(Bun.FFI, traps) });
          require("bun:ffi");
          console.log(JSON.stringify({ called: calls > 0, wrote }));
        `,
      });
      const { stdout, exitCode } = await run("*,-Bun", ["index.cjs"], String(dir));
      expect(JSON.parse(stdout)).toEqual({ called: true, wrote: [] });
      expect(exitCode).toBe(0);
    });

    test("jest.useFakeTimers() marks no built-in a program puts in setTimeout's place", async () => {
      using dir = tempDir("immutable-globals-planted", {
        "timers.test.js": `
          import { expect, jest, test } from "bun:test";
          ${attempt.replace('"use strict";', "")}
          test("another built-in", () => {
            globalThis.setTimeout = Object.prototype;
            jest.useFakeTimers();
            expect(Object.hasOwn(Object.prototype, "clock")).toBe(false);
            jest.useRealTimers();
          });
          test("a Proxy", () => {
            globalThis.setTimeout = new Proxy(function () {}, { deleteProperty() { attempt("setTimeout"); return true; } });
            jest.useFakeTimers();
            jest.useRealTimers();
            expect({ called: calls > 0, wrote }).toEqual({ called: true, wrote: [] });
          });
        `,
      });
      const { stderr, exitCode } = await run("*,-globalThis", ["test", "timers.test.js"], String(dir));
      expect(stderr).toContain("2 pass");
      expect(exitCode).toBe(0);
    });

    test.each([
      ["bun:ffi", `Object.freeze(Bun.FFI);`, "Unable to delete property."],
      [
        "node:perf_hooks",
        `Object.preventExtensions(Performance.prototype);`,
        "Attempting to define property on object that is not extensible.",
      ],
    ])("without the option, %s throws for a class it cannot finish", async (module, plant, message) => {
      const script = `
        ${plant}
        try {
          require(${JSON.stringify(module)});
        } catch (error) {
          console.log(error.message);
        }
      `;
      const { stdout, exitCode } = await run(undefined, ["-e", script]);
      expect({ stdout, exitCode }).toEqual({ stdout: message + "\n", exitCode: 0 });
    });
  });

  test("applies to node:vm contexts, workers and ShadowRealms", async () => {
    const { stdout, stderr, exitCode } = await run("*", [
      "-e",
      `
      import vm from "node:vm";
      import { Worker as NodeWorker } from "node:worker_threads";
      const attempt = '"use strict"; try { Array.prototype.map.call = 1; "ok"; } catch (error) { error.name; }';
      console.log("vm", vm.runInNewContext(attempt), vm.runInContext(attempt, vm.createContext({})));
      console.log("vm global", vm.runInNewContext('"use strict"; globalThis.fresh = 1; var declared = 2; fresh + declared'));
      console.log("ShadowRealm", new ShadowRealm().evaluate(attempt));
      const source = '"use strict"; const results = []; for (const f of [() => { Array.prototype.map = 1; }, () => { Headers.prototype.get = 1; }, () => { process.fresh = 1; }, () => { globalThis.fresh = 1; }]) { try { f(); results.push("ok"); } catch (error) { results.push(error.name); } }';
      const worker = new Worker("data:text/javascript," + encodeURIComponent(source + "postMessage(results.join());"));
      const { promise, resolve, reject } = Promise.withResolvers();
      worker.onerror = event => reject(new Error(event.message));
      worker.onmessage = event => resolve(event.data);
      console.log("worker", await promise);
      worker.terminate();
      const nodeWorker = new NodeWorker(source + 'require("node:worker_threads").parentPort.postMessage(results.join());', { eval: true });
      console.log("node:worker_threads", await new Promise((resolve, reject) => nodeWorker.on("message", resolve).on("error", reject)));
      `,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
      "vm TypeError TypeError
      vm global 3
      ShadowRealm TypeError
      worker TypeError,TypeError,TypeError,TypeError
      node:worker_threads TypeError,TypeError,TypeError,TypeError
      "
    `);
    expect(exitCode).toBe(0);
  });

  test.each(["*", "*,-globalThis", "*,-noSuchGlobal"])(
    "node:vm contexts can be created: %s",
    async immutableGlobals => {
      using dir = tempDir("immutable-globals-vm", {
        "index.mjs": `
        import vm from "node:vm";
        console.log(vm.runInContext("typeof globalThis", vm.createContext(vm.constants.DONT_CONTEXTIFY)));
        console.log(vm.runInContext("typeof globalThis", vm.createContext({})));
        console.log(vm.runInNewContext("typeof globalThis"));
      `,
      });
      expect(await run(immutableGlobals, ["index.mjs"], String(dir))).toEqual({
        stdout: "object\nobject\nobject\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );

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
      await run("*,-globalThis", [
        "-e",
        `import { mock } from "node:test"; mock.timers.enable({ apis: ["Date"], now: 1000 }); console.log(Date.now(), new Date().toUTCString()); mock.timers.reset();`,
      ]),
    ).toEqual({ stdout: "1000 Thu, 01 Jan 1970 00:00:01 GMT\n", stderr: "", exitCode: 0 });
  });

  test("Error.captureStackTrace() throws for an object with immutable properties", async () => {
    const { stdout, stderr, exitCode } = await run("*,-Set", [
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
    const immutable = await run("*", ["-e", source]);
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

  // Each of these needs a stack trace limit or a stack format of its own for a moment.
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

  test("--stack-trace-limit and --trace-exit work", async () => {
    using dir = tempDir("immutable-globals-flags", {
      "index.cjs": `
        function a() { return b(); }
        function b() { return c(); }
        function c() { return new Error().stack; }
        console.log(Error.stackTraceLimit, a().split("\\n").filter(line => line.includes(" at ")).length);
        (function leave() { process.exit(3); })();
      `,
    });
    const { stdout, stderr, exitCode } = await run(
      "*",
      ["--stack-trace-limit=2", "--trace-exit", "index.cjs"],
      String(dir),
    );
    expect(stdout).toBe("2 2\n");
    expect(stderr).toContain("WARNING: Exited the environment with code 3");
    expect(exitCode).toBe(3);
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

  test("--trace-env-js-stack takes a fractional Error.stackTraceLimit, and leaves the limit in force if it throws", async () => {
    using dir = tempDir("immutable-globals-trace-env", {
      "index.cjs": `
        function deep(n, f) { return n ? deep(n - 1, f) : f(); }
        Error.stackTraceLimit = 4.5;
        deep(20, () => process.env.TRACED);
        Error.prepareStackTrace = (error, callSites) => callSites;
        try { process.env.TRACED; } catch {}
        Error.prepareStackTrace = undefined;
        Error.stackTraceLimit = 1;
        console.log(deep(20, () => new Error().stack).split("\\n").length - 1);
      `,
    });
    const { stdout, stderr, exitCode } = await run(undefined, ["--trace-env-js-stack", "index.cjs"], String(dir));
    expect(stderr.split("\n").filter(line => line.includes("at deep (")).length).toBe(4);
    expect(stdout).toBe("1\n");
    expect(exitCode).toBe(0);
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
    using dir = tempDir("immutable-globals-repl", { "index.cjs": source });
    const [immutable, mutable] = await Promise.all([
      run("*", ["index.cjs"], String(dir)),
      run(undefined, ["index.cjs"], String(dir)),
    ]);
    expect(immutable.stdout).toMatchInlineSnapshot(`
      ""> Uncaught Error: Script execution was interrupted by \`SIGINT\`\\n> "
      "
    `);
    expect(mutable.stdout).toBe(immutable.stdout);
    expect(immutable.exitCode).toBe(0);
  });
});
