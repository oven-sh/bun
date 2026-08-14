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
});
