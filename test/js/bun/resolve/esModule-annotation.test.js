import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
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

describe('with type: "module" in a nameless package.json of a parent directory', () => {
  // The "type" that decides whether the annotation counts comes from the nearest
  // package.json, with or without a "name" (DirInfo.package_json_for_module_type).
  test("exports.default = true; exports.__esModule = true;", async () => {
    using dir = tempDir("esmodule-annotation-nameless-scope", {
      "package.json": `{ "type": "module" }`,
      "lib/export-esModule-annotation.cjs": `exports.default = true;\nexports.__esModule = true;\n`,
    });
    const ns = await import(join(String(dir), "lib/export-esModule-annotation.cjs"));
    expect(ns.default).toEqual({ default: true, __esModule: true });
    expect(ns.__esModule).toBeTrue();
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
