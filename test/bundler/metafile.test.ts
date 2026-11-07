import type { BunPlugin } from "bun";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { statSync } from "node:fs";
import { basename } from "node:path";

// Type definitions for metafile structure
interface MetafileImport {
  path: string;
  kind: string;
  original?: string;
  entryPoint?: string;
  external?: boolean;
  with?: { type: string };
}

interface MetafileInput {
  bytes: number;
  imports: MetafileImport[];
  format?: "esm" | "cjs";
}

interface MetafileOutput {
  bytes: number;
  inputs: Record<string, { bytesInOutput: number }>;
  imports: Array<{ path: string; kind: string; external?: boolean }>;
  exports: string[];
  entryPoint?: string;
  cssBundle?: string;
}

interface Metafile {
  inputs: Record<string, MetafileInput>;
  outputs: Record<string, MetafileOutput>;
}

describe("bundler metafile", () => {
  test("metafile option returns metafile object", async () => {
    using dir = tempDir("metafile-test", {
      "index.js": `import { foo } from "./foo.js"; console.log(foo);`,
      "foo.js": `export const foo = "hello";`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();
    expect(typeof result.metafile).toBe("object");

    // Check metafile structure - metafile returns the JSON directly (backward compatible with esbuild)
    const metafile = result.metafile as Metafile;
    expect(metafile.inputs).toBeDefined();
    expect(typeof metafile.inputs).toBe("object");
    expect(metafile.outputs).toBeDefined();
    expect(typeof metafile.outputs).toBe("object");
  });

  test("metafile inputs contain file metadata", async () => {
    using dir = tempDir("metafile-inputs-test", {
      "entry.js": `import { helper } from "./helper.js"; helper();`,
      "helper.js": `export function helper() { return 42; }`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    const inputs = (result.metafile as Metafile).inputs as Record<string, MetafileInput>;
    const inputKeys = Object.keys(inputs);

    // Should have at least 2 input files
    expect(inputKeys.length).toBeGreaterThanOrEqual(2);

    // Each input should have bytes and imports
    for (const key of inputKeys) {
      const input = inputs[key];
      expect(typeof input.bytes).toBe("number");
      expect(input.bytes).toBeGreaterThan(0);
      expect(Array.isArray(input.imports)).toBe(true);
    }
  });

  test("metafile outputs contain chunk metadata", async () => {
    using dir = tempDir("metafile-outputs-test", {
      "main.js": `export const value = 123;`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/main.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    const outputs = (result.metafile as Metafile).outputs as Record<string, MetafileOutput>;
    const outputKeys = Object.keys(outputs);

    // Should have at least 1 output
    expect(outputKeys.length).toBeGreaterThanOrEqual(1);

    // Each output should have bytes, inputs, imports, exports
    for (const key of outputKeys) {
      const output = outputs[key];
      expect(typeof output.bytes).toBe("number");
      expect(typeof output.inputs).toBe("object");
      expect(Array.isArray(output.imports)).toBe(true);
      expect(Array.isArray(output.exports)).toBe(true);
    }
  });

  test("metafile tracks import relationships", async () => {
    using dir = tempDir("metafile-imports-test", {
      "index.js": `import { a } from "./a.js"; console.log(a);`,
      "a.js": `import { b } from "./b.js"; export const a = b + 1;`,
      "b.js": `export const b = 10;`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    // Find the entry file in inputs
    const inputs = (result.metafile as Metafile).inputs as Record<string, MetafileInput>;
    let entryInput: MetafileInput | null = null;
    for (const [path, input] of Object.entries(inputs)) {
      if (path.includes("index.js")) {
        entryInput = input;
        break;
      }
    }

    expect(entryInput).not.toBeNull();
    // Entry should have an import to a.js
    expect(entryInput!.imports.length).toBeGreaterThan(0);
  });

  test("metafile imports have resolved path and original specifier", async () => {
    using dir = tempDir("metafile-resolved-path-test", {
      "entry.js": `import { foo } from "./lib/helper.js"; console.log(foo);`,
      "lib/helper.js": `export const foo = 42;`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    // Find the entry file in inputs
    const inputs = (result.metafile as Metafile).inputs as Record<string, MetafileInput>;
    let entryImports: MetafileImport[] | null = null;
    for (const [path, input] of Object.entries(inputs)) {
      if (path.includes("entry.js")) {
        entryImports = input.imports;
        break;
      }
    }

    expect(entryImports).not.toBeNull();
    expect(entryImports!.length).toBe(1);

    const imp = entryImports![0];
    // path should be the resolved path (contains lib/helper.js or lib\helper.js on Windows)
    expect(imp.path.includes("lib/helper.js") || imp.path.includes("lib\\helper.js")).toBe(true);
    expect(imp.kind).toBe("import-statement");
    // original should be the original import specifier
    expect(imp.original).toBe("./lib/helper.js");
  });

  test("metafile without option returns undefined", async () => {
    using dir = tempDir("metafile-disabled-test", {
      "test.js": `console.log("test");`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/test.js`],
      // metafile is not set (defaults to false)
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeUndefined();
  });

  test("metafile tracks exports", async () => {
    using dir = tempDir("metafile-exports-test", {
      "lib.js": `export const foo = 1; export const bar = 2; export default function() {}`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/lib.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    const outputs = (result.metafile as Metafile).outputs as Record<string, MetafileOutput>;
    const outputKeys = Object.keys(outputs);
    expect(outputKeys.length).toBeGreaterThanOrEqual(1);

    // Find the main output
    const mainOutput = outputs[outputKeys[0]];
    expect(mainOutput.exports).toBeDefined();
    expect(Array.isArray(mainOutput.exports)).toBe(true);
  });

  test("metafile includes entryPoint for entry chunks", async () => {
    using dir = tempDir("metafile-entrypoint-test", {
      "entry.js": `console.log("entry");`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    const outputs = (result.metafile as Metafile).outputs as Record<string, MetafileOutput>;
    const outputKeys = Object.keys(outputs);

    // At least one output should have entryPoint
    let hasEntryPoint = false;
    for (const key of outputKeys) {
      if (outputs[key].entryPoint) {
        hasEntryPoint = true;
        expect(typeof outputs[key].entryPoint).toBe("string");
        break;
      }
    }
    expect(hasEntryPoint).toBe(true);
  });

  test("metafile includes format for JS inputs", async () => {
    using dir = tempDir("metafile-format-test", {
      "esm.js": `export const x = 1;`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/esm.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    const inputs = (result.metafile as Metafile).inputs as Record<string, MetafileInput>;
    // At least one input should have format
    let hasFormat = false;
    for (const key of Object.keys(inputs)) {
      if (inputs[key].format) {
        hasFormat = true;
        expect(["esm", "cjs"]).toContain(inputs[key].format);
        break;
      }
    }
    expect(hasFormat).toBe(true);
  });

  test("metafile detects cjs format for CommonJS files", async () => {
    using dir = tempDir("metafile-cjs-format-test", {
      "entry.js": `const foo = require("./foo.js"); console.log(foo);`,
      "foo.js": `module.exports = { value: 42 };`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    const inputs = (result.metafile as Metafile).inputs as Record<string, MetafileInput>;
    // Find the foo.js file which uses CommonJS exports
    let fooInput: MetafileInput | null = null;
    for (const [path, input] of Object.entries(inputs)) {
      if (path.includes("foo.js")) {
        fooInput = input;
        break;
      }
    }

    expect(fooInput).not.toBeNull();
    expect(fooInput!.format).toBe("cjs");
  });

  test("metafile marks external imports", async () => {
    using dir = tempDir("metafile-external-test", {
      "index.js": `import fs from "fs"; console.log(fs);`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      metafile: true,
      external: ["fs"],
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    const inputs = (result.metafile as Metafile).inputs as Record<string, MetafileInput>;
    let foundExternal = false;

    for (const key of Object.keys(inputs)) {
      const input = inputs[key];
      for (const imp of input.imports) {
        if (imp.path === "fs" && imp.external === true) {
          foundExternal = true;
          break;
        }
      }
    }

    expect(foundExternal).toBe(true);
  });

  test("metafile with code splitting", async () => {
    using dir = tempDir("metafile-splitting-test", {
      "a.js": `import { shared } from "./shared.js"; console.log("a", shared);`,
      "b.js": `import { shared } from "./shared.js"; console.log("b", shared);`,
      "shared.js": `export const shared = "shared value";`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/a.js`, `${dir}/b.js`],
      metafile: true,
      splitting: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    const outputs = (result.metafile as Metafile).outputs as Record<string, MetafileOutput>;
    const outputKeys = Object.keys(outputs);

    // With splitting, we should have more outputs (shared chunk)
    expect(outputKeys.length).toBeGreaterThanOrEqual(2);
  });

  test("metafile includes with clause for JSON imports", async () => {
    using dir = tempDir("metafile-with-json-test", {
      "entry.js": `import data from "./data.json"; console.log(data);`,
      "data.json": `{"key": "value"}`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    // Find the entry file in inputs
    const inputs = (result.metafile as Metafile).inputs as Record<string, MetafileInput>;
    let jsonImport: MetafileImport | null = null;
    for (const [path, input] of Object.entries(inputs)) {
      if (path.includes("entry.js")) {
        for (const imp of input.imports) {
          if (imp.path.includes("data.json")) {
            jsonImport = imp;
            break;
          }
        }
        break;
      }
    }

    expect(jsonImport).not.toBeNull();
    expect(jsonImport!.with).toBeDefined();
    expect(jsonImport!.with!.type).toBe("json");
  });

  test("metafile tracks require-call imports", async () => {
    using dir = tempDir("metafile-require-test", {
      "entry.js": `const foo = require("./foo.js"); console.log(foo);`,
      "foo.js": `module.exports = { value: 42 };`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    // Find the entry file in inputs
    const inputs = (result.metafile as Metafile).inputs as Record<string, MetafileInput>;
    let requireImport: MetafileImport | null = null;
    for (const [path, input] of Object.entries(inputs)) {
      if (path.includes("entry.js")) {
        for (const imp of input.imports) {
          if (imp.path.includes("foo.js")) {
            requireImport = imp;
            break;
          }
        }
        break;
      }
    }

    expect(requireImport).not.toBeNull();
    expect(requireImport!.kind).toBe("require-call");
  });

  test("metafile tracks dynamic-import imports", async () => {
    using dir = tempDir("metafile-dynamic-import-test", {
      "entry.js": `import("./dynamic.js").then(m => console.log(m));`,
      "dynamic.js": `export const value = 123;`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      metafile: true,
      splitting: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    // Find the entry file in inputs
    const inputs = (result.metafile as Metafile).inputs as Record<string, MetafileInput>;
    let dynamicImport: MetafileImport | null = null;
    for (const [path, input] of Object.entries(inputs)) {
      if (path.includes("entry.js")) {
        for (const imp of input.imports) {
          if (imp.kind === "dynamic-import" && imp.original === "./dynamic.js") {
            dynamicImport = imp;
            break;
          }
        }
        break;
      }
    }

    expect(dynamicImport).not.toBeNull();
    expect(dynamicImport!.kind).toBe("dynamic-import");
    expect(dynamicImport!.original).toBe("./dynamic.js");
    // The path should be the final chunk path (e.g., "./chunk-xxx.js"), not the internal unique_key
    expect(dynamicImport!.path).toMatch(/^\.\/chunk-[a-z0-9]+\.js$/);

    // Verify the path corresponds to an actual output chunk
    const outputs = (result.metafile as Metafile).outputs as Record<string, MetafileOutput>;
    const outputPaths = Object.keys(outputs);
    expect(outputPaths).toContain(dynamicImport!.path);
  });

  describe.each(["browser", "bun"] as const)("target %s", target => {
    test.each([
      { kind: "dynamic-import", call: `import("./lazy.js").then(m => console.log(m.value))` },
      ...(target === "bun"
        ? [{ kind: "require-call", call: `export const load = () => require("./lazy.js").value` }]
        : []),
    ])("metafile names the input a split $kind loads as entryPoint", async ({ kind, call }) => {
      using dir = tempDir("metafile-split-import-test", {
        "entry.js": `import { shared } from "./shared.js"; console.log(shared); ${call};`,
        "lazy.js": `import { shared } from "./shared.js"; export const value = shared + 1;`,
        "shared.js": `export const shared = 123;`,
      });

      const result = await Bun.build({
        entrypoints: [`${dir}/entry.js`],
        metafile: true,
        splitting: true,
        target,
      });

      expect(result.success).toBe(true);
      const { inputs, outputs } = result.metafile as Metafile;
      const [lazyInput] = Object.keys(inputs).filter(path => path.endsWith("lazy.js"));
      const [entryInput] = Object.keys(inputs).filter(path => path.endsWith("entry.js"));
      const [lazyOutput] = Object.keys(outputs).filter(path => outputs[path].entryPoint === lazyInput);
      expect(lazyInput).toBeString();
      expect(lazyOutput).toMatch(/^\.\/chunk-[a-z0-9]+\.js$/);
      expect(inputs[entryInput].imports.filter(imp => imp.kind === kind)).toEqual([
        { path: lazyOutput, kind, original: "./lazy.js", entryPoint: lazyInput, external: true },
      ]);
      // A static import has no chunk of its own to name.
      expect(inputs[entryInput].imports.filter(imp => imp.kind === "import-statement")).toEqual([
        {
          path: Object.keys(inputs).find(path => path.endsWith("shared.js"))!,
          kind: "import-statement",
          original: "./shared.js",
        },
      ]);
    });
  });

  test("metafile names the same input as entryPoint when two entry points import() it", async () => {
    using dir = tempDir("metafile-split-import-two-entries", {
      "a.js": `import("./lazy.js").then(m => console.log("a", m.value));`,
      "b.js": `import("./lazy.js").then(m => console.log("b", m.value));`,
      "lazy.js": `export const value = 1;`,
    });
    const result = await Bun.build({
      entrypoints: [`${dir}/a.js`, `${dir}/b.js`],
      metafile: true,
      splitting: true,
    });
    expect(result.success).toBe(true);
    const { inputs } = result.metafile as Metafile;
    const input = (name: string) => Object.keys(inputs).find(path => path.endsWith(name))!;
    const split = (name: string) =>
      inputs[input(name)].imports.filter(imp => imp.kind === "dynamic-import").map(imp => imp.entryPoint);
    expect({ a: split("a.js"), b: split("b.js") }).toEqual({ a: [input("lazy.js")], b: [input("lazy.js")] });
  });

  test("metafile includes cssBundle for CSS outputs", async () => {
    using dir = tempDir("metafile-css-bundle-test", {
      "entry.js": `import "./styles.css"; console.log("styled");`,
      "styles.css": `.foo { color: red; }`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    const outputs = (result.metafile as Metafile).outputs as Record<string, MetafileOutput>;

    // Find the JS output that should reference the CSS bundle
    let foundCssBundle = false;
    for (const [outputPath, output] of Object.entries(outputs)) {
      if (outputPath.endsWith(".js") && output.cssBundle) {
        foundCssBundle = true;
        expect(typeof output.cssBundle).toBe("string");
        expect(output.cssBundle.endsWith(".css")).toBe(true);
        break;
      }
    }

    expect(foundCssBundle).toBe(true);
  });

  test("metafile import paths match input keys for all importers of a shared module", async () => {
    // When the same module is imported from many files, every import record must emit the
    // resolved pretty path (matching the "inputs" key), not the raw "./b/shared.js" specifier.
    const N = 30;
    const files: Record<string, string> = { "b/shared.js": `export const s = 1;` };
    for (let i = 0; i < N; i++) {
      files[`mid${i}.js`] = `import { s } from "./b/shared.js"; export const m${i} = s;`;
    }
    files["entry.js"] = Array.from({ length: N }, (_, i) => `export * from "./mid${i}.js";`).join("\n");

    using dir = tempDir("metafile-shared-import", files);

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      metafile: true,
    });
    expect(result.success).toBe(true);

    const metafile = result.metafile as Metafile;
    const inputKeys = Object.keys(metafile.inputs);
    const sharedKey = inputKeys.find(k => k.endsWith("b/shared.js") || k.endsWith("b\\shared.js"));
    expect(sharedKey).toBeDefined();

    // Every midN.js must report its import of shared.js using the exact input key,
    // and must carry the original specifier.
    const midImports: Array<{ from: string; path: string; original?: string }> = [];
    for (const [key, input] of Object.entries(metafile.inputs)) {
      if (!/[\\/]mid\d+\.js$/.test(key)) continue;
      expect(input.imports.length).toBe(1);
      midImports.push({ from: key, path: input.imports[0].path, original: input.imports[0].original });
    }
    expect(midImports.length).toBe(N);

    const bad = midImports.filter(m => m.path !== sharedKey);
    expect(bad).toEqual([]);
    for (const m of midImports) {
      expect(m.original).toBe("./b/shared.js");
    }

    // Also verify entry.js imports of midN.js all resolve to input keys.
    const entryKey = inputKeys.find(k => k.endsWith("entry.js"))!;
    for (const imp of metafile.inputs[entryKey].imports) {
      expect(imp.path in metafile.inputs).toBe(true);
    }
  });

  test("metafile import paths are deterministic across repeated builds", async () => {
    const N = 30;
    const files: Record<string, string> = { "b/shared.js": `export const s = 1;` };
    for (let i = 0; i < N; i++) {
      files[`mid${i}.js`] = `import { s } from "./b/shared.js"; export const m${i} = s;`;
    }
    files["entry.js"] = Array.from({ length: N }, (_, i) => `export * from "./mid${i}.js";`).join("\n");

    using dir = tempDir("metafile-determinism", files);

    async function collectImportPaths() {
      const r = await Bun.build({ entrypoints: [`${dir}/entry.js`], metafile: true });
      expect(r.success).toBe(true);
      const m = r.metafile as Metafile;
      return Object.keys(m.inputs)
        .sort()
        .map(k => [k, m.inputs[k].imports.map(i => ({ path: i.path, original: i.original }))]);
    }

    const first = await collectImportPaths();
    for (let i = 0; i < 4; i++) {
      expect(await collectImportPaths()).toEqual(first);
    }
  });

  test("metafile does not leak internal runtime source name for runtime-helper imports", async () => {
    using dir = tempDir("metafile-runtime-helper", {
      "entry.js": `using x = { [Symbol.dispose]() {} };\nconsole.log(x);\n`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      metafile: true,
    });
    expect(result.success).toBe(true);

    const metafile = result.metafile as Metafile;
    const entryKey = Object.keys(metafile.inputs).find(k => k.endsWith("entry.js"))!;
    const importPaths = metafile.inputs[entryKey].imports.map(i => i.path);
    expect(importPaths).toEqual(["bun:wrap"]);
    expect("runtime" in metafile.inputs).toBe(false);
  });

  test("metafile handles circular imports", async () => {
    using dir = tempDir("metafile-circular-test", {
      "a.js": `import { b } from "./b.js"; export const a = 1; console.log(b);`,
      "b.js": `import { a } from "./a.js"; export const b = 2; console.log(a);`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/a.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    const inputs = (result.metafile as Metafile).inputs as Record<string, MetafileInput>;
    const inputKeys = Object.keys(inputs);

    // Should have both files
    expect(inputKeys.length).toBe(2);

    // Both files should have imports to each other
    let aImportsB = false;
    let bImportsA = false;
    for (const [path, input] of Object.entries(inputs)) {
      if (path.includes("a.js")) {
        aImportsB = input.imports.some(imp => imp.path.includes("b.js"));
      }
      if (path.includes("b.js")) {
        bImportsA = input.imports.some(imp => imp.path.includes("a.js"));
      }
    }

    expect(aImportsB).toBe(true);
    expect(bImportsA).toBe(true);
  });
});

describe("Bun.build metafile option variants", () => {
  test("metafile: string writes JSON to file path", async () => {
    using dir = tempDir("metafile-string-path", {
      "entry.js": `import { foo } from "./foo.js"; console.log(foo);`,
      "foo.js": `export const foo = "hello";`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      outdir: `${dir}/dist`,
      metafile: "output-meta.json" as any,
    });

    expect(result.success).toBe(true);

    // Check JSON file was written (relative to outdir)
    const jsonFile = Bun.file(`${dir}/dist/output-meta.json`);
    expect(await jsonFile.exists()).toBe(true);

    // Verify JSON content
    const content = await jsonFile.text();
    const parsed = JSON.parse(content);
    expect(parsed.inputs).toBeDefined();
    expect(parsed.outputs).toBeDefined();

    // Also check result.metafile is available (backward compatible - returns JSON directly)
    expect(result.metafile).toBeDefined();
    const metafile = result.metafile as Metafile;
    expect(typeof metafile).toBe("object");
    expect(metafile.inputs).toBeDefined();
    expect(metafile.outputs).toBeDefined();
  });

  test("metafile: { json: path } writes JSON to specified path", async () => {
    using dir = tempDir("metafile-object-json", {
      "main.js": `export const value = 42;`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/main.js`],
      outdir: `${dir}/dist`,
      metafile: { json: "custom-meta.json" } as any,
    });

    expect(result.success).toBe(true);

    // Check JSON file was written (relative to outdir)
    const jsonFile = Bun.file(`${dir}/dist/custom-meta.json`);
    expect(await jsonFile.exists()).toBe(true);

    // Verify content
    const parsed = JSON.parse(await jsonFile.text());
    expect(parsed.inputs).toBeDefined();
    expect(parsed.outputs).toBeDefined();
  });

  test("metafile: { markdown: path } writes markdown to specified path", async () => {
    using dir = tempDir("metafile-object-md", {
      "app.js": `import "./util.js"; console.log("app");`,
      "util.js": `console.log("util");`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/app.js`],
      outdir: `${dir}/dist`,
      metafile: { markdown: "analysis.md" } as any,
    });

    expect(result.success).toBe(true);

    // Check markdown file was written (relative to outdir)
    const mdFile = Bun.file(`${dir}/dist/analysis.md`);
    expect(await mdFile.exists()).toBe(true);

    // Verify markdown content
    const content = await mdFile.text();
    expect(content).toContain("# Bundle Analysis Report");
    expect(content).toContain("app.js");

    // Also check result.metafile is available (backward compatible - returns JSON directly)
    expect(result.metafile).toBeDefined();
    const metafile = result.metafile as Metafile;
    expect(metafile.inputs).toBeDefined();
  });

  test("metafile: { json: path, markdown: path } writes both files", async () => {
    using dir = tempDir("metafile-object-both", {
      "index.js": `import { helper } from "./helper.js"; helper();`,
      "helper.js": `export function helper() { return "help"; }`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
      metafile: {
        json: "meta.json",
        markdown: "meta.md",
      } as any,
    });

    expect(result.success).toBe(true);

    // Check both files exist (relative to outdir)
    const jsonFile = Bun.file(`${dir}/dist/meta.json`);
    const mdFile = Bun.file(`${dir}/dist/meta.md`);
    expect(await jsonFile.exists()).toBe(true);
    expect(await mdFile.exists()).toBe(true);

    // Verify JSON
    const parsedJson = JSON.parse(await jsonFile.text());
    expect(parsedJson.inputs).toBeDefined();

    // Verify markdown
    const mdContent = await mdFile.text();
    expect(mdContent).toContain("# Bundle Analysis Report");

    // result.metafile is available (backward compatible - returns JSON directly)
    expect(result.metafile).toBeDefined();
    const metafile = result.metafile as Metafile;
    expect(metafile.inputs).toBeDefined();
    expect(metafile.outputs).toBeDefined();
  });

  test("metafile is lazily parsed", async () => {
    using dir = tempDir("metafile-lazy-json", {
      "entry.js": `export const x = 1;`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    // First access should parse the JSON (backward compatible - returns JSON directly)
    const metafile1 = result.metafile as Metafile;
    expect(metafile1).toBeDefined();
    expect(typeof metafile1).toBe("object");
    expect(metafile1.inputs).toBeDefined();

    // Second access should return the same cached object
    const metafile2 = result.metafile as Metafile;
    expect(metafile1).toBe(metafile2); // Same reference (memoized)
  });

  test("metafile: true provides metafile object", async () => {
    using dir = tempDir("metafile-true", {
      "test.js": `console.log("test");`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/test.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();
    // Backward compatible - returns JSON directly
    const metafile = result.metafile as Metafile;
    expect(metafile.inputs).toBeDefined();
    expect(metafile.outputs).toBeDefined();
  });

  test("metafile: { markdown: path } provides metafile object", async () => {
    using dir = tempDir("metafile-md-has-json", {
      "test.js": `export const a = 1;`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/test.js`],
      outdir: `${dir}/dist`,
      metafile: { markdown: "meta.md" } as any,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();
    // Backward compatible - returns JSON directly
    const metafile = result.metafile as Metafile;
    expect(metafile.inputs).toBeDefined();
    expect(metafile.outputs).toBeDefined();
  });
});

// CLI tests for --metafile-md
import { bunEnv, bunExe, isCI, isDebug, isWindows } from "harness";

describe("bun build --metafile-md", () => {
  test("generates markdown metafile with default name", async () => {
    using dir = tempDir("metafile-md-test", {
      "index.js": `import { foo } from "./foo.js"; console.log(foo);`,
      "foo.js": `export const foo = "hello";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "index.js", "--metafile-md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    // Check meta.md was created
    const metaFile = Bun.file(`${dir}/meta.md`);
    expect(await metaFile.exists()).toBe(true);

    const content = await metaFile.text();

    // Verify markdown structure
    expect(content).toContain("# Bundle Analysis Report");
    expect(content).toContain("## Quick Summary");
    expect(content).toContain("## Entry Point Analysis");
    expect(content).toContain("## Full Module Graph");

    // Verify content includes our files
    expect(content).toContain("index.js");
    expect(content).toContain("foo.js");
  });

  test("generates markdown metafile with custom name", async () => {
    using dir = tempDir("metafile-md-custom-name", {
      "main.js": `export const value = 42;`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "main.js", "--metafile-md=build-graph.md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    // Check custom-named file was created
    const metaFile = Bun.file(`${dir}/build-graph.md`);
    expect(await metaFile.exists()).toBe(true);

    const content = await metaFile.text();
    expect(content).toContain("# Bundle Analysis Report");
    expect(content).toContain("main.js");
  });

  test("generates both metafile and metafile-md when both specified", async () => {
    using dir = tempDir("metafile-both", {
      "app.js": `import "./util.js"; console.log("app");`,
      "util.js": `console.log("util");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "app.js", "--metafile=meta.json", "--metafile-md=meta.md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    // Check both files exist
    const jsonFile = Bun.file(`${dir}/meta.json`);
    const mdFile = Bun.file(`${dir}/meta.md`);

    expect(await jsonFile.exists()).toBe(true);
    expect(await mdFile.exists()).toBe(true);

    // Verify JSON is valid
    const jsonContent = await jsonFile.text();
    const parsed = JSON.parse(jsonContent);
    expect(parsed.inputs).toBeDefined();
    expect(parsed.outputs).toBeDefined();

    // Verify markdown structure
    const mdContent = await mdFile.text();
    expect(mdContent).toContain("# Bundle Analysis Report");
  });

  test("markdown includes summary metrics", async () => {
    using dir = tempDir("metafile-md-metrics", {
      "entry.js": `import { a } from "./a.js"; import { b } from "./b.js"; console.log(a, b);`,
      "a.js": `export const a = 1;`,
      "b.js": `export const b = 2;`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--metafile-md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Verify summary table
    expect(content).toContain("| Input modules |");
    expect(content).toContain("| Entry points |");
    expect(content).toContain("| Total output size |");
    expect(content).toContain("| ESM modules |");
  });

  test("markdown includes module format information", async () => {
    using dir = tempDir("metafile-md-format", {
      "esm.js": `export const x = 1;`,
      "cjs.js": `module.exports = { y: 2 };`,
      "entry.js": `import { x } from "./esm.js"; const cjs = require("./cjs.js"); console.log(x, cjs);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--metafile-md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Should indicate both esm and cjs formats
    expect(content).toContain("**Format**: esm");
    expect(content).toContain("**Format**: cjs");
  });

  test("markdown includes external imports", async () => {
    using dir = tempDir("metafile-md-external", {
      "app.js": `import fs from "fs"; console.log(fs);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "app.js", "--metafile-md", "--external=fs", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Check external is noted in summary
    expect(content).toContain("External imports");

    // Check external marker in imports list
    expect(content).toContain("**external**");
  });

  test("markdown includes exports list", async () => {
    using dir = tempDir("metafile-md-exports", {
      "lib.js": `export const foo = 1; export const bar = 2; export default function main() {}`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "lib.js", "--metafile-md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Check exports are listed
    expect(content).toContain("**Exports**:");
    expect(content).toContain("`foo`");
    expect(content).toContain("`bar`");
    expect(content).toContain("`default`");
  });

  test("markdown includes bundled modules table", async () => {
    using dir = tempDir("metafile-md-bundled", {
      "index.js": `import { utils } from "./utils.js"; utils();`,
      "utils.js": `export function utils() { return "utility"; }`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "index.js", "--metafile-md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Check bundled modules table
    expect(content).toContain("**Bundled modules**");
    expect(content).toContain("| Bytes | Module |");
  });

  test("markdown includes CSS bundle reference", async () => {
    using dir = tempDir("metafile-md-css", {
      "app.js": `import "./styles.css"; console.log("styled");`,
      "styles.css": `.foo { color: red; }`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "app.js", "--metafile-md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Check CSS bundle reference
    expect(content).toContain("**CSS bundle**:");
    expect(content).toContain(".css");
  });

  test("markdown includes import kinds", async () => {
    using dir = tempDir("metafile-md-import-kinds", {
      "entry.js": `
        import { static_import } from "./static.js";
        const dynamic = import("./dynamic.js");
        const required = require("./required.js");
      `,
      "static.js": `export const static_import = 1;`,
      "dynamic.js": `export const dynamic_value = 2;`,
      "required.js": `module.exports = { required_value: 3 };`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--metafile-md", "--outdir=dist", "--splitting"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Check import kinds are shown
    expect(content).toContain("import-statement");
    expect(content).toContain("dynamic-import");
    expect(content).toContain("require-call");
  });

  test("markdown reports a split import() / require() as an import of the input it loads", async () => {
    using dir = tempDir("metafile-md-split-imports", {
      "entry.js": `
        import("./lazy.js").then(m => console.log(m.value));
        import("external-pkg").then(m => console.log(m));
        export const load = () => require("./required.js").value;
      `,
      "lazy.js": `export const value = 1;`,
      "required.js": `export const value = 2;`,
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "entry.js",
        "--metafile-md",
        "--outdir=dist",
        "--splitting",
        "--target=bun",
        "--external=external-pkg",
      ],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const lines = (await Bun.file(`${dir}/meta.md`).text()).split("\n");

    // lazy.js and required.js are bundled into chunks of their own. Only external-pkg is external.
    expect(lines.filter(line => /^\[(IMPORT|EXTERNAL):/.test(line))).toEqual([
      "[IMPORT: entry.js -> lazy.js]",
      "[EXTERNAL: entry.js imports external-pkg]",
      "[IMPORT: entry.js -> required.js]",
    ]);
    expect(lines.filter(line => line.startsWith("[IMPORTED_BY:")).sort()).toEqual([
      "[IMPORTED_BY: lazy.js <- entry.js]",
      "[IMPORTED_BY: required.js <- entry.js]",
    ]);
    expect(lines.filter(line => line.includes("External imports"))).toEqual(["| External imports | 1 |"]);

    // The module graph lists the same edges.
    expect(lines.filter(line => line.startsWith("- **Imported by**")).sort()).toEqual([
      "- **Imported by** (1 files): `entry.js`",
      "- **Imported by** (1 files): `entry.js`",
      "- **Imported by**: (entry point or orphan)",
    ]);
    expect(
      lines.filter(line => line.startsWith("  - `")).map(line => line.replace(/contributes [^,]+/, "contributes N")),
    ).toEqual([
      "  - `lazy.js` (dynamic-import, contributes N, specifier: `./lazy.js`)",
      "  - `external-pkg` (dynamic-import, **external**)",
      "  - `required.js` (require-call, contributes N, specifier: `./required.js`)",
    ]);
  });

  test("markdown shows commonly imported modules", async () => {
    using dir = tempDir("metafile-md-common-imports", {
      "a.js": `import { shared } from "./shared.js"; console.log("a", shared);`,
      "b.js": `import { shared } from "./shared.js"; console.log("b", shared);`,
      "c.js": `import { shared } from "./shared.js"; console.log("c", shared);`,
      "shared.js": `export const shared = "common code";`,
      "entry.js": `import "./a.js"; import "./b.js"; import "./c.js";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--metafile-md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Verify the Dependency Chains section exists
    expect(content).toContain("## Dependency Chains");
    expect(content).toContain("Most Commonly Imported Modules");

    // shared.js should be listed as commonly imported (by 3 files)
    expect(content).toContain("shared.js");

    // Should show imported by a.js, b.js, c.js
    expect(content).toContain("a.js");
    expect(content).toContain("b.js");
    expect(content).toContain("c.js");
  });

  test("markdown shows largest files for bloat analysis", async () => {
    using dir = tempDir("metafile-md-bloat", {
      "entry.js": `import "./small.js"; import "./large.js";`,
      "small.js": `export const s = 1;`,
      "large.js": `export const large = "${"x".repeat(500)}";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--metafile-md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Verify bloat analysis section
    expect(content).toContain("## Largest Modules by Output Contribution");
    expect(content).toContain("bytes contributed to the output bundle");
    expect(content).toContain("% of Total");
  });

  test("markdown shows output contribution", async () => {
    using dir = tempDir("metafile-md-contrib", {
      "entry.js": `export const x = 1;`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--metafile-md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Should show output contribution in Full Module Graph
    expect(content).toContain("**Output contribution**:");
    expect(content).toMatch(/\d+\.\d+%/); // Should have percentage in Largest Modules section
  });

  test("markdown includes grep-friendly raw data section", async () => {
    using dir = tempDir("metafile-md-grep", {
      "main.js": `import { helper } from "./helper.js"; console.log(helper);`,
      "helper.js": `export const helper = "utility";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "main.js", "--metafile-md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Should have table of contents
    expect(content).toContain("## Table of Contents");
    expect(content).toContain("[Quick Summary]");
    expect(content).toContain("[Raw Data for Searching]");

    // Should have raw data section
    expect(content).toContain("## Raw Data for Searching");

    // Should have grep-friendly markers
    expect(content).toContain("[MODULE:");
    expect(content).toContain("[OUTPUT_BYTES:");
    expect(content).toContain("[IMPORT:");
    expect(content).toContain("[IMPORTED_BY:");

    // main.js imports helper.js should be searchable
    expect(content).toMatch(/\[IMPORT: main\.js -> .*helper\.js\]/);

    // helper.js is imported by main.js
    expect(content).toMatch(/\[IMPORTED_BY: .*helper\.js <- main\.js\]/);
  });

  test("markdown includes entry point markers", async () => {
    using dir = tempDir("metafile-md-entry-markers", {
      "app.js": `console.log("app");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "app.js", "--metafile-md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Should have entry point marker in raw data
    expect(content).toContain("[ENTRY:");
    // Entry format is: [ENTRY: source -> output (bytes)]
    expect(content).toMatch(/\[ENTRY: app\.js -> .*app\.js/);
  });

  test("markdown includes external import markers", async () => {
    using dir = tempDir("metafile-md-external-markers", {
      "index.js": `import fs from "fs"; console.log(fs);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "index.js", "--metafile-md", "--external=fs", "--outdir=dist", "--target=node"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Should have external marker in raw data
    expect(content).toContain("[EXTERNAL:");
    expect(content).toMatch(/\[EXTERNAL: index\.js imports fs\]/);
  });

  test("markdown includes node_modules markers", async () => {
    using dir = tempDir("metafile-md-node-modules", {
      "app.js": `import lodash from "./node_modules/lodash/index.js"; console.log(lodash);`,
      "node_modules/lodash/index.js": `export default { version: "4.0.0" };`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "app.js", "--metafile-md", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const content = await Bun.file(`${dir}/meta.md`).text();

    // Should have node_modules marker in raw data
    expect(content).toContain("[NODE_MODULES:");
    expect(content).toContain("node_modules/lodash");
  });
});

describe("bun build --metafile", () => {
  // Bun.spawn replaces a lone surrogate in a JS string with U+FFFD before it reaches argv,
  // so the raw bytes have to come from the shell. Windows argv is UTF-16 and cannot carry them.
  test.skipIf(isWindows)("escapes a lone surrogate and an invalid byte in an output path", async () => {
    using dir = tempDir("metafile-wtf8", {
      "index.js": `console.log(1);`,
    });

    // "\355\240\200" is U+D800 in WTF-8, "\377" is not valid UTF-8 at all.
    // No --outdir: the bundle goes to stdout and only the metafile is written.
    await using proc = Bun.spawn({
      cmd: [
        "sh",
        "-c",
        `"$1" build index.js --metafile=meta.json --entry-naming "x$(printf '\\355\\240\\200\\377')-[name].[ext]"`,
        "sh",
        bunExe(),
      ],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("console.log(1);");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const bytes = await Bun.file(`${dir}/meta.json`).bytes();
    // Throws on invalid UTF-8.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const metafile = JSON.parse(text) as Metafile;
    expect(Object.keys(metafile.outputs)).toEqual(["./x\uD800\uFFFD-index.js"]);
  });
});

// The bundler writes the final path of a chunk or an asset into the chunks that reference it
// only after it hashes the chunk contents, and appends the source map comment after that.
describe("metafile outputs[..].bytes is the size of the emitted file", () => {
  const splitFiles = {
    "a.ts": `import { shared } from "./shared.ts";\nconsole.log("a", shared);\nimport("./lazy.ts").then(m => console.log(m.lazy));\n`,
    "b.ts": `import { shared } from "./shared.ts";\nconsole.log("b", shared);\n`,
    "lazy.ts": `import { shared } from "./shared.ts";\nexport const lazy = "lazy " + shared;\n`,
    "shared.ts": `export const shared = "shared value";\n`,
  };

  // An outdir takes the loop that writes each chunk to disk. No outdir takes the in-memory loop.
  const destinations = ["on disk", "in memory"] as const;
  const outdirFor = (dir: unknown, destination: (typeof destinations)[number]) =>
    destination === "on disk" ? `${dir}/dist` : undefined;

  /** `bytes` of every metafile output, next to the size of the file the build produced for it. */
  function outputSizes(result: Bun.BuildOutput, outdir: string | undefined) {
    const reported: Record<string, number | undefined> = {};
    const actual: Record<string, number | undefined> = {};
    for (const [key, output] of Object.entries((result.metafile as Metafile).outputs)) {
      reported[key] = output.bytes;
      actual[key] = outdir
        ? statSync(`${outdir}/${key}`).size
        : result.outputs.find(artifact => artifact.path === key)?.size;
    }
    return { reported, actual };
  }

  const withoutHash = (key: string) => key.replace(/-[a-z0-9]+\./, "-[hash].");

  const sourcemaps = ["none", "linked", "inline", "external"] as const;
  test.each(sourcemaps.flatMap(sourcemap => destinations.map(destination => ({ sourcemap, destination }))))(
    "chunks that import other chunks (sourcemap: $sourcemap, $destination)",
    async ({ sourcemap, destination }) => {
      using dir = tempDir("metafile-bytes-splitting", splitFiles);
      const outdir = outdirFor(dir, destination);

      const result = await Bun.build({
        entrypoints: [`${dir}/a.ts`, `${dir}/b.ts`],
        outdir,
        splitting: true,
        sourcemap,
        metafile: true,
      });
      expect(result.success).toBe(true);

      // a, b and lazy each import the shared chunk, and a also imports the lazy chunk.
      const { outputs } = result.metafile as Metafile;
      expect(
        Object.values(outputs)
          .map(output => output.imports.length)
          .sort((a, b) => a - b),
      ).toEqual([0, 1, 1, 2]);

      const { reported, actual } = outputSizes(result, outdir);
      expect(reported).toEqual(actual);
    },
  );

  test.each(destinations)("chunks that reference copied assets (%s)", async destination => {
    using dir = tempDir("metafile-bytes-asset", {
      "entry.ts": `import logo from "./logo.svg";\nimport "./style.css";\nconsole.log(logo);\n`,
      "logo.svg": `<svg xmlns="http://www.w3.org/2000/svg"></svg>\n`,
      "style.css": `body { background: url("./big.png"); }\n`,
      // A stylesheet inlines a smaller file as a data: URL instead of a path.
      "big.png": Buffer.alloc(128 * 1024, "a").toString(),
    });
    const outdir = outdirFor(dir, destination);

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.ts`],
      outdir,
      metafile: true,
    });
    expect(result.success).toBe(true);

    const text = (suffix: string) => result.outputs.find(artifact => artifact.path.endsWith(suffix))!.text();
    expect(await text("entry.js")).toMatch(/"\.\/logo-[a-z0-9]+\.svg"/);
    expect(await text("entry.css")).toMatch(/url\("\.\/big-[a-z0-9]+\.png"\)/);

    const { reported, actual } = outputSizes(result, outdir);
    expect(Object.keys(reported).sort()).toEqual(["./entry.css", "./entry.js"]);
    expect(reported).toEqual(actual);
  });

  test.each(destinations)("an HTML entry point (%s)", async destination => {
    using dir = tempDir("metafile-bytes-html", {
      "index.html": `<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><script type="module" src="./app.ts"></script><img src="./logo.svg"></body></html>\n`,
      "app.ts": `console.log("app");\n`,
      "style.css": `body { color: red; }\n`,
      "logo.svg": `<svg xmlns="http://www.w3.org/2000/svg"></svg>\n`,
    });
    const outdir = outdirFor(dir, destination);

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      outdir,
      metafile: true,
    });
    expect(result.success).toBe(true);

    // The document references its stylesheet, its script and its image by their final paths.
    const html = await result.outputs.find(artifact => artifact.path.endsWith("index.html"))!.text();
    expect(html.match(/(?:href|src)="\.\/[^"]+"/g)?.map(withoutHash)).toEqual([
      `href="./chunk-[hash].css"`,
      `src="./chunk-[hash].js"`,
      `src="./logo-[hash].svg"`,
    ]);

    const { reported, actual } = outputSizes(result, outdir);
    expect(Object.keys(reported).map(withoutHash).sort()).toEqual([
      "./chunk-[hash].css",
      "./chunk-[hash].js",
      "./index.html",
    ]);
    expect(reported).toEqual(actual);
  });

  // `compile` with `target: "browser"` writes one HTML file with the script and the stylesheet inlined.
  // Each inlined chunk keeps its metafile output, with no file of its own to compare against:
  // its bytes are what the document has between the tags.
  test.each(destinations)("a standalone HTML file (%s)", async destination => {
    using dir = tempDir("metafile-bytes-standalone", {
      "index.html": `<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><script type="module" src="./app.ts"></script></body></html>\n`,
      "app.ts": `import logo from "./logo.svg";\nconsole.log("app", logo);\n`,
      "style.css": `body { color: red; }\n`,
      "logo.svg": `<svg xmlns="http://www.w3.org/2000/svg"></svg>\n`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      outdir: outdirFor(dir, destination),
      compile: true,
      target: "browser",
      sourcemap: "inline",
      metafile: true,
    });
    expect(result.outputs.map(artifact => artifact.loader)).toEqual(["html"]);

    const html = await result.outputs[0].text();
    const between = (open: string, close: string) => {
      const start = html.indexOf(open);
      const end = html.indexOf(close, start);
      expect({ open, start: start >= 0, end: end >= 0 }).toEqual({ open, start: true, end: true });
      return html.slice(start + open.length, end);
    };
    const script = between(`<script type="module">`, "</script>");
    const style = between("<style>", "</style>");
    expect(script).toContain(`"data:image/svg+xml;base64,`);
    expect(script).toContain("//# sourceMappingURL=data:application/json;base64,");

    const { outputs } = result.metafile as Metafile;
    expect(
      Object.fromEntries(Object.entries(outputs).map(([key, output]) => [withoutHash(key), output.bytes])),
    ).toEqual({
      "./index.html": Buffer.byteLength(html),
      "./chunk-[hash].js": Buffer.byteLength(script),
      "./chunk-[hash].css": Buffer.byteLength(style),
    });
  });

  test("bun build --metafile --metafile-md", async () => {
    using dir = tempDir("metafile-bytes-cli", splitFiles);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "a.ts",
        "b.ts",
        "--splitting",
        "--sourcemap=linked",
        "--outdir=dist",
        "--metafile=meta.json",
        "--metafile-md=meta.md",
      ],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const { outputs } = (await Bun.file(`${dir}/meta.json`).json()) as Metafile;
    expect(Object.keys(outputs)).toHaveLength(4);
    // a, b and lazy. The report prints the size of each in full in its raw data section.
    const entryKeys = Object.keys(outputs).filter(key => outputs[key].entryPoint !== undefined);
    expect(entryKeys).toHaveLength(3);
    const markdown = await Bun.file(`${dir}/meta.md`).text();
    const entries = [...markdown.matchAll(/^\[ENTRY: \S+ -> (\S+) \((\d+) bytes\)\]$/gm)];

    const onDisk = (keys: string[]) => Object.fromEntries(keys.map(key => [key, statSync(`${dir}/dist/${key}`).size]));
    expect({
      json: Object.fromEntries(Object.entries(outputs).map(([key, output]) => [key, output.bytes])),
      markdown: Object.fromEntries(entries.map(([, key, bytes]) => [key, Number(bytes)])),
    }).toEqual({
      json: onDisk(Object.keys(outputs)),
      markdown: onDisk(entryKeys),
    });
  });
});

// The scan phase gives a file its source index when the parse result of a file that
// imports it arrives. The same build numbers its files in another way each time, so
// no order in the output follows those numbers.
describe("output order does not follow parse order", () => {
  /**
   * A plugin that makes the parse results of `steps` arrive in that order. The file of
   * a step loads only after the bundler asks for `then` of the step before it. The
   * bundler asks for a file when it has the parse result of a file that imports it.
   */
  function parseInOrder(steps: { file: string; then: string }[]): BunPlugin {
    const released = steps.map(() => Promise.withResolvers<void>());
    released[0].resolve();
    return {
      name: "parse-in-order",
      setup(build) {
        build.onLoad({ filter: /./ }, async ({ path }) => {
          const name = basename(path);
          const asked = steps.findIndex(step => step.then === name);
          if (asked !== -1) released[asked + 1]?.resolve();
          const step = steps.findIndex(step => step.file === name);
          if (step !== -1) await released[step].promise;
          return undefined;
        });
      },
    };
  }

  const fiveFiles = {
    "entry.js": `import { a } from "./a.js";\nimport { b } from "./b.js";\nconsole.log(a + b);\n`,
    "a.js": `import { x } from "./x.js";\nexport const a = x;\n`,
    "b.js": `import { y } from "./y.js";\nexport const b = y;\n`,
    "x.js": `export const x = 1;\n`,
    "y.js": `export const y = 2;\n`,
  };
  // Each file comes after the files it imports. esbuild lists them the same way.
  const fiveFilesInOrder = ["x.js", "a.js", "y.js", "b.js", "entry.js"];

  test.concurrent("each input comes after the inputs it imports", async () => {
    using dir = tempDir("metafile-order-cli", fiveFiles);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--outdir=out", "--metafile=meta.json", "--metafile-md=meta.md"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const metafile = (await Bun.file(`${dir}/meta.json`).json()) as Metafile;
    const markdown = await Bun.file(`${dir}/meta.md`).text();
    expect({
      inputs: Object.keys(metafile.inputs),
      inputsOfOutput: Object.keys(metafile.outputs["./entry.js"].inputs),
      // The report lists the largest module first. Modules of one size keep the order of `inputs`.
      markdown: [...markdown.matchAll(/^\[MODULE: (\S+)\]$/gm)].map(match => match[1]),
    }).toEqual({
      inputs: fiveFilesInOrder,
      inputsOfOutput: fiveFilesInOrder,
      markdown: ["entry.js", "x.js", "a.js", "y.js", "b.js"],
    });
  });

  test.concurrent("inputs are in one order, whichever import is parsed first", async () => {
    using dir = tempDir("metafile-order-inputs", fiveFiles);

    async function build(steps: { file: string; then: string }[]) {
      const result = await Bun.build({
        entrypoints: [`${dir}/entry.js`],
        metafile: true,
        plugins: [parseInOrder(steps)],
      });
      return Object.keys((result.metafile as Metafile).inputs).map(key => basename(key));
    }

    const a = { file: "a.js", then: "x.js" };
    const b = { file: "b.js", then: "y.js" };
    expect({ aFirst: await build([a, b]), bFirst: await build([b, a]) }).toEqual({
      aFirst: fiveFilesInOrder,
      bFirst: fiveFilesInOrder,
    });
  });

  // `shared.js` is one module in the server graph and another one in the browser graph, and
  // `page.html` is a manifest module and a page. Each pair has one key in `inputs`. That is
  // a defect of its own. This test holds only the order of the records.
  test.concurrent("two inputs with one path are in one order, whichever is parsed first", async () => {
    using dir = tempDir("metafile-order-two-graphs", {
      "server.js": `import page from "./page.html";\nimport { shared } from "./server-only.js";\nconsole.log(page.index, shared);\n`,
      "server-only.js": `export { shared } from "./shared.js";\n`,
      "page.html": `<!DOCTYPE html><html><head></head><body><script type="module" src="./client.js"></script></body></html>`,
      "client.js": `import { shared } from "./shared.js";\nconsole.log(shared);\n`,
      "shared.js": `export const shared = "shared";\n`,
    });

    async function build(first: string, second: string) {
      const result = await Bun.build({
        entrypoints: [`${dir}/server.js`],
        outdir: `${dir}/out`,
        target: "bun",
        metafile: { json: "meta.json" } as any,
        plugins: [parseInOrder([first, second].map(file => ({ file, then: "shared.js" })))],
      });
      expect(result.success).toBe(true);
      return await Bun.file(`${dir}/out/meta.json`).text();
    }

    const serverFirst = await build("server-only.js", "client.js");
    const browserFirst = await build("client.js", "server-only.js");
    expect(browserFirst).toBe(serverFirst);

    // The files that the server entry point reaches come first, then the files of the page.
    const inputs = serverFirst.slice(0, serverFirst.indexOf(`\n  "outputs"`));
    expect([...inputs.matchAll(/^    "(.+)": \{$/gm)].map(match => basename(match[1]))).toEqual([
      "page.html",
      "shared.js",
      "server-only.js",
      "server.js",
      "shared.js",
      "client.js",
      "page.html",
    ]);
  });

  test.concurrent("CSS chunks are in entry point order, whichever stylesheet is parsed first", async () => {
    const names = ["d", "b", "a", "c"];
    using dir = tempDir(
      "metafile-order-css-chunks",
      Object.fromEntries(
        names.flatMap(name => [
          [`${name}.js`, `import "./${name}.css";\nconsole.log("${name}");\n`],
          [`${name}.css`, `.${name} { color: red; }\n`],
        ]),
      ),
    );

    async function build(parsed: string[]) {
      const result = await Bun.build({
        entrypoints: names.map(name => `${dir}/${name}.js`),
        outdir: `${dir}/out`,
        metafile: true,
        plugins: [parseInOrder(parsed.map(name => ({ file: `${name}.js`, then: `${name}.css` })))],
      });
      return {
        metafile: Object.keys((result.metafile as Metafile).outputs),
        artifacts: result.outputs.map(output => basename(output.path)),
      };
    }

    const expected = {
      metafile: ["./d.js", "./b.js", "./a.js", "./c.js", "./d.css", "./b.css", "./a.css", "./c.css"],
      artifacts: ["d.js", "b.js", "a.js", "c.js", "d.css", "b.css", "a.css", "c.css"],
    };
    expect([await build(names), await build(names.toReversed())]).toEqual([expected, expected]);
  });

  // Ten entry points, because JS chunks leave entry point order past eight.
  test.concurrent.each([[[]], [["--css-chunking"]]])("CSS entry points are in argv order (flags: %j)", async flags => {
    const names = ["h", "c", "j", "a", "e", "b", "i", "d", "g", "f"];
    using dir = tempDir(
      "metafile-order-css-entries",
      Object.fromEntries(names.map(name => [`${name}.css`, `.${name} { color: red; }\n`])),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", ...names.map(name => `${name}.css`), "--outdir=out", "--metafile=meta.json", ...flags],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const { inputs, outputs } = (await Bun.file(`${dir}/meta.json`).json()) as Metafile;
    expect({ inputs: Object.keys(inputs), outputs: Object.keys(outputs) }).toEqual({
      inputs: names.map(name => `${name}.css`),
      outputs: names.map(name => `./${name}.css`),
    });
  });

  // `c.js` and `d.js` print no code, so no output lists them. They are inputs all the same.
  test.concurrent("inputs that print no code are in the same order as the others", async () => {
    using dir = tempDir("metafile-order-no-code", {
      "entry.js": `await import("./a.js");\nawait import("./b.js");\nawait import("./e.js");\n`,
      "a.js": `import "./c.js";\nimport "./d.js";\nconsole.log("a");\n`,
      "b.js": `import "./c.js";\nimport "./shared.js";\nconsole.log("b");\n`,
      "c.js": `export function dead() {}\n`,
      "d.js": `import "./shared.js";\nexport function dead() {}\n`,
      "e.js": `import "./d.js";\nconsole.log("e");\n`,
      "shared.js": `console.log("shared");\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--splitting", "--outdir=out", "--metafile=meta.json"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const { inputs, outputs } = (await Bun.file(`${dir}/meta.json`).json()) as Metafile;
    const printed = new Set(Object.values(outputs).flatMap(output => Object.keys(output.inputs)));
    expect({ inputs: Object.keys(inputs), printed: ["c.js", "d.js"].filter(name => printed.has(name)) }).toEqual({
      inputs: ["c.js", "shared.js", "d.js", "a.js", "b.js", "e.js", "entry.js"],
      printed: [],
    });
  });

  // A chunk hashes the chunks it reaches in chunk order, so the order of the stylesheets
  // that `client.js` loads with import() is part of the name of its chunk.
  test.concurrent("a chunk that loads stylesheets with import() has one name in every directory", async () => {
    const sheets = ["d", "b", "a", "c"];
    const files = {
      "page.html": `<!DOCTYPE html><html><head><link rel="stylesheet" href="./page.css"></head><body><script type="module" src="./client.js"></script></body></html>`,
      "page.css": `.page { color: red; }\n`,
      "client.js": sheets
        .map(name => `document.querySelector("#${name}")?.addEventListener("click", () => import("./${name}.css"));\n`)
        .join(""),
      ...Object.fromEntries(sheets.map(name => [`${name}.css`, `.${name} { color: blue; }\n`])),
    };

    async function build(prefix: string) {
      using dir = tempDir(prefix, files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "page.html", "--splitting", "--css-chunking", "--outdir=out", "--metafile=meta.json"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const { outputs } = (await Bun.file(`${dir}/meta.json`).json()) as Metafile;
      return Object.entries(outputs).map(([key, output]) => ({ key, entryPoint: output.entryPoint }));
    }

    const [first, ...others] = await Promise.all(
      ["metafile-order-import-css", "metafile-order-import-css-in-a-longer-directory", "css-import"].map(build),
    );
    expect(others).toEqual([first, first]);
    // The stylesheet of the page, then one for each import() in source order.
    expect(first.filter(({ key }) => key.endsWith(".css")).map(({ entryPoint }) => entryPoint)).toEqual([
      "page.html",
      ...sheets.map(name => `${name}.css`),
    ]);
  });

  // A server imports a page whose script loads eight modules with import(). Each module has
  // a stylesheet. With the server and the page that is ten entry points: see the CSS entry
  // points test.
  const lazy = ["lazy3", "lazy1", "lazy4", "lazy2", "lazy7", "lazy5", "lazy8", "lazy6"];
  const serverWithLazyStylesheets = {
    "server.js": `import page from "./page.html";\nconsole.log(page.index);\n`,
    "page.html": `<!DOCTYPE html><html><head><link rel="stylesheet" href="./page.css"></head><body><script type="module" src="./client.js"></script></body></html>`,
    "page.css": `.page { color: red; }\n`,
    "client.js": lazy.map(name => `import("./${name}.js");\n`).join(""),
    ...Object.fromEntries(
      lazy.flatMap(name => [
        [`${name}.js`, `import "./${name}.css";\nexport default "${name}";\n`],
        [`${name}.css`, `.${name} { color: blue; }\n`],
      ]),
    ),
  };
  const lazyParsedInOrder = (parsed: string[]) =>
    parseInOrder(parsed.map(name => ({ file: `${name}.js`, then: `${name}.css` })));

  // The manifest of an HTML import is part of the server bundle. It lists the files of
  // the page in chunk order.
  test.concurrent(
    "the manifest of an HTML import is the same bytes, whichever stylesheet is parsed first",
    async () => {
      using dir = tempDir("metafile-order-manifest", serverWithLazyStylesheets);

      async function build(parsed: string[]) {
        const result = await Bun.build({
          entrypoints: [`${dir}/server.js`],
          outdir: `${dir}/out`,
          target: "bun",
          splitting: true,
          plugins: [lazyParsedInOrder(parsed)],
        });
        expect(result.success).toBe(true);
        return await Bun.file(`${dir}/out/server.js`).text();
      }

      const forward = await build(lazy);
      const backward = await build(lazy.toReversed());
      expect(backward).toBe(forward);

      const manifest = JSON.parse(JSON.parse('"' + forward.match(/__jsonParse\("(.+?)"\)/s)![1] + '"')) as {
        files: { input: string; loader: string }[];
      };
      expect(manifest.files.filter(file => file.loader === "css").map(file => file.input)).toEqual([
        "page.html",
        ...lazy.map(name => `${name}.js`),
      ]);
    },
  );

  // An executable holds its files in chunk order. Not concurrent: two compiles would starve
  // the tests beside it. Not on a debug build: one compile copies a binary of over 1 GB.
  test.skipIf(isDebug)(
    "a compiled executable is the same bytes, whichever stylesheet is parsed first",
    async () => {
      using dir = tempDir("metafile-order-compile", serverWithLazyStylesheets);

      async function build(parsed: string[], outdir: string) {
        const result = await Bun.build({
          entrypoints: [`${dir}/server.js`],
          compile: { outfile: `${dir}/${outdir}/app` },
          target: "bun",
          splitting: true,
          plugins: [lazyParsedInOrder(parsed)],
        });
        expect(result.success).toBe(true);
        const hasher = new Bun.CryptoHasher("sha256");
        for await (const chunk of Bun.file(result.outputs[0].path).stream()) hasher.update(chunk);
        return hasher.digest("hex");
      }

      const forward = await build(lazy, "forward");
      const backward = await build(lazy.toReversed(), "backward");
      expect(backward).toBe(forward);
    },
    isCI ? undefined : 30_000,
  );

  // Two entry points share a stylesheet only when their stylesheets hold the same modules.
  // These two hold modules of different graphs that have one path.
  test.concurrent("a stylesheet in the server graph and in the browser graph is two chunks", async () => {
    using dir = tempDir("metafile-order-css-two-graphs", {
      "server.js": `import page from "./page.html";\nimport "./shared.css";\nconsole.log(page.index);\n`,
      "page.html": `<!DOCTYPE html><html><head></head><body><script type="module" src="./client.js"></script></body></html>`,
      "client.js": `import "./shared.css";\nconsole.log("client");\n`,
      "shared.css": `.shared { color: red; }\n`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/server.js`],
      outdir: `${dir}/out`,
      target: "bun",
      metafile: true,
    });
    expect(result.success).toBe(true);

    // The server bundle, the script of the page, the page, and one stylesheet for each graph.
    expect(result.outputs).toHaveLength(5);
    const stylesheets = Object.entries((result.metafile as Metafile).outputs).filter(([key]) => key.endsWith(".css"));
    expect(stylesheets.map(([, output]) => basename(output.entryPoint!))).toEqual(["server.js", "page.html"]);
  });
});
