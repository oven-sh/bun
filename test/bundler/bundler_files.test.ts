import { describe, expect, test } from "bun:test";
import { bunRun, isWindows, tempDir } from "harness";

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

  test("in-memory file with a file-backed Blob is rejected", () => {
    // Only in-memory blobs are accepted as content; a Bun.file() blob would
    // have to be read from disk and is rejected like every other
    // string-or-blob argument, instead of being treated as empty content.
    // Like the other invalid options, this throws from Bun.build() itself.
    using dir = tempDir("bundler-files-bun-file", {
      "entry.js": `console.log("from disk");`,
    });

    expect(() =>
      Bun.build({
        entrypoints: ["/entry.js"],
        files: {
          "/entry.js": Bun.file(`${dir}/entry.js`),
        },
      }),
    ).toThrow("File blob cannot be used here");
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

  // Relative keys are resolved against the cwd, like relative entrypoints.
  // Bun.build reads the process cwd, so these run a fixture inside its own
  // directory instead of chdir-ing the test runner.
  describe("relative keys", () => {
    // Appended to a fixture that defines `options`: prints the build result
    // and which of the string literals in `markers` ended up in the bundle.
    function report(markers: string[]) {
      return `
        const result = await Bun.build({ ...options, throw: false });
        const output = result.success ? await result.outputs[0].text() : "";
        console.log(JSON.stringify({
          success: result.success,
          logs: result.logs.map(String),
          found: ${JSON.stringify(markers)}.filter(marker => output.includes(JSON.stringify(marker))),
        }));
      `;
    }

    // The two examples from the `files` docs: override a file that exists on
    // disk, and provide one that does not, both keyed relative to the cwd
    // while the importer refers to them as "./config.ts" / "./generated.ts".
    test.concurrent.each([
      ["./src/config.ts", "./src/generated.ts"],
      ["src/config.ts", "src/generated.ts"],
      ["./src/../src/config.ts", "./src/./generated.ts"],
      [".\\src\\config.ts", ".\\src\\generated.ts"],
    ])("disk entrypoint picks up %j and %j", async (configKey, generatedKey) => {
      using dir = tempDir("bundler-files-relative-override", {
        "src/index.ts": `
          import { config } from "./config.ts";
          import { generated } from "./generated.ts";
          console.log(config, generated);
        `,
        "src/config.ts": `export const config = "config from disk";`,
        "build.ts": `
          const options = {
            entrypoints: ["./src/index.ts"],
            files: {
              [${JSON.stringify(configKey)}]: 'export const config = "config from memory";',
              [${JSON.stringify(generatedKey)}]: 'export const generated = "generated in memory";',
            },
          };
          ${report(["config from disk", "config from memory", "generated in memory"])}
        `,
      });

      const { stdout, stderr, exitCode } = await bunRun(`${dir}/build.ts`);
      expect({ stderr, exitCode, stdout }).toEqual({
        stderr: "",
        exitCode: 0,
        stdout: JSON.stringify({ success: true, logs: [], found: ["config from memory", "generated in memory"] }),
      });
    });

    // These imports do not spell out the file, so the disk resolver picks the
    // file and the key has to match the path it comes back with.
    test.concurrent("keys override files the resolver finds for extensionless and package imports", async () => {
      using dir = tempDir("bundler-files-relative-override-resolved", {
        "src/index.ts": `
          import { config } from "./config";
          import { util } from "util-lib";
          console.log(config, util);
        `,
        "src/config.ts": `export const config = "config from disk";`,
        "node_modules/util-lib/package.json": JSON.stringify({ name: "util-lib", main: "index.js" }),
        "node_modules/util-lib/index.js": `export const util = "util from disk";`,
        "build.ts": `
          const options = {
            entrypoints: ["./src/index.ts"],
            files: {
              "./src/config.ts": 'export const config = "config from memory";',
              "./node_modules/util-lib/index.js": 'export const util = "util from memory";',
            },
          };
          ${report(["config from disk", "config from memory", "util from disk", "util from memory"])}
        `,
      });

      const { stdout, stderr, exitCode } = await bunRun(`${dir}/build.ts`);
      expect({ stderr, exitCode, stdout }).toEqual({
        stderr: "",
        exitCode: 0,
        stdout: JSON.stringify({ success: true, logs: [], found: ["config from memory", "util from memory"] }),
      });
    });

    // An entrypoint spelled one way and keyed another still resolves to the
    // same in-memory file, and in-memory files keyed relative to the cwd can
    // import each other. Nothing here exists on disk.
    test.concurrent.each([
      ["entry.js", "entry.js", "lib.js"],
      ["./entry.js", "./entry.js", "./lib.js"],
      ["entry.js", "./entry.js", "lib.js"],
      ["./entry.js", "entry.js", "./lib.js"],
      ["./src/entry.js", "./src/entry.js", "./src/lib.js"],
      ["src/entry.js", "./src/entry.js", "src/lib.js"],
      ["./src/entry.js", "src/entry.js", "./src/lib.js"],
    ])("entrypoint %j with keys %j and %j", async (entrypoint, entryKey, libKey) => {
      using dir = tempDir("bundler-files-relative-entry", {
        "build.ts": `
          const options = {
            entrypoints: [${JSON.stringify(entrypoint)}],
            files: {
              [${JSON.stringify(entryKey)}]: 'import { lib } from "./lib.js"; console.log("entry in memory", lib);',
              [${JSON.stringify(libKey)}]: 'export const lib = "lib in memory";',
            },
          };
          ${report(["entry in memory", "lib in memory"])}
        `,
      });

      const { stdout, stderr, exitCode } = await bunRun(`${dir}/build.ts`);
      expect({ stderr, exitCode, stdout }).toEqual({
        stderr: "",
        exitCode: 0,
        stdout: JSON.stringify({ success: true, logs: [], found: ["entry in memory", "lib in memory"] }),
      });
    });

    test.concurrent("in-memory entrypoint keyed relative to the cwd can import a file on disk", async () => {
      using dir = tempDir("bundler-files-relative-entry-disk-import", {
        "lib.js": `export const lib = "lib from disk";`,
        "build.ts": `
          const options = {
            entrypoints: ["./entry.js"],
            files: { "./entry.js": 'import { lib } from "./lib.js"; console.log("entry in memory", lib);' },
          };
          ${report(["entry in memory", "lib from disk"])}
        `,
      });

      const { stdout, stderr, exitCode } = await bunRun(`${dir}/build.ts`);
      expect({ stderr, exitCode, stdout }).toEqual({
        stderr: "",
        exitCode: 0,
        stdout: JSON.stringify({ success: true, logs: [], found: ["entry in memory", "lib from disk"] }),
      });
    });

    // The error is reported against the path the key resolved to.
    test.concurrent("a syntax error in an entrypoint keyed relative to the cwd is a build error", async () => {
      using dir = tempDir("bundler-files-relative-entry-syntax-error", {
        "build.ts": `
          import { isAbsolute, relative } from "node:path";
          const result = await Bun.build({
            entrypoints: ["./entry.js"],
            files: { "./entry.js": ")" },
            throw: false,
          });
          console.log(JSON.stringify({
            success: result.success,
            logs: result.logs.map(String),
            files: result.logs.map(log => {
              const file = log.position.file;
              return { absolute: isAbsolute(file), fromCwd: relative(process.cwd(), file) };
            }),
          }));
        `,
      });

      const { stdout, stderr, exitCode } = await bunRun(`${dir}/build.ts`);
      expect({ stderr, exitCode, stdout }).toEqual({
        stderr: "",
        exitCode: 0,
        stdout: JSON.stringify({
          success: false,
          logs: ["BuildMessage: Unexpected )"],
          files: [{ absolute: true, fromCwd: "entry.js" }],
        }),
      });
    });

    test.concurrent.skipIf(!isWindows)("keys and entrypoints match whatever the case of the drive letter", async () => {
      using dir = tempDir("bundler-files-drive-letter", {
        "build.ts": `
          import { join } from "node:path";
          const cwd = process.cwd();
          const lower = cwd[0].toLowerCase() + cwd.slice(1);
          const upper = cwd[0].toUpperCase() + cwd.slice(1);
          const options = {
            entrypoints: [join(lower, "entry.js")],
            files: {
              [join(upper, "entry.js")]: 'import { lib } from "./lib.js"; console.log("entry in memory", lib);',
              [join(lower, "lib.js")]: 'export const lib = "lib in memory";',
            },
          };
          ${report(["entry in memory", "lib in memory"])}
        `,
      });

      const { stdout, stderr, exitCode } = await bunRun(`${dir}/build.ts`);
      expect({ stderr, exitCode, stdout }).toEqual({
        stderr: "",
        exitCode: 0,
        stdout: JSON.stringify({ success: true, logs: [], found: ["entry in memory", "lib in memory"] }),
      });
    });

    // A key is a path, so an importer in another directory is not matched by
    // a key that merely spells the same text as its import specifier.
    test.concurrent("a key only matches the file it resolves to", async () => {
      using dir = tempDir("bundler-files-relative-key-is-a-path", {
        "src/index.ts": `
          import { config } from "./config.ts";
          console.log(config);
        `,
        "src/config.ts": `export const config = "config from disk";`,
        "build.ts": `
          const options = {
            entrypoints: ["./src/index.ts"],
            files: { "./config.ts": 'export const config = "config from memory";' },
          };
          ${report(["config from disk", "config from memory"])}
        `,
      });

      const { stdout, stderr, exitCode } = await bunRun(`${dir}/build.ts`);
      expect({ stderr, exitCode, stdout }).toEqual({
        stderr: "",
        exitCode: 0,
        stdout: JSON.stringify({ success: true, logs: [], found: ["config from disk"] }),
      });
    });

    // Longer than MAX_PATH_BYTES on every platform (Windows allows the most,
    // 32767 UTF-16 units * 3 bytes).
    const longerThanAnyPath = Buffer.alloc(100_000, "x").toString();

    test.concurrent("a key that resolves to a path longer than the platform allows is rejected", async () => {
      using dir = tempDir("bundler-files-key-too-long", {
        "build.ts": `
          const key = ${JSON.stringify(longerThanAnyPath)} + ".js";
          try {
            Bun.build({ entrypoints: [key], files: { [key]: "" } });
            console.log("did not throw");
          } catch (error) {
            console.log(JSON.stringify({ name: error.name, message: error.message.replace(/\\d+/, "N") }));
          }
        `,
      });

      const { stdout, stderr, exitCode } = await bunRun(`${dir}/build.ts`);
      expect({ stderr, exitCode, stdout }).toEqual({
        stderr: "",
        exitCode: 0,
        stdout: JSON.stringify({ name: "TypeError", message: "files: key resolves to a path longer than N bytes" }),
      });
    });

    test.concurrent("an import specifier longer than the platform allows is a resolve error, not a crash", async () => {
      using dir = tempDir("bundler-files-specifier-too-long", {
        "build.ts": `
          const long = ${JSON.stringify(longerThanAnyPath)};
          const result = await Bun.build({
            entrypoints: ["entry.js"],
            files: { "entry.js": 'import "./' + long + '.js";' },
            throw: false,
          });
          console.log(JSON.stringify({
            success: result.success,
            logs: result.logs.map(log => String(log).replaceAll(long, "<long>")),
          }));
        `,
      });

      const { stdout, stderr, exitCode } = await bunRun(`${dir}/build.ts`);
      expect({ stderr, exitCode, stdout }).toEqual({
        stderr: "",
        exitCode: 0,
        stdout: JSON.stringify({ success: false, logs: ['ResolveMessage: Could not resolve: "./<long>.js"'] }),
      });
    });

    // A plugin can give a module any path it likes. One that does not fit in a
    // path buffer cannot be joined with the module's imports, so `files` stays
    // out of the way and the import fails to resolve as it would without it.
    test.concurrent(
      "an importer with a path longer than the platform allows is a resolve error, not a crash",
      async () => {
        using dir = tempDir("bundler-files-importer-too-long", {
          "entry.js": `import "long";`,
          "build.ts": `
          const results = [];
          for (const long of [${JSON.stringify(longerThanAnyPath)}, ${JSON.stringify("/" + longerThanAnyPath)}]) {
            const result = await Bun.build({
              entrypoints: ["./entry.js"],
              files: { "./lib.js": "" },
              plugins: [{
                name: "long",
                setup(build) {
                  build.onResolve({ filter: /^long$/ }, () => ({ path: long, namespace: "long" }));
                  build.onLoad({ filter: /./, namespace: "long" }, () => ({ contents: 'import "./lib.js";', loader: "js" }));
                },
              }],
              throw: false,
            });
            results.push({ success: result.success, logs: result.logs.map(log => String(log).replaceAll(long, "<long>")) });
          }
          console.log(JSON.stringify(results));
        `,
        });

        const { stdout, stderr, exitCode } = await bunRun(`${dir}/build.ts`);
        const unresolved = { success: false, logs: ['ResolveMessage: Could not resolve: "./lib.js"'] };
        expect({ stderr, exitCode, stdout }).toEqual({
          stderr: "",
          exitCode: 0,
          stdout: JSON.stringify([unresolved, unresolved]),
        });
      },
    );
  });
});
