import { describe, expect, test as test_ } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const test = test_.concurrent;
// --frozen-intrinsics and worker spawns are ~3s each under debug+ASAN.
const SLOW = 30_000;

async function run(flags: string[], code: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...flags, "-e", code],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("--disallow-code-generation-from-strings", () => {
  test("eval() throws EvalError", async () => {
    const { stdout, exitCode } = await run(
      ["--disallow-code-generation-from-strings"],
      `try { eval("1"); console.log("eval WORKS"); } catch (e) { console.log(e.name + ": " + e.message); }`,
    );
    expect(stdout.trim()).toBe("EvalError: Code generation from strings disallowed for this context");
    expect(exitCode).toBe(0);
  });

  test("new Function() throws EvalError", async () => {
    const { stdout, exitCode } = await run(
      ["--disallow-code-generation-from-strings"],
      `try { new Function("return 1")(); console.log("Function WORKS"); } catch (e) { console.log(e.name + ": " + e.message); }`,
    );
    expect(stdout.trim()).toBe("EvalError: Code generation from strings disallowed for this context");
    expect(exitCode).toBe(0);
  });

  test(
    "applies to worker threads",
    async () => {
      const { stdout, exitCode } = await run(
        ["--disallow-code-generation-from-strings"],
        `const { Worker } = require("worker_threads");
         const w = new Worker('try { eval("1"); console.log("worker: eval WORKS"); } catch (e) { console.log("worker: " + e.name); }', { eval: true });
         w.on("exit", () => {});`,
      );
      expect(stdout.trim()).toBe("worker: EvalError");
      expect(exitCode).toBe(0);
    },
    SLOW,
  );

  test("WebAssembly is not affected", async () => {
    const { stdout, exitCode } = await run(
      ["--disallow-code-generation-from-strings"],
      `WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])).then(() => console.log("wasm ok"), e => console.log("wasm blocked"));`,
    );
    expect(stdout.trim()).toBe("wasm ok");
    expect(exitCode).toBe(0);
  });
});

describe("--disable-proto", () => {
  test("=delete removes Object.prototype.__proto__", async () => {
    const { stdout, exitCode } = await run(
      ["--disable-proto=delete"],
      `console.log(JSON.stringify({
         hasOwn: Object.prototype.hasOwnProperty("__proto__"),
         read: typeof ({}).__proto__,
       }))`,
    );
    expect(JSON.parse(stdout)).toEqual({ hasOwn: false, read: "undefined" });
    expect(exitCode).toBe(0);
  });

  test("=delete makes __proto__ assignment a plain own property", async () => {
    const { stdout, exitCode } = await run(
      ["--disable-proto=delete"],
      `const o = {}; o.__proto__ = { x: 1 }; console.log(JSON.stringify({ own: Object.hasOwn(o, "__proto__"), x: o.x }));`,
    );
    expect(JSON.parse(stdout)).toEqual({ own: true, x: undefined });
    expect(exitCode).toBe(0);
  });

  test("=throw makes __proto__ getter throw ERR_PROTO_ACCESS", async () => {
    const { stdout, exitCode } = await run(
      ["--disable-proto=throw"],
      `try { ({}).__proto__; console.log("readable"); } catch (e) { console.log(e.code + ": " + e.message); }`,
    );
    expect(stdout.trim()).toBe(
      "ERR_PROTO_ACCESS: Accessing Object.prototype.__proto__ has been disallowed with --disable-proto=throw",
    );
    expect(exitCode).toBe(0);
  });

  test("=throw makes __proto__ setter throw ERR_PROTO_ACCESS", async () => {
    const { stdout, exitCode } = await run(
      ["--disable-proto=throw"],
      `try { ({}).__proto__ = null; console.log("set ok"); } catch (e) { console.log(e.code); }`,
    );
    expect(stdout.trim()).toBe("ERR_PROTO_ACCESS");
    expect(exitCode).toBe(0);
  });

  test("=throw still has own-property accessor on Object.prototype", async () => {
    const { stdout, exitCode } = await run(
      ["--disable-proto=throw"],
      `const d = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__");
       console.log(JSON.stringify({
         hasOwn: Object.prototype.hasOwnProperty("__proto__"),
         enumerable: d.enumerable,
         configurable: d.configurable,
         hasGet: typeof d.get === "function",
         hasSet: typeof d.set === "function",
       }));`,
    );
    expect(JSON.parse(stdout)).toEqual({
      hasOwn: true,
      enumerable: false,
      configurable: true,
      hasGet: true,
      hasSet: true,
    });
    expect(exitCode).toBe(0);
  });

  test(
    "=throw applies to worker threads",
    async () => {
      const { stdout, exitCode } = await run(
        ["--disable-proto=throw"],
        `const { Worker } = require("worker_threads");
         const w = new Worker('try { ({}).__proto__; console.log("worker: readable"); } catch (e) { console.log("worker: " + e.code); }', { eval: true });
         w.on("exit", () => {});`,
      );
      expect(stdout.trim()).toBe("worker: ERR_PROTO_ACCESS");
      expect(exitCode).toBe(0);
    },
    SLOW,
  );

  test("invalid mode exits 12", async () => {
    const { stderr, exitCode } = await run(["--disable-proto=bogus"], `console.log("ran")`);
    expect(stderr).toContain("invalid mode passed to --disable-proto");
    expect(exitCode).toBe(12);
  });

  test("applies to node:vm contexts (throw)", async () => {
    const { stdout, exitCode } = await run(
      ["--disable-proto=throw"],
      `const vm = require("vm"); const ctx = vm.createContext();
       try { vm.runInContext("({}).__proto__", ctx); console.log("readable"); }
       catch (e) { console.log(e.code); }`,
    );
    expect(stdout.trim()).toBe("ERR_PROTO_ACCESS");
    expect(exitCode).toBe(0);
  });

  test("applies to node:vm contexts (delete)", async () => {
    const { stdout, exitCode } = await run(
      ["--disable-proto=delete"],
      `const vm = require("vm"); const ctx = vm.createContext();
       console.log(vm.runInContext("Object.prototype.hasOwnProperty('__proto__')", ctx));`,
    );
    expect(stdout.trim()).toBe("false");
    expect(exitCode).toBe(0);
  });
});

describe("--frozen-intrinsics", () => {
  test(
    "freezes ECMA-262 intrinsics but not globalThis, and emits ExperimentalWarning",
    async () => {
      const { stdout, stderr, exitCode } = await run(
        ["--frozen-intrinsics"],
        `console.log(JSON.stringify({
           arrProto: Object.isFrozen(Array.prototype),
           objProto: Object.isFrozen(Object.prototype),
           promise: Object.isFrozen(Promise),
           math: Object.isFrozen(Math),
           f16: Object.isFrozen(Float16Array.prototype),
           suppressedError: Object.isFrozen(SuppressedError.prototype),
           disposableStack: Object.isFrozen(DisposableStack.prototype),
           asyncDisposableStack: Object.isFrozen(AsyncDisposableStack.prototype),
           iterator: Object.isFrozen(Iterator),
           console: Object.isFrozen(console),
           globalThis: Object.isFrozen(globalThis),
           slotConfigurable: Object.getOwnPropertyDescriptor(globalThis, "globalThis").configurable,
           streams: Object.isFrozen(require("stream").Duplex.prototype),
         }))`,
      );
      expect(JSON.parse(stdout)).toEqual({
        arrProto: true,
        objProto: true,
        promise: true,
        math: true,
        f16: true,
        suppressedError: true,
        disposableStack: true,
        asyncDisposableStack: true,
        iterator: true,
        console: true,
        globalThis: false,
        slotConfigurable: false,
        streams: false,
      });
      expect(stderr).toContain("ExperimentalWarning");
      expect(stderr).toContain("experimental feature");
      expect(exitCode).toBe(0);
    },
    SLOW,
  );

  test(
    "intrinsic prototype assignment throws but derived-object assignment still works",
    async () => {
      const { stdout, exitCode } = await run(
        ["--frozen-intrinsics"],
        `"use strict";
         let proto; try { Array.prototype.push = 1; proto = "mutated"; } catch (e) { proto = e.name; }
         const o = {}; o.toString = () => "overridden";
         console.log(JSON.stringify({ proto, derived: o.toString() }));`,
      );
      expect(JSON.parse(stdout)).toEqual({ proto: "TypeError", derived: "overridden" });
      expect(exitCode).toBe(0);
    },
    SLOW,
  );

  test(
    "node:assert still throws AssertionError (Error.stackTraceLimit is guarded)",
    async () => {
      const { stdout, exitCode } = await run(
        ["--frozen-intrinsics"],
        `try { require("assert").strictEqual(1, 2); console.log("no throw"); }
         catch (e) { console.log(e.code); }`,
      );
      expect(stdout.trim()).toBe("ERR_ASSERTION");
      expect(exitCode).toBe(0);
    },
    SLOW,
  );

  test(
    "--require preloads run before the freeze",
    async () => {
      using dir = tempDir("frozen-intrinsics-preload", {
        "poly.cjs": `Array.prototype.myPolyfill = 1;`,
      });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--frozen-intrinsics",
          "--require",
          "./poly.cjs",
          "-e",
          `console.log(JSON.stringify({ frozen: Object.isFrozen(Array.prototype), poly: Array.prototype.myPolyfill }))`,
        ],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(JSON.parse(stdout)).toEqual({ frozen: true, poly: 1 });
      expect(exitCode).toBe(0);
    },
    SLOW,
  );
});

describe("--secure-heap", () => {
  test("is recognised and warns that BoringSSL lacks a secure heap", async () => {
    const { stdout, stderr, exitCode } = await run(
      ["--secure-heap=4096"],
      `console.log(typeof require("crypto").secureHeapUsed())`,
    );
    expect(stderr).toContain("--secure-heap is not supported");
    expect(stderr).toContain("BoringSSL");
    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  });
});

describe("without flags", () => {
  test("eval works", async () => {
    const { stdout } = await run([], `console.log(eval("1+1"))`);
    expect(stdout.trim()).toBe("2");
  });

  test("__proto__ is readable", async () => {
    const { stdout } = await run([], `console.log(({}).__proto__ === Object.prototype)`);
    expect(stdout.trim()).toBe("true");
  });

  test("Array.prototype is not frozen", async () => {
    const { stdout } = await run([], `console.log(Object.isFrozen(Array.prototype))`);
    expect(stdout.trim()).toBe("false");
  });
});
