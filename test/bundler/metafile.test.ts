import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";

// Type definitions for metafile structure
interface MetafileImport {
  path: string;
  kind: string;
  original?: string;
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

    // Check inputs structure
    expect(result.metafile.inputs).toBeDefined();
    expect(typeof result.metafile.inputs).toBe("object");

    // Check outputs structure
    expect(result.metafile.outputs).toBeDefined();
    expect(typeof result.metafile.outputs).toBe("object");
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

    const inputs = result.metafile.inputs as Record<string, MetafileInput>;
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

    const outputs = result.metafile.outputs as Record<string, MetafileOutput>;
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
    const inputs = result.metafile.inputs as Record<string, MetafileInput>;
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
    const inputs = result.metafile.inputs as Record<string, MetafileInput>;
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

    const outputs = result.metafile.outputs as Record<string, MetafileOutput>;
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

    const outputs = result.metafile.outputs as Record<string, MetafileOutput>;
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

    const inputs = result.metafile.inputs as Record<string, MetafileInput>;
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

    const inputs = result.metafile.inputs as Record<string, MetafileInput>;
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

    const outputs = result.metafile.outputs as Record<string, MetafileOutput>;
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
    const inputs = result.metafile.inputs as Record<string, MetafileInput>;
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
});
