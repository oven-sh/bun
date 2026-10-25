import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, unprivilegedSpawnOptions } from "harness";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
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

  // A key that is the path of a file on disk replaces the contents of that file and nothing else. The
  // module is compiled with the tsconfig.json and package.json of that path, whichever entry point or
  // import creates it. A key with no file on disk is compiled with the Bun.build options.
  describe.concurrent("a key and the file on disk that it names", () => {
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
    // Each key holds the bytes of its file, so a build with the keys has to equal the build without them.
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
        logs: result.logs.map(log => log.message),
        inputs: Object.keys(result.metafile?.inputs ?? {}).sort(),
        outputs: await Promise.all(
          result.outputs.map(async output => ({ path: output.path, text: await output.text() })),
        ),
      };
    }

    // The output names of a build, without the hashes.
    const outputNames = (built: Awaited<ReturnType<typeof build>>) =>
      built.outputs.map(output => basename(output.path).replace(/-[a-z0-9]+\./, ".")).sort();

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
        expect(onDisk.outputs[0].text).toContain(`"preact/jsx-dev-runtime"`);
        expect(onDisk.outputs[0].text).not.toContain("unused ran");
        expect(await build({ entrypoints, files: appKeys(root) })).toEqual(onDisk);
      }
    });

    test("two importers create the module alike in either order", async () => {
      using dir = tempDir("files-key-two-importers", { ...app, ...importers });
      const root = String(dir);
      const entrypoints = [join(root, "index.ts")];
      const onDisk = await build({ entrypoints, plugins: [createdBy("a")] });
      expect(onDisk.outputs[0].text).toContain(`"preact/jsx-dev-runtime"`);
      for (const first of ["a", "b"] as const) {
        expect(await build({ entrypoints, files: appKeys(root), plugins: [createdBy(first)] })).toEqual(onDisk);
      }
    });

    test("an entry point that names the key builds like the file on disk, however it is spelled", async () => {
      using dir = tempDir("files-key-entry-point", app);
      const root = String(dir);
      const key = join(root, "app", "component.tsx");
      const fromCwd = relative(process.cwd(), key).replaceAll("\\", "/");
      // On Windows the temporary directory can be on another drive, and then there is no relative spelling.
      const relativeToCwd = isAbsolute(fromCwd) ? fromCwd : "./" + fromCwd;
      for (const entry of [key, relativeToCwd, relativeToCwd.slice(0, -".tsx".length)]) {
        const entrypoints = [entry];
        const onDisk = await build({ entrypoints });
        expect(onDisk.outputs[0].text).toContain(`"preact/jsx-dev-runtime"`);
        expect(await build({ entrypoints, files: appKeys(root) })).toEqual(onDisk);
      }
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
        expect(
          await build({ entrypoints, files: appKeys(root), plugins: [createdBy(first), declines] }),
        ).toEqual(onDisk);
      }
    });

    test("onResolve that answers with the key creates the module that the resolver creates", async () => {
      using dir = tempDir("files-key-answered", {
        ...app,
        ...importers,
        "a.ts": `import { Component } from "alias/component"; console.log(Component);`,
      });
      const root = String(dir);
      const entrypoints = [join(root, "index.ts")];
      const answers: Bun.BunPlugin = {
        name: "answers",
        setup(build) {
          build.onResolve({ filter: /^alias\/component$/ }, () => ({ path: join(root, "app", "component.tsx") }));
        },
      };
      // Without the keys the resolver has to land first: a module that onResolve creates is not the subject here.
      const onDisk = await build({ entrypoints, plugins: [createdBy("b"), answers] });
      expect(onDisk.outputs[0].text).toContain(`"preact/jsx-dev-runtime"`);
      for (const first of ["a", "b"] as const) {
        expect(
          await build({ entrypoints, files: appKeys(root), plugins: [createdBy(first), answers] }),
        ).toEqual(onDisk);
      }
    });

    test("an entry point that onResolve declines, or answers with the key, builds like the file on disk", async () => {
      using dir = tempDir("files-key-plugin-entry-point", app);
      const root = String(dir);
      const key = join(root, "app", "component.tsx");
      const declines: Bun.BunPlugin = {
        name: "declines",
        setup(build) {
          build.onResolve({ filter: /component\.tsx$/ }, () => undefined);
        },
      };
      const answers: Bun.BunPlugin = {
        name: "answers",
        setup(build) {
          build.onResolve({ filter: /^virtual-entry$/ }, () => ({ path: key }));
        },
      };
      const onDisk = await build({ entrypoints: [key], plugins: [declines] });
      expect(onDisk.outputs[0].text).toContain(`"preact/jsx-dev-runtime"`);
      expect(await build({ entrypoints: [key], files: appKeys(root), plugins: [declines] })).toEqual(onDisk);
      // The output takes the name of the entry point, so only the text can be equal.
      const answered = await build({ entrypoints: ["virtual-entry"], files: appKeys(root), plugins: [answers] });
      expect(answered.outputs.map(output => output.text)).toEqual(onDisk.outputs.map(output => output.text));
    });

    // An in-memory module shows the JSX import source it was compiled with, and whether its side effect survived.
    const inMemoryOptions = {
      jsx: { runtime: "automatic", importSource: "in-memory-jsx" },
      external: ["in-memory-jsx"],
    } as const;
    const compiledWith = (text: string) => ({
      jsxImportSource: /"([^"]+)\/jsx-dev-runtime"/.exec(text)?.[1],
      sideEffectRan: text.includes("effect ran"),
      contents: text.includes("in memory") ? "in memory" : text.includes("on disk") ? "on disk" : "none",
    });
    // `config` holds a tsconfig.json and a package.json that must not apply. `directory` is how the keys spell it.
    const inMemoryTree = (config: string, directory: string) => ({
      [`${config}/tsconfig.json`]: app["app/tsconfig.json"],
      [`${config}/package.json`]: app["app/package.json"],
      "entry.ts": `import { Component } from "./${directory}/memory.tsx"; import "./${directory}/effect.ts"; console.log(Component);`,
    });
    // Two builds: the keys as imports, then a key as the entry point.
    const inMemoryBuilds = (root: string, directory: string): Bun.BuildConfig[] => {
      const files = {
        [join(root, directory, "memory.tsx")]: `export const Component = () => <div>in memory</div>;`,
        [join(root, directory, "effect.ts")]: `console.log("effect ran");`,
      };
      return [
        { entrypoints: [join(root, "entry.ts")], files, ...inMemoryOptions },
        { entrypoints: [join(root, directory, "memory.tsx")], files, ...inMemoryOptions },
      ];
    };
    const howCompiled = ([imported, entryPoint]: Awaited<ReturnType<typeof build>>[]) => ({
      logs: [...imported.logs, ...entryPoint.logs],
      imported: compiledWith(imported.outputs[0]?.text ?? ""),
      entryPoint: compiledWith(entryPoint.outputs[0]?.text ?? "").jsxImportSource,
    });
    const compiledWithBuildOptions = {
      logs: [],
      imported: { jsxImportSource: "in-memory-jsx", sideEffectRan: true, contents: "in memory" },
      entryPoint: "in-memory-jsx",
    };

    // The resolver has no file of that name for these keys. No import reaches their modules through the
    // resolver, so they stay files in memory: the tsconfig.json and package.json beside them do not apply.
    for (const [name, directory, prepare] of [
      ["has no file on disk", "app", (_root: string) => {}],
      [
        "names a directory",
        "app",
        (root: string) => {
          mkdirSync(join(root, "app", "memory.tsx"));
          writeFileSync(join(root, "app", "memory.tsx", "index.tsx"), `export const Component = "on disk";`);
        },
      ],
      [
        "goes through a symlinked directory",
        "link",
        (root: string) => {
          writeFileSync(join(root, "app", "memory.tsx"), `export const Component = "on disk";`);
          symlinkSync(join(root, "app"), join(root, "link"), "dir");
        },
      ],
    ] as const) {
      test.skipIf(isWindows && directory === "link")(
        `a key that ${name} is compiled with the Bun.build options`,
        async () => {
          using dir = tempDir("files-key-in-memory", inMemoryTree("app", directory));
          const root = String(dir);
          prepare(root);
          const builds = [];
          for (const config of inMemoryBuilds(root, directory)) builds.push(await build(config));
          expect(howCompiled(builds)).toEqual(compiledWithBuildOptions);
        },
      );
    }

    // A directory that the user can pass through and cannot list. The resolver cannot read it, so it has
    // nothing to say about the key, and that is not an error of the build. The child is not root.
    test.skipIf(isWindows)(
      "a key in a directory that cannot be listed is compiled with the Bun.build options",
      async () => {
        using dir = tempDir("files-key-unlistable", {
          ...inMemoryTree("locked", "locked"),
          "locked/memory.tsx": `export const Component = "on disk";`,
          "build-fixture.ts": `
            ${build}
            const builds = [];
            for (const config of JSON.parse(process.argv[2])) builds.push(await build(config));
            console.log(JSON.stringify(builds));
          `,
        });
        const root = String(dir);
        // With the browser target the resolver reads the directory of the importer for its "browser" map.
        const configs = inMemoryBuilds(root, "locked").map(config => ({ ...config, target: "bun" }));
        using unprivileged = unprivilegedSpawnOptions(root);
        chmodSync(join(root, "locked"), 0o311);
        try {
          await using proc = Bun.spawn({
            cmd: [bunExe(), join(root, "build-fixture.ts"), JSON.stringify(configs)],
            env: bunEnv,
            cwd: root,
            stdout: "pipe",
            stderr: "pipe",
            ...unprivileged,
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
          expect(howCompiled(JSON.parse(stdout))).toEqual(compiledWithBuildOptions);
        } finally {
          chmodSync(join(root, "locked"), 0o755);
        }
      },
    );

    test("a key with no file on disk stays away from the resolver, and its entry point builds when onResolve declines it", async () => {
      using dir = tempDir("files-key-no-file", { "entry.ts": `import "./generated/virtual.ts";` });
      const root = String(dir);
      const key = join(root, "generated", "virtual.ts");
      const files = { [key]: `import "dependency"; console.log("in memory");` };
      // The resolver keeps a directory that it did not find for the whole process, and it looks for
      // `node_modules` from the directory of the importer. It must not look for this directory before the
      // plugin creates it.
      const createsDirectory: Bun.BunPlugin = {
        name: "creates the directory",
        setup(build) {
          build.onLoad({ filter: /virtual\.ts$/ }, () => {
            const dependency = join(root, "generated", "node_modules", "dependency");
            mkdirSync(dependency, { recursive: true });
            writeFileSync(join(dependency, "index.js"), `console.log("dependency");`);
            return undefined;
          });
        },
      };
      const imported = await build({ entrypoints: [join(root, "entry.ts")], files, plugins: [createsDirectory] });
      expect({ logs: imported.logs, dependency: imported.outputs[0]?.text.includes(`"dependency"`) }).toEqual({
        logs: [],
        dependency: true,
      });

      const declines: Bun.BunPlugin = {
        name: "declines",
        setup(build) {
          build.onResolve({ filter: /virtual\.ts$/ }, () => undefined);
        },
      };
      const entryPoint = await build({ entrypoints: [key], files });
      expect(entryPoint.logs).toEqual([]);
      expect(await build({ entrypoints: [key], files, plugins: [declines] })).toEqual(entryPoint);
    });

    test("a key that `external` lists is still bundled, with the config of its path and in either order", async () => {
      using dir = tempDir("files-key-external", { ...app, ...importers });
      const root = String(dir);
      const entrypoints = [join(root, "index.ts")];
      const external = ["preact", "react", join(root, "app", "component.tsx")];
      // Without the key, `external` leaves the import of `a.ts` in the output: it compares the import as written.
      const withoutKey = await build({ entrypoints, external, plugins: [createdBy("b")] });
      expect(withoutKey.outputs[0].text).toContain(`from "./app/component.tsx"`);
      // With the key, both imports get the module that the resolver creates for `b.ts`.
      const onDisk = await build({ entrypoints, plugins: [createdBy("a")] });
      for (const first of ["a", "b"] as const) {
        expect(
          await build({ entrypoints, external, files: appKeys(root), plugins: [createdBy(first)] }),
        ).toEqual(onDisk);
      }
    });

    test("a key that a `browser` map points away from is still the module of its own path", async () => {
      using dir = tempDir("files-key-browser-map", {
        "app/tsconfig.json": app["app/tsconfig.json"],
        "app/package.json": JSON.stringify({ name: "app", browser: { "./page.tsx": "./page.browser.tsx" } }),
        "app/page.tsx": `export const Page = () => <div>on disk</div>;`,
        "app/page.browser.tsx": `export const Page = () => <div>browser file</div>;`,
        "exact.ts": `import { Page } from "./app/page.tsx"; console.log(Page);`,
        "resolver.ts": `import { Page } from "./app/page"; console.log(Page);`,
      });
      const root = String(dir);
      const files = { [join(root, "app", "page.tsx")]: `export const Page = () => <div>in memory</div>;` };
      const exact = await build({ entrypoints: [join(root, "exact.ts")], files, target: "browser" });
      const resolver = await build({ entrypoints: [join(root, "resolver.ts")], files, target: "browser" });
      expect({
        logs: [...exact.logs, ...resolver.logs],
        // The import that spells the key gets the key, as before, and now with the tsconfig.json of its path.
        exact: { ...compiledWith(exact.outputs[0].text), browserFile: exact.outputs[0].text.includes("browser file") },
        // The resolver follows the map to another file, and the key is not that file.
        resolver: { ...compiledWith(resolver.outputs[0].text), browserFile: resolver.outputs[0].text.includes("browser file") },
      }).toEqual({
        logs: [],
        exact: { jsxImportSource: "preact", sideEffectRan: false, contents: "in memory", browserFile: false },
        resolver: { jsxImportSource: "preact", sideEffectRan: false, contents: "none", browserFile: true },
      });
    });

    test("an HTML file under a key that server code imports gets its manifest in either order", async () => {
      using dir = tempDir("files-key-html-import", {
        "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@page": ["./pages/page.html"] } } }),
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
      expect(onDisk.logs).toEqual([]);
      expect(outputNames(onDisk)).toEqual(["chunk.js", "index.js", "page.html"]);
      for (const first of ["a", "b"] as const) {
        expect(
          await build({ entrypoints, files, target: "bun", plugins: [createdBy(first, /page\.html$/)] }),
        ).toEqual(onDisk);
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

    // The resolver reads the directory of a key on disk when the module is created, as it does for the
    // file without the key. These two builds fail without the key, and they fail alike with it.
    test.each([
      [
        "a tsconfig.json that does not parse beside the key",
        { "broken/tsconfig.json": `{ "compilerOptions": `, "broken/leaf.ts": `console.log("leaf");` },
        [],
      ],
      [
        "an onLoad callback for the key that writes a file the key imports",
        { "broken/leaf.ts": `import "./sibling.ts"; console.log("leaf");` },
        [
          (root: string): Bun.BunPlugin => ({
            name: "writes the sibling",
            setup(build) {
              build.onLoad({ filter: /leaf\.ts$/ }, () => {
                writeFileSync(join(root, "broken", "sibling.ts"), `console.log("sibling");`);
                return undefined;
              });
            },
          }),
        ],
      ],
    ])("%s fails the build as it does without the key", async (_, tree, plugins) => {
      // The resolver reports a config file that does not parse once per process, and lists a directory
      // once per build, so each build gets its own copy of the files.
      async function buildCopy(withKey: boolean) {
        using dir = tempDir("files-key-resolver-reads", { ...tree, "entry.ts": `import "./broken/leaf.ts";` });
        const root = String(dir);
        const result = await build({
          entrypoints: [join(root, "entry.ts")],
          files: withKey ? { [join(root, "broken", "leaf.ts")]: tree["broken/leaf.ts"] } : undefined,
          plugins: plugins.map(plugin => plugin(root)),
        });
        return { logs: result.logs.map(log => log.replaceAll(root, "<root>")), outputs: result.outputs.length };
      }
      const onDisk = await buildCopy(false);
      expect(onDisk.logs).not.toEqual([]);
      expect(await buildCopy(true)).toEqual(onDisk);
    });
  });
});
