import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

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
      "invalid loader - must be js, jsx, tsx, ts, css, json, jsonc, json5, toml, yaml, xml, text, wasm, or md",
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

  test("xml", () => {
    const out = t.transformSync(`<a b="1"><c>x</c></a>`, "xml");
    expect(out).toContain("export default");
    expect(out).toContain('"@b": "1"');
    expect(out).toContain('c: "x"');
  });

  test("text", () => {
    expect(t.transformSync("hello", "text")).toContain("export default");
  });
});

// One row for each loader name that transform() and transformSync() declare. No top-level key
// here is a reserved word: with such a key the printed module does not parse.
describe("Bun.Transpiler prints a module for each loader of transform() and transformSync()", () => {
  type TransformLoader = NonNullable<Parameters<Bun.Transpiler["transform"]>[1]>;
  const modules: Record<TransformLoader, [input: string, defaultExport: unknown]> = {
    js: ["export default 1;", 1],
    jsx: ["export default 1;", 1],
    ts: ["export default 1 as number;", 1],
    tsx: ["export default 1 as number;", 1],
    json: ['{ "name": "bun", "tags": [1, 2] }', { name: "bun", tags: [1, 2] }],
    jsonc: ['{ "name": "bun", /* a comment */ "tags": [1, 2], }', { name: "bun", tags: [1, 2] }],
    json5: ["{ name: 'bun', tags: [1, 2], }", { name: "bun", tags: [1, 2] }],
    toml: ['name = "bun"\ntags = [1, 2]', { name: "bun", tags: [1, 2] }],
    yaml: ["name: bun\ntags:\n  - 1\n  - 2", { name: "bun", tags: [1, 2] }],
    xml: ["<pkg><name>bun</name></pkg>", { pkg: { name: "bun" } }],
    text: ["Hello, Bun!", "Hello, Bun!"],
    md: ["# Hello", "<h1>Hello</h1>\n"],
  };
  const t = new Bun.Transpiler();

  test.each(Object.keys(modules) as TransformLoader[])("%s", async loader => {
    const [input, defaultExport] = modules[loader];
    const output = t.transformSync(input, loader);
    expect(await t.transform(input, loader)).toBe(output);

    using dir = tempDir("transpiler-loader-argument", { "printed.mjs": output });
    const printed = await import(join(String(dir), "printed.mjs"));
    expect(printed.default).toEqual(defaultExport);
  });
});
