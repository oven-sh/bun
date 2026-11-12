import { describe, expect, test, vi } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import * as WithTypeModuleExportEsModuleAnnotationMissingDefault from "./with-type-module/export-esModule-annotation-empty.cjs";
import * as WithTypeModuleExportEsModuleAnnotationNoDefault from "./with-type-module/export-esModule-annotation-no-default.cjs";
import * as WithTypeModuleExportEsModuleAnnotation from "./with-type-module/export-esModule-annotation.cjs";
import * as WithTypeModuleExportEsModuleNoAnnotation from "./with-type-module/export-esModule-no-annotation.cjs";
import * as WithoutTypeModuleExportEsModuleAnnotationMissingDefault from "./without-type-module/export-esModule-annotation-empty.cjs";
import * as WithoutTypeModuleExportEsModuleAnnotationNoDefault from "./without-type-module/export-esModule-annotation-no-default.cjs";
import * as WithoutTypeModuleExportEsModuleAnnotation from "./without-type-module/export-esModule-annotation.cjs";
import * as WithoutTypeModuleExportEsModuleNoAnnotation from "./without-type-module/export-esModule-no-annotation.cjs";

describe('without type: "module"', () => {
  test("module.exports = {}", () => {
    expect(WithoutTypeModuleExportEsModuleAnnotationMissingDefault.default).toEqual({});
    expect(WithoutTypeModuleExportEsModuleAnnotationMissingDefault.__esModule).toBeUndefined();
  });

  test("exports.__esModule = true", () => {
    expect(WithoutTypeModuleExportEsModuleAnnotationNoDefault.default).toEqual({
      __esModule: true,
    });

    // The module namespace object will not have the __esModule property.
    expect(WithoutTypeModuleExportEsModuleAnnotationNoDefault.__esModule).toBeUndefined();
  });

  test("exports.default = true; exports.__esModule = true;", () => {
    expect(WithoutTypeModuleExportEsModuleAnnotation.default).toBeTrue();
    expect(WithoutTypeModuleExportEsModuleAnnotation.__esModule).toBeUndefined();
  });

  test("exports.default = true;", () => {
    expect(WithoutTypeModuleExportEsModuleNoAnnotation.default).toEqual({
      default: true,
    });
    expect(WithoutTypeModuleExportEsModuleAnnotation.__esModule).toBeUndefined();
  });
});

describe('with type: "module"', () => {
  test("module.exports = {}", () => {
    expect(WithTypeModuleExportEsModuleAnnotationMissingDefault.default).toEqual({});
    expect(WithTypeModuleExportEsModuleAnnotationMissingDefault.__esModule).toBeUndefined();
  });

  test("exports.__esModule = true", () => {
    expect(WithTypeModuleExportEsModuleAnnotationNoDefault.default).toEqual({
      __esModule: true,
    });

    // The module namespace object WILL have the __esModule property.
    expect(WithTypeModuleExportEsModuleAnnotationNoDefault.__esModule).toBeTrue();
  });

  test("exports.default = true; exports.__esModule = true;", () => {
    expect(WithTypeModuleExportEsModuleAnnotation.default).toEqual({
      default: true,
      __esModule: true,
    });
    expect(WithTypeModuleExportEsModuleAnnotation.__esModule).toBeTrue();
  });

  test("exports.default = true;", () => {
    expect(WithTypeModuleExportEsModuleNoAnnotation.default).toEqual({
      default: true,
    });
    expect(WithTypeModuleExportEsModuleAnnotation.__esModule).toBeTrue();
  });
});

describe("exports object with a getter", () => {
  // The getter takes module.exports off the path that reads a plain object. The rules above still apply.
  const getter = `Object.defineProperty(exports, "getter", { get: () => "value", enumerable: true });`;
  test.each([
    ["exports.default = true; exports.__esModule = true;", exports => exports.default],
    ["exports.__esModule = true;", exports => exports],
    ["exports.default = true;", exports => exports],
  ])("%s", async (source, defaultOf) => {
    using dir = tempDir("cjs-esmodule-getter-exports", { "mod.cjs": `${getter}\n${source}` });
    const ns = await import(join(String(dir), "mod.cjs"));
    expect(ns.getter).toBe("value");
    expect(ns.default).toBe(defaultOf(require(join(String(dir), "mod.cjs"))));
    expect(ns.__esModule).toBeUndefined();
  });

  test("a default getter that throws, with exports.__esModule = true", async () => {
    using dir = tempDir("cjs-esmodule-default-throws", {
      "mod.cjs": `
        Object.defineProperty(exports, "default", { get() { throw new Error("default"); }, enumerable: true });
        exports.__esModule = true;
        exports.named = "named";
      `,
    });
    const ns = await import(join(String(dir), "mod.cjs"));
    expect({ ...ns }).toStrictEqual({ default: undefined, named: "named" });
  });
});

describe("CJS exports the ESM wrapper cannot enumerate", () => {
  // Building the synthetic ESM namespace enumerates module.exports; if that throws, the import
  // fails with the real error instead of yielding an empty namespace.
  test.each([false, true])("ownKeys trap throws (__esModule: %p)", async esModule => {
    using dir = tempDir("cjs-ownkeys-throws", {
      "mod.cjs": `module.exports = new Proxy({ __esModule: ${esModule}, a: 1 }, {
        ownKeys() { throw new Error("ownKeys trap"); },
      });`,
    });
    await expect(import(join(String(dir), "mod.cjs"))).rejects.toThrow("ownKeys trap");
  });

  test.each([
    ["before the import", `const { proxy, revoke } = Proxy.revocable({ a: 1, b: 2 }, {}); revoke();`],
    [
      "by the getter of an earlier export",
      `const { proxy, revoke } = Proxy.revocable({ get a() { revoke(); return 1; }, b: 2 }, {});`,
    ],
  ])("Proxy revoked %s", async (_, revocable) => {
    using dir = tempDir("cjs-revoked-proxy", { "mod.cjs": `${revocable} module.exports = proxy;` });
    await expect(import(join(String(dir), "mod.cjs"))).rejects.toThrow("Proxy has already been revoked");
  });
});

describe("CJS export that throws when the ESM wrapper reads it", () => {
  // The export is undefined and the import succeeds, whatever kind of object module.exports is. Node gives the
  // same for these files: the three assignments make its lexer list the names.
  const names = `exports.before = 0; exports.boom = 0; exports.after = 0;`;
  const properties = `before: 1, get boom() { throw new Error("boom"); }, after: 2`;
  test.each([
    ["Proxy whose target has a getter that throws", `new Proxy({ ${properties} }, {})`],
    [
      "Proxy whose get trap throws",
      `new Proxy({ before: 1, boom: 0, after: 2 }, {
        get(target, key, receiver) {
          if (key === "boom") throw new Error("boom");
          return Reflect.get(target, key, receiver);
        },
      })`,
    ],
    ["node:vm context global", `require("node:vm").runInNewContext("this", { ${properties} })`],
    [
      "node:vm context global with __esModule",
      `require("node:vm").runInNewContext("this", { __esModule: true, ${properties} })`,
    ],
  ])("%s", async (_, exports) => {
    using dir = tempDir("cjs-export-throws", { "mod.cjs": `${names}\nmodule.exports = ${exports};` });
    const ns = await import(join(String(dir), "mod.cjs"));
    expect({ before: ns.before, hasBoom: "boom" in ns, boom: ns.boom, after: ns.after }).toEqual({
      before: 1,
      hasBoom: true,
      boom: undefined,
      after: 2,
    });
  });

  const throwingProxy = `${names}\nmodule.exports = new Proxy({ ${properties} }, {});`;
  const importer = `import { before, boom, after } from "./mod.cjs";\nexport default { before, boom, after };`;

  test("static import", async () => {
    using dir = tempDir("cjs-export-throws", { "mod.cjs": throwingProxy, "importer.mjs": importer });
    const { default: imported } = await import(join(String(dir), "importer.mjs"));
    expect(imported).toEqual({ before: 1, boom: undefined, after: 2 });
  });

  test("require() of an ES module that imports it", () => {
    using dir = tempDir("cjs-export-throws", { "mod.cjs": throwingProxy, "importer.mjs": importer });
    expect(require(join(String(dir), "importer.mjs")).default).toEqual({ before: 1, boom: undefined, after: 2 });
  });

  test("entry point", async () => {
    using dir = tempDir("cjs-export-throws", { "mod.cjs": `${throwingProxy}\nconsole.log("ran");` });
    await using proc = Bun.spawn({ cmd: [bunExe(), "mod.cjs"], env: bunEnv, cwd: String(dir), stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ran\n", stderr: "", exitCode: 0 });
  });

  test("Worker entry point", async () => {
    using dir = tempDir("cjs-export-throws", { "mod.cjs": throwingProxy });
    const worker = new Worker(join(String(dir), "mod.cjs"));
    const { promise, resolve, reject } = Promise.withResolvers();
    worker.addEventListener("error", event => reject(event.error ?? new Error(event.message)));
    worker.addEventListener("close", event => resolve(event.code));
    expect(await promise).toBe(0);
  });

  test("vi.importActual() of the file behind vi.doMock()", async () => {
    using dir = tempDir("cjs-export-throws", { "mod.cjs": throwingProxy });
    const path = join(String(dir), "mod.cjs");
    const proxy = require(path);
    vi.doMock(path, () => ({ mocked: true }));
    try {
      const { default: actualDefault, ...actual } = await vi.importActual(path);
      expect(actual).toStrictEqual({ before: 1, boom: undefined, after: 2 });
      expect(actualDefault).toBe(proxy);
    } finally {
      vi.doUnmock(path);
    }
  });

  // For these mocks the test runner makes the exports of the original itself, from what require() returned.
  test("the original of the file behind mock.module() and jest.doMock()", async () => {
    using dir = tempDir("cjs-export-throws-mock", {
      ...Object.fromEntries(["a", "b", "c", "d"].map(name => [`${name}.cjs`, throwingProxy])),
      "original.test.js": `
        import { expect, jest, mock, test, vi } from "bun:test";

        function expectOriginal(original, proxy) {
          const { default: originalDefault, ...named } = original;
          expect(named).toStrictEqual({ before: 1, boom: undefined, after: 2 });
          expect(originalDefault).toBe(proxy);
        }

        test("mock.module() then vi.importActual()", async () => {
          const proxy = require("./a.cjs");
          mock.module("./a.cjs", () => ({ mocked: true }));
          expectOriginal(await vi.importActual("./a.cjs"), proxy);
        });

        test("jest.doMock() then vi.importActual()", async () => {
          const proxy = require("./b.cjs");
          jest.doMock("./b.cjs", () => ({ mocked: true }));
          expectOriginal(await vi.importActual("./b.cjs"), proxy);
        });

        test("mock.module() with importOriginal", async () => {
          const proxy = require("./c.cjs");
          let original;
          await mock.module("./c.cjs", async importOriginal => {
            original = await importOriginal();
            return { mocked: true };
          });
          expectOriginal(original, proxy);
        });

        test("a factory that returns the CommonJS module object", async () => {
          const proxy = require("./d.cjs");
          mock.module("./other.cjs", () => require.cache[require.resolve("./d.cjs")]);
          expectOriginal(await import("./other.cjs"), proxy);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(" 4 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  });
});

describe("CJS exports behind a Proxy", () => {
  // The wrapper calls no trap but ownKeys and get, until a read throws. Then it looks that key up once.
  const traps = `{
    ownKeys(target) {
      log.push("ownKeys");
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      log.push("getOwnPropertyDescriptor " + key);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(target, key, receiver) {
      log.push("get " + key);
      return Reflect.get(target, key, receiver);
    },
  }`;

  test("the traps that run", async () => {
    using dir = tempDir("cjs-proxy-traps", {
      "log.cjs": `module.exports = [];`,
      "mod.cjs": `
        const log = require("./log.cjs");
        module.exports = new Proxy({ before: 1, get boom() { throw new Error("boom"); }, after: 2 }, ${traps});
      `,
    });
    const { default: _, ...named } = await import(join(String(dir), "mod.cjs"));
    expect(named).toStrictEqual({ before: 1, boom: undefined, after: 2 });
    expect(require(join(String(dir), "log.cjs"))).toEqual([
      "ownKeys",
      "get before",
      "get boom",
      "getOwnPropertyDescriptor boom",
      "get after",
    ]);
  });

  test.each([
    ["the sandbox of a node:vm context", `vm.runInNewContext("this", sandbox)`],
    [
      "the sandbox of a context whose global is the sandbox of another context",
      `vm.runInNewContext("this", vm.runInNewContext("this", sandbox))`,
    ],
  ])("the traps that run for %s", async (_, exports) => {
    using dir = tempDir("cjs-proxy-sandbox-traps", {
      "log.cjs": `module.exports = [];`,
      "mod.cjs": `
        const vm = require("node:vm");
        const log = require("./log.cjs");
        const sandbox = new Proxy({ before: 1, get boom() { throw new Error("boom"); }, after: 2 }, ${traps});
        module.exports = ${exports};
        log.length = 0;
      `,
    });
    const ns = await import(join(String(dir), "mod.cjs"));
    expect({ before: ns.before, boom: ns.boom, after: ns.after }).toEqual({ before: 1, boom: undefined, after: 2 });
    // The global of the context also lists its built-ins, and reads each through the sandbox.
    const log = require(join(String(dir), "log.cjs")).filter(entry =>
      /before|boom|after|ownKeys|Descriptor/.test(entry),
    );
    expect(log).toEqual(["ownKeys", "get before", "get boom", "getOwnPropertyDescriptor boom", "get after"]);
  });

  test("a key that the target does not have is an export", async () => {
    using dir = tempDir("cjs-proxy-virtual-key", {
      "mod.cjs": `module.exports = new Proxy({}, {
        ownKeys() { return ["virtual"]; },
        get(target, key) { return key === "virtual" ? "value" : undefined; },
      });`,
    });
    const { default: _, ...named } = await import(join(String(dir), "mod.cjs"));
    expect(named).toEqual({ virtual: "value" });
  });
});

test.each([
  ["an Array", `["a", "b"]`, { 0: "a", 1: "b", length: 2 }],
  ["a Uint8Array", `new Uint8Array([5, 6])`, { 0: 5, 1: 6 }],
  ["a Proxy of an Array", `new Proxy(["a", "b"], {})`, { 0: "a", 1: "b", length: 2 }],
])("CJS exports that are %s export the index keys", async (_, exports, expected) => {
  using dir = tempDir("cjs-index-keys", { "mod.cjs": `module.exports = ${exports};` });
  const { default: _default, ...named } = await import(join(String(dir), "mod.cjs"));
  expect(named).toEqual(expected);
});

describe("node:vm context global as CJS exports", () => {
  test("a sandbox property reads as it does in the context", async () => {
    using dir = tempDir("cjs-vm-global", {
      "mod.cjs": `
        const sandbox = {};
        sandbox.self = sandbox;
        module.exports = require("node:vm").runInNewContext("this", sandbox);
      `,
    });
    const ns = await import(join(String(dir), "mod.cjs"));
    // In the context, the sandbox object reads as the global.
    expect(ns.self === ns.default).toBe(true);
  });

  // The getter of `first` runs before the wrapper comes to `second`. The read of the global then says whether
  // `second` is still there.
  const deletesSecond = object => `get() { delete ${object}.second; return 1; }, enumerable: true, configurable: true`;
  test.each([
    [
      "the sandbox",
      `const sandbox = {};
       Object.defineProperty(sandbox, "first", { ${deletesSecond("sandbox")} });
       sandbox.second = 2;
       module.exports = vm.runInNewContext("this", sandbox);`,
      { first: 1, hasSecond: false, second: undefined },
    ],
    [
      "the sandbox, whose prototype has the key",
      `const sandbox = Object.create({ second: "inherited" });
       Object.defineProperty(sandbox, "first", { ${deletesSecond("sandbox")} });
       sandbox.second = 2;
       module.exports = vm.runInNewContext("this", sandbox);`,
      { first: 1, hasSecond: true, second: "inherited" },
    ],
    [
      "a context that has no sandbox",
      `const context = vm.createContext(vm.constants.DONT_CONTEXTIFY);
       Object.defineProperty(context, "first", { ${deletesSecond("context")} });
       context.second = 2;
       module.exports = context;`,
      { first: 1, hasSecond: false, second: undefined },
    ],
    [
      "the target of a Proxy sandbox",
      `const target = {};
       Object.defineProperty(target, "first", { ${deletesSecond("target")} });
       target.second = 2;
       module.exports = vm.runInNewContext("this", new Proxy(target, {}));`,
      { first: 1, hasSecond: false, second: undefined },
    ],
  ])("a key that the getter of an earlier export deletes from %s", async (_, source, expected) => {
    using dir = tempDir("cjs-vm-global-deleted", { "mod.cjs": `const vm = require("node:vm");\n${source}` });
    const ns = await import(join(String(dir), "mod.cjs"));
    expect({ first: ns.first, hasSecond: "second" in ns, second: ns.second }).toEqual(expected);
  });

  test("a default that the getter of an earlier export deletes leaves the global as the default export", async () => {
    using dir = tempDir("cjs-vm-global-deleted-default", {
      "mod.cjs": `
        const sandbox = { __esModule: true, get first() { delete sandbox.default; return 1; }, default: "d" };
        module.exports = require("node:vm").runInNewContext("this", sandbox);
      `,
    });
    const ns = await import(join(String(dir), "mod.cjs"));
    expect(ns.default).toBe(require(join(String(dir), "mod.cjs")));
  });

  test("a key that a Proxy sandbox lists is an export when the read finds it", async () => {
    using dir = tempDir("cjs-vm-global-listed", {
      "mod.cjs": `
        const sandbox = new Proxy(Object.create({ inherited: "from the prototype" }), {
          ownKeys: () => ["inherited", "missing"],
        });
        module.exports = require("node:vm").runInNewContext("this", sandbox);
      `,
    });
    const ns = await import(join(String(dir), "mod.cjs"));
    expect({ inherited: ns.inherited, hasMissing: "missing" in ns }).toEqual({
      inherited: "from the prototype",
      hasMissing: false,
    });
  });
});

describe("__esModule defined as a getter", () => {
  // The ESM wrapper checks for __esModule without running user code, so it ignores a getter
  // and the default import is module.exports.
  test.concurrent.each([
    ["import", `import def, { named } from "./getter.cjs";`],
    ["import()", `const { default: def, named } = await import("./getter.cjs");`],
  ])("%s doesn't call the getter", async (_, importGetter) => {
    using dir = tempDir("cjs-esmodule-getter", {
      "getter.cjs": `
        globalThis.getterCalls = 0;
        Object.defineProperty(exports, "__esModule", {
          get() {
            globalThis.getterCalls++;
            return true;
          },
        });
        exports.default = "default";
        exports.named = "named";
      `,
      "entry.mjs": `
        ${importGetter}
        console.log(JSON.stringify({ defaultImport: typeof def, named, getterCalls: globalThis.getterCalls }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      // Makes every build abort if the lookup calls into JS. By default only builds with assertions
      // abort, and release builds silently get undefined.
      env: { ...bunEnv, BUN_JSC_crashOnDisallowedVMEntry: "1", BUN_ENABLE_CRASH_REPORTING: "0" },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe(`{"defaultImport":"object","named":"named","getterCalls":0}\n`);
    expect(exitCode).toBe(0);
  });
});
