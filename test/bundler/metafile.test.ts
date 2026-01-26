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

    // Check metafile structure
    expect(result.metafile!.json).toBeDefined();
    expect(typeof result.metafile!.json).toBe("object");

    // Check inputs structure
    expect(result.metafile!.json.inputs).toBeDefined();
    expect(typeof result.metafile!.json.inputs).toBe("object");

    // Check outputs structure
    expect(result.metafile!.json.outputs).toBeDefined();
    expect(typeof result.metafile!.json.outputs).toBe("object");
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

    const inputs = result.metafile!.json.inputs as Record<string, MetafileInput>;
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

    const outputs = result.metafile!.json.outputs as Record<string, MetafileOutput>;
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
    const inputs = result.metafile!.json.inputs as Record<string, MetafileInput>;
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
    const inputs = result.metafile!.json.inputs as Record<string, MetafileInput>;
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

    const outputs = result.metafile!.json.outputs as Record<string, MetafileOutput>;
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

    const outputs = result.metafile!.json.outputs as Record<string, MetafileOutput>;
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

    const inputs = result.metafile!.json.inputs as Record<string, MetafileInput>;
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

    const inputs = result.metafile!.json.inputs as Record<string, MetafileInput>;
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

    const inputs = result.metafile!.json.inputs as Record<string, MetafileInput>;
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

    const outputs = result.metafile!.json.outputs as Record<string, MetafileOutput>;
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
    const inputs = result.metafile!.json.inputs as Record<string, MetafileInput>;
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
    const inputs = result.metafile!.json.inputs as Record<string, MetafileInput>;
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
    const inputs = result.metafile!.json.inputs as Record<string, MetafileInput>;
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
    const outputs = result.metafile!.json.outputs as Record<string, MetafileOutput>;
    const outputPaths = Object.keys(outputs);
    expect(outputPaths).toContain(dynamicImport!.path);
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

    const outputs = result.metafile!.json.outputs as Record<string, MetafileOutput>;

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

    const inputs = result.metafile!.json.inputs as Record<string, MetafileInput>;
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
      metafile: `${dir}/output-meta.json`,
    });

    expect(result.success).toBe(true);

    // Check JSON file was written
    const jsonFile = Bun.file(`${dir}/output-meta.json`);
    expect(await jsonFile.exists()).toBe(true);

    // Verify JSON content
    const content = await jsonFile.text();
    const parsed = JSON.parse(content);
    expect(parsed.inputs).toBeDefined();
    expect(parsed.outputs).toBeDefined();

    // Also check result.metafile.json is available
    expect(result.metafile).toBeDefined();
    expect(result.metafile!.json).toBeDefined();
    expect(typeof result.metafile!.json).toBe("object");
    expect(result.metafile!.json.inputs).toBeDefined();
  });

  test("metafile: { json: path } writes JSON to specified path", async () => {
    using dir = tempDir("metafile-object-json", {
      "main.js": `export const value = 42;`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/main.js`],
      outdir: `${dir}/dist`,
      metafile: { json: `${dir}/custom-meta.json` },
    });

    expect(result.success).toBe(true);

    // Check JSON file was written
    const jsonFile = Bun.file(`${dir}/custom-meta.json`);
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
      metafile: { markdown: `${dir}/analysis.md` },
    });

    expect(result.success).toBe(true);

    // Check markdown file was written
    const mdFile = Bun.file(`${dir}/analysis.md`);
    expect(await mdFile.exists()).toBe(true);

    // Verify markdown content
    const content = await mdFile.text();
    expect(content).toContain("# Bundle Analysis Report");
    expect(content).toContain("app.js");

    // Also check result.metafile.markdown is available
    expect(result.metafile).toBeDefined();
    expect(result.metafile!.markdown).toBeDefined();
    expect(typeof result.metafile!.markdown).toBe("string");
    expect(result.metafile!.markdown).toContain("# Bundle Analysis Report");
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
        json: `${dir}/meta.json`,
        markdown: `${dir}/meta.md`,
      },
    });

    expect(result.success).toBe(true);

    // Check both files exist
    const jsonFile = Bun.file(`${dir}/meta.json`);
    const mdFile = Bun.file(`${dir}/meta.md`);
    expect(await jsonFile.exists()).toBe(true);
    expect(await mdFile.exists()).toBe(true);

    // Verify JSON
    const parsedJson = JSON.parse(await jsonFile.text());
    expect(parsedJson.inputs).toBeDefined();

    // Verify markdown
    const mdContent = await mdFile.text();
    expect(mdContent).toContain("# Bundle Analysis Report");

    // Both should be in result.metafile
    expect(result.metafile!.json).toBeDefined();
    expect(result.metafile!.markdown).toBeDefined();
  });

  test("metafile.json is lazily parsed", async () => {
    using dir = tempDir("metafile-lazy-json", {
      "entry.js": `export const x = 1;`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();

    // First access should parse the JSON
    const json1 = result.metafile!.json;
    expect(json1).toBeDefined();
    expect(typeof json1).toBe("object");
    expect(json1.inputs).toBeDefined();

    // Second access should return the same cached object
    const json2 = result.metafile!.json;
    expect(json1).toBe(json2); // Same reference (memoized)
  });

  test("metafile: true provides json and no markdown", async () => {
    using dir = tempDir("metafile-true", {
      "test.js": `console.log("test");`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/test.js`],
      metafile: true,
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();
    expect(result.metafile!.json).toBeDefined();
    expect(result.metafile!.markdown).toBeUndefined();
  });

  test("metafile: { markdown: path } provides both json and markdown", async () => {
    using dir = tempDir("metafile-md-has-json", {
      "test.js": `export const a = 1;`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/test.js`],
      outdir: `${dir}/dist`,
      metafile: { markdown: `${dir}/meta.md` },
    });

    expect(result.success).toBe(true);
    expect(result.metafile).toBeDefined();
    // Should have both json and markdown
    expect(result.metafile!.json).toBeDefined();
    expect(result.metafile!.markdown).toBeDefined();
  });
});

// CLI tests for --metafile-md
import { bunEnv, bunExe } from "harness";

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
