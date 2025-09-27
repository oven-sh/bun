import { describe, expect, test } from "bun:test";
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
    // CommonJS always exports entire module.exports as default
    expect(WithoutTypeModuleExportEsModuleAnnotationMissingDefault.default).toEqual({});
    expect(WithoutTypeModuleExportEsModuleAnnotationMissingDefault.__esModule).toBeUndefined();
  });

  test("exports.__esModule = true", () => {
    // CommonJS exports entire module.exports as default, including __esModule property
    expect(WithoutTypeModuleExportEsModuleAnnotationNoDefault.default).toEqual({
      __esModule: true,
    });

    // The module namespace object should have __esModule as a named export
    expect(WithoutTypeModuleExportEsModuleAnnotationNoDefault.__esModule).toBe(true);
  });

  test("exports.default = true; exports.__esModule = true;", () => {
    // CommonJS exports entire module.exports as default
    expect(WithoutTypeModuleExportEsModuleAnnotation.default).toEqual({
      default: true,
      __esModule: true,
    });
    expect(WithoutTypeModuleExportEsModuleAnnotation.__esModule).toBe(true);
  });

  test("exports.default = true;", () => {
    // CommonJS exports entire module.exports as default
    expect(WithoutTypeModuleExportEsModuleNoAnnotation.default).toEqual({
      default: true,
    });
    expect(WithoutTypeModuleExportEsModuleNoAnnotation.__esModule).toBeUndefined();
  });
});

describe('with type: "module"', () => {
  test("module.exports = {}", () => {
    // CommonJS always exports entire module.exports as default, regardless of type:module
    expect(WithTypeModuleExportEsModuleAnnotationMissingDefault.default).toEqual({});
    expect(WithTypeModuleExportEsModuleAnnotationMissingDefault.__esModule).toBeUndefined();
  });

  test("exports.__esModule = true", () => {
    // CommonJS exports entire module.exports as default, including __esModule property
    expect(WithTypeModuleExportEsModuleAnnotationNoDefault.default).toEqual({
      __esModule: true,
    });

    // The module namespace object should have __esModule as a named export
    expect(WithTypeModuleExportEsModuleAnnotationNoDefault.__esModule).toBe(true);
  });

  test("exports.default = true; exports.__esModule = true;", () => {
    // CommonJS exports entire module.exports as default
    expect(WithTypeModuleExportEsModuleAnnotation.default).toEqual({
      default: true,
      __esModule: true,
    });
    // __esModule should be available as a named export
    expect(WithTypeModuleExportEsModuleAnnotation.__esModule).toBe(true);
  });

  test("exports.default = true;", () => {
    // CommonJS exports entire module.exports as default
    expect(WithTypeModuleExportEsModuleNoAnnotation.default).toEqual({
      default: true,
    });
    expect(WithTypeModuleExportEsModuleNoAnnotation.__esModule).toBeUndefined();
  });
});
