import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";

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
  // process runs the builds of every case, each in a directory of its own. The
  // build script is in another directory, so a key resolved against the script
  // would fail. A test writes the name of its case to the stdin of the child
  // process and reads the report of that case from its stdout.
  describe("relative keys", () => {
    type Report = Record<
      string,
      { logs: string[]; outputs: string[]; found: string[]; inputs?: string[] } | { threw: string }
    >;
    const cases: { name: string; files: Record<string, string>; markers: string[]; builds: string }[] = [];
    // Lines on the stdout of a child process that are not the report of a case.
    const notReports: string[] = [];
    let root: ReturnType<typeof tempDir> | undefined;
    let child:
      | { proc: Bun.Subprocess<"pipe", "pipe", "pipe">; lines: AsyncGenerator<string>; stderr: Promise<string> }
      | undefined;
    const directoryOf = (name: string) => join(String(root), String(cases.findIndex(it => it.name === name)));

    async function* linesOf(stream: ReadableStream<Uint8Array>) {
      const decoder = new TextDecoder();
      let text = "";
      for await (const chunk of stream) {
        text += decoder.decode(chunk, { stream: true });
        for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n")) {
          yield text.slice(0, end);
          text = text.slice(end + 1);
        }
      }
      if (text) yield text;
    }

    function start() {
      root ??= tempDir("bundler-files-relative-keys", {
        "scripts/build.mjs": `
          import { symlinkSync } from "node:fs";
          import { isAbsolute, join, relative, resolve as abs } from "node:path";
          const root = process.cwd();
          const cases = new Map([${cases.map((it, index) => `[${JSON.stringify(it.name)}, ["${index}", ${JSON.stringify(it.markers)}, () => (${it.builds})]],`).join("\n")}]);
          for await (const name of console) {
            // The last line of stdin is empty.
            if (!name) continue;
            if (!cases.has(name)) throw new Error("There is no case " + JSON.stringify(name));
            const [directory, markers, builds] = cases.get(name);
            process.chdir(join(root, directory));
            const report = {};
            for (const [build, { chdir, chdirAfterCall, ...options }] of Object.entries(builds())) {
              if (chdir) process.chdir(chdir);
              const cwd = process.cwd();
              try {
                const building = Bun.build({ ...options, throw: false });
                if (chdirAfterCall) process.chdir(chdirAfterCall);
                const result = await building;
                const texts = await Promise.all(result.outputs.map(output => (options.compile ? "" : output.text())));
                const text = texts.join("\\n");
                report[build] = {
                  logs: result.logs.map(String),
                  outputs: result.outputs
                    .map(({ path }) => (isAbsolute(path) ? relative(cwd, path) : path).replaceAll("\\\\", "/"))
                    .sort(),
                  found: markers.flatMap(marker =>
                    Array(text.split(marker.startsWith("raw:") ? marker.slice(4) : JSON.stringify(marker)).length - 1).fill(marker),
                  ),
                  ...(result.metafile && { inputs: Object.keys(result.metafile.inputs).sort() }),
                };
              } catch (error) {
                report[build] = { threw: error.message };
              }
              process.chdir(join(root, directory));
            }
            console.log(JSON.stringify({ name, report }));
          }
        `,
        ...Object.fromEntries(
          cases.flatMap((it, index) => [
            [`${index}/case.txt`, it.name],
            ...Object.entries(it.files).map(([file, text]) => [`${index}/${file}`, text]),
          ]),
        ),
      });
      const proc = Bun.spawn({
        cmd: [bunExe(), join("scripts", "build.mjs")],
        cwd: String(root),
        env: { ...bunEnv, NODE_ENV: undefined },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      return { proc, lines: linesOf(proc.stdout), stderr: proc.stderr.text() };
    }

    // The rest of the output of a child process that has no more work, or that stopped.
    async function exited(stopped: NonNullable<typeof child>) {
      stopped.proc.stdin.end();
      for await (const line of stopped.lines) notReports.push(line);
      return { stdout: notReports.splice(0), stderr: await stopped.stderr, exitCode: await stopped.proc.exited };
    }

    async function reportOf(name: string): Promise<Report> {
      const running = (child ??= start());
      running.proc.stdin.write(name + "\n");
      running.proc.stdin.flush();
      // A `for await` loop closes the generator when the loop returns.
      for (let line = await running.lines.next(); !line.done; line = await running.lines.next()) {
        try {
          const { name: reported, report } = JSON.parse(line.value);
          if (reported === name) return report;
        } catch {}
        notReports.push(line.value);
      }
      // The child process stopped before it printed the report. The next case starts another one.
      child = undefined;
      expect(await exited(running)).toEqual({ stdout: [], stderr: "", exitCode: 0 });
      throw new Error(`The child process did not print a report for ${JSON.stringify(name)}`);
    }

    // `builds` is the source of an object: name -> Bun.build options. It can
    // call abs(), which is path.resolve(), and symlinkSync(). `chdir` is the
    // directory to call Bun.build() from. `chdirAfterCall` is the directory to
    // go to before the build is awaited. The report has, for each build, the
    // logs, the output paths from the directory of the call, each string
    // literal of the outputs that is one of `markers`, and the inputs of the
    // metafile if there is one. A marker that starts with "raw:" is any text,
    // not a string literal.
    function buildsIn(
      name: string,
      files: Record<string, string>,
      markers: string[],
      builds: string,
      check: (report: Report, directory: string) => void | Promise<void>,
      skip = false,
    ) {
      if (!skip) cases.push({ name, files, markers, builds });
      test.skipIf(skip)(name, async () => {
        await check(await reportOf(name), directoryOf(name));
      });
    }

    afterAll(() => {
      child?.proc.kill();
      root?.[Symbol.dispose]();
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
          "lib/text.ts": `import "./src/entry.tsx";`,
          "lib/bare.ts": `import "src/entry.tsx";`,
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
          // The import is not a path to the file from lib/. It is the text of the key.
          "relative key, import with the text of the key": {
            entrypoints: ["./lib/text.ts"],
            files: { "./src/entry.tsx": ${inMemory} },
            external: ["preact"],
          },
          "relative key, bare import with the text of the key": {
            entrypoints: ["./lib/bare.ts"],
            files: { "src/entry.tsx": ${inMemory} },
            external: ["preact"],
          },
          "relative key, import by path and by text": {
            entrypoints: ["./src/index.ts", "./lib/text.ts"],
            files: { "./src/entry.tsx": ${inMemory} },
            external: ["preact"],
            metafile: true,
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
            "relative key, import with the text of the key": { logs: [], outputs: ["./text.js"], found },
            "relative key, bare import with the text of the key": { logs: [], outputs: ["./bare.js"], found },
            // One module, whichever import the bundler resolves first.
            "relative key, import by path and by text": {
              logs: [],
              outputs: ["lib/text.js", "src/index.js"],
              found: [...found, ...found].sort(),
              inputs: ["lib/text.ts", "src/entry.tsx", "src/index.ts"],
            },
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

    // The disk resolver does not name these paths as files. Each key is a file
    // in memory, as it is when nothing is on disk at its path.
    buildsIn(
      "a key for a path that is not a file on disk is a file in memory",
      {
        "index.ts": `import { config } from "./config.ts"; console.log(config);`,
        "config.ts/index.ts": `export const config = "config from the directory on disk";`,
        "src/lower.ts": `console.log("lower on disk");`,
      },
      ["config from the directory on disk", "config from memory", "lower on disk", "upper in memory"],
      `{
        "a directory": {
          entrypoints: ["./index.ts"],
          files: { "./config.ts": 'export const config = "config from memory";' },
        },
        // The file on disk is src/lower.ts. Only some file systems find it by this name.
        "another letter case": {
          entrypoints: ["./src/LOWER.ts"],
          files: { "./src/LOWER.ts": 'console.log("upper in memory");' },
        },
      }`,
      report => {
        expect(report).toEqual({
          "a directory": { logs: [], outputs: ["./index.js"], found: ["config from memory"] },
          "another letter case": { logs: [], outputs: ["src/LOWER.js"], found: ["upper in memory"] },
        });
      },
    );

    // The disk resolver names the target of a symlink, not the path of the key.
    buildsIn(
      "a key for a symlink on disk is a file in memory",
      {
        "real.ts": `export const value = "real file on disk";`,
        "imports-link.ts": `import { value } from "./link.ts"; console.log(value);`,
        "real-directory/inner.ts": `export const value = "inner file on disk";`,
        "imports-inner.ts": `import { value } from "./link-directory/inner.ts"; console.log(value);`,
      },
      ["real file on disk", "inner file on disk", "link in memory", "inner in memory"],
      `(() => {
        symlinkSync("real.ts", "link.ts");
        symlinkSync("real-directory", "link-directory");
        return {
          "an import of a symlink": {
            entrypoints: ["./imports-link.ts"],
            files: { "./link.ts": 'export const value = "link in memory";' },
          },
          "an entry point that is a symlink": {
            entrypoints: ["./link.ts"],
            files: { "./link.ts": 'console.log("link in memory");' },
          },
          "an import through a symlinked directory": {
            entrypoints: ["./imports-inner.ts"],
            files: { "link-directory/inner.ts": 'export const value = "inner in memory";' },
          },
        };
      })()`,
      report => {
        expect(report).toEqual({
          "an import of a symlink": { logs: [], outputs: ["./imports-link.js"], found: ["link in memory"] },
          "an entry point that is a symlink": { logs: [], outputs: ["./link.js"], found: ["link in memory"] },
          "an import through a symlinked directory": {
            logs: [],
            outputs: ["./imports-inner.js"],
            found: ["inner in memory"],
          },
        });
      },
      // A symlink to a file needs a privilege on Windows.
      isWindows,
    );

    // Bun 1.4 resolved every import of such a file from the cwd. The directory
    // of the key is first now.
    {
      const build = (plugins: string) => `{
        entrypoints: ["./src/entry.ts"],
        files: {
          "./src/entry.ts": 'import { beside } from "./beside.ts"; import { helper } from "./helper.ts"; import { util } from "./lib/util.ts"; console.log(beside, helper, util);',
        },
        plugins: ${plugins},
      }`;
      buildsIn(
        "a relative import in a file of files that finds nothing beside the key resolves from the cwd",
        {
          "src/beside.ts": `export const beside = "beside the key";`,
          "beside.ts": `export const beside = "beside in the cwd";`,
          "helper.ts": `export const helper = "helper in the cwd";`,
          "lib/util.ts": `export const util = "util in the cwd";`,
        },
        ["beside the key", "beside in the cwd", "helper in the cwd", "util in the cwd"],
        `{
          "no plugin": ${build("[]")},
          "an onResolve plugin declines": ${build(`[{
            name: "declines",
            setup(build) {
              build.onResolve({ filter: /beside|helper|util/ }, () => undefined);
            },
          }]`)},
        }`,
        report => {
          const build = {
            logs: [],
            outputs: ["src/entry.js"],
            found: ["beside the key", "helper in the cwd", "util in the cwd"],
          };
          expect(report).toEqual({ "no plugin": build, "an onResolve plugin declines": build });
        },
      );
    }

    buildsIn(
      "a key does not depend on a process.chdir() after the Bun.build() call",
      {
        "one/src/entry.ts": `console.log("entry from disk in one");`,
        "other/src/entry.ts": `console.log("entry from disk in other");`,
      },
      ["entry from disk in one", "entry from disk in other", "entry from memory"],
      `{
        build: {
          chdir: "one",
          chdirAfterCall: "../other",
          entrypoints: ["./src/entry.ts"],
          files: { "./src/entry.ts": 'console.log("entry from memory");' },
        },
      }`,
      report => {
        expect(report).toEqual({ build: { logs: [], outputs: ["src/entry.js"], found: ["entry from memory"] } });
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
      const declinesAll = `[{
        name: "declines",
        setup(build) {
          build.onResolve({ filter: /./ }, () => undefined);
        },
      }]`;
      const inMemoryEntry = (plugins: string) => `{
        entrypoints: ["./virtual/entry.ts"],
        files: {
          "./virtual/entry.ts": 'import { lib } from "./lib.ts"; console.log("entry in memory", lib);',
          "virtual/lib.ts": 'export const lib = "lib in memory";',
        },
        plugins: ${plugins},
      }`;
      const entryOnDisk = (plugins: string) => `{
        entrypoints: ["./src/config.ts"],
        files: { "src/config.ts": 'export const config = "config from memory";' },
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
        ["config from memory", "generated in memory", "util from memory", "entry in memory", "lib in memory"],
        `{
          "no plugin": ${build("[]")},
          "declined": ${build(`[{
            name: "declines",
            setup(build) {
              build.onResolve({ filter: /config|generated|util-lib/ }, () => undefined);
            },
          }]`)},
          "an entry point in memory, no plugin": ${inMemoryEntry("[]")},
          "an entry point in memory, declined": ${inMemoryEntry(declinesAll)},
          "a key for an entry point on disk, no plugin": ${entryOnDisk("[]")},
          "a key for an entry point on disk, declined": ${entryOnDisk(declinesAll)},
        }`,
        report => {
          expect(report["no plugin"]).toEqual({
            logs: [],
            outputs: [expect.stringMatching(/^\.\/index-\w+\.js$/)],
            found: ["config from memory", "generated in memory", "util from memory"],
            inputs: ["node_modules/util-lib/index.js", "src/config.ts", "src/generated.ts", "src/index.ts"],
          });
          expect(report["declined"]).toEqual(report["no plugin"]);
          expect(report["an entry point in memory, no plugin"]).toEqual({
            logs: [],
            outputs: ["virtual/entry.js"],
            found: ["entry in memory", "lib in memory"],
          });
          expect(report["an entry point in memory, declined"]).toEqual(report["an entry point in memory, no plugin"]);
          expect(report["a key for an entry point on disk, no plugin"]).toEqual({
            logs: [],
            outputs: ["./config.js"],
            found: ["config from memory"],
          });
          expect(report["a key for an entry point on disk, declined"]).toEqual(
            report["a key for an entry point on disk, no plugin"],
          );
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
        // The root is ./virtual. The name of the directory of the chunk starts with "..".
        "a chunk in a directory with two dots at the start of its name": {
          entrypoints: ["./virtual/worker.ts"],
          files: {
            "virtual/worker.ts": 'import("./..cache/lazy.ts"); console.log("entry in memory");',
            "virtual/..cache/lazy.ts": 'console.log("lazy in memory");',
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
          "a chunk in a directory with two dots at the start of its name": {
            logs: [],
            outputs: [expect.stringMatching(/^out\/\.\.cache\/lazy-\w+\.js$/), "out/worker.js"],
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

    // This test is the last one: it closes the stdin of the child process.
    test("the child process that runs the builds exits cleanly", async () => {
      const running = (child ??= start());
      child = undefined;
      expect(await exited(running)).toEqual({ stdout: [], stderr: "", exitCode: 0 });
    });
  });
});
