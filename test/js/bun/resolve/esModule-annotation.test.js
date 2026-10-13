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
});

describe("__esModule is a getter", () => {
  // The ESM wrapper looks for the annotation without running user code, so it does not call the
  // getter. A getter is not the annotation: the default import is module.exports.
  test.concurrent.each([
    ["import", `import def, { named } from "./getter.cjs";`],
    ["import()", `const { default: def, named } = await import("./getter.cjs");`],
  ])("%s does not call it", async (_, importGetter) => {
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
      env: bunEnv,
      cwd: String(dir),
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe(`{"defaultImport":"object","named":"named","getterCalls":0}\n`);
    expect(exitCode).toBe(0);
  });
});
