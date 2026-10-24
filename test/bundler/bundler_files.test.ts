import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { mkdirSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

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

  test("an absolute key overrides the file that a relative import names", async () => {
    // Create a temp directory with a real entry file and a config file on disk
    using dir = tempDir("bundler-files-absolute-key", {
      "entry.js": `
        import { config } from "./config.js";
        console.log(config);
      `,
      "config.js": `
        export const config = "from disk";
      `,
    });

    const entryPath = `${dir}/entry.js`;

    // The key is the path that "./config.js" resolves to from the entry point
    const result = await Bun.build({
      entrypoints: [entryPath],
      files: {
        [`${dir}/config.js`]: `export const config = "from memory";`,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = await result.outputs[0].text();
    // The in-memory file should override the disk file
    expect(output).toContain("from memory");
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

  // A relative key is a path from the cwd of the `Bun.build()` call. One child
  // process runs every case, each in a directory of its own. The build script
  // is in another directory, so a key resolved against the script would fail.
  describe("relative keys", () => {
    type Report = Record<
      string,
      { logs: string[]; outputs: string[]; found: string[]; inputs?: string[] } | { threw: string }
    >;
    // A file is its text, or a symlink to `link`, a path from the directory of the symlink.
    type Files = Record<string, string | { link: string }>;
    const cases: { name: string; files: Files; markers: string[]; builds: string }[] = [];
    const reports = new Map<string, Report>();
    let child = { stderr: "the child process did not run", exitCode: null as number | null };
    let root: ReturnType<typeof tempDir> | undefined;
    const directoryOf = (name: string) => join(String(root), String(cases.findIndex(it => it.name === name)));

    // `builds` is the source of an object: name -> Bun.build options. It can
    // call abs(), which is path.resolve(). `chdir` is the directory to call
    // Bun.build() from. `before` is a function to call before the build, for
    // example linkDirectory(target, path). The report has, for each build, the
    // logs with their notes, the output paths from the cwd, each string literal
    // of the outputs that is one of `markers`, and the inputs of the metafile if
    // there is one: an absolute input is "<case>/" and its path from the
    // directory of the case. A marker that starts with "raw:" is any text, not a
    // string literal.
    function buildsIn(
      name: string,
      files: Files,
      markers: string[],
      builds: string,
      check: (report: Report, directory: string) => void | Promise<void>,
      skip = false,
    ) {
      if (!skip) cases.push({ name, files, markers, builds });
      test.skipIf(skip)(name, async () => {
        const report = reports.get(name);
        // A case that has no report is one that the child process did not finish.
        if (!report) expect(child).toEqual({ stderr: "", exitCode: 0 });
        await check(report!, directoryOf(name));
      });
    }

    beforeAll(async () => {
      const tree: Record<string, string> = {
        "scripts/build.mjs": `
          import { mkdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
          import { isAbsolute, join, relative, resolve as abs } from "node:path";
          const root = process.cwd();
          // Replace the symlink at "path" with one to the directory "target".
          // Windows: a junction needs no privilege, and its target is absolute.
          function linkDirectory(target, path) {
            try {
              unlinkSync(path);
            } catch {
              rmdirSync(path);
            }
            symlinkSync(process.platform === "win32" ? abs(target) : target, path, "junction");
          }
          const cases = [${cases.map((it, index) => `[${JSON.stringify(it.name)}, "${index}", ${JSON.stringify(it.markers)}, () => (${it.builds})],`).join("\n")}];
          for (const [name, directory, markers, builds] of cases) {
            process.chdir(join(root, directory));
            const report = {};
            for (const [build, { chdir, before, ...options }] of Object.entries(builds())) {
              before?.();
              if (chdir) process.chdir(chdir);
              try {
                const result = await Bun.build({ ...options, throw: false });
                const texts = await Promise.all(result.outputs.map(output => (options.compile ? "" : output.text())));
                const text = texts.join("\\n");
                report[build] = {
                  logs: result.logs.map(log => [log, ...(log.notes ?? []).map(note => "note: " + note.message)].join("\\n")),
                  outputs: result.outputs
                    .map(({ path }) => (isAbsolute(path) ? relative(process.cwd(), path) : path).replaceAll("\\\\", "/"))
                    .sort(),
                  found: markers.flatMap(marker =>
                    Array(text.split(marker.startsWith("raw:") ? marker.slice(4) : JSON.stringify(marker)).length - 1).fill(marker),
                  ),
                  ...(result.metafile && {
                    inputs: Object.keys(result.metafile.inputs)
                      .map(input => (isAbsolute(input) ? "<case>/" + relative(join(root, directory), input) : input).replaceAll("\\\\", "/"))
                      .sort(),
                  }),
                };
              } catch (error) {
                report[build] = { threw: error.message };
              }
              process.chdir(join(root, directory));
            }
            console.log(JSON.stringify({ name, report }));
          }
        `,
      };
      const links: [path: string, target: string][] = [];
      cases.forEach((it, index) => {
        tree[`${index}/case.txt`] = it.name;
        for (const [file, text] of Object.entries(it.files)) {
          if (typeof text === "string") tree[`${index}/${file}`] = text;
          else links.push([`${index}/${file}`, text.link]);
        }
      });
      root = tempDir("bundler-files-relative-keys", tree);
      for (const [path, target] of links) {
        const from = join(String(root), path);
        const to = join(dirname(from), target);
        mkdirSync(dirname(from), { recursive: true });
        // A symlink can lead nowhere, or to itself.
        const toDirectory = (() => {
          try {
            return statSync(to).isDirectory();
          } catch {
            return false;
          }
        })();
        // Windows: a junction needs no privilege, and its target is absolute.
        if (toDirectory) symlinkSync(isWindows ? to : target, from, "junction");
        else symlinkSync(target, from, "file");
      }
      await using proc = Bun.spawn({
        cmd: [bunExe(), join("scripts", "build.mjs")],
        cwd: String(root),
        env: { ...bunEnv, NODE_ENV: undefined },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // A child process that crashes can print its report of the crash to stdout.
      const notReports: string[] = [];
      for (const line of stdout.split("\n").filter(Boolean)) {
        try {
          const { name, report } = JSON.parse(line);
          reports.set(name, report);
        } catch {
          notReports.push(line);
        }
      }
      child = { stderr: stderr + notReports.join("\n"), exitCode };
    }, 120_000);
    afterAll(() => root?.[Symbol.dispose]());

    test("the child process that runs the builds exits cleanly", () => {
      expect(child).toEqual({ stderr: "", exitCode: 0 });
    });

    // The two examples in the docs of `files`.
    {
      const build = (config: string, generated: string) => `{
        entrypoints: ["./src/index.ts"],
        files: {
          [${JSON.stringify(config)}]: 'export const config = "config from memory";',
          [${JSON.stringify(generated)}]: 'export const generated = "generated in memory";',
        },
        metafile: true,
      }`;
      buildsIn(
        "a key overrides a file on disk and adds a file that is only in memory",
        {
          "src/index.ts": `
            import { config } from "./config.ts";
            import { generated } from "./generated.ts";
            console.log(config, generated);
          `,
          "src/config.ts": `export const config = "config from disk";`,
        },
        ["config from disk", "config from memory", "generated in memory"],
        `{
          "./src/config.ts": ${build("./src/config.ts", "./src/generated.ts")},
          "src/config.ts": ${build("src/config.ts", "src/generated.ts")},
          "dot segments": ${build("./src/../src/config.ts", "./src/./generated.ts")},
          "backslashes": ${build(".\\src\\config.ts", ".\\src\\generated.ts")},
        }`,
        report => {
          // The display path of a file is its path from the cwd, however the key is written.
          const inMemory = {
            logs: [],
            outputs: ["./index.js"],
            found: ["config from memory", "generated in memory"],
            inputs: ["src/config.ts", "src/generated.ts", "src/index.ts"],
          };
          expect(report).toEqual({
            "./src/config.ts": inMemory,
            "src/config.ts": inMemory,
            "dot segments": inMemory,
            "backslashes": inMemory,
          });
        },
      );
    }

    // The disk resolver picks the file for these imports. The parse task then
    // finds the key by the path of that file.
    buildsIn(
      "a key overrides the file that the resolver finds for an import",
      {
        "src/index.ts": `
          import { config } from "./config";
          import { util } from "util-lib";
          console.log(config, util);
        `,
        "src/config.ts": `export const config = "config from disk";`,
        "node_modules/util-lib/package.json": JSON.stringify({ name: "util-lib", main: "index.js" }),
        "node_modules/util-lib/index.js": `export const util = "util from disk";`,
      },
      ["config from disk", "config from memory", "util from disk", "util from memory"],
      `{
        build: {
          entrypoints: ["./src/index.ts"],
          files: {
            "./src/config.ts": 'export const config = "config from memory";',
            "node_modules/util-lib/index.js": 'export const util = "util from memory";',
          },
        },
      }`,
      report => {
        expect(report).toEqual({
          build: { logs: [], outputs: ["./index.js"], found: ["config from memory", "util from memory"] },
        });
      },
    );

    // A relative key for a file on disk replaces the contents only. The disk
    // resolver still resolves the file, so its tsconfig.json applies.
    {
      const inMemory = `'console.log(<div>{"entry from memory"}</div>);'`;
      buildsIn(
        "a key for a file on disk keeps the tsconfig.json of that file",
        {
          "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" } }),
          "src/entry.tsx": `console.log(<div>entry from disk</div>);`,
          "src/index.ts": `import "./entry.tsx";`,
        },
        ["entry from disk", "entry from memory", "preact/jsx-dev-runtime", "react/jsx-dev-runtime"],
        `{
          // An absolute key did this before relative keys were paths.
          "absolute key, relative entry point": {
            entrypoints: ["./src/entry.tsx"],
            files: { [abs("src/entry.tsx")]: ${inMemory} },
            external: ["preact"],
          },
          "relative key, entry point written like the key": {
            entrypoints: ["./src/entry.tsx"],
            files: { "./src/entry.tsx": ${inMemory} },
            external: ["preact"],
          },
          "relative key, entry point written another way": {
            entrypoints: ["src/entry.tsx"],
            files: { "./src/entry.tsx": ${inMemory} },
            external: ["preact"],
          },
          "relative key, import": {
            entrypoints: ["./src/index.ts"],
            files: { "src/entry.tsx": ${inMemory} },
            external: ["preact"],
          },
        }`,
        report => {
          const found = ["entry from memory", "preact/jsx-dev-runtime"];
          expect(report).toEqual({
            "absolute key, relative entry point": { logs: [], outputs: ["./entry.js"], found },
            // Every entrypoint is written like a key, so the root is the cwd.
            "relative key, entry point written like the key": { logs: [], outputs: ["src/entry.js"], found },
            "relative key, entry point written another way": { logs: [], outputs: ["./entry.js"], found },
            "relative key, import": { logs: [], outputs: ["./index.js"], found },
          });
        },
      );
    }

    // The disk rules for a page apply to a key for a file on disk: a manifest
    // is copied, and the script of a page in a server build is for the browser.
    buildsIn(
      "a key for a file on disk keeps the rules of an HTML page",
      {
        "pages/index.html": `<!doctype html><link rel="manifest" href="./manifest.json" /><script type="module" src="./app.ts"></script>`,
        "pages/manifest.json": JSON.stringify({ name: "manifest from disk" }),
        "pages/app.ts": `console.log("app from disk");`,
      },
      ["manifest from disk", "manifest from memory", "app from disk", "app from memory", "raw:// @bun"],
      `{
        "an asset of a page": {
          entrypoints: ["./pages/index.html"],
          files: { "pages/manifest.json": '{ "name": "manifest from memory" }' },
        },
        "a page in a server build": {
          entrypoints: ["./pages/index.html"],
          files: {
            "pages/index.html": '<!doctype html><script type="module" src="./app.ts"></script>',
            "./pages/app.ts": 'console.log("app from memory");',
          },
          target: "bun",
        },
      }`,
      report => {
        const chunk = expect.stringMatching(/^\.\/chunk-\w+\.js$/);
        expect(report).toEqual({
          "an asset of a page": {
            logs: [],
            outputs: [chunk, "./index.html", expect.stringMatching(/^\.\/manifest-\w+\.json$/)],
            found: ["manifest from memory", "app from disk"],
          },
          "a page in a server build": { logs: [], outputs: [chunk, "./index.html"], found: ["app from memory"] },
        });
      },
    );

    // Nothing is on disk. Each build spells the entry point one way and the
    // keys another way. The entry imports the other key as "./lib.js".
    for (const base of ["entry.js", "virtual/entry.js"]) {
      const spellings = {
        [base]: JSON.stringify(base),
        ["./" + base]: JSON.stringify("./" + base),
        absolute: `abs(${JSON.stringify(base)})`,
      };
      const lib = (key: string) => key.replace("entry.js", "lib.js");
      const rows = Object.entries(spellings).flatMap(([entryName, entry]) =>
        Object.entries(spellings).map(([keyName, key]) => ({
          name: `${entryName} with key ${keyName}`,
          // The root is the cwd when the entry point is written like the key. If not,
          // it is the directory of the entry point, as for an entry point on disk.
          output: entryName === keyName && base.includes("/") ? base : "./entry.js",
          entry,
          key,
        })),
      );
      buildsIn(
        `an entry point names the key ${JSON.stringify(base)} by text or by path`,
        {},
        ["entry in memory", "lib in memory"],
        `{${rows
          .map(
            ({ name, entry, key }) => `${JSON.stringify(name)}: {
              entrypoints: [${entry}],
              files: {
                [${key}]: 'import { lib } from "./lib.js"; console.log("entry in memory", lib);',
                [${lib(key)}]: 'export const lib = "lib in memory";',
              },
            },`,
          )
          .join("\n")}}`,
        report => {
          expect(report).toEqual(
            Object.fromEntries(
              rows.map(({ name, output }) => [
                name,
                { logs: [], outputs: [output], found: ["entry in memory", "lib in memory"] },
              ]),
            ),
          );
        },
      );
    }

    {
      const build = (entry: string) => `{
        entrypoints: [${entry}],
        files: { "./src/entry.ts": 'console.log("entry from memory");' },
      }`;
      buildsIn(
        "a key overrides an entry point on disk",
        { "src/entry.ts": `console.log("entry from disk");` },
        ["entry from disk", "entry from memory"],
        `{
          "./src/entry.ts": ${build(`"./src/entry.ts"`)},
          "src/entry.ts": ${build(`"src/entry.ts"`)},
          "absolute": ${build(`abs("src/entry.ts")`)},
        }`,
        report => {
          expect(report).toEqual({
            // Every entrypoint is written like a key, so the root is the cwd.
            "./src/entry.ts": { logs: [], outputs: ["src/entry.js"], found: ["entry from memory"] },
            // The output paths of an entry point on disk do not depend on `files`.
            "src/entry.ts": { logs: [], outputs: ["./entry.js"], found: ["entry from memory"] },
            "absolute": { logs: [], outputs: ["./entry.js"], found: ["entry from memory"] },
          });
        },
      );
    }

    {
      const build = (chdir: string) => `{
        chdir: ${JSON.stringify(chdir)},
        entrypoints: ["virtual/index.ts"],
        files: { "./virtual/index.ts": 'console.log("entry in memory");' },
        outdir: "out",
      }`;
      buildsIn(
        "the default root does not depend on what is on disk",
        { "without/keep": "", "with/virtual/keep": "" },
        ["entry in memory"],
        `{
          "the directory of the entry point is not on disk": ${build("without")},
          "the directory of the entry point is on disk": ${build("with")},
          "a root that is not on disk is an error": {
            entrypoints: ["./entry.ts"],
            files: { "./entry.ts": "" },
            root: "./missing",
          },
        }`,
        report => {
          const inMemory = { logs: [], outputs: ["out/index.js"], found: ["entry in memory"] };
          expect(report).toEqual({
            "the directory of the entry point is not on disk": inMemory,
            "the directory of the entry point is on disk": inMemory,
            "a root that is not on disk is an error": { threw: "ENOENT: failed to open root directory: ./missing" },
          });
        },
      );
    }

    buildsIn(
      "a key is a path from the directory that Bun.build() is called in",
      {
        "packages/app/src/index.ts": `import { config } from "./config.ts"; console.log(config);`,
        "packages/app/src/config.ts": `export const config = "config from disk";`,
      },
      ["config from disk", "config from memory"],
      `{
        build: {
          chdir: "packages/app",
          entrypoints: ["./src/index.ts"],
          files: { "./src/config.ts": 'export const config = "config from memory";' },
        },
      }`,
      report => {
        expect(report).toEqual({ build: { logs: [], outputs: ["./index.js"], found: ["config from memory"] } });
      },
    );

    buildsIn(
      "a key matches an import with the same text from any directory",
      {
        "index.ts": `
          import name from "config" with { type: "text" };
          import { disk } from "./config";
          console.log(name, disk);
        `,
        "config.ts": `export const disk = "config from disk";`,
      },
      [
        "scheme key",
        "file name key",
        "dot key",
        "beside the file name key",
        "name key",
        "config from disk",
        "key beside the importer",
        "key with the text of the import",
        "key for a built-in",
      ],
      `{
        imports: {
          entrypoints: ["/app/nested/index.ts"],
          files: {
            "/app/nested/index.ts": 'import "virtual:config.ts"; import "lib/file.ts"; import "./dot.ts";',
            "virtual:config.ts": 'console.log("scheme key");',
            "lib/file.ts": 'import "./beside.ts"; console.log("file name key");',
            "lib/beside.ts": 'console.log("beside the file name key");',
            "./dot.ts": 'console.log("dot key");',
          },
        },
        // The name "config" is not the path "./config".
        "a name beside a file on disk": {
          entrypoints: ["./index.ts"],
          files: { config: "name key" },
        },
        // "./util.ts" is the file beside the importer first, then the key with that text.
        "a key beside the importer comes first": {
          entrypoints: ["./entry.ts"],
          files: {
            "./entry.ts": 'import "./lib/main.ts";',
            "./lib/main.ts": 'import "./util.ts";',
            "./lib/util.ts": 'console.log("key beside the importer");',
            "./util.ts": 'console.log("key with the text of the import");',
          },
        },
        "a name does not replace a built-in": {
          entrypoints: ["/app/index.ts"],
          files: { "/app/index.ts": 'import "node:fs";', "node:fs": 'console.log("key for a built-in");' },
          target: "bun",
        },
      }`,
      report => {
        const output = [expect.stringContaining("index.js")];
        expect(report).toEqual({
          imports: {
            logs: [],
            outputs: output,
            found: ["scheme key", "file name key", "dot key", "beside the file name key"],
          },
          "a name beside a file on disk": {
            logs: [],
            outputs: ["./index.js"],
            found: ["name key", "config from disk"],
          },
          "a key beside the importer comes first": {
            logs: [],
            outputs: ["./entry.js"],
            found: ["key beside the importer"],
          },
          "a name does not replace a built-in": { logs: [], outputs: output, found: [] },
        });
      },
    );

    // An onLoad plugin sees the path of each module. A relative path is under
    // the cwd. A name is the key as written.
    {
      const keys = {
        "./dot.ts": "path dot.ts",
        "../up.ts": "path ../up.ts",
        "dir/file.ts": "path dir/file.ts",
        "bare.ts": "path bare.ts",
        "socket.io": "path socket.io",
        "@scope/pkg.js": "path @scope/pkg.js",
        ".env": "name .env",
        "LICENSE": "name LICENSE",
        "bin/cli": "name bin/cli",
        "@scope/pkg": "name @scope/pkg",
        "virtual:config.ts": "name virtual:config.ts",
        "my-plugin:entry.ts": "name my-plugin:entry.ts",
      };
      const imports = Object.keys(keys).map(key => `import ${JSON.stringify(key)};`);
      buildsIn(
        "a key without ./ is a path if it has a file extension, and a name if not",
        {},
        Object.values(keys),
        `{
          build: {
            entrypoints: ["/app/index.ts"],
            files: {
              "/app/index.ts": ${JSON.stringify(imports.join("\n"))},
              ${Object.keys(keys)
                .map(key => `${JSON.stringify(key)}: "",`)
                .join("\n")}
            },
            plugins: [{
              name: "paths",
              setup(build) {
                const cwd = process.cwd();
                build.onLoad({ filter: /./ }, ({ path }) => {
                  if (path === "/app/index.ts") return;
                  const seen = isAbsolute(path) ? "path " + relative(cwd, path).replaceAll("\\\\", "/") : "name " + path;
                  return { contents: "console.log(" + JSON.stringify(seen) + ");", loader: "js" };
                });
              },
            }],
          },
        }`,
        report => {
          expect(report).toEqual({
            build: { logs: [], outputs: [expect.stringContaining("index.js")], found: Object.values(keys) },
          });
        },
      );
    }

    // No onLoad plugin reads the module, so the bundler reads the path. That
    // path is the text of a key.
    buildsIn(
      "a plugin that resolves to the text of a key gets the file",
      { "index.ts": `import "generated";`, "gen/config.ts": `console.log("config from disk");` },
      ["config from disk", "config from memory"],
      `{
        build: {
          entrypoints: ["./index.ts"],
          files: { "gen/config.ts": 'console.log("config from memory");' },
          plugins: [{
            name: "namespace",
            setup(build) {
              build.onResolve({ filter: /^generated$/ }, () => ({ path: "gen/config.ts", namespace: "generated" }));
              build.onLoad({ filter: /never/, namespace: "generated" }, () => undefined);
            },
          }],
        },
      }`,
      report => {
        expect(report).toEqual({ build: { logs: [], outputs: ["./index.js"], found: ["config from memory"] } });
      },
    );

    // An onResolve plugin that declines an import sends it through another
    // branch of the bundler. The result is the same.
    {
      const build = (plugins: string) => `{
        entrypoints: ["./src/index.ts"],
        files: {
          "./src/config.ts": 'export const config = "config from memory";',
          "src/generated.ts": 'export const generated = "generated in memory";',
          "node_modules/util-lib/index.js": 'export const util = "util from memory";',
        },
        naming: "[name]-[hash].[ext]",
        metafile: true,
        plugins: ${plugins},
      }`;
      buildsIn(
        "an onResolve plugin that declines does not change the build",
        {
          "src/index.ts": `
            import { config } from "./config.ts";
            import { generated } from "./generated.ts";
            import { util } from "util-lib";
            console.log(config, generated, util);
          `,
          "src/config.ts": `export const config = "config from disk";`,
          "node_modules/util-lib/package.json": JSON.stringify({ name: "util-lib", main: "index.js" }),
          "node_modules/util-lib/index.js": `export const util = "util from disk";`,
        },
        ["config from memory", "generated in memory", "util from memory"],
        `{
          "no plugin": ${build("[]")},
          "declined": ${build(`[{
            name: "declines",
            setup(build) {
              build.onResolve({ filter: /config|generated|util-lib/ }, () => undefined);
            },
          }]`)},
        }`,
        report => {
          expect(report["no plugin"]).toEqual({
            logs: [],
            outputs: [expect.stringMatching(/^\.\/index-\w+\.js$/)],
            found: ["config from memory", "generated in memory", "util from memory"],
            inputs: ["node_modules/util-lib/index.js", "src/config.ts", "src/generated.ts", "src/index.ts"],
          });
          expect(report["declined"]).toEqual(report["no plugin"]);
        },
      );
    }

    buildsIn(
      "a key is one file, however an import or another key names it",
      {
        "index.ts": `import "./src/generated.ts"; import "./src/deep/importer.ts";`,
        "src/deep/importer.ts": `import "../generated.ts";`,
      },
      ["generated in memory", "onLoad saw the path", "onLoad saw another path"],
      `{
        "by text and by path": {
          entrypoints: ["./index.ts"],
          files: { "./src/generated.ts": 'console.log("generated in memory");' },
        },
        "two keys with the same contents": {
          entrypoints: ["./index.ts"],
          files: {
            "./src/generated.ts": 'console.log("generated in memory");',
            "src/generated.ts": 'console.log("generated in memory");',
            [abs("src/generated.ts")]: 'console.log("generated in memory");',
          },
        },
        "two keys with different contents": {
          entrypoints: ["./index.ts"],
          files: { "./src/generated.ts": "first", "src/generated.ts": "second" },
        },
        "the path of the module": {
          entrypoints: ["./index.ts"],
          files: { "src/generated.ts": "" },
          plugins: [{
            name: "path",
            setup(build) {
              // Windows: the path has "/" separators, and the case of the drive letter can differ.
              const expected = abs("src/generated.ts").replaceAll("\\\\", "/").toLowerCase();
              build.onLoad({ filter: /generated/ }, ({ path }) => ({
                contents: "console.log(" + JSON.stringify(path.toLowerCase() === expected ? "onLoad saw the path" : "onLoad saw another path") + ");",
                loader: "js",
              }));
            },
          }],
        },
      }`,
      report => {
        const once = { logs: [], outputs: ["./index.js"], found: ["generated in memory"] };
        expect(report).toEqual({
          "by text and by path": once,
          "two keys with the same contents": once,
          "two keys with different contents": {
            threw:
              'files: the keys "./src/generated.ts" and "src/generated.ts" name the same file and have different contents',
          },
          "the path of the module": { logs: [], outputs: ["./index.js"], found: ["onLoad saw the path"] },
        });
      },
    );

    buildsIn(
      "the output of an in-memory module keeps the name and the directory of its key",
      { "lib.ts": `export const lib = "lib from disk";`, "packages/app/keep": "" },
      ["entry in memory", "lib from disk", "lazy in memory"],
      `{
        "a file name": {
          entrypoints: ["worker.ts"],
          files: { "worker.ts": 'import { lib } from "./lib.ts"; console.log("entry in memory", lib);' },
          outdir: "out",
        },
        "a directory that is not on disk": {
          entrypoints: ["virtual/worker.ts"],
          files: { "virtual/worker.ts": 'import { lib } from "../lib.ts"; console.log("entry in memory", lib);' },
          outdir: "out",
        },
        "a directory above the cwd": {
          chdir: "packages/app",
          entrypoints: ["../virtual/worker.ts"],
          files: { "../virtual/worker.ts": 'import { lib } from "../../lib.ts"; console.log("entry in memory", lib);' },
          outdir: "out",
        },
        "backslashes": {
          entrypoints: [".\\\\virtual\\\\worker.ts"],
          files: { ".\\\\virtual\\\\worker.ts": 'import { lib } from "../lib.ts"; console.log("entry in memory", lib);' },
          outdir: "out",
        },
        "a chunk of a dynamic import": {
          entrypoints: ["virtual/worker.ts"],
          files: {
            "virtual/worker.ts": 'import("virtual/lazy.ts"); console.log("entry in memory");',
            "virtual/lazy.ts": 'console.log("lazy in memory");',
          },
          outdir: "out",
          splitting: true,
          naming: { chunk: "[dir]/[name]-[hash].[ext]" },
        },
      }`,
      report => {
        const worker = { logs: [], outputs: ["out/virtual/worker.js"], found: ["entry in memory", "lib from disk"] };
        expect(report).toEqual({
          "a file name": { logs: [], outputs: ["out/worker.js"], found: ["entry in memory", "lib from disk"] },
          "a directory that is not on disk": worker,
          "a directory above the cwd": worker,
          "backslashes": worker,
          "a chunk of a dynamic import": {
            logs: [],
            outputs: [expect.stringMatching(/^out\/virtual\/lazy-\w+\.js$/), "out/virtual/worker.js"],
            found: ["entry in memory", "lazy in memory"],
          },
        });
      },
    );

    // A standalone executable finds a worker by the name of its output. The
    // key is a file name, it is an entrypoint next to one on disk, and a
    // nested module imports another key by its text. A debug build copies a
    // binary of more than 1 GB for this.
    buildsIn(
      "a compiled executable starts a worker that is an in-memory entrypoint",
      {
        "main.ts": `
          import { generated } from "./nested/load.ts";
          const worker = new Worker("./worker.js");
          worker.onmessage = async event => {
            console.log(event.data, await generated());
            worker.terminate();
          };
        `,
        "nested/load.ts": `export const generated = () => import("generated.ts").then(module => module.default);`,
      },
      [],
      `{
        build: {
          entrypoints: ["./main.ts", "worker.js", "generated.ts"],
          files: {
            "worker.js": 'postMessage("worker in memory");',
            "generated.ts": 'export default "generated in memory";',
          },
          compile: { outfile: "app" },
          outdir: "out",
        },
      }`,
      async (report, directory) => {
        const app = isWindows ? "app.exe" : "app";
        expect(report).toEqual({ build: { logs: [], outputs: ["out/" + app], found: [] } });
        await using proc = Bun.spawn({
          cmd: [join(directory, "out", app)],
          cwd: directory,
          env: bunEnv,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: "worker in memory generated in memory\n",
          stderr: "",
          exitCode: 0,
        });
      },
      isDebug || isASAN,
    );

    // A symlinked directory gives a file two paths. The disk resolver gives a
    // module its real path. A key names the file by either path.
    {
      const fromMemory = `'export const config = "config from memory";'`;
      const linkedSrc: Files = {
        "real-src/index.ts": `import { config } from "./config.ts"; console.log(config);`,
        "real-src/config.ts": `export const config = "config from disk";`,
        "src": { link: "real-src" },
      };
      const markers = ["config from disk", "config from memory"];
      const inMemory = { logs: [], outputs: ["./index.js"], found: ["config from memory"] };
      // The module has the path that the disk resolver gives the file.
      const onDiskRoute = { ...inMemory, inputs: ["real-src/config.ts", "real-src/index.ts"] };
      // The module has the path of the key.
      const inMemoryRoute = { ...inMemory, inputs: ["<case>/src/config.ts", "real-src/index.ts"] };

      buildsIn(
        "a key through a symlinked directory overrides the file",
        linkedSrc,
        markers,
        `(() => {
          const build = key => ({ entrypoints: ["./src/index.ts"], files: { [key]: ${fromMemory} }, metafile: true });
          return {
            "relative key": build("./src/config.ts"),
            // From here on the resolver has read the directory of the key.
            "relative key without ./": build("src/config.ts"),
            "absolute key": build(abs("src/config.ts")),
            "key by the real path": build("./real-src/config.ts"),
          };
        })()`,
        report => {
          expect(report).toEqual({
            "relative key": onDiskRoute,
            "relative key without ./": onDiskRoute,
            "absolute key": inMemoryRoute,
            "key by the real path": onDiskRoute,
          });
        },
      );

      // No import goes through the symlink, so the resolver never reads it.
      buildsIn(
        "a key through a symlinked directory overrides a file that is imported by its real path",
        linkedSrc,
        markers,
        `(() => {
          const build = key => ({ entrypoints: ["./real-src/index.ts"], files: { [key]: ${fromMemory} }, metafile: true });
          return { "relative key": build("./src/config.ts"), "absolute key": build(abs("src/config.ts")) };
        })()`,
        report => {
          expect(report).toEqual({ "relative key": onDiskRoute, "absolute key": inMemoryRoute });
        },
      );

      buildsIn(
        "a key through a symlinked directory overrides an entry point",
        linkedSrc,
        ["config from disk", "entry from memory"],
        `(() => {
          const build = (entry, key) => ({
            entrypoints: [entry],
            files: { [key]: 'console.log("entry from memory");' },
            metafile: true,
          });
          return {
            "relative key, entry point written like the key": build("./src/index.ts", "./src/index.ts"),
            "relative key, entry point written another way": build("src/index.ts", "./src/index.ts"),
            "relative key, entry point by its real path": build("./real-src/index.ts", "./src/index.ts"),
            "absolute key, entry point by its real path": build(abs("real-src/index.ts"), abs("src/index.ts")),
          };
        })()`,
        report => {
          const found = ["entry from memory"];
          const inputs = ["real-src/index.ts"];
          expect(report).toEqual({
            // Every entrypoint is written like a key, so the root is the cwd.
            "relative key, entry point written like the key": {
              logs: [],
              outputs: ["real-src/index.js"],
              found,
              inputs,
            },
            "relative key, entry point written another way": { logs: [], outputs: ["./index.js"], found, inputs },
            "relative key, entry point by its real path": { logs: [], outputs: ["./index.js"], found, inputs },
            // The module has the path of the key.
            "absolute key, entry point by its real path": {
              logs: [],
              outputs: ["./index.js"],
              found,
              inputs: ["src/index.ts"],
            },
          });
        },
      );

      // A key for a file on disk takes the route of its kind, whichever path it is written with.
      buildsIn(
        "a key through a symlinked directory keeps the tsconfig.json of a relative key",
        {
          "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" } }),
          "real-src/index.ts": `import "./view.tsx";`,
          "real-src/view.tsx": `console.log(<div>view from disk</div>);`,
          "src": { link: "real-src" },
        },
        ["view from disk", "view from memory", "preact/jsx-dev-runtime", "react/jsx-dev-runtime"],
        `(() => {
          const build = key => ({
            entrypoints: ["./real-src/index.ts"],
            files: { [key]: 'console.log(<div>{"view from memory"}</div>);' },
            external: ["preact", "react"],
          });
          return {
            "relative key through the symlink": build("./src/view.tsx"),
            "relative key by the real path": build("./real-src/view.tsx"),
            "absolute key through the symlink": build(abs("src/view.tsx")),
            "absolute key by the real path": build(abs("real-src/view.tsx")),
          };
        })()`,
        report => {
          const onDisk = { logs: [], outputs: ["./index.js"], found: ["view from memory", "preact/jsx-dev-runtime"] };
          const memory = { logs: [], outputs: ["./index.js"], found: ["view from memory", "react/jsx-dev-runtime"] };
          expect(report).toEqual({
            "relative key through the symlink": onDisk,
            "relative key by the real path": onDisk,
            "absolute key through the symlink": memory,
            "absolute key by the real path": memory,
          });
        },
      );

      buildsIn(
        "a key below a symlinked directory adds a file that is only in memory",
        {
          "real-src/index.ts": `
            import { generated } from "./generated.ts";
            import { deep } from "./not-on-disk/deep.ts";
            console.log(generated, deep);
          `,
          "src": { link: "real-src" },
        },
        ["generated in memory", "deep in memory"],
        `(() => {
          const build = key => ({
            entrypoints: ["./src/index.ts"],
            files: {
              [key("src/generated.ts")]: 'export const generated = "generated in memory";',
              [key("src/not-on-disk/deep.ts")]: 'export { deep } from "./deeper.ts";',
              [key("src/not-on-disk/deeper.ts")]: 'export const deep = "deep in memory";',
            },
            metafile: true,
          });
          return { "relative keys": build(key => "./" + key), "absolute keys": build(abs) };
        })()`,
        report => {
          const both = { logs: [], outputs: ["./index.js"], found: ["generated in memory", "deep in memory"] };
          // An in-memory module has the path of its key.
          const inputs = ["src/generated.ts", "src/not-on-disk/deep.ts", "src/not-on-disk/deeper.ts"];
          expect(report).toEqual({
            "relative keys": { ...both, inputs: ["real-src/index.ts", ...inputs] },
            "absolute keys": { ...both, inputs: [...inputs.map(input => "<case>/" + input), "real-src/index.ts"] },
          });
        },
      );

      // One importer is beside the key, and one is beside the real path of the key.
      buildsIn(
        "a key below a symlinked directory is one module, whichever path an import names it by",
        {
          "index.ts": `import "./src/beside-the-key.ts"; import "./src/beside-the-real-path.ts";`,
          "real-src/beside-the-real-path.ts": `import "./state.ts";`,
          "src": { link: "real-src" },
        },
        ["state in memory"],
        `{
          build: {
            entrypoints: ["./index.ts"],
            files: {
              "./src/beside-the-key.ts": 'import "./state.ts";',
              "./src/state.ts": 'console.log("state in memory");',
            },
            metafile: true,
          },
        }`,
        report => {
          expect(report).toEqual({
            build: {
              logs: [],
              outputs: ["./index.js"],
              found: ["state in memory"],
              inputs: ["index.ts", "real-src/beside-the-real-path.ts", "src/beside-the-key.ts", "src/state.ts"],
            },
          });
        },
      );

      buildsIn(
        "a key in a linked package overrides the file",
        {
          "packages/util-lib/package.json": JSON.stringify({ name: "util-lib", main: "index.js" }),
          "packages/util-lib/index.js": `export const util = "util from disk";`,
          "app/index.ts": `import { util } from "util-lib"; console.log(util);`,
          "app/node_modules/util-lib": { link: "../../packages/util-lib" },
          // What the isolated linker of bun install makes.
          "isolated/node_modules/.bun/util-lib@1.0.0/node_modules/util-lib/package.json": JSON.stringify({
            name: "util-lib",
            main: "index.js",
          }),
          "isolated/node_modules/.bun/util-lib@1.0.0/node_modules/util-lib/index.js": `export const util = "util from disk";`,
          "isolated/index.ts": `import { util } from "util-lib"; console.log(util);`,
          "isolated/node_modules/util-lib": { link: ".bun/util-lib@1.0.0/node_modules/util-lib" },
        },
        ["util from disk", "util from memory"],
        `(() => {
          const build = (chdir, key) => ({
            chdir,
            entrypoints: ["./index.ts"],
            files: { [key]: 'export const util = "util from memory";' },
            metafile: true,
          });
          return {
            "relative key": build("app", "node_modules/util-lib/index.js"),
            "absolute key": build("app", abs("app/node_modules/util-lib/index.js")),
            "isolated linker": build("isolated", "node_modules/util-lib/index.js"),
          };
        })()`,
        report => {
          const inMemory = { logs: [], outputs: ["./index.js"], found: ["util from memory"] };
          // The disk resolver finds the package, so the module has the real path.
          const linked = { ...inMemory, inputs: ["../packages/util-lib/index.js", "index.ts"] };
          expect(report).toEqual({
            "relative key": linked,
            "absolute key": linked,
            "isolated linker": {
              ...inMemory,
              inputs: ["index.ts", "node_modules/.bun/util-lib@1.0.0/node_modules/util-lib/index.js"],
            },
          });
        },
      );

      // On macOS /tmp and /var are such symlinks.
      buildsIn(
        "an absolute key through a symlink above the working directory overrides the file",
        {
          "real-root/project/src/index.ts": `import { config } from "./config.ts"; console.log(config);`,
          "real-root/project/src/config.ts": `export const config = "config from disk";`,
          "root": { link: "real-root" },
        },
        markers,
        `{
          build: {
            chdir: "root/project",
            entrypoints: [abs("root/project/src/index.ts")],
            files: { [abs("root/project/src/config.ts")]: ${fromMemory} },
          },
        }`,
        report => {
          expect(report).toEqual({ build: inMemory });
        },
      );

      // The real path of the symlink is "/", and a path below it starts with one "/".
      buildsIn(
        "a key through a symlink to the root of the filesystem overrides the file",
        { ...linkedSrc, "to-root": { link: "/" } },
        markers,
        `{
          build: {
            entrypoints: ["./real-src/index.ts"],
            files: { ["./to-root" + abs("real-src/config.ts")]: ${fromMemory} },
          },
        }`,
        report => {
          expect(report).toEqual({ build: inMemory });
        },
        isWindows,
      );

      buildsIn(
        "two keys that name one file through a symlink are one file, or a build error",
        { ...linkedSrc, "also-src": { link: "real-src" } },
        [...markers, "other config from memory"],
        `(() => {
          const build = files => ({ entrypoints: ["./src/index.ts"], files });
          const other = 'export const config = "other config from memory";';
          return {
            "the same contents": build({ "./src/config.ts": ${fromMemory}, [abs("real-src/config.ts")]: ${fromMemory} }),
            "the path through the symlink and the real path": build({ "./src/config.ts": ${fromMemory}, "./real-src/config.ts": other }),
            "two paths through symlinks": build({ "./src/config.ts": ${fromMemory}, [abs("also-src/config.ts")]: other }),
          };
        })()`,
        (report, directory) => {
          const inCase = (path: string) => join(directory, path).replaceAll("\\", "/");
          const failed = (other: string, key: string) => ({
            logs: [
              `BuildMessage: files: the keys "${other}" and "${key}" name the same file and have different contents\n` +
                `note: The real path of the file is "${inCase("real-src/config.ts")}"`,
            ],
            outputs: [],
            found: [],
          });
          expect(report).toEqual({
            "the same contents": inMemory,
            "the path through the symlink and the real path": failed("./real-src/config.ts", "./src/config.ts"),
            "two paths through symlinks": failed(inCase("also-src/config.ts"), "./src/config.ts"),
          });
        },
      );

      // A path that a plugin returns is the path of the module, as the plugin wrote it.
      buildsIn(
        "an onResolve plugin does not stop a key through a symlinked directory",
        linkedSrc,
        markers,
        `(() => {
          const build = onResolve => ({
            entrypoints: ["./src/index.ts"],
            files: { "./src/config.ts": ${fromMemory} },
            plugins: [{ name: "resolves", setup: build => void build.onResolve({ filter: /config/ }, onResolve) }],
          });
          return {
            "the plugin declines": build(() => undefined),
            "the plugin returns the real path": build(() => ({ path: abs("real-src/config.ts") })),
            "the plugin returns the path of the key": build(() => ({ path: abs("src/config.ts") })),
          };
        })()`,
        report => {
          expect(report).toEqual({
            "the plugin declines": inMemory,
            "the plugin returns the real path": inMemory,
            "the plugin returns the path of the key": inMemory,
          });
        },
      );

      // The resolver keeps what it read about a directory for the life of the
      // process. The key follows the resolver, so the two agree in each build.
      {
        const importer = `import { config } from "./config.ts"; console.log(config);`;
        const build = `before => ({ before, entrypoints: ["./src/index.ts"], files: { "./src/config.ts": ${fromMemory} } })`;
        // The root is the directory that the symlink leads to now, so the output path changes.
        const stale = { ...inMemory, outputs: [expect.any(String)] };
        buildsIn(
          "a key through a symlink that changes between two builds overrides the file in each build",
          {
            "first/index.ts": importer,
            "first/config.ts": `export const config = "config from disk";`,
            "second/index.ts": importer,
            "second/config.ts": `export const config = "config from disk";`,
            "src": { link: "first" },
          },
          markers,
          `(() => {
            const build = ${build};
            return { "before the change": build(undefined), "after the change": build(() => linkDirectory("second", "src")) };
          })()`,
          report => {
            expect(report).toEqual({ "before the change": inMemory, "after the change": stale });
          },
        );

        // The resolver still reads the first directory. No config.ts is on disk there.
        buildsIn(
          "a key through a symlink that changes is a file on disk only where the resolver reads it",
          {
            "first/index.ts": importer,
            "second/index.ts": importer,
            "second/config.ts": `export const config = "config from disk";`,
            "src": { link: "first" },
          },
          markers,
          `(() => {
            const build = ${build};
            return { "before the change": build(undefined), "after the change": build(() => linkDirectory("second", "src")) };
          })()`,
          report => {
            expect(report).toEqual({ "before the change": inMemory, "after the change": stale });
          },
        );

        // The resolver read the directory "src" before it was a symlink, so it has no real path for it.
        buildsIn(
          "a key through a symlink that the resolver read as a directory overrides the file",
          {
            "real-src/index.ts": importer,
            "real-src/config.ts": `export const config = "config from disk";`,
            "src/index.ts": importer,
            "src/config.ts": `export const config = "config from disk";`,
          },
          markers,
          `{
            "a directory": {
              entrypoints: ["./src/index.ts"],
              files: { "./src/config.ts": ${fromMemory} },
            },
            "a symlink": {
              before() {
                unlinkSync("src/index.ts");
                unlinkSync("src/config.ts");
                linkDirectory("real-src", "src");
              },
              entrypoints: ["./real-src/index.ts"],
              files: { "./src/config.ts": ${fromMemory} },
            },
          }`,
          report => {
            expect(report).toEqual({ "a directory": inMemory, "a symlink": inMemory });
          },
        );
      }

      // The build asks where the directory of a key is. That question reads no
      // tsconfig.json and leaves nothing behind for the next build.
      buildsIn(
        "a key that no module reads does not change the build",
        {
          "index.ts": `import "./later/on-disk.ts"; console.log("entry from disk");`,
          "index-before.ts": `console.log("entry from disk");`,
          "broken/tsconfig.json": `{ this is not JSON`,
          "broken/unused.ts": ``,
          "linked": { link: "broken" },
          // A symlink to itself, and one that leads nowhere.
          ...(!isWindows && { "loop": { link: "loop" }, "nowhere": { link: "not-on-disk" } }),
        },
        ["entry from disk", "later from disk"],
        `(() => {
          const files = {
            "./linked/unused.ts": "",
            "./broken/unused.ts": "",
            "./later/unused.ts": "",
            "./loop/unused.ts": "",
            "./nowhere/unused.ts": "",
            [abs("missing/deep/unused.ts")]: "",
            // Longer than a path buffer, 400 directories deep, and with a NUL.
            [abs("long") + "/" + Buffer.alloc(131072, "a").toString() + ".ts"]: "",
            [abs("deep") + Buffer.alloc(800, "/d").toString() + "/unused.ts"]: "",
            [abs("linked") + "/nul\\0.ts"]: "",
            [abs("linked") + "\\0/unused.ts"]: "",
          };
          return {
            "a directory with a tsconfig.json that does not parse": { entrypoints: ["./index-before.ts"], files },
            "a directory that is made after a build with a key in it": {
              before() {
                mkdirSync("later");
                writeFileSync("later/on-disk.ts", 'console.log("later from disk");');
              },
              entrypoints: ["./index.ts"],
              files,
            },
          };
        })()`,
        report => {
          expect(report).toEqual({
            "a directory with a tsconfig.json that does not parse": {
              logs: [],
              outputs: ["./index-before.js"],
              found: ["entry from disk"],
            },
            "a directory that is made after a build with a key in it": {
              logs: [],
              outputs: ["./index.js"],
              found: ["entry from disk", "later from disk"],
            },
          });
        },
      );

      // An in-memory module has the path of its key. Its imports start there,
      // not at the real path of that directory.
      buildsIn(
        "a module of a key below a symlinked directory imports from the directory of the key",
        {
          "beside.ts": `export const beside = "beside the symlink";`,
          "deep/beside.ts": `export const beside = "beside the real directory";`,
          "deep/real-src/keep": ``,
          "src": { link: "deep/real-src" },
        },
        ["beside the symlink", "beside the real directory", "lib in memory"],
        `{
          build: {
            entrypoints: [abs("src/index.ts")],
            files: {
              [abs("src/index.ts")]: 'import { beside } from "../beside.ts"; import { lib } from "./lib.ts"; console.log(beside, lib);',
              [abs("src/lib.ts")]: 'export const lib = "lib in memory";',
            },
          },
        }`,
        report => {
          expect(report).toEqual({
            build: { logs: [], outputs: ["deep/real-src/index.js"], found: ["beside the symlink", "lib in memory"] },
          });
        },
      );

      // Bun does not read an absolute key that is not normalized, with or without a symlink.
      buildsIn(
        "an absolute key that is not normalized has no effect",
        linkedSrc,
        markers,
        `{
          build: {
            entrypoints: ["./src/index.ts"],
            files: {
              [abs("src") + "/./config.ts"]: ${fromMemory},
              [abs("src") + "//config.ts"]: ${fromMemory},
              [abs(".") + "/./src/config.ts"]: ${fromMemory},
              [abs(".") + "/not-on-disk/../src/config.ts"]: ${fromMemory},
            },
          },
        }`,
        report => {
          expect(report).toEqual({ build: { logs: [], outputs: ["./index.js"], found: ["config from disk"] } });
        },
      );
    }

    buildsIn(
      "a key matches a path whatever the case of the drive letter",
      {},
      ["entry in memory", "lib in memory"],
      `(() => {
        const cwd = process.cwd();
        const lower = cwd[0].toLowerCase() + cwd.slice(1);
        const upper = cwd[0].toUpperCase() + cwd.slice(1);
        return {
          build: {
            entrypoints: [lower + "\\\\entry.js"],
            files: {
              [upper + "\\\\entry.js"]: 'import { lib } from "./lib.js"; console.log("entry in memory", lib);',
              [lower + "\\\\lib.js"]: 'export const lib = "lib in memory";',
            },
          },
        };
      })()`,
      report => {
        expect(report).toEqual({
          build: { logs: [], outputs: ["./entry.js"], found: ["entry in memory", "lib in memory"] },
        });
      },
      !isWindows,
    );
  });

  // With this flag the runtime does not follow symlinks, and it shares its
  // directory cache with the bundler. The bundler follows them.
  test("a key through a symlinked directory overrides the file under --preserve-symlinks", async () => {
    using dir = tempDir("bundler-files-preserve-symlinks", {
      "real-src/index.ts": `import { config } from "./config.ts"; console.log(config);`,
      "real-src/config.ts": `export const config = "config from disk";`,
      "build.mjs": `
        await import("./src/config.ts");
        const report = {};
        for (const entry of ["./src/index.ts", "./real-src/index.ts"]) {
          const result = await Bun.build({
            entrypoints: [entry],
            files: { "./src/config.ts": 'export const config = "config from memory";' },
            throw: false,
          });
          const text = result.success ? await result.outputs[0].text() : "";
          report[entry] = { logs: result.logs.map(String), found: text.match(/config from \\w+/g) };
        }
        console.log(JSON.stringify(report));
      `,
    });
    // Windows: a junction needs no privilege, and its target is absolute.
    symlinkSync(isWindows ? join(String(dir), "real-src") : "real-src", join(String(dir), "src"), "junction");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preserve-symlinks", "build.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const inMemory = { logs: [], found: ["config from memory"] };
    expect({ stdout: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: { "./src/index.ts": inMemory, "./real-src/index.ts": inMemory },
      stderr: "",
      exitCode: 0,
    });
  });
});
