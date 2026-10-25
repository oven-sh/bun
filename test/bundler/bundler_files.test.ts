import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
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

  // A relative key is a path from the cwd of the `Bun.build()` call. One child
  // process runs the builds of every case, each in a directory of its own. The
  // build script is in another directory, so a key resolved against the script
  // would fail. A test writes the name of its case to the stdin of the child
  // process and reads the report of that case from its stdout.
  describe("relative keys", () => {
    type Report = Record<
      string,
      { logs: string[]; outputs: string[]; found: string[]; inputs?: string[]; whole?: unknown } | { threw: string }
    >;
    // A file is its text, or a link to another path of the case (a junction on Windows).
    type Files = Record<string, string | { link: string }>;
    const cases: { name: string; files: Files; markers: string[]; builds: string }[] = [];
    // Lines on the stdout of a child process that are not the report of a case.
    const notReports: string[] = [];
    let root: ReturnType<typeof tempDir> | undefined;
    let child:
      | { proc: Bun.Subprocess<"pipe", "pipe", "pipe">; lines: AsyncGenerator<string>; stderr: Promise<string> }
      | undefined;
    // The call of `reportOf` that a test waits in. A test that ends before its report arrives leaves it set.
    let waiting: object | undefined;

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

    // Writes the files of every case once. Each child process reads them.
    function writeCases() {
      const tree = tempDir("bundler-files-relative-keys", {
        "scripts/build.mjs": `
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
            for (const [build, { chdir, chdirAfterCall, whole, ...options }] of Object.entries(builds())) {
              if (chdir) process.chdir(chdir);
              const cwd = process.cwd();
              const withoutCwd = text => text.replaceAll(JSON.stringify(cwd).slice(1, -1), "<cwd>").replaceAll(cwd, "<cwd>");
              globalThis.seen = [];
              try {
                const building = Bun.build({ ...options, throw: false });
                if (chdirAfterCall) process.chdir(chdirAfterCall);
                const result = await building;
                const texts = await Promise.all(result.outputs.map(output => output.text()));
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
                if (whole) {
                  const outputs = result.outputs.map(({ path }, index) => [withoutCwd(path), withoutCwd(texts[index])]);
                  const positions = result.logs.map(({ position }) => position && withoutCwd(position.file) + ":" + position.line);
                  report[build].whole = { outputs: outputs.sort(), metafile: result.metafile, positions, seen: seen.map(withoutCwd).sort() };
                }
              } catch (error) {
                report[build] = { threw: error.name + ": " + error.message };
              }
              process.chdir(join(root, directory));
            }
            console.log(JSON.stringify({ name, report }));
          }
        `,
        ...Object.fromEntries(
          cases.flatMap((it, index) => [
            [`${index}/case.txt`, it.name],
            ...Object.entries(it.files).flatMap(([file, text]) =>
              typeof text === "string" ? [[`${index}/${file}`, text]] : [],
            ),
          ]),
        ),
      });
      for (const [index, { files }] of cases.entries()) {
        for (const [file, target] of Object.entries(files)) {
          if (typeof target === "string") continue;
          mkdirSync(dirname(join(String(tree), String(index), file)), { recursive: true });
          symlinkSync(
            join(String(tree), String(index), target.link),
            join(String(tree), String(index), file),
            "junction",
          );
        }
      }
      return tree;
    }

    function start() {
      root ??= writeCases();
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
      const call = (waiting = {});
      running.proc.stdin.write(name + "\n");
      running.proc.stdin.flush();
      // A `for await` loop closes the generator when the loop returns.
      for (let line = await running.lines.next(); !line.done; line = await running.lines.next()) {
        try {
          const { name: reported, report } = JSON.parse(line.value);
          if (reported === name) {
            if (waiting === call) waiting = undefined;
            return report;
          }
        } catch {}
        notReports.push(line.value);
      }
      // `afterEach` stopped the child process of a test that timed out. That test is over.
      if (waiting !== call) return new Promise<Report>(() => {});
      // The child process stopped before it printed the report. The next case starts another one.
      waiting = undefined;
      if (child === running) child = undefined;
      expect(await exited(running)).toEqual({ stdout: [], stderr: "", exitCode: 0 });
      throw new Error(`The child process did not print a report for ${JSON.stringify(name)}`);
    }

    // `builds` is the source of an object: name -> Bun.build options. It can
    // call abs(), which is path.resolve(). `chdir` is the
    // directory to call Bun.build() from. `chdirAfterCall` is the directory to
    // go to before the build is awaited. The report has, for each build, the
    // logs, the output paths from the directory of the call, each string
    // literal of the outputs that is one of `markers`, and the inputs of the
    // metafile if there is one. A marker that starts with "raw:" is any text,
    // not a string literal. With `whole: true` the report also has the text of
    // each output, the metafile, the file and line of each log, and what a
    // plugin pushed to `seen`, with "<cwd>" for the directory of the call.
    function buildsIn(
      name: string,
      files: Files,
      markers: string[],
      builds: string,
      check: (report: Report) => void | Promise<void>,
      skip = false,
    ) {
      if (!skip) cases.push({ name, files, markers, builds });
      test.skipIf(skip)(name, async () => {
        await check(await reportOf(name));
      });
    }

    // A test that timed out still waits for its report. The next test must not read that report.
    afterEach(() => {
      if (waiting === undefined) return;
      waiting = undefined;
      child?.proc.kill();
      child = undefined;
    });

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
          expect(report).toEqual({ "./src/config.ts": inMemory, "dot segments": inMemory, "backslashes": inMemory });
        },
      );
    }

    // Display paths, `[hash]` names, class names of a CSS module and inlined
    // paths come from the path of a module, so they show what a key is.
    {
      const project = {
        "index.ts": `
          import styles from "./src/card.module.css";
          import { shared } from "./src/shared.ts";
          console.log(styles.title, shared);
          import("./src/lazy.ts");
        `,
        "src/card.module.css": `.title { color: red; }`,
        "src/shared.ts": `export const shared = "shared";`,
        "src/lazy.ts": `import { shared } from "./shared.ts"; console.log("lazy", shared);`,
        "where.ts": `import { where } from "./src/where.ts"; console.log(where);`,
        "src/where.ts": `export const where = [__filename, __dirname];`,
        "bad.ts": `import "./src/bad.ts";`,
        "src/bad.ts": `export const = 1;`,
      };
      const keysOf = (...files: (keyof typeof project)[]) =>
        JSON.stringify(Object.fromEntries(files.map(file => ["./" + file, project[file]])));
      const build = `entry => ({
        entrypoints: [entry],
        splitting: true,
        naming: "[dir]/[name]-[hash].[ext]",
        metafile: true,
        whole: true,
      })`;
      const keys = keysOf("src/card.module.css", "src/shared.ts", "src/lazy.ts");

      buildsIn(
        "a ./ key with the text of its file gives the same build as the file",
        { ...project, "virtual/index.ts": project["index.ts"] },
        [],
        `(() => {
          const build = ${build};
          return {
            "files on disk": build("./index.ts"),
            "keys over the files": { ...build("./index.ts"), files: ${keys} },
            "keys and no files": { ...build("./index.ts"), files: ${keys}, chdir: "virtual" },
          };
        })()`,
        report => {
          const onDisk = report["files on disk"];
          expect(onDisk).toMatchObject({ logs: [], inputs: expect.arrayContaining(["src/lazy.ts"]) });
          expect(report["keys over the files"]).toEqual(onDisk);
          expect(report["keys and no files"]).toEqual(onDisk);
        },
      );

      buildsIn(
        "a plugin, an inlined path and a log get the path of a ./ key as they get the path of its file",
        project,
        [],
        `(() => {
          const build = ${build};
          // The plugin declines, so the bundler resolves and loads each module.
          const plugins = [{
            name: "sees",
            setup(build) {
              build.onResolve({ filter: /shared/ }, ({ path, importer, resolveDir }) => void seen.push(["onResolve", path, importer, resolveDir].join(" ")));
              build.onLoad({ filter: /lazy|shared/ }, ({ path }) => void seen.push("onLoad " + path));
            },
          }];
          return {
            "a plugin and files on disk": { ...build("./index.ts"), plugins },
            "a plugin and keys": { ...build("./index.ts"), files: ${keys}, plugins },
            "__filename on disk": build("./where.ts"),
            "__filename in a key": { ...build("./where.ts"), files: ${keysOf("src/where.ts")} },
            "a syntax error on disk": build("./bad.ts"),
            "a syntax error in a key": { ...build("./bad.ts"), files: ${keysOf("src/bad.ts")} },
          };
        })()`,
        report => {
          expect(report["a plugin and files on disk"]).toMatchObject({
            logs: [],
            whole: {
              seen: expect.arrayContaining([expect.stringMatching(/^onLoad <cwd>[\\/]src[\\/]lazy\.ts$/)]),
            },
          });
          expect(report["a plugin and keys"]).toEqual(report["a plugin and files on disk"]);
          expect(report["__filename on disk"]).toMatchObject({ logs: [] });
          expect(report["__filename in a key"]).toEqual(report["__filename on disk"]);
          expect(report["a syntax error on disk"]).toMatchObject({
            outputs: [],
            whole: { positions: expect.arrayContaining([expect.stringMatching(/^<cwd>[\\/]src[\\/]bad\.ts:1$/)]) },
          });
          expect(report["a syntax error in a key"]).toEqual(report["a syntax error on disk"]);
        },
      );
    }

    // The disk resolver picks the file for these imports. The parse task then
    // finds the key by the path of that file. "./config.ts" in other.ts is an
    // import that `files` answers: both imports name one module.
    buildsIn(
      "a key overrides the file that the resolver finds for an import",
      {
        "src/index.ts": `
          import { config } from "./config";
          import { util } from "util-lib";
          import "./other.ts";
          console.log(config, util);
        `,
        "src/other.ts": `import { config } from "./config.ts"; console.log(config);`,
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
            "./node_modules/util-lib/index.js": 'export const util = "util from memory";',
          },
        },
      }`,
      report => {
        expect(report).toEqual({
          build: { logs: [], outputs: ["./index.js"], found: ["config from memory", "util from memory"] },
        });
      },
    );

    // No file of these builds is on disk. The entry imports the other key as "./lib.js".
    buildsIn(
      "an entry point names a key by its text",
      { "proj/keep": "", "with-src/src/keep": "" },
      ["entry in memory", "lib in memory"],
      `(() => {
        const build = (entry, key) => ({
          entrypoints: [entry],
          files: {
            [key]: 'import { lib } from "./lib.js"; console.log("entry in memory", lib);',
            "./lib.js": 'export const lib = "lib in memory";',
          },
        });
        return {
          "./entry.js": build("./entry.js", "./entry.js"),
          "absolute, absolute key": build(abs("entry.js"), abs("entry.js")),
          // Any other entry point is for the disk resolver, with a "./" key and with an absolute key.
          absolute: build(abs("entry.js"), "./entry.js"),
          "entry.js": build("entry.js", "./entry.js"),
          "entry.js, absolute key": build("entry.js", abs("entry.js")),
          "./entry.js, absolute key": build("./entry.js", abs("entry.js")),
          // The default root is the directory of such an entry point.
          "a directory that is not on disk": build("virtual/entry.js", "./virtual/entry.js"),
          "a directory with no such file": { ...build("src/entry.js", "./src/entry.js"), chdir: "with-src" },
          // Before the disk resolver, Bun joins such an entry point onto the directory above the cwd. An absolute key can be there.
          "an absolute key at the entry point from the directory above the cwd": {
            ...build("proj/entry.js", abs("proj/entry.js")),
            root: ".",
            chdir: "proj",
          },
        };
      })()`,
      report => {
        const inMemory = { logs: [], outputs: ["./entry.js"], found: ["entry in memory", "lib in memory"] };
        const notFound = (entry: string) => ({
          logs: [`BuildMessage: ModuleNotFound resolving "${entry}" (entry point)`],
          outputs: [],
          found: [],
        });
        expect(report).toEqual({
          "./entry.js": inMemory,
          "absolute, absolute key": inMemory,
          absolute: {
            logs: [expect.stringMatching(/^BuildMessage: ModuleNotFound resolving ".+entry\.js" \(entry point\)$/)],
            outputs: [],
            found: [],
          },
          "entry.js": notFound("entry.js"),
          "entry.js, absolute key": notFound("entry.js"),
          "./entry.js, absolute key": notFound("./entry.js"),
          "a directory that is not on disk": { threw: expect.stringContaining("failed to open root directory") },
          "a directory with no such file": notFound("src/entry.js"),
          "an absolute key at the entry point from the directory above the cwd": inMemory,
        });
      },
    );

    {
      const build = (entry: string) => `{
        entrypoints: [${entry}],
        files: { "./src/entry.ts": 'console.log("entry from memory");' },
      }`;
      // A relative entry point that is not the text of a key is for the disk
      // resolver. The parse task reads the key at the path that it finds.
      const page = (key: string) => `{
        entrypoints: ["src/page.tsx"],
        files: { [${key}]: 'console.log(<div>{"page from memory"}</div>);' },
        external: ["preact"],
      }`;
      buildsIn(
        "a key overrides an entry point on disk",
        {
          "src/entry.ts": `console.log("entry from disk");`,
          "src/page.tsx": `console.log(<div>page from disk</div>);`,
          "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" } }),
        },
        ["entry from disk", "entry from memory", "page from disk", "page from memory", "preact/jsx-dev-runtime"],
        `{
          "./src/entry.ts": ${build(`"./src/entry.ts"`)},
          "src/entry.ts": ${build(`"src/entry.ts"`)},
          "absolute": ${build(`abs("src/entry.ts")`)},
          "the tsconfig.json of the file applies": ${page(`"./src/page.tsx"`)},
          "the tsconfig.json of the file applies, absolute key": ${page(`abs("src/page.tsx")`)},
        }`,
        report => {
          const page = { logs: [], outputs: ["./page.js"], found: ["page from memory", "preact/jsx-dev-runtime"] };
          expect(report).toEqual({
            // The entrypoint is the text of a key or the path of its file, so the root is the cwd.
            "./src/entry.ts": { logs: [], outputs: ["src/entry.js"], found: ["entry from memory"] },
            "absolute": { logs: [], outputs: ["src/entry.js"], found: ["entry from memory"] },
            // If not, the root is the directory of the entry point, as for an entry point on disk.
            "src/entry.ts": { logs: [], outputs: ["./entry.js"], found: ["entry from memory"] },
            "the tsconfig.json of the file applies": page,
            "the tsconfig.json of the file applies, absolute key": page,
          });
        },
      );
    }

    // `files` answers "./page.tsx" and gives the module the JSX options of the
    // build. The disk resolver answers "./page" and gives it the tsconfig.json
    // of the file. An absolute key does the same.
    {
      const build = (entry: string) => `{
        entrypoints: [${JSON.stringify(entry)}],
        files: { "./src/page.tsx": 'export const Page = () => <div>{"page from memory"}</div>;' },
        external: ["preact", "react"],
      }`;
      buildsIn(
        "a key over a file takes the settings of the route that finds it",
        {
          "src/index.tsx": `import { Page } from "./page.tsx"; console.log(Page);`,
          "src/noext.tsx": `import { Page } from "./page"; console.log(Page);`,
          "src/page.tsx": `export const Page = () => <div>page from disk</div>;`,
          "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" } }),
        },
        ["page from memory", "page from disk", 'raw:"react/jsx-dev-runtime"', 'raw:"preact/jsx-dev-runtime"'],
        `{
          "an import with the extension": ${build("./src/index.tsx")},
          "an import without the extension": ${build("./src/noext.tsx")},
        }`,
        report => {
          expect(report).toEqual({
            "an import with the extension": {
              logs: [],
              outputs: ["./index.js"],
              found: ["page from memory", 'raw:"react/jsx-dev-runtime"'],
            },
            "an import without the extension": {
              logs: [],
              outputs: ["./noext.js"],
              found: ["page from memory", 'raw:"preact/jsx-dev-runtime"'],
            },
          });
        },
      );
    }

    // Bun does not resolve a symlink in a key. The disk resolver gives a module
    // its real path, so that is the path that a key must have.
    buildsIn(
      "a key for a file behind a symlink is its real path",
      {
        "index.ts": `import { util } from "util-lib"; console.log(util);`,
        "store/util-lib/package.json": JSON.stringify({ name: "util-lib", main: "index.js" }),
        "store/util-lib/index.js": `export const util = "util from disk";`,
        "node_modules/util-lib": { link: "store/util-lib" },
      },
      ["util from disk", "util from memory"],
      `(() => {
        const build = key => ({
          entrypoints: ["./index.ts"],
          files: { [key]: 'export const util = "util from memory";' },
        });
        return {
          "the path through the link": build("./node_modules/util-lib/index.js"),
          "the real path": build("./store/util-lib/index.js"),
        };
      })()`,
      report => {
        expect(report).toEqual({
          "the path through the link": { logs: [], outputs: ["./index.js"], found: ["util from disk"] },
          "the real path": { logs: [], outputs: ["./index.js"], found: ["util from memory"] },
        });
      },
    );

    buildsIn(
      "a key is a path from the directory that Bun.build() is called in",
      {
        "packages/app/src/index.ts": `import { config } from "./config.ts"; console.log(config);`,
        "packages/app/src/config.ts": `export const config = "config from disk";`,
        "one/src/index.ts": `import { config } from "./config.ts"; console.log(config);`,
        "one/src/config.ts": `export const config = "config from disk in one";`,
        "other/src/config.ts": `export const config = "config from disk in other";`,
      },
      ["config from disk", "config from memory", "config from disk in one", "config from disk in other"],
      `{
        "the directory of the call": {
          chdir: "packages/app",
          entrypoints: ["./src/index.ts"],
          files: { "./src/config.ts": 'export const config = "config from memory";' },
        },
        // The key is one/src/config.ts, not other/src/config.ts. Its display path is from one/ too.
        "process.chdir() after the call": {
          chdir: "one",
          chdirAfterCall: "../other",
          entrypoints: [abs("one/src/index.ts")],
          files: { "./src/config.ts": 'export const config = "config from memory";' },
          metafile: true,
        },
        // The path of this module is a name. An import in it is a path from the directory of the call.
        "process.chdir() after the call, an import in a name": {
          chdir: "one",
          chdirAfterCall: "../other",
          entrypoints: ["worker.ts"],
          files: {
            "worker.ts": 'import { config } from "./src/config.ts"; console.log(config);',
            [abs("one/src/config.ts")]: 'export const config = "config from memory";',
          },
        },
      }`,
      report => {
        const inMemory = { logs: [], outputs: ["./index.js"], found: ["config from memory"] };
        expect(report).toEqual({
          "the directory of the call": inMemory,
          "process.chdir() after the call": { ...inMemory, inputs: expect.arrayContaining(["src/config.ts"]) },
          "process.chdir() after the call, an import in a name": {
            logs: [],
            outputs: [expect.stringContaining("worker.js")],
            found: ["config from memory"],
          },
        });
      },
    );

    buildsIn(
      "an import names the key beside the importer, or the key with that text",
      {
        "index.ts": `import chart from "chart.js"; console.log(chart);`,
        "node_modules/chart.js/package.json": JSON.stringify({ name: "chart.js", main: "index.js" }),
        "node_modules/chart.js/index.js": `export default "chart.js from node_modules";`,
        "styles/main.css": `@import "theme.css";`,
        "pages/index.html": `<!doctype html><link rel="stylesheet" href="style.css" /><script type="module" src="app.js"></script>`,
      },
      [
        "scheme key",
        "dot key",
        "key beside the importer",
        "key with the text of the import",
        "chart.js from node_modules",
        "chart.js from memory",
        "app in memory",
        "raw:theme-in-memory",
        "raw:page-in-memory",
      ],
      `(() => {
        // An onResolve plugin that declines sends an import through another branch of the bundler.
        const declines = [{
          name: "declines",
          setup(build) {
            build.onResolve({ filter: /./ }, () => undefined);
          },
        }];
        // "chart.js" in JavaScript is a package. In CSS and HTML, a bare specifier can be the file beside the importer.
        const javascript = plugins => ({
          entrypoints: ["./index.ts"],
          files: { "./chart.js": 'export default "chart.js from memory";' },
          plugins,
        });
        const css = plugins => ({
          entrypoints: ["./styles/main.css"],
          files: { "./styles/theme.css": ".theme-in-memory { color: red; }" },
          plugins,
        });
        const html = plugins => ({
          entrypoints: ["./pages/index.html"],
          files: {
            "./pages/style.css": ".page-in-memory { color: red; }",
            "./pages/app.js": 'console.log("app in memory");',
          },
          plugins,
        });
        return {
          "the text of a key, from any directory": {
            entrypoints: ["/app/nested/index.ts"],
            files: {
              "/app/nested/index.ts": 'import "virtual:config.ts"; import "./dot.ts";',
              "virtual:config.ts": 'console.log("scheme key");',
              "./dot.ts": 'console.log("dot key");',
            },
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
          "a bare import in JavaScript": javascript([]),
          "a bare import in JavaScript, declined": javascript(declines),
          "a bare import in CSS": css([]),
          "a bare import in CSS, declined": css(declines),
          "a bare reference in HTML": html([]),
          "a bare reference in HTML, declined": html(declines),
        };
      })()`,
      report => {
        const javascript = { logs: [], outputs: ["./index.js"], found: ["chart.js from node_modules"] };
        const css = { logs: [], outputs: ["./main.css"], found: ["raw:theme-in-memory"] };
        const html = {
          logs: [],
          outputs: ["./chunk-[hash].css", "./chunk-[hash].js", "./index.html"],
          found: ["app in memory", "raw:page-in-memory"],
        };
        // The chunks of a page have a hash in their names.
        for (const build of Object.values(report)) {
          if ("outputs" in build)
            build.outputs = build.outputs.map(it => it.replace(/chunk-\w+/, "chunk-[hash]")).sort();
        }
        expect(report).toEqual({
          "the text of a key, from any directory": {
            logs: [],
            outputs: [isWindows ? expect.stringContaining("index.js") : "app/nested/index.js"],
            found: ["scheme key", "dot key"],
          },
          "a key beside the importer comes first": {
            logs: [],
            outputs: ["./entry.js"],
            found: ["key beside the importer"],
          },
          "a bare import in JavaScript": javascript,
          "a bare import in JavaScript, declined": javascript,
          "a bare import in CSS": css,
          "a bare import in CSS, declined": css,
          "a bare reference in HTML": html,
          "a bare reference in HTML, declined": html,
        });
      },
    );

    // The path of the module of a "./" key is absolute. A key without "./" is
    // a name, and its module has the text of the key.
    {
      const keys = {
        "./dot.ts": "path dot.ts",
        "../up.ts": "path ../up.ts",
        "dir/file.ts": "name dir/file.ts",
        "bare.ts": "name bare.ts",
        "virtual:config.ts": "name virtual:config.ts",
      };
      const imports = Object.keys(keys).map(key => `import ${JSON.stringify(key)};`);
      buildsIn(
        "an onLoad plugin gets the path of a key that starts with ./ or ../",
        { "index.ts": `import "generated";`, "gen/config.ts": `console.log("config from disk");` },
        [...Object.values(keys), "config from disk", "config from memory"],
        `{
          "the path that onLoad gets": {
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
          // No onLoad plugin reads the module, so the bundler reads the path: the text of the key.
          "a plugin resolves to the text of a key": {
            entrypoints: ["./index.ts"],
            files: { "./gen/config.ts": 'console.log("config from memory");' },
            plugins: [{
              name: "namespace",
              setup(build) {
                build.onResolve({ filter: /^generated$/ }, () => ({ path: "./gen/config.ts", namespace: "generated" }));
                build.onLoad({ filter: /never/, namespace: "generated" }, () => undefined);
              },
            }],
          },
        }`,
        report => {
          expect(report).toEqual({
            "the path that onLoad gets": {
              logs: [],
              outputs: [isWindows ? expect.stringContaining("index.js") : "app/index.js"],
              found: Object.values(keys),
            },
            "a plugin resolves to the text of a key": {
              logs: [],
              outputs: ["./index.js"],
              found: ["config from memory"],
            },
          });
        },
      );
    }

    // An onResolve plugin that declines an import sends it through another
    // branch of the bundler. The result is the same.
    {
      const build = (plugins: string) => `{
        entrypoints: ["./src/index.ts"],
        files: {
          "./src/config.ts": 'export const config = "config from memory";',
          "./src/generated.ts": 'export const generated = "generated in memory";',
          "./node_modules/util-lib/index.js": 'export const util = "util from memory";',
        },
        naming: "[name]-[hash].[ext]",
        metafile: true,
        plugins: ${plugins},
      }`;
      buildsIn(
        "an onResolve plugin that declines an import does not change the build",
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
            "./src/deep/../generated.ts": 'console.log("generated in memory");',
            [abs("src/generated.ts")]: 'console.log("generated in memory");',
          },
        },
        "two keys with different contents": {
          entrypoints: ["./index.ts"],
          files: { "./src/generated.ts": "first", "./src/deep/../generated.ts": "second" },
        },
        "the path of the module": {
          entrypoints: ["./index.ts"],
          files: { "./src/generated.ts": "" },
          plugins: [{
            name: "path",
            setup(build) {
              // Windows: the case of the drive letter can differ.
              const expected = abs("src/generated.ts").toLowerCase();
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
            threw: expect.stringMatching(
              /^TypeError: files: the keys "\.\/src\/generated\.ts" and "\.\/src\/deep\/\.\.\/generated\.ts" both name ".*\/src\/generated\.ts" and have different contents$/,
            ),
          },
          "the path of the module": { logs: [], outputs: ["./index.js"], found: ["onLoad saw the path"] },
        });
      },
    );

    buildsIn(
      "the output of an entry point that is written like its key keeps that name and directory",
      { "lib.ts": `export const lib = "lib from disk";`, "packages/app/keep": "" },
      ["entry in memory", "lib from disk"],
      `{
        "a directory that is not on disk": {
          entrypoints: ["./virtual/worker.ts"],
          files: { "./virtual/worker.ts": 'import { lib } from "../lib.ts"; console.log("entry in memory", lib);' },
          outdir: "out",
        },
        "a directory above the cwd": {
          chdir: "packages/app",
          entrypoints: ["../virtual/worker.ts"],
          files: { "../virtual/worker.ts": 'import { lib } from "../../lib.ts"; console.log("entry in memory", lib);' },
          outdir: "out",
        },
      }`,
      report => {
        const worker = { logs: [], outputs: ["out/virtual/worker.js"], found: ["entry in memory", "lib from disk"] };
        expect(report).toEqual({ "a directory that is not on disk": worker, "a directory above the cwd": worker });
      },
    );

    // The output of a "./" key has the directory and the name of its path from the cwd, like the
    // key text gave it on Bun 1.4. No directory of these keys is on disk. The builds import the
    // key by its text, and give the output of Bun 1.4.
    buildsIn(
      "the output of a ./ key is at its path from the cwd",
      { "src/keep": "", "packages/app/keep": "" },
      [],
      `(() => {
        const build = (entry, key, options) => ({
          entrypoints: [entry],
          files: { [entry]: "import(" + JSON.stringify(key) + ");", [key]: "export const lazy = 1;" },
          splitting: true,
          naming: { chunk: "[dir]/[name]-chunk.[ext]" },
          outdir: "out",
          ...options,
        });
        return {
          "the default root": build("./entry.ts", "./lazy/mod.ts"),
          "root": build("./src/entry.ts", "./src/lazy/mod.ts", { root: "./src" }),
          "a key above the cwd, inside root": build("./entry.ts", "../lazy/mod.ts", { root: "..", chdir: "packages/app" }),
          "a key above the cwd": build("./entry.ts", "../lazy/mod.ts", { chdir: "packages/app" }),
          "a key outside root": build("./src/entry.ts", "./gen/lazy/mod.ts", { root: "./src" }),
        };
      })()`,
      report => {
        const at = (...outputs: string[]) => ({ logs: [], outputs, found: [] });
        expect(report).toEqual({
          "the default root": at("out/entry.js", "out/lazy/mod-chunk.js"),
          "root": at("out/entry.js", "out/lazy/mod-chunk.js"),
          "a key above the cwd, inside root": at("out/app/entry.js", "out/app/lazy/mod-chunk.js"),
          "a key above the cwd": at("out/entry.js", "out/lazy/mod-chunk.js"),
          "a key outside root": at("out/_.._/gen/lazy/mod-chunk.js", "out/entry.js"),
        });
      },
    );

    // The module of a "./" key is the file at its path, so the imports in it resolve from the
    // directory of the key. Bun 1.4 resolved them from the cwd. A key without "./" is a name:
    // the imports in it resolve from the cwd.
    buildsIn(
      "an import in a ./ key resolves from the directory of the key, and in a name from the cwd",
      {
        "helper.js": `export const helper = "helper in the cwd";`,
        "both.js": `export const both = "both in the cwd";`,
        "src/both.js": `export const both = "both beside the key";`,
        "packages/app/node_modules/app-lib/package.json": JSON.stringify({ name: "app-lib", main: "index.js" }),
        "packages/app/node_modules/app-lib/index.js": `export const lib = "package of the cwd";`,
      },
      ["helper in the cwd", "both in the cwd", "both beside the key", "package of the cwd"],
      `(() => {
        // An onResolve plugin that declines sends an import through another branch of the bundler.
        const declines = [{
          name: "declines",
          setup(build) {
            build.onResolve({ filter: /helper|both|app-lib/ }, () => undefined);
          },
        }];
        const helper = 'import { helper } from "./helper.js"; console.log(helper);';
        const both = 'import { both } from "./both.js"; console.log(both);';
        const lib = 'import { lib } from "app-lib"; console.log(lib);';
        const build = (key, text, plugins = []) => ({ entrypoints: [key], files: { [key]: text }, plugins });
        return {
          "a file of the cwd": build("./src/a.ts", helper),
          "a file of the cwd, declined": build("./src/a.ts", helper, declines),
          "a file in both directories": build("./src/a.ts", both),
          "a package of the cwd, in a key above the cwd": { ...build("../up.ts", lib), chdir: "packages/app" },
          "a name: a file of the cwd": build("src/a.ts", helper),
          "a name: a file of the cwd, declined": build("src/a.ts", helper, declines),
          "a name: a file in both directories": build("src/a.ts", both),
        };
      })()`,
      report => {
        const notResolved = (message: string) => ({ logs: ["ResolveMessage: " + message], outputs: [], found: [] });
        expect(report).toEqual({
          "a file of the cwd": notResolved(`Could not resolve: "./helper.js"`),
          "a file of the cwd, declined": notResolved(`Could not resolve: "./helper.js"`),
          "a file in both directories": { logs: [], outputs: ["src/a.js"], found: ["both beside the key"] },
          "a package of the cwd, in a key above the cwd": notResolved(
            `Could not resolve: "app-lib". Maybe you need to "bun install"?`,
          ),
          "a name: a file of the cwd": { logs: [], outputs: ["src/a.js"], found: ["helper in the cwd"] },
          "a name: a file of the cwd, declined": { logs: [], outputs: ["src/a.js"], found: ["helper in the cwd"] },
          "a name: a file in both directories": { logs: [], outputs: ["src/a.js"], found: ["both in the cwd"] },
        });
      },
    );

    // `files` answers an import before the `external` option does. The disk resolver answers
    // "./config", so that import is external. An absolute key does the same.
    buildsIn(
      "a key answers an import before the external option",
      {
        "src/index.ts": `import { config } from "./config.ts"; import { config as other } from "./config"; console.log(config, other);`,
        "src/config.ts": `export const config = "config from disk";`,
      },
      ["config from disk", "config from memory", 'raw:from "./config.ts"', 'raw:from "./config"'],
      `(() => {
        const build = (key, external) => ({
          entrypoints: ["./src/index.ts"],
          files: { [key]: 'export const config = "config from memory";' },
          external,
        });
        return {
          "every import is external": build("./src/config.ts", ["*"]),
          "every import is external, absolute key": build(abs("src/config.ts"), ["*"]),
        };
      })()`,
      report => {
        const bundled = { logs: [], outputs: ["./index.js"], found: ["config from memory", 'raw:from "./config"'] };
        expect(report).toEqual({
          "every import is external": bundled,
          "every import is external, absolute key": bundled,
        });
      },
    );

    // Debug builds assert that the path of an entry point is absolute. A name is not a path.
    buildsIn(
      "a key that is a name can be an entry point",
      {},
      ["entry in memory", "lib in memory"],
      `{
        "a scheme": {
          entrypoints: ["virtual:entry.ts"],
          files: { "virtual:entry.ts": 'console.log("entry in memory");' },
        },
        "a file name": {
          entrypoints: ["worker.ts"],
          files: { "worker.ts": 'console.log("entry in memory");' },
        },
        // A relative import in a module with a name as its path is a path from the cwd.
        "a name that imports an absolute key": {
          entrypoints: ["worker.ts"],
          files: {
            "worker.ts": 'import { lib } from "./lib.ts"; console.log("entry in memory", lib);',
            [abs("lib.ts")]: 'export const lib = "lib in memory";',
          },
        },
      }`,
      report => {
        expect(report).toEqual({
          "a scheme": {
            logs: [],
            outputs: [isWindows ? expect.stringContaining("entry.js") : "./virtual:entry.js"],
            found: ["entry in memory"],
          },
          "a file name": { logs: [], outputs: ["./worker.js"], found: ["entry in memory"] },
          "a name that imports an absolute key": {
            logs: [],
            outputs: ["./worker.js"],
            found: ["entry in memory", "lib in memory"],
          },
        });
      },
    );

    buildsIn(
      "a key matches a path whatever the case of the drive letter and the separators",
      {},
      ["entry in memory", "lib in memory"],
      `(() => {
        const cwd = process.cwd();
        const lower = cwd[0].toLowerCase() + cwd.slice(1);
        const upper = cwd[0].toUpperCase() + cwd.slice(1);
        return {
          "absolute keys": {
            entrypoints: [lower + "\\\\entry.js"],
            files: {
              [upper + "\\\\entry.js"]: 'import { lib } from "./lib.js"; console.log("entry in memory", lib);',
              [lower + "\\\\lib.js"]: 'export const lib = "lib in memory";',
            },
          },
          "a relative key with backslashes": {
            entrypoints: [".\\\\virtual\\\\entry.js"],
            files: {
              ".\\\\virtual\\\\entry.js": 'import { lib } from "./lib.js"; console.log("entry in memory", lib);',
              ".\\\\virtual\\\\lib.js": 'export const lib = "lib in memory";',
            },
            outdir: "out",
          },
        };
      })()`,
      report => {
        expect(report).toEqual({
          "absolute keys": { logs: [], outputs: ["./entry.js"], found: ["entry in memory", "lib in memory"] },
          "a relative key with backslashes": {
            logs: [],
            outputs: ["out/virtual/entry.js"],
            found: ["entry in memory", "lib in memory"],
          },
        });
      },
      !isWindows,
    );

    // Server code that imports an in-memory page gets its manifest, as for a page on disk. The page
    // is in a directory that is not on disk. This test has child processes of its own: the built
    // server runs from the outdir.
    test("a built server that imports an in-memory page under a ./ key starts", async () => {
      using dir = tempDir("bundler-files-html-import-relative", {
        "build.mjs": `
          import { relative } from "node:path";
          const result = await Bun.build({
            entrypoints: ["./server.ts"],
            target: "bun",
            outdir: "./dist",
            files: {
              "./server.ts": 'import page from "./pages/index.html"; console.log("page:", page.index.replace(/[^a-z.]+/g, "/"));',
              "./pages/index.html": '<!DOCTYPE html><link rel="stylesheet" href="./page.css"><script src="./client.js"></script>',
              "./pages/page.css": "body { color: red }",
              "./pages/client.js": 'document.title = "client";',
            },
          });
          const paths = result.outputs.map(output => relative(process.cwd(), output.path).replaceAll("\\\\", "/"));
          console.log(JSON.stringify(paths.map(path => path.replace(/chunk-\\w+/, "chunk-[hash]")).sort()));
        `,
      });

      await using build = Bun.spawn({
        cmd: [bunExe(), "build.mjs"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const built = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect(built).toEqual([
        JSON.stringify(["dist/chunk-[hash].css", "dist/chunk-[hash].js", "dist/pages/index.html", "dist/server.js"]) +
          "\n",
        "",
        0,
      ]);

      await using server = Bun.spawn({
        cmd: [bunExe(), "server.js"],
        cwd: join(String(dir), "dist"),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const ran = await Promise.all([server.stdout.text(), server.stderr.text(), server.exited]);
      expect(ran).toEqual(["page: pages/index.html\n", "", 0]);
    });

    // This test is the last one: it closes the stdin of the child process.
    test("the child process that runs the builds exits cleanly", async () => {
      const running = (child ??= start());
      child = undefined;
      expect(await exited(running)).toEqual({ stdout: [], stderr: "", exitCode: 0 });
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

  test("in-memory imports are parsed with the build's jsx options", async () => {
    const result = await Bun.build({
      entrypoints: ["/app/entry.js"],
      files: {
        "/app/entry.js": `import "./child.jsx";`,
        "/app/child.jsx": `console.log(<div>child</div>);`,
      },
      jsx: { runtime: "classic", factory: "myFactory", fragment: "MyFragment" },
    });

    const output = await result.outputs[0].text();
    expect(output).toContain(`myFactory("div", null, "child")`);
    // In-memory files are labelled by their key, not by a path relative to cwd.
    expect(output).toContain("// /app/child.jsx");
  });

  test("import attributes pick the loader of in-memory imports", async () => {
    const result = await Bun.build({
      entrypoints: ["/app/entry.js"],
      files: {
        "/app/entry.js": `import data from "./data.json" with { type: "text" }; console.log(data);`,
        "/app/data.json": `{"answer": 42}`,
      },
    });

    expect(await result.outputs[0].text()).toContain(`'{"answer": 42}'`);
  });

  describe("HTML imports", () => {
    type Manifest = {
      index: string;
      files: Array<{ input: string; path: string; loader: string; isEntry: boolean; headers: Record<string, string> }>;
    };

    // Importing an .html file into a server build replaces the import with a
    // `__jsonParse("<manifest json>")` module describing the browser build of that page.
    function manifestsIn(serverCode: string): Manifest[] {
      return [...serverCode.matchAll(/__jsonParse\("(.+?)"\)/gs)].map(m => JSON.parse(JSON.parse(`"${m[1]}"`)));
    }

    const basename = (path: string) => path.split(/[\\/]/).pop()!;

    function outputText(result: Awaited<ReturnType<typeof Bun.build>>, path: string) {
      const output = result.outputs.find(o => basename(o.path) === basename(path));
      if (!output) throw new Error(`no output named ${basename(path)} in ${result.outputs.map(o => o.path)}`);
      return output.text();
    }

    // Kind and name of each output, without the content hash.
    function outputKinds(result: Awaited<ReturnType<typeof Bun.build>>) {
      return result.outputs.map(o => `${o.kind}:${basename(o.path).replace(/-[a-z0-9]{8}\./, ".")}`).sort();
    }

    const pageHtml = `<!DOCTYPE html><html><head><link rel="stylesheet" href="./page.css"></head><body><script src="./client.js"></script></body></html>`;
    const pageCss = `body { color: red }`;
    const clientJs = `document.title = "client";`;

    test("server build importing an in-memory .html file gets a manifest and a browser bundle", async () => {
      const result = await Bun.build({
        entrypoints: ["/app/server.js"],
        target: "bun",
        files: {
          "/app/server.js": `import page from "./page.html"; export default page;`,
          "/app/page.html": pageHtml,
          "/app/page.css": pageCss,
          "/app/client.js": clientJs,
        },
      });

      const server = await outputText(result, "server.js");
      expect(server).toStartWith("// @bun\n");
      expect(server).not.toMatch(/from "[^"]*page\.html"/);

      const [manifest, ...extra] = manifestsIn(server);
      expect(extra).toBeEmpty();
      expect(manifest.index).toMatch(/page\.html$/);
      // `input` is relative to the working directory here: no directory of the build is on disk.
      const input = expect.stringMatching(/(^|\/)app\/page\.html$/);
      expect(manifest.files.toSorted((a, b) => a.loader.localeCompare(b.loader))).toEqual([
        {
          input,
          path: expect.stringMatching(/\.css$/),
          loader: "css",
          isEntry: true,
          headers: { "etag": expect.any(String), "content-type": "text/css;charset=utf-8" },
        },
        {
          input,
          path: manifest.index,
          loader: "html",
          isEntry: true,
          headers: { "etag": expect.any(String), "content-type": "text/html;charset=utf-8" },
        },
        {
          input,
          path: expect.stringMatching(/\.js$/),
          loader: "js",
          isEntry: true,
          headers: { "etag": expect.any(String), "content-type": "text/javascript;charset=utf-8" },
        },
      ]);

      const { path: cssPath } = manifest.files.find(f => f.loader === "css")!;
      const { path: jsPath } = manifest.files.find(f => f.loader === "js")!;
      const html = await outputText(result, manifest.index);
      expect(html).toContain(basename(cssPath));
      expect(html).toContain(basename(jsPath));

      // The page's script is bundled for the browser even though the build targets bun.
      const client = await outputText(result, jsPath);
      expect(client).toContain(clientJs);
      expect(client).not.toContain("// @bun");
      expect(await outputText(result, cssPath)).toContain("color: red");
    });

    test("file on disk importing an in-memory .html file", async () => {
      using dir = tempDir("bundler-files-html-import", {
        "server.js": `import page from "./page.html"; export default page;`,
      });

      const result = await Bun.build({
        entrypoints: [`${dir}/server.js`],
        target: "bun",
        files: {
          [`${dir}/page.html`]: pageHtml,
          [`${dir}/page.css`]: pageCss,
          [`${dir}/client.js`]: clientJs,
        },
      });

      const [manifest, ...extra] = manifestsIn(await outputText(result, "server.js"));
      expect(extra).toBeEmpty();
      expect(manifest.index).toMatch(/page\.html$/);
      // A `files` key has "/" separators on Windows, where the root has "\\". The path code
      // finds no common root for the two forms, so `input` is the whole key.
      const input = isWindows ? `${dir}/page.html`.replaceAll("\\", "/") : "page.html";
      const byLoader = manifest.files.toSorted((a, b) => a.loader.localeCompare(b.loader));
      expect(byLoader.map(f => [f.input, f.loader])).toEqual([
        [input, "css"],
        [input, "html"],
        [input, "js"],
      ]);
      const { path: jsPath } = manifest.files.find(f => f.loader === "js")!;
      expect(await outputText(result, manifest.index)).toContain(basename(jsPath));
      expect(await outputText(result, jsPath)).toContain(clientJs);
    });

    // Without a manifest the bundle keeps an import of the page's path. No file is at
    // that path, so the bundle does not start.
    test.concurrent.each(["bun", "node"] as const)(
      "Bun.serve serves an in-memory page from a bundle for %s",
      async target => {
        using dir = tempDir("bundler-files-html-serve", {
          "server.js": `
            import page from "./page.html";
            const server = Bun.serve({
              port: 0,
              hostname: "127.0.0.1",
              routes: { "/": page },
              fetch: () => new Response("not found", { status: 404 }),
            });
            const html = await fetch(server.url);
            const text = await html.text();
            const script = await fetch(new URL(text.match(/<script[^>]* src="([^"]+)"/)[1], server.url));
            const stylesheet = await fetch(new URL(text.match(/<link[^>]* href="([^"]+)"/)[1], server.url));
            console.log(JSON.stringify({
              page: html.status,
              script: [script.status, (await script.text()).includes(${JSON.stringify(clientJs)})],
              stylesheet: [stylesheet.status, (await stylesheet.text()).includes("color: red")],
            }));
            await server.stop(true);
          `,
        });

        await Bun.build({
          entrypoints: [`${dir}/server.js`],
          target,
          outdir: `${dir}/dist`,
          files: {
            [`${dir}/page.html`]: pageHtml,
            [`${dir}/page.css`]: pageCss,
            [`${dir}/client.js`]: clientJs,
          },
        });

        // Bun.serve looks for the files of a manifest in the working directory.
        await using proc = Bun.spawn({
          cmd: [bunExe(), "server.js"],
          cwd: `${dir}/dist`,
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: `{"page":200,"script":[200,true],"stylesheet":[200,true]}\n`,
          stderr: "",
          exitCode: 0,
        });
      },
    );

    test("each in-memory .html file gets one manifest, however often it is imported", async () => {
      const result = await Bun.build({
        entrypoints: ["/app/server.js"],
        target: "bun",
        files: {
          "/app/server.js": `
            import home from "./home.html";
            import about from "./about.html";
            import { home as homeAgain } from "./routes.js";
            export default { home, about, homeAgain };
          `,
          "/app/routes.js": `export { default as home } from "./home.html";`,
          "/app/home.html": `<!DOCTYPE html><script src="./home.js"></script>`,
          "/app/about.html": `<!DOCTYPE html><script src="./about.js"></script>`,
          "/app/home.js": `console.log("home");`,
          "/app/about.js": `console.log("about");`,
        },
      });

      const server = await outputText(result, "server.js");
      expect(server).not.toMatch(/from "[^"]*\.html"/);

      const manifests = manifestsIn(server).toSorted((a, b) => a.index.localeCompare(b.index));
      expect(manifests.map(m => basename(m.index))).toEqual(["about.html", "home.html"]);
      for (const manifest of manifests) {
        expect(manifest.files.map(f => f.loader).toSorted()).toEqual(["html", "js"]);
        const { path: jsPath } = manifest.files.find(f => f.loader === "js")!;
        const pageName = basename(manifest.index).replace(".html", "");
        expect(await outputText(result, jsPath)).toContain(`console.log("${pageName}")`);
      }
    });

    // The loader of the import decides whether the file is a page, not its extension.
    describe("loader of the import", () => {
      function buildServer(importLine: string, files: Record<string, string>, loader?: Record<string, "text">) {
        return Bun.build({
          entrypoints: ["/app/server.js"],
          target: "bun",
          files: { "/app/server.js": `${importLine} export default page;`, "/app/client.js": clientJs, ...files },
          loader,
        });
      }
      const scriptHtml = `<!DOCTYPE html><script src="./client.js"></script>`;

      test.each([
        [`with { type: "text" }`, `import page from "./page.html" with { type: "text" };`, undefined],
        [`under loader: { ".html": "text" }`, `import page from "./page.html";`, { ".html": "text" } as const],
      ])("an .html import %s is the text of the file", async (_name, importLine, loader) => {
        const result = await buildServer(importLine, { "/app/page.html": scriptHtml }, loader);
        expect(outputKinds(result)).toEqual(["entry-point:server.js"]);
        const server = await outputText(result, "server.js");
        expect(server).toContain(`'${scriptHtml}'`);
        expect(manifestsIn(server)).toBeEmpty();
      });

      test(`an .html import with { type: "file" } is an asset`, async () => {
        const result = await buildServer(`import page from "./page.html" with { type: "file" };`, {
          "/app/page.html": scriptHtml,
        });
        expect(outputKinds(result)).toEqual(["asset:page.html", "entry-point:server.js"]);
        expect(manifestsIn(await outputText(result, "server.js"))).toBeEmpty();
      });

      test(`an import with { type: "html" } is a page`, async () => {
        const result = await buildServer(`import page from "./page.tpl" with { type: "html" };`, {
          "/app/page.tpl": scriptHtml,
        });
        expect(outputKinds(result).filter(output => output.endsWith(".html"))).toEqual(["entry-point:page.html"]);
        const [manifest, ...extra] = manifestsIn(await outputText(result, "server.js"));
        expect(extra).toBeEmpty();
        expect(manifest.files.map(f => f.loader).toSorted()).toEqual(["html", "js"]);
      });
    });

    // A url reference of a page (<link rel="manifest">) is copied to the output also
    // when its extension has a loader that parses the file.
    async function expectManifestJsonCopied(result: Awaited<ReturnType<typeof Bun.build>>) {
      const html = await outputText(result, "index.html");
      expect(html).toMatch(/href="[^"]*manifest-[a-zA-Z0-9]+\.json"/);

      const asset = result.outputs.find(o => o.kind === "asset");
      expect(asset?.path).toMatch(/manifest-[a-zA-Z0-9]+\.json$/);
      expect(await asset!.text()).toBe(`{"name":"app"}`);
    }

    test("assets referenced by an in-memory .html file are copied to the output", async () => {
      await expectManifestJsonCopied(
        await Bun.build({
          entrypoints: ["/app/index.html"],
          files: {
            "/app/index.html": `<!DOCTYPE html><link rel="manifest" href="./manifest.json">`,
            "/app/manifest.json": `{"name":"app"}`,
          },
        }),
      );
    });

    test("in-memory assets referenced by an .html file on disk are copied to the output", async () => {
      using dir = tempDir("bundler-files-html-asset", {
        "index.html": `<!DOCTYPE html><link rel="manifest" href="./manifest.json">`,
      });

      await expectManifestJsonCopied(
        await Bun.build({
          entrypoints: [`${dir}/index.html`],
          files: { [`${dir}/manifest.json`]: `{"name":"app"}` },
        }),
      );
    });

    test("a standalone HTML build inlines the assets of an in-memory .html file", async () => {
      const result = await Bun.build({
        entrypoints: ["/app/index.html"],
        compile: true,
        target: "browser",
        files: {
          "/app/index.html": `<!DOCTYPE html><link rel="manifest" href="./manifest.json">`,
          "/app/manifest.json": `{"name":"app"}`,
        },
      });

      expect(outputKinds(result)).toEqual(["entry-point:index.html"]);
      const json = Buffer.from(`{"name":"app"}`).toString("base64");
      expect(await result.outputs[0].text()).toContain(`href="data:application/json;charset=utf-8;base64,${json}"`);
    });
  });
});
