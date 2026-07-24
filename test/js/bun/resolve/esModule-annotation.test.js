import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
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

// https://github.com/oven-sh/bun/issues/6747
describe("accessor properties on module.exports", () => {
  const fixtures = join(import.meta.dir, "without-type-module");

  test("without __esModule, getters are not invoked or exposed as named exports", async () => {
    const src = `
      import colors, * as ns from ${JSON.stringify(join(fixtures, "export-with-getter.cjs"))};
      process.stdout.write("imported\\n");
      process.stdout.write("keys=" + Object.keys(ns).sort().join(",") + "\\n");
      process.stdout.write("red=" + ns.red + "\\n");
      delete colors.lightBlue;
      process.stdout.write("afterDelete=" + colors.lightBlue + "\\n");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--input-type=module", "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("imported\nkeys=default,red\nred=#f00\nafterDelete=undefined\n");
    expect(exitCode).toBe(0);
  });

  test("without __esModule, the getter remains on the default export and still works", async () => {
    const src = `
      import colors from ${JSON.stringify(join(fixtures, "export-with-getter.cjs"))};
      process.stdout.write("imported\\n");
      process.stdout.write("value=" + colors.lightBlue + "\\n");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--input-type=module", "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("imported\nGETTER:lightBlue\nvalue=#0ff\n");
    expect(exitCode).toBe(0);
  });

  test("with __esModule, getters are still invoked for named exports", async () => {
    const src = `
      import * as ns from ${JSON.stringify(join(fixtures, "export-esModule-with-getter.cjs"))};
      process.stdout.write("imported\\n");
      process.stdout.write("keys=" + Object.keys(ns).sort().join(",") + "\\n");
      process.stdout.write("lightBlue=" + ns.lightBlue + "\\n");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--input-type=module", "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("GETTER:lightBlue\nimported\nkeys=default,lightBlue,red\nlightBlue=#0ff\n");
    expect(exitCode).toBe(0);
  });
});
