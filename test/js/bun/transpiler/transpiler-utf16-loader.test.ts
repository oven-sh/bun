import { describe, expect, test } from "bun:test";

describe("Bun.Transpiler with a UTF-16 loader string", () => {
  // Previously, passing a string with non-Latin-1 characters as the loader
  // argument would hit a debug assertion because the code called .slice()
  // on a ZigString that may be backed by UTF-16 storage.
  const utf16 = "тsx";

  test("scan", () => {
    const t = new Bun.Transpiler();
    expect(() => t.scan("", utf16)).toThrow(TypeError);
  });

  test("scanImports", () => {
    const t = new Bun.Transpiler();
    expect(() => t.scanImports("", utf16)).toThrow(TypeError);
  });

  test("transformSync", () => {
    const t = new Bun.Transpiler();
    expect(() => t.transformSync("", utf16)).toThrow(TypeError);
  });

  test("transform", () => {
    const t = new Bun.Transpiler();
    expect(() => t.transform("", utf16)).toThrow(TypeError);
  });

  test("constructor", () => {
    expect(() => new Bun.Transpiler({ loader: utf16 as any })).toThrow(TypeError);
  });
});
