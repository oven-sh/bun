import { describe, expect, test } from "bun:test";
import Module, { stripTypeScriptTypes } from "node:module";
import ModuleAlt, { stripTypeScriptTypes as stripTypeScriptTypesAlt } from "module";

describe("node:module stripTypeScriptTypes", () => {
  test("exports parity and signature", () => {
    expect(typeof stripTypeScriptTypes).toBe("function");
    expect(typeof stripTypeScriptTypesAlt).toBe("function");
    expect(typeof Module.stripTypeScriptTypes).toBe("function");
    expect(typeof ModuleAlt.stripTypeScriptTypes).toBe("function");

    const req = require("node:module");
    const reqAlt = require("module");
    expect(typeof req.stripTypeScriptTypes).toBe("function");
    expect(typeof reqAlt.stripTypeScriptTypes).toBe("function");

    expect(stripTypeScriptTypes).toBe(stripTypeScriptTypesAlt);
    expect(stripTypeScriptTypes).toBe(Module.stripTypeScriptTypes);
    expect(stripTypeScriptTypes).toBe(ModuleAlt.stripTypeScriptTypes);
    expect(stripTypeScriptTypes).toBe(req.stripTypeScriptTypes);
    expect(stripTypeScriptTypes).toBe(reqAlt.stripTypeScriptTypes);

    expect(stripTypeScriptTypes.length).toBe(1);
    expect(stripTypeScriptTypes.name).toBe("stripTypeScriptTypes");
  });

  describe("argument validation", () => {
    test("validates code argument type", () => {
      // @ts-ignore
      expect(() => stripTypeScriptTypes(123)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
      // @ts-ignore
      expect(() => stripTypeScriptTypes(null)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
      // @ts-ignore
      expect(() => stripTypeScriptTypes(undefined)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    test("validates options argument type", () => {
      // @ts-ignore
      expect(() => stripTypeScriptTypes("const x = 1;", 123)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
      // @ts-ignore
      expect(() => stripTypeScriptTypes("const x = 1;", null)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
      // @ts-ignore
      expect(() => stripTypeScriptTypes("const x = 1;", [])).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    test("validates mode option", () => {
      // @ts-ignore
      expect(() => stripTypeScriptTypes("const x = 1;", { mode: "invalid" })).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_VALUE",
        }),
      );
    });

    test("validates sourceMap option", () => {
      // @ts-ignore
      expect(() => stripTypeScriptTypes("const x = 1;", { sourceMap: "invalid" })).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );

      expect(() => stripTypeScriptTypes("const x = 1;", { mode: "strip", sourceMap: true })).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_VALUE",
        }),
      );
    });

    test("validates sourceUrl option", () => {
      // @ts-ignore
      expect(() => stripTypeScriptTypes("const x = 1;", { sourceUrl: 123 })).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });
  });

  describe("strip mode (default)", () => {
    test("strips variable and function type annotations", () => {
      const code = "const x: number = 42;";
      const stripped = stripTypeScriptTypes(code);
      expect(stripped).toContain("const x = 42;");
      expect(stripped).not.toContain("number");

      const fnCode = "function add(a: number, b: number): number { return a + b; }";
      const strippedFn = stripTypeScriptTypes(fnCode);
      expect(strippedFn).toContain("function add(a, b) {");
      expect(strippedFn).toContain("return a + b;");
    });

    test("strips interfaces, type aliases, and generics", () => {
      const code = `
interface User {
  name: string;
  age: number;
}
type ID = string | number;
function wrap<T>(val: T): { value: T } {
  return { value: val };
}
const result: ID = wrap<number>(10).value;
`;
      const stripped = stripTypeScriptTypes(code);
      expect(stripped).not.toContain("interface User");
      expect(stripped).not.toContain("type ID");
      expect(stripped).toContain("function wrap(val) {");
      expect(stripped).toContain("return { value: val };");
    });

    test("throws ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX on enum", () => {
      expect(() => stripTypeScriptTypes("enum Direction { Up, Down }")).toThrow(
        expect.objectContaining({
          name: "SyntaxError",
          code: "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
        }),
      );

      expect(() => stripTypeScriptTypes("export enum Direction { Up, Down }")).toThrow(
        expect.objectContaining({
          name: "SyntaxError",
          code: "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
        }),
      );

      expect(() => stripTypeScriptTypes("const enum Direction { Up, Down }")).toThrow(
        expect.objectContaining({
          name: "SyntaxError",
          code: "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
        }),
      );
    });

    test("throws ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX on namespace and module", () => {
      expect(() => stripTypeScriptTypes("namespace Utils { export const x = 1; }")).toThrow(
        expect.objectContaining({
          name: "SyntaxError",
          code: "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
        }),
      );

      expect(() => stripTypeScriptTypes("module Utils { export const x = 1; }")).toThrow(
        expect.objectContaining({
          name: "SyntaxError",
          code: "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
        }),
      );
    });

    test("allows ambient declare enum and declare namespace in strip mode", () => {
      expect(() => stripTypeScriptTypes("declare enum Foo { A }")).not.toThrow();
      expect(() => stripTypeScriptTypes("declare namespace Foo { const x: number; }")).not.toThrow();
      expect(() => stripTypeScriptTypes('declare module "foo" {}')).not.toThrow();
    });
  });

  describe("transform mode", () => {
    test("transforms enum into executable JS", () => {
      const code = "enum Color { Red = 1, Green = 2 }";
      const transformed = stripTypeScriptTypes(code, { mode: "transform" });
      expect(transformed).toContain("Color");
      expect(transformed).toContain("Red");
      expect(transformed).toContain("Green");
    });

    test("transforms namespace into executable JS", () => {
      const code = "namespace MySpace { export const val = 123; }";
      const transformed = stripTypeScriptTypes(code, { mode: "transform" });
      expect(transformed).toContain("MySpace");
      expect(transformed).toContain("123");
    });

    test("generates sourcemap when sourceMap: true", () => {
      const code = "const x: number = 42;";
      const transformed = stripTypeScriptTypes(code, {
        mode: "transform",
        sourceMap: true,
        sourceUrl: "my-file.ts",
      });
      expect(transformed).toContain("//# sourceMappingURL=data:application/json;base64,");
      const match = transformed.match(/\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/);
      expect(match).not.toBeNull();
      const mapJson = JSON.parse(atob(match![1]));
      expect(mapJson.version).toBe(3);
      expect(mapJson.sources).toEqual(["my-file.ts"]);
    });
  });

  describe("syntax errors", () => {
    test("throws SyntaxError on invalid code", () => {
      expect(() => stripTypeScriptTypes("const x: = 123;")).toThrow(
        expect.objectContaining({
          name: "SyntaxError",
        }),
      );
    });
  });
});
