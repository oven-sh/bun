import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";

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

  // `check: true` type checks the source text of a file: its text in `files`, or else on disk. It checks what an onLoad
  // plugin returns only for a file that isn't on disk, and whose text in `files` it can't check: the file isn't there,
  // or it isn't TypeScript or JavaScript by name.
  // The tests run one at a time: each type check uses every core, so checks that run at once slow each other down.
  describe("check: true", () => {
    // `noLib` skips TypeScript's libraries, which take seconds to load in a debug build. `globals.d.ts` declares the
    // types that TypeScript asks for then.
    const options = {
      strict: true,
      noEmit: true,
      target: "esnext",
      module: "esnext",
      moduleResolution: "bundler",
      noLib: true,
      types: [],
      skipLibCheck: true,
      allowImportingTsExtensions: true,
    };
    const globals = [
      "Array<T>",
      "Boolean",
      "CallableFunction",
      "Function",
      "IArguments",
      "ImportAttributes",
      "NewableFunction",
      "Number",
      "Object",
      "RegExp",
      "String",
    ]
      .map(name => `interface ${name} {}\n`)
      .join("");

    // Each text has a type error that names where the text is from.
    const text = (from: string) => `export const value: "${from}" = 1;\n`;
    const wrong = (from: string, file = "lib.ts") => `TS2322: Type '1' is not assignable to type '"${from}"'. ${file}`;
    const notFound = (specifier: string) =>
      `TS2307: Cannot find module '${specifier}' or its corresponding type declarations. main.ts`;

    type Plugin = (build: Bun.PluginBuilder, dir: string) => void;
    type Project = {
      /** The files on disk, besides `tsconfig.json` and `globals.d.ts`. */
      disk: Record<string, string>;
      /** `files`, by each file's name in the project. */
      files?: Record<string, string>;
      plugin?: Plugin;
      entry?: string;
      loader?: Bun.BuildConfig["loader"];
    };
    /** `errors`: the message and the file of each. */
    type Row = Project & { name: string; errors: string[] };

    async function errorsOf({ disk, files = {}, plugin, entry = "main.ts", loader }: Project) {
      using project = tempDir("bundler-files-check", {
        "tsconfig.json": JSON.stringify({ compilerOptions: options }),
        "globals.d.ts": globals,
        ...disk,
      });
      const dir = String(project);
      const built = await Bun.build({
        entrypoints: [`${dir}/${entry}`],
        loader,
        check: true,
        throw: false,
        files: Object.fromEntries(Object.entries(files).map(([file, text]) => [`${dir}/${file}`, text])),
        plugins: plugin ? [{ name: "plugin", setup: build => plugin(build, dir) }] : [],
      });
      return built.logs.map(log => `${log.message} ${relative(dir, log.position?.file ?? "").replaceAll("\\", "/")}`);
    }

    const main = `export { value } from "./lib.ts";\n`;
    const typeOnly = (specifier: string) =>
      `import type { value } from "${specifier}";\nexport type Value = typeof value;\n`;
    const returns =
      (contents: string, loader: Bun.Loader = "ts", filter = /lib[.]ts$/): Plugin =>
      build => {
        build.onLoad({ filter }, () => ({ contents, loader }));
      };

    /** Like `errorsOf`, with the key `./lib.ts` in `files`. A relative key counts from the working directory. */
    async function errorsWithRelativeKey(main: string, hasPlugin: boolean) {
      using project = tempDir("bundler-files-check", {
        "tsconfig.json": JSON.stringify({ compilerOptions: options }),
        "globals.d.ts": globals,
        "main.ts": main,
        "build.mjs": `
          import { relative } from "node:path";
          const contents = ${JSON.stringify(text("plugin"))};
          const setup = build => build.onLoad({ filter: /lib[.]ts$/ }, () => ({ contents, loader: "ts" }));
          const built = await Bun.build({
            entrypoints: ["./main.ts"],
            check: true,
            throw: false,
            files: { "./lib.ts": ${JSON.stringify(text("files"))} },
            plugins: ${hasPlugin} ? [{ name: "plugin", setup }] : [],
          });
          const file = log => relative(process.cwd(), log.position?.file ?? "").replaceAll("\\\\", "/");
          console.log(JSON.stringify(built.logs.map(log => log.message + " " + file(log))));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build.mjs"],
        cwd: String(project),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(stdout) as string[];
    }

    describe("checks the source text of a file", () => {
      const inFiles = { disk: { "main.ts": main }, files: { "lib.ts": text("files") }, errors: [wrong("files")] };
      const onDisk = { disk: { "main.ts": main, "lib.ts": text("disk") } };
      const noExport = `TS2305: Module '"./lib.ts"' has no exported member 'value'. main.ts`;
      const rows: Row[] = [
        { name: "in `files`", ...inFiles },
        { name: "on disk and in `files`", ...inFiles, ...onDisk },
        { name: "on disk, loaded by a plugin", ...onDisk, plugin: returns(text("plugin")), errors: [wrong("disk")] },
        {
          name: "that only a plugin provides",
          disk: { "main.ts": main },
          plugin(build, dir) {
            build.onResolve({ filter: /lib[.]ts$/ }, () => ({ path: join(dir, "lib.ts") }));
            returns(text("plugin"))(build, dir);
          },
          errors: [wrong("plugin")],
        },
        { name: "in `files`, loaded by a plugin", ...inFiles, plugin: returns(text("plugin")) },
        { name: "on disk and in `files`, loaded by a plugin", ...inFiles, ...onDisk, plugin: returns(text("plugin")) },
        {
          name: "in `files`, loaded by a plugin after defer()",
          ...inFiles,
          plugin(build) {
            build.onLoad({ filter: /lib[.]ts$/ }, async ({ defer }) => {
              await defer();
              return { contents: text("plugin"), loader: "ts" };
            });
          },
        },
        {
          name: "in `files`, declined by a plugin",
          ...inFiles,
          plugin(build) {
            build.onLoad({ filter: /lib[.]ts$/ }, () => undefined);
          },
        },
        {
          name: "in `files`, loaded by a plugin as JavaScript",
          ...inFiles,
          plugin: returns(`export const value = 1;\n`, "js"),
        },
        {
          name: "in `files`, loaded by a plugin as an object",
          ...inFiles,
          plugin(build) {
            build.onLoad({ filter: /lib[.]ts$/ }, () => ({ exports: { value: 1 }, loader: "object" }));
          },
        },
        {
          name: "in `files`, loaded by a plugin as text",
          ...inFiles,
          disk: { "main.ts": `import * as lib from "./lib.ts";\nexport default lib;\n` },
          plugin: returns("plugin", "text"),
        },
        {
          name: "in `files`, loaded by a plugin, with a `loader` for its extension",
          disk: { "main.ts": `export { value } from "./lib.txt";\n` },
          files: { "lib.txt": text("files") },
          loader: { ".txt": "ts" },
          plugin: returns(text("plugin"), "ts", /lib[.]txt$/),
          errors: [wrong("files", "lib.txt")],
        },
        {
          name: "in `files`, resolved and loaded by a plugin",
          ...inFiles,
          disk: { "main.ts": `export { value } from "./lib";\n` },
          plugin(build, dir) {
            build.onResolve({ filter: /^[.][/]lib$/ }, () => ({ path: join(dir, "lib.ts") }));
            returns(text("plugin"))(build, dir);
          },
        },
        {
          name: "in `files` as the entry point, loaded by a plugin",
          ...inFiles,
          disk: {},
          plugin: returns(text("plugin")),
          entry: "lib.ts",
        },
        {
          name: "on disk and in `files` as the entry point, loaded by a plugin",
          ...inFiles,
          disk: { "lib.ts": text("disk") },
          plugin: returns(text("plugin")),
          entry: "lib.ts",
        },
        // The plugin's output has the export. The text that is checked does not.
        {
          name: "on disk as a placeholder that a plugin fills",
          disk: { "main.ts": main, "lib.ts": `export {};\n` },
          plugin: returns(`export const value = 1;\n`),
          errors: [noExport],
        },
        {
          name: "in `files` as a placeholder that a plugin fills",
          disk: { "main.ts": main },
          files: { "lib.ts": `export {};\n` },
          plugin: returns(`export const value = 1;\n`),
          errors: [noExport],
        },
      ];
      test.each(rows)("$name", async row => {
        expect(await errorsOf(row)).toEqual(row.errors);
      });

      test("in `files` under a relative key, loaded by a plugin", async () => {
        expect(await errorsWithRelativeKey(main, true)).toEqual([wrong("files")]);
      });
    });

    test("follows an import in the `files` text of a file that a plugin loads", async () => {
      const errors = await errorsOf({
        disk: { "main.ts": main, "dep.ts": text("dep") },
        files: { "lib.ts": `export { value } from "./dep.ts";\n` },
        plugin: returns(`export const value = 1;\n`),
      });
      expect(errors).toEqual([wrong("dep", "dep.ts")]);
    });

    // An entry point that a plugin loads also stands for what the plugin's output imports, on disk and in `files`.
    test.each([
      { name: "on disk", disk: { "lib.ts": text("disk"), "extra.ts": text("extra") }, from: "disk" },
      { name: "in `files`", disk: { "extra.ts": text("extra") }, files: { "lib.ts": text("files") }, from: "files" },
    ])("checks an entry point $name and what its plugin's output imports", async ({ from, ...project }) => {
      const plugin = returns(`export * from "./extra.ts";\n`);
      const errors = await errorsOf({ ...project, plugin, entry: "lib.ts" });
      expect(errors).toEqual([wrong("extra", "extra.ts"), wrong(from)]);
    });

    // The bundler doesn't load a file that only types use, and loads a text import as text. The type checker gets
    // either one from `files`.
    describe("checks the `files` text of a file that the bundle doesn't load as code", () => {
      const rows: Row[] = [
        {
          name: "the target of `import type`",
          disk: { "main.ts": typeOnly("./lib.ts") },
          files: { "lib.ts": text("files") },
          errors: [wrong("files")],
        },
        {
          name: "the target of an import that only a type uses",
          disk: { "main.ts": `import { value } from "./lib.ts";\nexport type Value = typeof value;\n` },
          files: { "lib.ts": text("files") },
          errors: [wrong("files")],
        },
        {
          name: "the target of `export type`",
          disk: { "main.ts": `export type { value } from "./lib.ts";\n` },
          files: { "lib.ts": text("files") },
          errors: [wrong("files")],
        },
        {
          name: "an ambient declaration file",
          disk: { "main.ts": `export const value: typeof ambient = 1;\n` },
          files: { "ambient.d.ts": `declare const ambient: "files";\n` },
          errors: [wrong("files", "main.ts")],
        },
        {
          name: 'a TypeScript file imported with { type: "text" }',
          disk: { "main.ts": `import * as lib from "./lib.ts" with { type: "text" };\nexport default lib;\n` },
          files: { "lib.ts": text("files") },
          errors: [wrong("files")],
        },
        {
          name: "the target of `import type`, with a `loader` for its extension",
          disk: { "main.ts": typeOnly("./lib.txt") },
          files: { "lib.txt": text("files") },
          loader: { ".txt": "ts" },
          errors: [wrong("files", "lib.txt")],
        },
      ];
      test.each(rows)("$name", async row => {
        expect(await errorsOf(row)).toEqual(row.errors);
      });
    });

    // The bundler and the type checker can differ on the file that such a key names. Then the type checker doesn't get
    // the key, and reads the disk as it does without the key.
    describe("leaves a file that the bundle doesn't load as code to the disk", () => {
      const onDisk = { "main.ts": typeOnly("./lib.ts"), "lib.ts": text("disk") };
      const inPackage = "./node_modules/pkg/lib.ts";
      const rows: Row[] = [
        { name: "if it's on disk too", disk: onDisk, files: { "lib.ts": text("files") }, errors: [wrong("disk")] },
        {
          name: "if its key has a `..` part",
          disk: onDisk,
          files: { "missing/../lib.ts": text("files") },
          errors: [wrong("disk")],
        },
        {
          name: "if it's in `node_modules`",
          disk: { "main.ts": typeOnly(inPackage) },
          files: { [inPackage.slice(2)]: text("files") },
          errors: [notFound(inPackage)],
        },
      ];
      test.each(rows)("$name", async row => {
        expect(await errorsOf(row)).toEqual(row.errors);
      });
      test("if its key is relative", async () => {
        expect(await errorsWithRelativeKey(typeOnly("./lib.ts"), false)).toEqual([notFound("./lib.ts")]);
      });
    });

    // The bundler's resolver reads configuration from disk, so the type checker does too.
    describe("reads configuration from disk, not from `files`", () => {
      const implicitAny = `TS7006: Parameter 'x' implicitly has an 'any' type. main.ts`;
      const loose = JSON.stringify({ compilerOptions: { ...options, strict: false } });
      const main = `export function f(x) {\n  return x;\n}\n`;
      test("tsconfig.json", async () => {
        const errors = await errorsOf({ disk: { "main.ts": main }, files: { "tsconfig.json": loose } });
        expect(errors).toEqual([implicitAny]);
      });
      test("a file that tsconfig.json extends", async () => {
        const errors = await errorsOf({
          disk: {
            "main.ts": main,
            "tsconfig.json": JSON.stringify({ extends: "./base.json" }),
            "base.json": JSON.stringify({ compilerOptions: options }),
          },
          files: { "base.json": loose },
        });
        expect(errors).toEqual([implicitAny]);
      });
    });

    // Where the file system folds case, `Lib.ts` is another name of `lib.ts`, which the bundler loads from disk.
    const foldsCase = (() => {
      using probe = tempDir("bundler-files-check", { "probe": "" });
      return existsSync(`${probe}/PROBE`);
    })();
    test.skipIf(!foldsCase).each([
      { name: "imports", main },
      { name: "only imports the type of", main: typeOnly("./lib.ts") },
    ])("checks the file on disk where a key differs from its name in case and the entry $name it", async ({ main }) => {
      const errors = await errorsOf({
        disk: { "main.ts": main, "lib.ts": text("disk") },
        files: { "Lib.ts": text("files") },
      });
      expect(errors).toEqual([wrong("disk")]);
    });

    // `App.svelte` isn't TypeScript or JavaScript by its name, so its text in `files` can't be checked. What the plugin
    // returns is checked instead, like for a file that's in neither place. On disk, a declaration stands for the file.
    describe("checks what a plugin returns for a file in `files` that isn't TypeScript or JavaScript by name", () => {
      const component = `<script lang="ts">let count: number = 1;</script>\n`;
      const declaration = `declare module "*.svelte" {\n  const component: unknown;\n  export default component;\n}\n`;
      const compiled = `const component: "plugin" = 1;\nexport default component;\n`;
      const compiles = returns(compiled, "ts", /[.]svelte$|virtual$|config[.]yaml$|data[.]json$/);
      const imports = (specifier: string) => ({ "main.ts": `export { default } from "${specifier}";\n` });
      const rows: Row[] = [
        {
          name: "a component",
          disk: imports("./App.svelte"),
          files: { "App.svelte": component },
          errors: [wrong("plugin", "App.svelte")],
        },
        {
          name: "a component that's the entry point",
          disk: {},
          files: { "App.svelte": component },
          entry: "App.svelte",
          errors: [wrong("plugin", "App.svelte")],
        },
        {
          name: "a file without an extension",
          disk: imports("./virtual"),
          files: { "virtual": component },
          errors: [wrong("plugin", "virtual")],
        },
        {
          name: "a YAML file",
          disk: imports("./config.yaml"),
          files: { "config.yaml": `port: 8080\n` },
          errors: [wrong("plugin", "config.yaml")],
        },
        {
          name: "a JSON file",
          disk: imports("./data.json"),
          files: { "data.json": `{ "port": 8080 }\n` },
          errors: [wrong("plugin", "data.json")],
        },
        {
          name: "but not for a component that's on disk too",
          disk: { ...imports("./App.svelte"), "App.svelte": component, "svelte.d.ts": declaration },
          files: { "App.svelte": component },
          errors: [],
        },
      ];
      test.each(rows)("$name", async row => {
        expect(await errorsOf({ ...row, plugin: compiles })).toEqual(row.errors);
      });
    });
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
});
