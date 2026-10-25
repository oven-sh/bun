import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";

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

  // Specifiers are joined onto the importer's directory to find a matching
  // in-memory file. A specifier longer than a path buffer (4096 bytes on
  // Linux, 1024 on macOS, 98302 on Windows) used to abort the process. These
  // run in a child process because the bug is a crash.
  describe.concurrent("specifiers longer than a path buffer", () => {
    async function buildInChild(script: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return JSON.parse(stdout);
    }

    test("a CSS url() is kept as-is", async () => {
      const result = await buildInChild(`
        const url = "data:image/svg+xml," + Buffer.alloc(131072, "A").toString();
        const result = await Bun.build({
          entrypoints: ["/style.css"],
          files: { "/style.css": '.x { background: url("' + url + '") }' },
          throw: false,
        });
        const output = result.success ? await result.outputs[0].text() : "";
        console.log(JSON.stringify({
          success: result.success,
          logs: result.logs.map(String),
          outputHasUrl: output.includes(url),
        }));
      `);
      expect(result).toEqual({ success: true, logs: [], outputHasUrl: true });
    });

    test("a relative import reports a resolve error", async () => {
      const result = await buildInChild(`
        const specifier = "./" + Buffer.alloc(131072, "A").toString() + ".js";
        const result = await Bun.build({
          entrypoints: ["/entry.js"],
          files: { "/entry.js": 'import "' + specifier + '";' },
          throw: false,
        });
        console.log(JSON.stringify({
          success: result.success,
          logs: result.logs.map(log => log.message.replace(specifier, "<specifier>")),
        }));
      `);
      expect(result).toEqual({
        success: false,
        logs: ['Could not resolve: "<specifier>"'],
      });
    });

    test("HTML script and stylesheet references report resolve errors", async () => {
      const result = await buildInChild(`
        const long = Buffer.alloc(131072, "A").toString();
        const result = await Bun.build({
          entrypoints: ["/index.html"],
          files: {
            "/index.html":
              '<!doctype html><html><head><link rel="stylesheet" href="./' + long + '.css"></head>' +
              '<body><script src="./' + long + '.js"></script></body></html>',
          },
          throw: false,
        });
        console.log(JSON.stringify({
          success: result.success,
          logs: result.logs.map(log => log.message.replace(long, "<long>")).sort(),
        }));
      `);
      expect(result).toEqual({
        success: false,
        logs: ['Could not resolve: "./<long>.css"', 'Could not resolve: "./<long>.js"'],
      });
    });

    test("a relative entry point reports a resolve error", async () => {
      const result = await buildInChild(`
        const entryPoint = Buffer.alloc(131072, "A").toString() + ".js";
        const result = await Bun.build({
          entrypoints: [entryPoint],
          files: { "/entry.js": "" },
          throw: false,
        });
        console.log(JSON.stringify({
          success: result.success,
          logs: result.logs.map(log => log.message.replace(entryPoint, "<entry point>")),
        }));
      `);
      expect(result).toEqual({
        success: false,
        logs: ['ModuleNotFound resolving "<entry point>" (entry point)'],
      });
    });
  });

  // A key that is a file on disk replaces the contents of that file and nothing else. The resolver
  // resolves an import of it as it does without the key, whichever spelling the import has, so the
  // module has the tsconfig.json and package.json of its path. Each key here holds the bytes of its
  // file, so the build with the keys has to equal the build without them.
  describe("a key over a file on disk", () => {
    // One setting for each kind of config that the resolver reads for a file: tsconfig.json gives the
    // JSX import source and the decorators, package.json gives "type" and "sideEffects".
    const app = {
      "app/tsconfig.json": JSON.stringify({
        compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact", experimentalDecorators: true },
      }),
      "app/package.json": JSON.stringify({ name: "app", type: "module", sideEffects: false }),
      "app/component.tsx": `
        import cjs from "./cjs.cjs";
        function decorator(...args) { console.log(typeof args[1]); }
        class Decorated { @decorator method() {} }
        export const Component = () => <div>{cjs}{Decorated.name}</div>;
      `,
      "app/unused.ts": `console.log("unused ran"); export {};`,
      "app/cjs.cjs": `exports.__esModule = true; exports.default = "the default export";`,
    };
    const appKeys = (root: string) => ({
      [join(root, "app", "component.tsx")]: app["app/component.tsx"],
      [join(root, "app", "unused.ts")]: app["app/unused.ts"],
    });
    // `a.ts` spells the keys. `b.ts` leaves the extension to the resolver.
    const importers = {
      "index.ts": `import "./a.ts"; import "./b.ts";`,
      "a.ts": `import { Component } from "./app/component.tsx"; import "./app/unused.ts"; console.log(Component);`,
      "b.ts": `import { Component } from "./app/component"; import "./app/unused"; console.log(Component);`,
    };

    // Everything a build gives: the logs, the display path of each module, and the name and text of each output.
    async function build(config: Bun.BuildConfig) {
      const result = await Bun.build({
        external: ["preact", "react"],
        metafile: true,
        naming: "[name]-[hash].[ext]",
        throw: false,
        ...config,
      });
      return {
        success: result.success,
        logs: result.logs.map(log => log.message),
        inputs: Object.keys(result.metafile?.inputs ?? {}).sort(),
        outputs: await Promise.all(
          result.outputs.map(async output => ({ path: output.path, text: await output.text() })),
        ),
      };
    }
    type Built = Awaited<ReturnType<typeof build>>;
    // The output names of a build, without the hashes.
    const outputNames = (built: Built) =>
      built.outputs.map(output => basename(output.path).replace(/-[a-z0-9]+\./, ".")).sort();
    const jsxImportSource = (built: Built) => /"([^"]+)\/jsx-dev-runtime"/.exec(built.outputs[0]?.text ?? "")?.[1];

    // The import that lands first creates the module. An onLoad callback with no result reports that
    // the module exists, and the importer that has to come second waits for that report.
    function createdBy(first: "a" | "b", module = /component\.tsx$/): Bun.BunPlugin {
      const created = Promise.withResolvers<void>();
      return {
        name: "creation order",
        setup(build) {
          build.onLoad({ filter: module }, () => {
            created.resolve();
            return undefined;
          });
          for (const importer of ["a", "b"] as const) {
            build.onLoad({ filter: new RegExp(`[\\\\/]${importer}\\.ts$`) }, async () => {
              if (importer !== first) await created.promise;
              return undefined;
            });
          }
        },
      };
    }

    test("one importer that names the key both ways builds like the file on disk", async () => {
      using dir = tempDir("files-key-one-importer", {
        ...app,
        "exact-first.ts": `
          import { Component } from "./app/component.tsx";
          import { Component as again } from "./app/component";
          import "./app/unused.ts";
          import "./app/unused";
          console.log(Component, again);
        `,
        "resolver-first.ts": `
          import { Component } from "./app/component";
          import { Component as again } from "./app/component.tsx";
          import "./app/unused";
          import "./app/unused.ts";
          console.log(Component, again);
        `,
      });
      const root = String(dir);
      for (const entry of ["exact-first.ts", "resolver-first.ts"]) {
        const entrypoints = [join(root, entry)];
        const onDisk = await build({ entrypoints });
        expect(jsxImportSource(onDisk)).toBe("preact");
        expect(onDisk.outputs[0].text).not.toContain("unused ran");
        expect(await build({ entrypoints, files: appKeys(root) })).toEqual(onDisk);
      }
    });

    test("two importers create the module alike in either order", async () => {
      using dir = tempDir("files-key-two-importers", { ...app, ...importers });
      const root = String(dir);
      const entrypoints = [join(root, "index.ts")];
      const onDisk = await build({ entrypoints, plugins: [createdBy("a")] });
      expect(jsxImportSource(onDisk)).toBe("preact");
      for (const first of ["a", "b"] as const) {
        expect(await build({ entrypoints, files: appKeys(root), plugins: [createdBy(first)] })).toEqual(onDisk);
      }
    });

    test("a plugin gets the path of the file on disk for the key and for what the key imports", async () => {
      using dir = tempDir("files-key-plugin-paths", { ...app, ...importers });
      const root = String(dir);
      async function pathsAndBuild(files?: Record<string, string>) {
        const paths: string[] = [];
        const records: Bun.BunPlugin = {
          name: "records",
          setup(build) {
            build.onLoad({ filter: /component\.tsx$/ }, args => {
              paths.push(`onLoad path ${args.path}`);
              return undefined;
            });
            build.onResolve({ filter: /cjs\.cjs$/ }, args => {
              paths.push(`onResolve importer ${args.importer}`);
              return undefined;
            });
          },
        };
        const built = await build({ entrypoints: [join(root, "a.ts")], files, plugins: [records] });
        return { paths, built };
      }
      const onDisk = await pathsAndBuild();
      expect(onDisk.paths).toEqual([
        `onLoad path ${join(root, "app", "component.tsx")}`,
        `onResolve importer ${join(root, "app", "component.tsx")}`,
      ]);
      expect(await pathsAndBuild(appKeys(root))).toEqual(onDisk);
    });

    // The output root is the cwd when every entry point is a key, with or without a file. The names
    // that `build` asks for have no `[dir]`, so that difference does not show here.
    test("an entry point that names the key is compiled like the file on disk, however it is spelled", async () => {
      using dir = tempDir("files-key-entry-point", app);
      const root = String(dir);
      const key = join(root, "app", "component.tsx");
      const fromCwd = relative(process.cwd(), key).replaceAll("\\", "/");
      // On Windows the temporary directory can be on another drive, and then there is no relative spelling.
      const relativeToCwd = isAbsolute(fromCwd) ? fromCwd : "./" + fromCwd;
      const declines: Bun.BunPlugin = {
        name: "declines",
        setup(build) {
          build.onResolve({ filter: /component/ }, () => undefined);
        },
      };
      for (const [entry, plugins] of [
        [key, []],
        [fromCwd, []],
        [relativeToCwd, []],
        [relativeToCwd.slice(0, -".tsx".length), []],
        [key, [declines]],
      ] as const) {
        const config = { entrypoints: [entry], plugins: [...plugins] };
        const onDisk = await build(config);
        expect(jsxImportSource(onDisk)).toBe("preact");
        expect(await build({ ...config, files: appKeys(root) })).toEqual(onDisk);
      }
    });

    test("an HTML entry point that names the key is built for the browser, like the file on disk", async () => {
      using dir = tempDir("files-key-html-entry-point", {
        "page.html": `<!doctype html><html><body><script type="module" src="./client.ts"></script></body></html>`,
        "client.ts": `console.log("client");`,
      });
      const root = String(dir);
      const entrypoints = [join(root, "page.html")];
      const files = { [join(root, "page.html")]: await Bun.file(join(root, "page.html")).text() };
      const onDisk = await build({ entrypoints, target: "bun" });
      expect({
        names: outputNames(onDisk),
        bunPragma: onDisk.outputs.some(output => output.text.includes("// @bun")),
      }).toEqual({
        names: ["chunk.js", "page.html"],
        bunPragma: false,
      });
      expect(await build({ entrypoints, target: "bun", files })).toEqual(onDisk);
    });

    test.each([
      ["every import of the key", /component/],
      ["the import that spells the key", /component\.tsx$/],
      ["the import that the resolver resolves to the key", /component$/],
    ])("onResolve that declines %s leaves the build as it is without the key", async (_, declined) => {
      using dir = tempDir("files-key-declined", { ...app, ...importers });
      const root = String(dir);
      const entrypoints = [join(root, "index.ts")];
      const declines: Bun.BunPlugin = {
        name: "declines",
        setup(build) {
          build.onResolve({ filter: declined }, () => undefined);
        },
      };
      for (const first of ["a", "b"] as const) {
        const onDisk = await build({ entrypoints, plugins: [createdBy(first), declines] });
        expect(onDisk.logs).toEqual([]);
        expect(await build({ entrypoints, files: appKeys(root), plugins: [createdBy(first), declines] })).toEqual(
          onDisk,
        );
      }
    });

    // Only a key that the resolver itself names is the file on disk. The resolver names another path for
    // a directory and for a path through a symlinked directory, and none for a path with no file. No
    // import reaches such a key through the resolver, so it stays a file in memory, as before.
    test("a key is the file on disk only when the resolver names that file by the key", async () => {
      using dir = tempDir("files-key-which-keys", {
        "app/tsconfig.json": app["app/tsconfig.json"],
        "app/file.tsx": `export const Component = () => <div>on disk</div>;`,
        "app/directory.tsx/index.tsx": `export const Component = () => <div>on disk</div>;`,
      });
      const root = String(dir);
      // A junction needs no privilege on Windows.
      symlinkSync(join(root, "app"), join(root, "link"), "junction");
      const declines: Bun.BunPlugin = {
        name: "declines",
        setup(build) {
          build.onResolve({ filter: /absent\.tsx$/ }, () => undefined);
        },
      };
      const compiledWith: Record<string, unknown> = {};
      const rows: [string, string, { external?: string[]; plugins?: Bun.BunPlugin[] }][] = [
        ["a file", "./app/file.tsx", {}],
        ["a directory", "./app/directory.tsx", {}],
        [
          "a directory that `external` lists",
          "./app/directory.tsx",
          { external: [join(root, "app", "directory.tsx")] },
        ],
        ["a path through a symlinked directory", "./link/file.tsx", {}],
        ["no file", "./app/absent.tsx", {}],
        ["no file, and onResolve declines the import", "./app/absent.tsx", { plugins: [declines] }],
      ];
      for (const [name, specifier, options] of rows) {
        const entry = join(root, "entry.tsx");
        const built = await build({
          entrypoints: [entry],
          files: {
            [entry]: `import { Component } from "${specifier}"; console.log(Component);`,
            [join(root, specifier)]: `export const Component = () => <div>in memory</div>;`,
          },
          jsx: { runtime: "automatic", importSource: "the-build-option" },
          external: ["preact", "the-build-option", ...(options.external ?? [])],
          plugins: options.plugins,
        });
        compiledWith[name] = {
          logs: built.logs,
          contents: built.outputs[0]?.text.includes("in memory") ? "in memory" : "on disk",
          jsxImportSource: jsxImportSource(built),
        };
      }
      const inMemory = { logs: [], contents: "in memory", jsxImportSource: "the-build-option" };
      expect(compiledWith).toEqual({
        "a file": { logs: [], contents: "in memory", jsxImportSource: "preact" },
        "a directory": inMemory,
        "a directory that `external` lists": inMemory,
        "a path through a symlinked directory": inMemory,
        "no file": inMemory,
        "no file, and onResolve declines the import": inMemory,
      });
    });

    test.each([
      [
        "`external` lists",
        app,
        (root: string) => ({ external: ["preact", "react", join(root, "app", "component.tsx")] }),
        `from "./app/component.tsx"`,
      ],
      [
        "a `browser` map points away from",
        {
          ...app,
          "app/package.json": JSON.stringify({ name: "app", browser: { "./component.tsx": "./browser.tsx" } }),
          "app/browser.tsx": `export const Component = () => <div>the browser file</div>;`,
        },
        (_root: string) => ({ target: "browser" as const }),
        "the browser file",
      ],
    ])("an import that %s the file resolves as it does without the key", async (_, tree, options, marker) => {
      using dir = tempDir("files-key-import-rules", {
        ...tree,
        "exact.ts": `import { Component } from "./app/component.tsx"; console.log(Component);`,
        "resolver.ts": `import { Component } from "./app/component"; console.log(Component);`,
      });
      const root = String(dir);
      const onDisk = await build({ entrypoints: [join(root, "exact.ts")], ...options(root) });
      expect({ logs: onDisk.logs, marker: onDisk.outputs[0]?.text.includes(marker) }).toEqual({
        logs: [],
        marker: true,
      });
      for (const entry of ["exact.ts", "resolver.ts"]) {
        const config = { entrypoints: [join(root, entry)], ...options(root) };
        expect(await build({ ...config, files: appKeys(root) })).toEqual(await build(config));
      }
    });

    test.each([
      [
        "a stylesheet and a CSS module",
        {
          "entry.ts": `import styles from "./title.module.css"; import "./index.css"; console.log(styles.title);`,
          "index.css": `@import "./imported.css";\n.index { color: red; }`,
          "imported.css": `.imported { color: blue; }`,
          "title.module.css": `.title { color: green; }`,
        },
        {},
      ],
      [
        "an import attribute and a JSON file",
        {
          "entry.ts": `import text from "./text.ts" with { type: "text" }; import json from "./data.json"; console.log(text, json);`,
          "text.ts": `export const notCompiled = 1;`,
          "data.json": `{ "value": 1 }`,
        },
        {},
      ],
      [
        "`import()` and `require()`",
        {
          "entry.ts": `const lazy = await import("./lazy.ts"); console.log(lazy, require("./required.cjs"));`,
          "lazy.ts": `export const lazy = 1;`,
          "required.cjs": `module.exports = 2;`,
        },
        { splitting: true },
      ],
    ])("%s under a key build like the files on disk", async (_, tree, options) => {
      using dir = tempDir("files-key-import-kinds", tree);
      const root = String(dir);
      const config = { entrypoints: [join(root, "entry.ts")], ...options };
      const files = Object.fromEntries(
        Object.entries(tree)
          .filter(([name]) => name !== "entry.ts")
          .map(([name, text]) => [join(root, name), text]),
      );
      const onDisk = await build(config);
      expect({ logs: onDisk.logs, inputs: onDisk.inputs.length }).toEqual({
        logs: [],
        inputs: Object.keys(tree).length,
      });
      expect(await build({ ...config, files })).toEqual(onDisk);
    });

    test("the `tsconfig` option sets the JSX of the key, as it does for the file on disk", async () => {
      using dir = tempDir("files-key-tsconfig-option", {
        ...app,
        "other/tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "solid-js" } }),
        "exact.ts": `import { Component } from "./app/component.tsx"; console.log(Component);`,
        "resolver.ts": `import { Component } from "./app/component"; console.log(Component);`,
      });
      const root = String(dir);
      for (const entry of ["exact.ts", "resolver.ts"]) {
        const config = {
          entrypoints: [join(root, entry)],
          tsconfig: join(root, "other", "tsconfig.json"),
          external: ["solid-js"],
        };
        const onDisk = await build(config);
        expect(jsxImportSource(onDisk)).toBe("solid-js");
        expect(await build({ ...config, files: appKeys(root) })).toEqual(onDisk);
      }
    });

    // `files` joins a specifier with no `./` to the directory of the importer. The resolver does not,
    // so such an import of a key that is a file on disk fails, as it fails without the key.
    test("an import with no `./` reaches only a key with no file", async () => {
      using dir = tempDir("files-key-bare-specifier", {
        "entry.ts": `import "leaf.ts";`,
        "leaf.ts": `console.log("leaf");`,
      });
      const root = String(dir);
      const entrypoints = [join(root, "entry.ts")];
      const onDisk = await build({ entrypoints });
      expect(onDisk).toEqual({
        success: false,
        logs: [`Could not resolve: "leaf.ts". Maybe you need to "bun install"?`],
        inputs: [],
        outputs: [],
      });
      expect(await build({ entrypoints, files: { [join(root, "leaf.ts")]: `console.log("leaf");` } })).toEqual(onDisk);
      const noFile = await build({
        entrypoints,
        files: {
          [join(root, "entry.ts")]: `import "absent.ts";`,
          [join(root, "absent.ts")]: `console.log("in memory");`,
        },
      });
      expect({ logs: noFile.logs, inMemory: noFile.outputs[0]?.text.includes("in memory") }).toEqual({
        logs: [],
        inMemory: true,
      });
    });

    test("an HTML file under a key that server code imports gets its manifest in either order", async () => {
      using dir = tempDir("files-key-html-import", {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@page": ["./pages/page.html"] } },
        }),
        "index.ts": importers["index.ts"],
        "a.ts": `import page from "./pages/page.html"; console.log(page.index);`,
        "b.ts": `import page from "@page"; console.log(page.index);`,
        "pages/page.html": `<!doctype html><html><body><script type="module" src="./client.ts"></script></body></html>`,
        "pages/client.ts": `console.log("client");`,
      });
      const root = String(dir);
      const entrypoints = [join(root, "index.ts")];
      const files = { [join(root, "pages", "page.html")]: await Bun.file(join(root, "pages", "page.html")).text() };
      const onDisk = await build({ entrypoints, target: "bun", plugins: [createdBy("a", /page\.html$/)] });
      expect({ logs: onDisk.logs, names: outputNames(onDisk) }).toEqual({
        logs: [],
        names: ["chunk.js", "index.js", "page.html"],
      });
      for (const first of ["a", "b"] as const) {
        expect(await build({ entrypoints, files, target: "bun", plugins: [createdBy(first, /page\.html$/)] })).toEqual(
          onDisk,
        );
      }
    });

    test("a file under a key that an HTML file links to is copied as an asset", async () => {
      using dir = tempDir("files-key-url-asset", {
        "index.html": `<!doctype html><html><head><link rel="manifest" href="./manifest.json" /></head><body></body></html>`,
        "manifest.json": `{ "name": "app" }`,
      });
      const root = String(dir);
      const entrypoints = [join(root, "index.html")];
      const onDisk = await build({ entrypoints });
      expect(outputNames(onDisk)).toEqual(["chunk.js", "index.html", "manifest.json"]);
      expect(await build({ entrypoints, files: { [join(root, "manifest.json")]: `{ "name": "app" }` } })).toEqual(
        onDisk,
      );
    });

    test("a barrel file under a key defers its re-exports like the file on disk, in either order", async () => {
      const leaf = (name: string) => `console.log("${name} ran"); export const ${name} = "${name}";`;
      const barrel = {
        "app/package.json": JSON.stringify({ name: "app", sideEffects: false }),
        "app/index.ts": `export { alpha } from "./alpha.ts"; export { beta } from "./beta.ts"; export { gamma } from "./gamma.ts";`,
        "app/alpha.ts": leaf("alpha"),
        "app/beta.ts": leaf("beta"),
        "app/gamma.ts": leaf("gamma"),
      };
      using dir = tempDir("files-key-barrel", {
        ...barrel,
        "index.ts": importers["index.ts"],
        "a.ts": `import { alpha } from "./app/index.ts"; console.log(alpha);`,
        "b.ts": `import { beta } from "./app/index"; console.log(beta);`,
      });
      const root = String(dir);
      const entrypoints = [join(root, "index.ts")];
      const files = Object.fromEntries(
        Object.entries(barrel)
          .filter(([name]) => name.endsWith(".ts"))
          .map(([name, text]) => [join(root, name), text]),
      );
      const module = /app[\\/]index\.ts$/;
      const onDisk = await build({ entrypoints, plugins: [createdBy("a", module)] });
      expect({
        logs: onDisk.logs,
        ran: ["alpha", "beta", "gamma"].filter(name => onDisk.outputs[0]?.text.includes(`${name} ran`)),
      }).toEqual({ logs: [], ran: ["alpha", "beta"] });
      for (const first of ["a", "b"] as const) {
        expect(await build({ entrypoints, files, plugins: [createdBy(first, module)] })).toEqual(onDisk);
      }
    });

    // The resolver reads the directory of a key that is a file on disk when an import first names the
    // key, as it does for the file without the key. It reports a config file that does not parse once
    // per process, so each of the two builds gets its own copy of the files.
    test("a tsconfig.json that does not parse beside the key fails the build as it does without the key", async () => {
      async function buildCopy(withKey: boolean) {
        using dir = tempDir("files-key-broken-tsconfig", {
          "entry.ts": `import "./broken/leaf.ts";`,
          "broken/tsconfig.json": `{ "compilerOptions": `,
          "broken/leaf.ts": `console.log("leaf");`,
        });
        const root = String(dir);
        const files = withKey ? { [join(root, "broken", "leaf.ts")]: `console.log("leaf");` } : undefined;
        const built = await build({ entrypoints: [join(root, "entry.ts")], files });
        return { success: built.success, logs: built.logs, outputs: built.outputs.length };
      }
      const onDisk = await buildCopy(false);
      expect(onDisk).toEqual({ success: false, logs: ["Unexpected end of file"], outputs: 0 });
      expect(await buildCopy(true)).toEqual(onDisk);
    });

    // The resolver lists a directory once per build. It lists the directory of a key that is a file on
    // disk before the onLoad callback of the key runs, as it does without the key. It does not look at
    // the directory of a key with no file: it would keep a directory that it did not find for the
    // whole process.
    test("an onLoad callback for the key cannot add a file beside a file on disk, and can create the directory of a key with no file", async () => {
      async function buildCopy(tree: Record<string, string>, withKey: boolean) {
        using dir = tempDir("files-key-onload-writes", { ...tree, "entry.ts": `import "./generated/leaf.ts";` });
        const root = String(dir);
        const writes: Bun.BunPlugin = {
          name: "writes",
          setup(build) {
            build.onLoad({ filter: /leaf\.ts$/ }, () => {
              const dependency = join(root, "generated", "node_modules", "dependency");
              mkdirSync(dependency, { recursive: true });
              writeFileSync(join(dependency, "index.js"), `console.log("dependency");`);
              writeFileSync(join(root, "generated", "sibling.ts"), `console.log("sibling");`);
              return undefined;
            });
          },
        };
        const leaf = `import "dependency"; import "./sibling.ts"; console.log("leaf");`;
        const built = await build({
          entrypoints: [join(root, "entry.ts")],
          files: withKey ? { [join(root, "generated", "leaf.ts")]: leaf } : undefined,
          plugins: [writes],
        });
        return {
          success: built.success,
          logs: built.logs,
          outputs: built.outputs.length,
          siblingWritten: existsSync(join(root, "generated", "sibling.ts")),
        };
      }
      const leafOnDisk = { "generated/leaf.ts": `import "dependency"; import "./sibling.ts"; console.log("leaf");` };
      const onDisk = await buildCopy(leafOnDisk, false);
      expect(onDisk).toEqual({
        success: false,
        logs: [
          `Could not resolve: "dependency". Maybe you need to "bun install"?`,
          `Could not resolve: "./sibling.ts"`,
        ],
        outputs: 0,
        siblingWritten: true,
      });
      expect(await buildCopy(leafOnDisk, true)).toEqual(onDisk);
      expect(await buildCopy({}, true)).toEqual({ success: true, logs: [], outputs: 1, siblingWritten: true });
    });
  });
});
