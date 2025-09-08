import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import * as path from "node:path";

test("Bun.build plugin virtual modules - basic", async () => {
  using dir = tempDir("virtual-basic", {
    "entry.ts": `
      import message from "my-virtual-module";
      console.log(message);
    `,
  });

  const result = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.ts")],
    outdir: String(dir),
    plugins: [{
      name: "virtual-module-plugin",
      setup(build) {
        build.module("my-virtual-module", () => ({
          contents: `export default "Hello from virtual module!"`,
          loader: "js",
        }));
      },
    }],
  });

  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);

  const output = await result.outputs[0].text();
  expect(output).toContain("Hello from virtual module!");
});

test("Bun.build plugin virtual modules - multiple modules", async () => {
  using dir = tempDir("virtual-multiple", {
    "entry.ts": `
      import { greeting } from "virtual-greeting";
      import { name } from "virtual-name";
      console.log(greeting + " " + name);
    `,
  });

  const result = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.ts")],
    outdir: String(dir),
    plugins: [{
      name: "multi-virtual-plugin",
      setup(build) {
        build.module("virtual-greeting", () => ({
          contents: `export const greeting = "Hello";`,
          loader: "js",
        }));
        
        build.module("virtual-name", () => ({
          contents: `export const name = "World";`,
          loader: "js",
        }));
      },
    }],
  });

  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);

  const output = await result.outputs[0].text();
  expect(output).toContain("Hello");
  expect(output).toContain("World");
});

test("Bun.build plugin virtual modules - TypeScript", async () => {
  using dir = tempDir("virtual-typescript", {
    "entry.ts": `
      import { calculate } from "virtual-math";
      console.log(calculate(5, 10));
    `,
  });

  const result = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.ts")],
    outdir: String(dir),
    plugins: [{
      name: "typescript-virtual-plugin",
      setup(build) {
        build.module("virtual-math", () => ({
          contents: `
            export function calculate(a: number, b: number): number {
              return a + b;
            }
          `,
          loader: "ts",
        }));
      },
    }],
  });

  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);

  const output = await result.outputs[0].text();
  expect(output).toContain("calculate(5, 10)"); // Function call is in output
});

test("Bun.build plugin virtual modules - JSON", async () => {
  using dir = tempDir("virtual-json", {
    "entry.ts": `
      import config from "virtual-config";
      console.log(config.version);
    `,
  });

  const result = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.ts")],
    outdir: String(dir),
    plugins: [{
      name: "json-virtual-plugin",
      setup(build) {
        build.module("virtual-config", () => ({
          contents: JSON.stringify({ version: "1.2.3", enabled: true }),
          loader: "json",
        }));
      },
    }],
  });

  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);

  const output = await result.outputs[0].text();
  expect(output).toContain("1.2.3");
});

test("Bun.build plugin virtual modules - with onLoad and onResolve", async () => {
  using dir = tempDir("virtual-mixed", {
    "entry.ts": `
      import virtual from "my-virtual";
      import modified from "./real.js";
      console.log(virtual, modified);
    `,
    "real.js": `export default "original";`,
  });

  const result = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.ts")],
    outdir: String(dir),
    plugins: [{
      name: "mixed-plugin",
      setup(build) {
        // Virtual module
        build.module("my-virtual", () => ({
          contents: `export default "virtual content";`,
          loader: "js",
        }));
        
        // Regular onLoad plugin
        build.onLoad({ filter: /\.js$/ }, () => ({
          contents: `export default "modified";`,
          loader: "js",
        }));
      },
    }],
  });

  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);

  const output = await result.outputs[0].text();
  expect(output).toContain("virtual content");
  expect(output).toContain("modified");
});

test("Bun.build plugin virtual modules - dynamic content", async () => {
  using dir = tempDir("virtual-dynamic", {
    "entry.ts": `
      import timestamp from "virtual-timestamp";
      console.log(timestamp);
    `,
  });

  const buildTime = Date.now();
  
  const result = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.ts")],
    outdir: String(dir),
    plugins: [{
      name: "dynamic-virtual-plugin",
      setup(build) {
        build.module("virtual-timestamp", () => ({
          contents: `export default ${buildTime};`,
          loader: "js",
        }));
      },
    }],
  });

  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);

  const output = await result.outputs[0].text();
  expect(output).toContain(buildTime.toString());
});

test("Bun.build plugin virtual modules - nested imports", async () => {
  using dir = tempDir("virtual-nested", {
    "entry.ts": `
      import { main } from "virtual-main";
      console.log(main());
    `,
  });

  const result = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.ts")],
    outdir: String(dir),
    plugins: [{
      name: "nested-virtual-plugin",
      setup(build) {
        build.module("virtual-main", () => ({
          contents: `
            import { helper } from "virtual-helper";
            export function main() {
              return helper() + " from main";
            }
          `,
          loader: "js",
        }));
        
        build.module("virtual-helper", () => ({
          contents: `
            export function helper() {
              return "Hello";
            }
          `,
          loader: "js",
        }));
      },
    }],
  });

  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);

  const output = await result.outputs[0].text();
  expect(output).toContain("helper() + \" from main\""); // Check for the function composition
});

test("Bun.build plugin virtual modules - multiple plugins", async () => {
  using dir = tempDir("virtual-multi-plugin", {
    "entry.ts": `
      import first from "virtual-first";
      import second from "virtual-second";
      console.log(first, second);
    `,
  });

  const result = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.ts")],
    outdir: String(dir),
    plugins: [
      {
        name: "first-plugin",
        setup(build) {
          build.module("virtual-first", () => ({
            contents: `export default "from first plugin";`,
            loader: "js",
          }));
        },
      },
      {
        name: "second-plugin",
        setup(build) {
          build.module("virtual-second", () => ({
            contents: `export default "from second plugin";`,
            loader: "js",
          }));
        },
      },
    ],
  });

  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);

  const output = await result.outputs[0].text();
  expect(output).toContain("from first plugin");
  expect(output).toContain("from second plugin");
});

test("Bun.build plugin virtual modules - error handling", async () => {
  using dir = tempDir("virtual-error", {
    "entry.ts": `
      import data from "virtual-error";
      console.log(data);
    `,
  });

  // Plugin errors are thrown as "Bundle failed"
  await expect(
    Bun.build({
      entrypoints: [path.join(String(dir), "entry.ts")],
      outdir: String(dir),
      plugins: [{
        name: "error-plugin",
        setup(build) {
          build.module("virtual-error", () => {
            throw new Error("Failed to generate virtual module");
          });
        },
      }],
    })
  ).rejects.toThrow("Bundle failed");
});

test("Bun.build plugin virtual modules - CSS", async () => {
  using dir = tempDir("virtual-css", {
    "entry.ts": `
      import styles from "virtual-styles";
      console.log(styles);
    `,
  });

  const result = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.ts")],
    outdir: String(dir),
    plugins: [{
      name: "css-virtual-plugin",
      setup(build) {
        build.module("virtual-styles", () => ({
          contents: `
            .container {
              display: flex;
              justify-content: center;
              align-items: center;
            }
          `,
          loader: "css",
        }));
      },
    }],
  });

  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(2); // JS and CSS output
});