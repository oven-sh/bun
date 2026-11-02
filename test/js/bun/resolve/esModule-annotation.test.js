import { describe, expect, test } from "bun:test";
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

  test("the traps that run for the sandbox of a node:vm context", async () => {
    using dir = tempDir("cjs-proxy-sandbox-traps", {
      "log.cjs": `module.exports = [];`,
      "mod.cjs": `
        const log = require("./log.cjs");
        const sandbox = new Proxy({ before: 1, get boom() { throw new Error("boom"); }, after: 2 }, ${traps});
        module.exports = require("node:vm").runInNewContext("this", sandbox);
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

test("CJS export that the getter of an earlier export deletes is not read from the prototype", async () => {
  using dir = tempDir("cjs-export-deleted", {
    "mod.cjs": `
      const object = Object.create({ second: "inherited" });
      Object.defineProperty(object, "first", { get() { delete object.second; return 1; }, enumerable: true });
      object.second = 2;
      module.exports = object;
    `,
  });
  const { default: _, ...named } = await import(join(String(dir), "mod.cjs"));
  expect(named).toEqual({ first: 1 });
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

  // The rules for an ordinary object (see esm-defineProperty.test.ts) apply to the sandbox.
  test("a non-enumerable getter of the sandbox is not an export, a non-enumerable value is", async () => {
    using dir = tempDir("cjs-vm-global-hidden", {
      "log.cjs": `module.exports = [];`,
      "mod.cjs": `
        const log = require("./log.cjs");
        const sandbox = { a: 1, get g() { log.push("getter g"); return 2; } };
        Object.defineProperty(sandbox, "hidden", { get() { log.push("getter hidden"); return 3; }, enumerable: false });
        Object.defineProperty(sandbox, "hiddenValue", { value: 4, enumerable: false });
        module.exports = require("node:vm").runInNewContext("this", sandbox);
      `,
    });
    const ns = await import(join(String(dir), "mod.cjs"));
    expect({ a: ns.a, g: ns.g, hasHidden: "hidden" in ns, hiddenValue: ns.hiddenValue }).toEqual({
      a: 1,
      g: 2,
      hasHidden: false,
      hiddenValue: 4,
    });
    expect(require(join(String(dir), "log.cjs"))).toEqual(["getter g"]);
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
