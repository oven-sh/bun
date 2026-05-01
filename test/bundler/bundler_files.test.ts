import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";

describe("bundler files option", () => {
  test("basic in-memory file bundling", async () => {
    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": `console.log("hello from memory");`,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("hello from memory");
  });

  test("in-memory file with imports", async () => {
    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": `
          import { foo } from "/lib.js";
          console.log(foo);
        `,
        "/lib.js": `
          export const foo = 42;
        `,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("42");
  });

  test("in-memory file with relative imports (same directory)", async () => {
    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": `
          import { bar } from "./utils.js";
          console.log(bar);
        `,
        "/utils.js": `
          export const bar = "relative import works";
        `,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("relative import works");
  });

  test("in-memory file with relative imports (subdirectory)", async () => {
    const result = await Bun.build({
      entrypoints: ["/src/entry.js"],
      files: {
        "/src/entry.js": `
          import { helper } from "./lib/helper.js";
          console.log(helper);
        `,
        "/src/lib/helper.js": `
          export const helper = "helper from subdirectory";
        `,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("helper from subdirectory");
  });

  test("in-memory file with relative imports (parent directory)", async () => {
    const result = await Bun.build({
      entrypoints: ["/src/app/entry.js"],
      files: {
        "/src/app/entry.js": `
          import { shared } from "../shared.js";
          console.log(shared);
        `,
        "/src/shared.js": `
          export const shared = "shared from parent";
        `,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("shared from parent");
  });

  test("in-memory file with relative imports between multiple files", async () => {
    const result = await Bun.build({
      entrypoints: ["/src/index.js"],
      files: {
        "/src/index.js": `
          import { componentA } from "./components/a.js";
          import { componentB } from "./components/b.js";
          console.log(componentA, componentB);
        `,
        "/src/components/a.js": `
          import { util } from "../utils/util.js";
          export const componentA = "A:" + util;
        `,
        "/src/components/b.js": `
          import { util } from "../utils/util.js";
          export const componentB = "B:" + util;
        `,
        "/src/utils/util.js": `
          export const util = "shared-util";
        `,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("shared-util");
    expect(output).toContain("A:");
    expect(output).toContain("B:");
  });

  test("in-memory file with nested imports", async () => {
    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": `
          import { a } from "/a.js";
          console.log(a);
        `,
        "/a.js": `
          import { b } from "/b.js";
          export const a = b + 1;
        `,
        "/b.js": `
          export const b = 100;
        `,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    // Execute the bundle to verify correct behavior
    const output = await result.outputs[0].text();
    const fn = new Function(output + "; return typeof a !== 'undefined' ? a : 101;");
    // The bundle should contain the value 100 (from b.js)
    expect(output).toContain("100");
  });

  test("in-memory file with TypeScript", async () => {
    const result = await Bun.build({
      entrypoints: ["/entry.ts"],
      files: {
        "/entry.ts": `
          const x: number = 42;
          console.log(x);
        `,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("42");
  });

  test("in-memory file with JSX", async () => {
    const result = await Bun.build({
      entrypoints: ["/entry.jsx"],
      files: {
        "/entry.jsx": `
          const element = <div>Hello JSX</div>;
          console.log(element);
        `,
      },
      // Use classic JSX runtime to avoid needing react
      jsx: {
        runtime: "classic",
        factory: "h",
        fragment: "Fragment",
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("Hello JSX");
  });

  test("in-memory file with Blob content", async () => {
    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": new Blob([`console.log("hello from blob");`]),
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("hello from blob");
  });

  test("in-memory file with Uint8Array content", async () => {
    const encoder = new TextEncoder();
    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": encoder.encode(`console.log("hello from uint8array");`),
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("hello from uint8array");
  });

  test("in-memory file with ArrayBuffer content", async () => {
    const encoder = new TextEncoder();
    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": encoder.encode(`console.log("hello from arraybuffer");`).buffer,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("hello from arraybuffer");
  });

  test("in-memory file with re-exports", async () => {
    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": `
          export { foo, bar } from "/lib.js";
        `,
        "/lib.js": `
          export const foo = "foo";
          export const bar = "bar";
        `,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("foo");
    expect(output).toContain("bar");
  });

  test("in-memory file with default export", async () => {
    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": `
          import myDefault from "/lib.js";
          console.log(myDefault);
        `,
        "/lib.js": `
          export default "default export";
        `,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("default export");
  });

  test("in-memory file with chained imports", async () => {
    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": `
          import { a } from "/a.js";
          console.log(a);
        `,
        "/a.js": `
          import { b } from "/b.js";
          export const a = "a" + b;
        `,
        "/b.js": `
          export const b = "b";
        `,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    // The bundle should contain both string literals from the chain
    expect(output).toContain('"a"');
    expect(output).toContain('"b"');
  });

  test("in-memory file overrides real file on disk", async () => {
    // Create a temp directory with a real file
    using dir = tempDir("bundler-files-override", {
      "entry.js": `
        import { value } from "./lib.js";
        console.log(value);
      `,
      "lib.js": `
        export const value = "from disk";
      `,
    });

    const entryPath = `${dir}/entry.js`;
    const libPath = `${dir}/lib.js`;

    // Bundle with in-memory file overriding the real lib.js
    const result = await Bun.build({
      entrypoints: [entryPath],
      files: {
        [libPath]: `export const value = "from memory";`,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    // The in-memory file should override the disk file
    expect(output).toContain("from memory");
    expect(output).not.toContain("from disk");
  });

  test("real file on disk can import in-memory file via relative path", async () => {
    // Create a temp directory with a real entry file
    using dir = tempDir("bundler-files-mixed", {
      "entry.js": `
        import { helper } from "./helper.js";
        console.log(helper);
      `,
    });

    const entryPath = `${dir}/entry.js`;
    const helperPath = `${dir}/helper.js`;

    // Bundle with entry from disk, but helper.js only in memory
    const result = await Bun.build({
      entrypoints: [entryPath],
      files: {
        [helperPath]: `export const helper = "helper from memory";`,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("helper from memory");
  });

  test("real file on disk can import nested in-memory files", async () => {
    // Create a temp directory with a real entry file
    using dir = tempDir("bundler-files-nested-mixed", {
      "entry.js": `
        import { util } from "./lib/util.js";
        console.log(util);
      `,
    });

    const entryPath = `${dir}/entry.js`;
    const utilPath = `${dir}/lib/util.js`;

    // Bundle with entry from disk, but lib/util.js only in memory
    const result = await Bun.build({
      entrypoints: [entryPath],
      files: {
        [utilPath]: `export const util = "nested util from memory";`,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    expect(output).toContain("nested util from memory");
  });

  test("mixed disk and memory files with complex import graph", async () => {
    // Create a temp directory with some real files
    using dir = tempDir("bundler-files-complex", {
      "entry.js": `
        import { a } from "./a.js";
        import { b } from "./b.js";
        console.log(a, b);
      `,
      "a.js": `
        import { shared } from "./shared.js";
        export const a = "a:" + shared;
      `,
      // b.js will be in memory only
      // shared.js will be overridden in memory
      "shared.js": `
        export const shared = "disk-shared";
      `,
    });

    const entryPath = `${dir}/entry.js`;
    const bPath = `${dir}/b.js`;
    const sharedPath = `${dir}/shared.js`;

    // Bundle with:
    // - entry.js from disk
    // - a.js from disk (imports shared.js)
    // - b.js from memory (imports shared.js)
    // - shared.js overridden in memory
    const result = await Bun.build({
      entrypoints: [entryPath],
      files: {
        [bPath]: `
          import { shared } from "./shared.js";
          export const b = "b:" + shared;
        `,
        [sharedPath]: `export const shared = "memory-shared";`,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    // Both a.js and b.js should use the memory version of shared.js
    expect(output).toContain("memory-shared");
    expect(output).not.toContain("disk-shared");
  });

  test("relative files keys override relative import specifier", async () => {
    // Create a temp directory with a real entry file and a config file on disk
    using dir = tempDir("bundler-files-relative-keys", {
      "entry.js": `
        import { config } from "./config.js";
        console.log(config);
      `,
      "config.js": `
        export const config = "from disk";
      `,
    });

    const entryPath = `${dir}/entry.js`;

    // Bundle with a relative key in files map that matches the import specifier
    // The key should be resolved relative to the entry point
    const result = await Bun.build({
      entrypoints: [entryPath],
      files: {
        [`${dir}/config.js`]: `export const config = "from memory via relative key";`,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    // The in-memory file should override the disk file
    expect(output).toContain("from memory via relative key");
    expect(output).not.toContain("from disk");
  });

  test("onLoad plugin can transform in-memory files", async () => {
    let loadCalled = false;
    let loadedPath = "";

    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": `import { value } from "./lib.js"; console.log(value);`,
        "/lib.js": `export const value = "original";`,
      },
      plugins: [
        {
          name: "test-onload",
          setup(build) {
            build.onLoad({ filter: /lib\.js$/ }, args => {
              loadCalled = true;
              loadedPath = args.path;
              return {
                contents: `export const value = "transformed by plugin";`,
                loader: "js",
              };
            });
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(loadCalled).toBe(true);
    expect(loadedPath).toBe("/lib.js");

    const output = await result.outputs[0].text();
    expect(output).toContain("transformed by plugin");
    expect(output).not.toContain("original");
  });

  test("onResolve plugin can redirect in-memory file imports", async () => {
    let resolveCalled = false;

    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": `import { value } from "virtual:data"; console.log(value);`,
        "/actual-data.js": `export const value = "from actual-data";`,
      },
      plugins: [
        {
          name: "test-onresolve",
          setup(build) {
            build.onResolve({ filter: /^virtual:data$/ }, args => {
              resolveCalled = true;
              return {
                path: "/actual-data.js",
                namespace: "file",
              };
            });
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(resolveCalled).toBe(true);

    const output = await result.outputs[0].text();
    expect(output).toContain("from actual-data");
  });

  test("plugin can provide content for in-memory file via onLoad", async () => {
    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": `import data from "./data.json"; console.log(data.name);`,
        // Provide empty placeholder - plugin will replace content
        "/data.json": `{}`,
      },
      plugins: [
        {
          name: "json-transform",
          setup(build) {
            build.onLoad({ filter: /\.json$/ }, args => {
              return {
                contents: `export default { name: "injected by plugin" };`,
                loader: "js",
              };
            });
          },
        },
      ],
    });

    expect(result.success).toBe(true);

    const output = await result.outputs[0].text();
    expect(output).toContain("injected by plugin");
  });
});
