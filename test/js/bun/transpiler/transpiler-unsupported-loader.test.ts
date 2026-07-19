import { describe, expect, test } from "bun:test";

// `Loader::from_string` accepts these names (they are real bundler loaders) but
// `Bun.Transpiler` cannot produce source text for them.
const unsupported = ["file", "napi", "node", "base64", "dataurl", "sh", "sqlite", "sqlite_embedded", "html"] as const;

describe("Bun.Transpiler rejects non-transpilable loaders", () => {
  const t = new Bun.Transpiler({ loader: "ts" });

  describe.each(unsupported)("%s", loader => {
    test("transformSync", () => {
      expect(() => t.transformSync("let x = 1", loader as any)).toThrow(TypeError);
    });

    test("transform", () => {
      expect(() => t.transform("let x = 1", loader as any)).toThrow(TypeError);
    });

    test("scan", () => {
      expect(() => t.scan("let x = 1", loader as any)).toThrow(TypeError);
    });
  });

  test("error message names the loader", () => {
    expect(() => t.transformSync("let x = 1", "file" as any)).toThrow(
      'loader "file" is not supported in Bun.Transpiler',
    );
  });

  test("unknown-loader message lists only transpilable loaders", () => {
    expect(() => t.transformSync("let x = 1", "bogus" as any)).toThrow(TypeError);
    expect(() => t.transformSync("let x = 1", "bogus" as any)).toThrow(
      "invalid loader - must be js, jsx, tsx, ts, css, json, jsonc, json5, toml, yaml, text, wasm, or md",
    );
  });
});

describe("Bun.Transpiler still accepts data-format loaders", () => {
  const t = new Bun.Transpiler({ loader: "ts" });

  test("json", () => {
    expect(t.transformSync('{"a":1}', "json")).toContain("export default");
  });

  test("toml", () => {
    expect(t.transformSync("a = 1", "toml")).toContain("export default");
  });

  test("text", () => {
    expect(t.transformSync("hello", "text")).toContain("export default");
  });
});
