import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Top-level `await import(self)` is a spec-level deadlock under the new
// pure-C++ module loader (Node prints an "unsettled top-level await" warning
// and exits). A static self-import yields the same namespace object without
// blocking evaluation on itself.
import * as Self from "./esModule.test.ts";

test("__esModule defaults to undefined", () => {
  expect((Self as any).__esModule).toBeUndefined();
});

test("__esModule is settable", () => {
  (Self as any).__esModule = true;
  expect((Self as any).__esModule).toBe(true);
  (Self as any).__esModule = false;
  expect((Self as any).__esModule).toBe(undefined);
  (Self as any).__esModule = true;
  expect((Self as any).__esModule).toBe(true);
  (Self as any).__esModule = undefined;
});

test("require of self sets __esModule", () => {
  expect((Self as any).__esModule).toBeUndefined();
  {
    const Self = require("./esModule.test.ts");
    expect(Self.__esModule).toBe(true);
  }
  expect((Self as any).__esModule).toBe(true);
  expect(Object.getOwnPropertyNames(Self)).toBeEmpty();
});

// Namespace objects share a Structure and a prototype. A cache of a hit on the prototype would answer for all of them.
describe.concurrent("a site that the JIT compiled on a namespace without an `__esModule` export", () => {
  const files = {
    "package.json": JSON.stringify({ type: "module" }),
    "warm.mjs": `
      import { numberOfDFGCompiles } from "bun:jsc";

      // Calls \`fn\` often enough that the JIT compiles it and its property caches form.
      export function warm(fn, ...args) {
        for (let i = 0; i < 2000; i++) fn(...args);
        // With the JIT off this count is not zero for a function that has run.
        if (!numberOfDFGCompiles(fn)) throw new Error("the JIT did not compile the site");
      }
    `,
    "plain.mjs": `export const x = 1;`,
    "plain2.mjs": `export const x = 2;`,
    "plain3.mjs": `export const x = 3;`,
    "exports-true.mjs": `
      export const __esModule = true;
      export const x = 1;
    `,
    "exports-false.mjs": `
      export const __esModule = false;
      export const x = 1;
    `,
    "exports-y.mjs": `export const y = "export";`,
  };

  async function run(cmd: string[], fixture: Record<string, string>, env: Record<string, string> = {}) {
    using dir = tempDir("esmodule-jit", { ...files, ...fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      // The JIT is on whatever the test run's environment says, and compiles a function after a fixed number of calls.
      env: { ...bunEnv, BUN_JSC_useJIT: "1", BUN_JSC_useConcurrentJIT: "0", ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("a read gives the value of the export", async () => {
    const { stdout, stderr, exitCode } = await run(["entry.mjs"], {
      "array.json": `[1, 2, 3]`,
      "exports-true.cjs": `
        exports.__esModule = true;
        exports.a = 1;
      `,
      "entry.mjs": `
        import * as plain from "./plain.mjs";
        import * as exportsTrue from "./exports-true.mjs";
        import * as exportsFalse from "./exports-false.mjs";
        import * as jsonArray from "./array.json";
        import * as commonJS from "./exports-true.cjs";
        import { warm } from "./warm.mjs";

        const byId = ns => ns.__esModule;
        const byVal = (ns, key) => ns[key];
        const reflectGet = ns => Reflect.get(ns, "__esModule");
        const reflectGetWithReceiver = ns => Reflect.get(ns, "__esModule", ns);
        const interopRequireDefault = ns => (ns && ns.__esModule ? ns : { default: ns });
        // A CommonJS file that sets \`exports.__esModule\`, and a JSON file whose value is not an object, export it too.
        const ofOtherFile = ns => ns.__esModule;

        warm(byId, plain);
        warm(byVal, plain, "__esModule");
        warm(reflectGet, plain);
        warm(reflectGetWithReceiver, plain);
        warm(interopRequireDefault, plain);
        warm(ofOtherFile, plain);

        console.log(
          JSON.stringify({
            byId: [byId(exportsTrue), byId(exportsFalse)],
            byVal: [byVal(exportsTrue, "__esModule"), byVal(exportsFalse, "__esModule")],
            reflectGet: [reflectGet(exportsTrue), reflectGet(exportsFalse)],
            reflectGetWithReceiver: [reflectGetWithReceiver(exportsTrue), reflectGetWithReceiver(exportsFalse)],
            interopRequireDefault: interopRequireDefault(exportsTrue) === exportsTrue,
            ofOtherFile: [ofOtherFile(commonJS), ofOtherFile(jsonArray)],
          }),
        );
      `,
    });

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      byId: [true, false],
      byVal: [true, false],
      reflectGet: [true, false],
      reflectGetWithReceiver: [true, false],
      interopRequireDefault: true,
      ofOtherFile: [true, true],
    });
    expect(exitCode).toBe(0);
  });

  test("a write to the export throws, and does not set the marker", async () => {
    const { stdout, stderr, exitCode } = await run(["entry.mjs"], {
      "entry.mjs": `
        import * as plain from "./plain.mjs";
        import * as exportsFalse from "./exports-false.mjs";
        import { warm } from "./warm.mjs";

        const strictById = (ns, value) => {
          ns.__esModule = value;
        };
        const strictByVal = (ns, key, value) => {
          ns[key] = value;
        };
        const sloppyById = new Function("ns", "value", "ns.__esModule = value;");
        const sloppyByVal = new Function("ns", "key", "value", "ns[key] = value;");
        const read = ns => ns.__esModule;

        warm(strictById, plain, undefined);
        warm(strictByVal, plain, "__esModule", undefined);
        warm(sloppyById, plain, undefined);
        warm(sloppyByVal, plain, "__esModule", undefined);
        warm(read, plain);

        function errorOf(fn) {
          try {
            fn();
            return "none";
          } catch (error) {
            return error.constructor.name;
          }
        }

        console.log(
          JSON.stringify({
            strictById: errorOf(() => strictById(exportsFalse, true)),
            strictByVal: errorOf(() => strictByVal(exportsFalse, "__esModule", true)),
            sloppyById: errorOf(() => sloppyById(exportsFalse, true)),
            sloppyByVal: errorOf(() => sloppyByVal(exportsFalse, "__esModule", true)),
            // The getter of the prototype, asked about the namespace object that has the export.
            marker: String(Reflect.get(plain, "__esModule", exportsFalse)),
            read: read(exportsFalse),
          }),
        );
      `,
    });

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      strictById: "TypeError",
      strictByVal: "TypeError",
      sloppyById: "none",
      sloppyByVal: "none",
      marker: "undefined",
      read: false,
    });
    expect(exitCode).toBe(0);
  });

  test("a read of an export that is not initialized throws", async () => {
    const { stdout, stderr, exitCode } = await run(["entry.mjs"], {
      "site.mjs": `
        import * as plain from "./plain.mjs";
        import { warm } from "./warm.mjs";

        export const read = ns => ns.__esModule;
        warm(read, plain);
      `,
      "cycle-a.mjs": `
        import "./cycle-b.mjs";
        export const __esModule = true;
      `,
      // cycle-a.mjs imports this module, so this body runs before the one that initializes the export.
      "cycle-b.mjs": `
        import * as a from "./cycle-a.mjs";
        import { read } from "./site.mjs";

        try {
          globalThis.result = String(read(a));
        } catch (error) {
          globalThis.result = error.constructor.name;
        }
      `,
      "entry.mjs": `
        import "./cycle-a.mjs";
        console.log(globalThis.result);
      `,
    });

    expect(stderr).toBe("");
    expect(stdout).toBe("ReferenceError\n");
    expect(exitCode).toBe(0);
  });

  test("`in` and a read evaluate the module of an `import defer` namespace", async () => {
    const { stdout, stderr, exitCode } = await run(["entry.mjs"], {
      "deferred.mjs": `
        globalThis.evaluated = (globalThis.evaluated ?? "") + "1";
        export const x = 1;
      `,
      "deferred2.mjs": `
        globalThis.evaluated = (globalThis.evaluated ?? "") + "2";
        export const x = 1;
      `,
      "entry.mjs": `
        import * as plain from "./plain.mjs";
        import defer * as deferred from "./deferred.mjs";
        import defer * as deferred2 from "./deferred2.mjs";
        import { warm } from "./warm.mjs";

        const has = ns => "__esModule" in ns;
        const read = ns => ns.__esModule;
        warm(has, plain);
        warm(read, plain);

        const evaluated = [String(globalThis.evaluated)];
        has(deferred);
        evaluated.push(globalThis.evaluated);
        read(deferred2);
        evaluated.push(globalThis.evaluated);
        console.log(JSON.stringify(evaluated));
      `,
    });

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["undefined", "1", "12"]);
    expect(exitCode).toBe(0);
  });

  test("a namespace from mock.module() gives what its factory returned", async () => {
    const { stdout, exitCode } = await run(["test", "./mock.test.js"], {
      "mocked.mjs": `export const a = "not mocked";`,
      "mocked2.mjs": `export const a = "not mocked";`,
      "mock.test.js": `
        import { mock, test } from "bun:test";
        import * as plain from "./plain.mjs";
        import { warm } from "./warm.mjs";

        test("mock", async () => {
          const read = ns => ns.__esModule;
          warm(read, plain);

          mock.module("./mocked.mjs", () => ({ __esModule: "from the factory" }));
          const mocked = await import("./mocked.mjs");

          const exports = {};
          mock.module("./mocked2.mjs", () => exports);
          const mocked2 = await import("./mocked2.mjs");
          const before = String(read(mocked2));
          exports.__esModule = "added later";

          console.log(JSON.stringify({ mocked: read(mocked), mocked2: [before, read(mocked2)] }));
        });
      `,
    });

    // `bun test` writes lines of its own to stdout.
    const line = stdout.split("\n").find(line => line.startsWith("{"));
    expect(JSON.parse(line ?? "null")).toEqual({ mocked: "from the factory", mocked2: ["undefined", "added later"] });
    expect(exitCode).toBe(0);
  });

  test("require() and the namespace object that it returns", async () => {
    const { stdout, stderr, exitCode } = await run(["entry.cjs"], {
      ...Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`esm${i}.mjs`, `export const x = ${i};`])),
      "entry.cjs": `
        "use strict";
        const { warm } = require("./warm.mjs");

        // require() reads and writes \`__esModule\` on the namespace object of each ES module that it loads.
        for (let i = 0; i < 60; i++) require("./esm" + i + ".mjs");
        const plain = require("./esm0.mjs");
        const exportsFalse = require("./exports-false.mjs");
        // The getter of the prototype, asked about the namespace object that has the export.
        const markerAfterRequire = String(Reflect.get(plain, "__esModule", exportsFalse));

        const read = ns => ns.__esModule;
        const write = (ns, value) => {
          ns.__esModule = value;
        };
        warm(read, plain);
        warm(write, plain, true);
        let error = "none";
        try {
          write(exportsFalse, true);
        } catch (thrown) {
          error = thrown.constructor.name;
        }

        console.log(
          JSON.stringify({
            plain: read(plain),
            markerAfterRequire,
            read: read(exportsFalse),
            write: error,
            markerAfterWrite: String(Reflect.get(plain, "__esModule", exportsFalse)),
          }),
        );
      `,
    });

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      plain: true,
      markerAfterRequire: "undefined",
      read: false,
      write: "TypeError",
      markerAfterWrite: "undefined",
    });
    expect(exitCode).toBe(0);
  });

  test("an object that inherits from a namespace reads the exports of that namespace", async () => {
    const { stdout, stderr, exitCode } = await run(["entry.mjs"], {
      "entry.mjs": `
        import { jscDescribe } from "bun:jsc";
        import * as plain from "./plain.mjs";
        import * as exportsY from "./exports-y.mjs";
        import { warm } from "./warm.mjs";

        // The instances of a class that is created again and again get one Structure, whatever their prototype is.
        function makeObject() {
          function make() {
            class C {
              constructor() {
                this.field = 1;
              }
            }
            return new C();
          }
          for (let i = 0; i < 15; i++) make();
          return make();
        }
        const overPlain = Object.setPrototypeOf(makeObject(), plain);
        const overExportsY = Object.setPrototypeOf(makeObject(), exportsY);
        const structureOf = object => /StructureID: (\\d+)/.exec(jscDescribe(object))[1];

        const read = object => object.y;
        const has = object => "y" in object;
        warm(read, overPlain);
        warm(has, overPlain);

        console.log(
          JSON.stringify({
            oneStructure: structureOf(overPlain) === structureOf(overExportsY),
            read: String(read(overExportsY)),
            has: has(overExportsY),
          }),
        );
      `,
    });

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ oneStructure: true, read: "export", has: true });
    expect(exitCode).toBe(0);
  });

  test.each([
    ["the JIT", {}],
    ["the interpreter", { BUN_JSC_useJIT: "0" }],
  ])("a name that is added to the prototype does not answer for a namespace that exports it, in %s", async (_, env) => {
    const { stdout, stderr, exitCode } = await run(
      ["entry.mjs"],
      {
        "entry.mjs": `
          import * as plain from "./plain.mjs";
          import * as exportsY from "./exports-y.mjs";
          import { warm } from "./warm.mjs";

          Object.getPrototypeOf(plain).y = "prototype";

          const read = ns => ns.y;
          warm(read, plain);
          console.log(JSON.stringify([read(plain), read(exportsY)]));
        `,
      },
      env,
    );

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["prototype", "export"]);
    expect(exitCode).toBe(0);
  });

  test("the marker still shows at the site", async () => {
    const { stdout, stderr, exitCode } = await run(["entry.mjs"], {
      "entry.mjs": `
        import { createRequire } from "node:module";
        import * as required from "./plain.mjs";
        import * as notRequired from "./plain2.mjs";
        import * as assigned from "./plain3.mjs";
        import { warm } from "./warm.mjs";

        const read = ns => ns.__esModule;
        const write = (ns, value) => {
          ns.__esModule = value;
        };
        warm(read, required);
        warm(write, notRequired, undefined);

        const beforeRequire = String(read(required));
        createRequire(import.meta.url)("./plain.mjs");
        write(assigned, true);
        const whileAssigned = read(assigned);
        write(assigned, false);

        console.log(
          JSON.stringify({
            required: [beforeRequire, read(required)],
            notRequired: String(read(notRequired)),
            assigned: [whileAssigned, String(read(assigned))],
          }),
        );
      `,
    });

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      required: ["undefined", true],
      notRequired: "undefined",
      assigned: [true, "undefined"],
    });
    expect(exitCode).toBe(0);
  });
});
