import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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
      expect(manifest.files.toSorted((a, b) => a.loader.localeCompare(b.loader))).toEqual([
        {
          input: expect.stringContaining("page.html"),
          path: expect.stringMatching(/\.css$/),
          loader: "css",
          isEntry: true,
          headers: { "etag": expect.any(String), "content-type": "text/css;charset=utf-8" },
        },
        {
          input: expect.stringContaining("page.html"),
          path: manifest.index,
          loader: "html",
          isEntry: true,
          headers: { "etag": expect.any(String), "content-type": "text/html;charset=utf-8" },
        },
        {
          input: expect.stringContaining("page.html"),
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
      expect(manifest.files.map(f => f.loader).toSorted()).toEqual(["css", "html", "js"]);
      const { path: jsPath } = manifest.files.find(f => f.loader === "js")!;
      expect(await outputText(result, manifest.index)).toContain(basename(jsPath));
      expect(await outputText(result, jsPath)).toContain(clientJs);
    });

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

    test("assets referenced by an in-memory .html file are copied to the output", async () => {
      const result = await Bun.build({
        entrypoints: ["/app/index.html"],
        files: {
          "/app/index.html": `<!DOCTYPE html><link rel="manifest" href="./manifest.json">`,
          "/app/manifest.json": `{"name":"app"}`,
        },
      });

      const html = await outputText(result, "index.html");
      expect(html).toMatch(/href="[^"]*manifest-[a-zA-Z0-9]+\.json"/);

      const asset = result.outputs.find(o => o.kind === "asset");
      expect(asset?.path).toMatch(/manifest-[a-zA-Z0-9]+\.json$/);
      expect(await asset!.text()).toBe(`{"name":"app"}`);
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

    function start() {
      root ??= tempDir("bundler-files-relative-keys", {
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
            for (const [build, { chdir, chdirAfterCall, ...options }] of Object.entries(builds())) {
              if (chdir) process.chdir(chdir);
              const cwd = process.cwd();
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
    // not a string literal.
    function buildsIn(
      name: string,
      files: Record<string, string>,
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

    // Nothing is on disk. The entry imports the other key as "./lib.js".
    buildsIn(
      "an entry point names a key by text or by path",
      {},
      ["entry in memory", "lib in memory"],
      `(() => {
        const build = entry => ({
          entrypoints: [entry],
          files: {
            "./entry.js": 'import { lib } from "./lib.js"; console.log("entry in memory", lib);',
            "./lib.js": 'export const lib = "lib in memory";',
          },
        });
        return {
          "./entry.js": build("./entry.js"),
          "entry.js": build("entry.js"),
          absolute: build(abs("entry.js")),
          // A relative entry point is a path from the cwd for an absolute key too.
          "./entry.js with absolute keys": {
            entrypoints: ["./entry.js"],
            files: {
              [abs("entry.js")]: 'import { lib } from "./lib.js"; console.log("entry in memory", lib);',
              [abs("lib.js")]: 'export const lib = "lib in memory";',
            },
          },
        };
      })()`,
      report => {
        const inMemory = { logs: [], outputs: ["./entry.js"], found: ["entry in memory", "lib in memory"] };
        expect(report).toEqual({
          "./entry.js": inMemory,
          "entry.js": inMemory,
          absolute: inMemory,
          "./entry.js with absolute keys": inMemory,
        });
      },
    );

    {
      const build = (entry: string) => `{
        entrypoints: [${entry}],
        files: { "./src/entry.ts": 'console.log("entry from memory");' },
      }`;
      // An entry point that is the path of a key, written another way, is for
      // the disk resolver when the file is on disk. The parse task reads the key.
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
            // Every entrypoint is written like a key, so the root is the cwd.
            "./src/entry.ts": { logs: [], outputs: ["src/entry.js"], found: ["entry from memory"] },
            // If not, the root is the directory of the entry point, as for an entry point on disk.
            "src/entry.ts": { logs: [], outputs: ["./entry.js"], found: ["entry from memory"] },
            "absolute": { logs: [], outputs: ["./entry.js"], found: ["entry from memory"] },
            "the tsconfig.json of the file applies": page,
            "the tsconfig.json of the file applies, absolute key": page,
          });
        },
      );
    }

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
        // The key is one/src/config.ts, not other/src/config.ts.
        "process.chdir() after the call": {
          chdir: "one",
          chdirAfterCall: "../other",
          entrypoints: [abs("one/src/index.ts")],
          files: { "./src/config.ts": 'export const config = "config from memory";' },
        },
      }`,
      report => {
        const inMemory = { logs: [], outputs: ["./index.js"], found: ["config from memory"] };
        expect(report).toEqual({ "the directory of the call": inMemory, "process.chdir() after the call": inMemory });
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

    // Debug builds assert that the path of an entry point is absolute. A name is not a path.
    buildsIn(
      "a key that is a name can be an entry point",
      {},
      ["entry in memory"],
      `{
        "a scheme": {
          entrypoints: ["virtual:entry.ts"],
          files: { "virtual:entry.ts": 'console.log("entry in memory");' },
        },
        "a file name": {
          entrypoints: ["worker.ts"],
          files: { "worker.ts": 'console.log("entry in memory");' },
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

    // This test is the last one: it closes the stdin of the child process.
    test("the child process that runs the builds exits cleanly", async () => {
      const running = (child ??= start());
      child = undefined;
      expect(await exited(running)).toEqual({ stdout: [], stderr: "", exitCode: 0 });
    });
  });
});
