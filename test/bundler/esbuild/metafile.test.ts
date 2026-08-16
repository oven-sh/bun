import { describe, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { itBundled } from "../expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_default_test.go

describe("bundler", () => {
  itBundled("metafile/ImportWithTypeJSON", {
    files: {
      "/project/entry.js": /* js */ `
        import a from './data.json'
        import b from './data.json' assert { type: 'json' }
        import c from './data.json' with { type: 'json' }
        x = [a, b, c]
      `,
      "/project/data.json": `{"some": "data"}`,
    },
    outdir: "/out",
    metafile: "/metafile.json",
    onAfterBundle(api) {
      const metafilePath = api.join("metafile.json");
      expect(existsSync(metafilePath)).toBe(true);
      const metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
      expect(metafile.inputs).toBeDefined();
      expect(metafile.outputs).toBeDefined();
      // Should have imports with 'with' clause for JSON
      const entryInputKey = Object.keys(metafile.inputs).find(k => k.includes("entry.js"));
      expect(entryInputKey).toBeDefined();
      const entryInput = metafile.inputs[entryInputKey!];
      expect(entryInput.imports.length).toBeGreaterThan(0);
      // At least one import should have a 'with' clause
      const hasWithClause = entryInput.imports.some((imp: any) => imp.with?.type === "json");
      expect(hasWithClause).toBe(true);
    },
  });

  itBundled("metafile/BasicStructure", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from './foo.js';
        console.log(foo);
      `,
      "/foo.js": /* js */ `
        export const foo = 42;
      `,
    },
    outdir: "/out",
    metafile: "/metafile.json",
    onAfterBundle(api) {
      const metafilePath = api.join("metafile.json");
      expect(existsSync(metafilePath)).toBe(true);
      const metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
      // Check basic structure
      expect(metafile.inputs).toBeDefined();
      expect(metafile.outputs).toBeDefined();
      expect(Object.keys(metafile.inputs).length).toBeGreaterThanOrEqual(2);
      expect(Object.keys(metafile.outputs).length).toBeGreaterThanOrEqual(1);
      // Check input has bytes and imports
      for (const input of Object.values(metafile.inputs) as any[]) {
        expect(typeof input.bytes).toBe("number");
        expect(Array.isArray(input.imports)).toBe(true);
      }
      // Check output has bytes, inputs, imports, exports
      for (const output of Object.values(metafile.outputs) as any[]) {
        expect(typeof output.bytes).toBe("number");
        expect(typeof output.inputs).toBe("object");
        expect(Array.isArray(output.imports)).toBe(true);
        expect(Array.isArray(output.exports)).toBe(true);
      }
    },
  });

  itBundled("metafile/MultipleEntryPoints", {
    files: {
      "/a.js": /* js */ `
        import { shared } from './shared.js';
        console.log('a', shared);
      `,
      "/b.js": /* js */ `
        import { shared } from './shared.js';
        console.log('b', shared);
      `,
      "/shared.js": /* js */ `
        export const shared = 'shared value';
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    metafile: "/metafile.json",
    splitting: true,
    onAfterBundle(api) {
      const metafilePath = api.join("metafile.json");
      expect(existsSync(metafilePath)).toBe(true);
      const metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
      expect(metafile.inputs).toBeDefined();
      expect(metafile.outputs).toBeDefined();
      // With splitting, we should have multiple outputs
      expect(Object.keys(metafile.outputs).length).toBeGreaterThanOrEqual(2);
    },
  });

  itBundled("metafile/ExternalImports", {
    files: {
      "/entry.js": /* js */ `
        import ext1 from 'external-pkg-1';
        import ext2 from 'external-pkg-2';
        console.log(ext1, ext2);
      `,
    },
    outdir: "/out",
    metafile: "/metafile.json",
    external: ["external-pkg-1", "external-pkg-2"],
    onAfterBundle(api) {
      const metafilePath = api.join("metafile.json");
      expect(existsSync(metafilePath)).toBe(true);
      const metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
      // Find the entry file
      const entryKey = Object.keys(metafile.inputs).find(k => k.includes("entry.js"));
      expect(entryKey).toBeDefined();
      const entry = metafile.inputs[entryKey!];
      // Check that external imports are marked
      const externalImports = entry.imports.filter((imp: any) => imp.external === true);
      expect(externalImports.length).toBe(2);
    },
  });

  itBundled("metafile/DynamicImport", {
    files: {
      "/entry.js": /* js */ `
        import('./dynamic.js').then(m => console.log(m));
      `,
      "/dynamic.js": /* js */ `
        export const value = 123;
      `,
    },
    outdir: "/out",
    metafile: "/metafile.json",
    splitting: true,
    onAfterBundle(api) {
      const metafilePath = api.join("metafile.json");
      expect(existsSync(metafilePath)).toBe(true);
      const metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
      expect(metafile.inputs).toBeDefined();
      expect(metafile.outputs).toBeDefined();
      // Find the entry file
      const entryKey = Object.keys(metafile.inputs).find(k => k.includes("entry.js"));
      expect(entryKey).toBeDefined();
      const entry = metafile.inputs[entryKey!];
      // Should have a dynamic import
      const dynamicImports = entry.imports.filter((imp: any) => imp.kind === "dynamic-import");
      expect(dynamicImports.length).toBe(1);
    },
  });

  itBundled("metafile/RequireCall", {
    files: {
      "/entry.js": /* js */ `
        const foo = require('./foo.js');
        console.log(foo);
      `,
      "/foo.js": /* js */ `
        module.exports = { value: 42 };
      `,
    },
    outdir: "/out",
    metafile: "/metafile.json",
    onAfterBundle(api) {
      const metafilePath = api.join("metafile.json");
      expect(existsSync(metafilePath)).toBe(true);
      const metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
      expect(metafile.inputs).toBeDefined();
      // Find the entry file
      const entryKey = Object.keys(metafile.inputs).find(k => k.includes("entry.js"));
      expect(entryKey).toBeDefined();
      const entry = metafile.inputs[entryKey!];
      // Should have a require call
      const requireImports = entry.imports.filter((imp: any) => imp.kind === "require-call");
      expect(requireImports.length).toBe(1);
    },
  });

  itBundled("metafile/ReExports", {
    files: {
      "/entry.js": /* js */ `
        export { foo } from './foo.js';
        export * from './bar.js';
      `,
      "/foo.js": /* js */ `
        export const foo = 1;
      `,
      "/bar.js": /* js */ `
        export const bar = 2;
        export const baz = 3;
      `,
    },
    outdir: "/out",
    metafile: "/metafile.json",
    onAfterBundle(api) {
      const metafilePath = api.join("metafile.json");
      expect(existsSync(metafilePath)).toBe(true);
      const metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
      expect(metafile.outputs).toBeDefined();
      // Find the output
      const outputKey = Object.keys(metafile.outputs)[0];
      const output = metafile.outputs[outputKey];
      // Should have exports
      expect(output.exports.length).toBeGreaterThanOrEqual(3); // foo, bar, baz
    },
  });

  itBundled("metafile/NestedImports", {
    files: {
      "/entry.js": /* js */ `
        import { a } from './a.js';
        console.log(a);
      `,
      "/a.js": /* js */ `
        import { b } from './b.js';
        export const a = b + 1;
      `,
      "/b.js": /* js */ `
        import { c } from './c.js';
        export const b = c + 1;
      `,
      "/c.js": /* js */ `
        export const c = 1;
      `,
    },
    outdir: "/out",
    metafile: "/metafile.json",
    onAfterBundle(api) {
      const metafilePath = api.join("metafile.json");
      expect(existsSync(metafilePath)).toBe(true);
      const metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
      expect(metafile.inputs).toBeDefined();
      // Should have 4 input files
      expect(Object.keys(metafile.inputs).length).toBe(4);
      // Each file should have proper imports
      for (const [path, input] of Object.entries(metafile.inputs) as any) {
        expect(typeof input.bytes).toBe("number");
        expect(Array.isArray(input.imports)).toBe(true);
      }
    },
  });

  itBundled("metafile/JSONImport", {
    files: {
      "/entry.js": /* js */ `
        import data from './data.json';
        console.log(data);
      `,
      "/data.json": `{"key": "value", "number": 42}`,
    },
    outdir: "/out",
    metafile: "/metafile.json",
    onAfterBundle(api) {
      const metafilePath = api.join("metafile.json");
      expect(existsSync(metafilePath)).toBe(true);
      const metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
      // Find the entry file
      const entryKey = Object.keys(metafile.inputs).find(k => k.includes("entry.js"));
      expect(entryKey).toBeDefined();
      const entry = metafile.inputs[entryKey!];
      // Should have an import to the JSON file with 'with' clause
      const jsonImport = entry.imports.find((imp: any) => imp.path.includes("data.json"));
      expect(jsonImport).toBeDefined();
      expect(jsonImport.with?.type).toBe("json");
    },
  });

  itBundled("metafile/TextImport", {
    files: {
      "/entry.js": /* js */ `
        import text from './file.txt';
        console.log(text);
      `,
      "/file.txt": `Hello, World!`,
    },
    outdir: "/out",
    metafile: "/metafile.json",
    loader: {
      ".txt": "text",
    },
    onAfterBundle(api) {
      const metafilePath = api.join("metafile.json");
      expect(existsSync(metafilePath)).toBe(true);
      const metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
      // Find the entry file
      const entryKey = Object.keys(metafile.inputs).find(k => k.includes("entry.js"));
      expect(entryKey).toBeDefined();
      const entry = metafile.inputs[entryKey!];
      // Should have an import to the text file with 'with' clause
      const textImport = entry.imports.find((imp: any) => imp.path.includes("file.txt"));
      expect(textImport).toBeDefined();
      expect(textImport.with?.type).toBe("text");
    },
  });

  itBundled("metafile/EntryPoint", {
    files: {
      "/entry.js": /* js */ `
        console.log('entry');
      `,
    },
    outdir: "/out",
    metafile: "/metafile.json",
    onAfterBundle(api) {
      const metafilePath = api.join("metafile.json");
      expect(existsSync(metafilePath)).toBe(true);
      const metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
      expect(metafile.outputs).toBeDefined();
      // Find an output with entryPoint
      const outputWithEntryPoint = Object.values(metafile.outputs).find((o: any) => o.entryPoint);
      expect(outputWithEntryPoint).toBeDefined();
      expect(typeof (outputWithEntryPoint as any).entryPoint).toBe("string");
    },
  });

  itBundled("metafile/OriginalPath", {
    files: {
      "/entry.js": /* js */ `
        import { helper } from './lib/helper.js';
        console.log(helper);
      `,
      "/lib/helper.js": /* js */ `
        export const helper = 'helper';
      `,
    },
    outdir: "/out",
    metafile: "/metafile.json",
    onAfterBundle(api) {
      const metafilePath = api.join("metafile.json");
      expect(existsSync(metafilePath)).toBe(true);
      const metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
      // Find the entry file
      const entryKey = Object.keys(metafile.inputs).find(k => k.includes("entry.js"));
      expect(entryKey).toBeDefined();
      const entry = metafile.inputs[entryKey!];
      // Should have an import with original path
      expect(entry.imports.length).toBe(1);
      expect(entry.imports[0].original).toBe("./lib/helper.js");
    },
  });
});
