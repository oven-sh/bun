import { test, expect } from "bun:test";
import * as ExportEsModuleAnnotationMissingDefault from "./export-esModule-annotation-empty.cjs";
import * as ExportEsModuleAnnotationNoDefault from "./export-esModule-annotation-no-default.cjs";
import * as ExportEsModuleAnnotation from "./export-esModule-annotation.cjs";
import * as ExportEsModuleNoAnnotation from "./export-esModule-no-annotation.cjs";
import DefaultExportForExportEsModuleAnnotationNoDefault from "./export-esModule-annotation-no-default.cjs";
import DefaultExportForExportEsModuleAnnotation from "./export-esModule-annotation.cjs";
import DefaultExportForExportEsModuleNoAnnotation from "./export-esModule-no-annotation.cjs";

test("empty exports object", () => {
  expect(ExportEsModuleAnnotationMissingDefault.default).toBe(undefined);
  expect(ExportEsModuleAnnotationMissingDefault.__esModule).toBeUndefined();
});

test("exports.__esModule = true", () => {
  expect(ExportEsModuleAnnotationNoDefault.default).toEqual({
    // in this case, since it's the CommonJS module.exports object, it leaks the __esModule
    __esModule: true,
  });

  // The module namespace object will not have the __esModule property.
  expect(ExportEsModuleAnnotationNoDefault).not.toHaveProperty("__esModule");

  expect(DefaultExportForExportEsModuleAnnotationNoDefault).toEqual({
    __esModule: true,
  });
});

test("exports.default = true; exports.__esModule = true;", () => {
  expect(ExportEsModuleAnnotation.default).toBeTrue();
  expect(ExportEsModuleAnnotation.__esModule).toBeUndefined();
  expect(DefaultExportForExportEsModuleAnnotation).toBeTrue();
});

test("exports.default = true;", () => {
  expect(ExportEsModuleNoAnnotation.default).toEqual({
    default: true,
  });
  expect(ExportEsModuleAnnotation.__esModule).toBeUndefined();
  expect(DefaultExportForExportEsModuleNoAnnotation).toEqual({
    default: true,
  });
});
