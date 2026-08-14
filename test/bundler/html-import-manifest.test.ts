import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { itBundled } from "./expectBundled";

describe.concurrent("bundler", () => {
  // Test HTML import manifest with enhanced metadata
  itBundled("html-import/manifest-with-metadata", {
    outdir: "out/",
    files: {
      "/server.js": `
import html from "./client.html";

if (!html.files.find(a => a.path === html.index)) {
  throw new Error("Bad file");
}

console.log(JSON.stringify(html, null, 2));

`,
      "/client.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./styles.css">
    <script src="./client.js"></script>
  </head>
  <body>
    <h1>Client HTML</h1>
  </body>
</html>`,
      "/styles.css": `
body {
  background-color: #f0f0f0;
  margin: 0;
  padding: 20px;
}
h1 {
  color: #333;
}`,
      "/client.js": `
import favicon from './favicon.png';
console.log("Client script loaded");
window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM ready');
});
console.log(favicon);
`,
      "/favicon.png": Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG header
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52, // IHDR chunk
        0x00,
        0x00,
        0x00,
        0x10,
        0x00,
        0x00,
        0x00,
        0x10, // 16x16
        0x08,
        0x02,
        0x00,
        0x00,
        0x00,
        0x90,
        0x91,
        0x68, // 8-bit RGB
        0x36,
        0x00,
        0x00,
        0x00,
        0x00,
        0x49,
        0x45,
        0x4e, // IEND chunk
        0x44,
        0xae,
        0x42,
        0x60,
        0x82,
      ]),
    },
    entryPoints: ["/server.js"],
    target: "bun",

    run: {
      validate({ stdout, stderr }) {
        expect(stdout).toMatchInlineSnapshot(`
          "{
            "index": "./client.html",
            "files": [
              {
                "input": "client.html",
                "path": "./client-n6nsv5xk.js",
                "loader": "js",
                "isEntry": true,
                "headers": {
                  "etag": "NYY12TsFXfM",
                  "content-type": "text/javascript;charset=utf-8"
                }
              },
              {
                "input": "client.html",
                "path": "./client.html",
                "loader": "html",
                "isEntry": true,
                "headers": {
                  "etag": "n-UhEHjBQQc",
                  "content-type": "text/html;charset=utf-8"
                }
              },
              {
                "input": "client.html",
                "path": "./client-0z58sk45.css",
                "loader": "css",
                "isEntry": true,
                "headers": {
                  "etag": "4B9l6JnTRAU",
                  "content-type": "text/css;charset=utf-8"
                }
              },
              {
                "input": "favicon.png",
                "path": "./favicon-wjepk3hq.png",
                "loader": "file",
                "isEntry": false,
                "headers": {
                  "etag": "fFLOVvPDEZc",
                  "content-type": "image/png"
                }
              }
            ]
          }
          "
        `);
      },
    },
  });

  // Test that non-JS/CSS assets referenced directly in HTML (favicon, images)
  // are included in the manifest files array (regression test for #27820)
  itBundled("html-import/html-referenced-assets-in-manifest", {
    outdir: "out/",
    files: {
      "/server.js": `
import html from "./index.html";

// Verify the favicon asset is in the manifest files array
const faviconEntry = html.files.find(f => f.path.includes("favicon") && f.path.endsWith(".svg"));
if (!faviconEntry) {
  throw new Error("favicon.svg not found in manifest files: " + JSON.stringify(html.files.map(f => f.path)));
}

console.log(JSON.stringify(html, null, 2));
`,
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <title>Test</title>
  </head>
  <body>
    <h1>Favicon Test</h1>
    <script type="module" src="./app.ts"></script>
  </body>
</html>`,
      "/app.ts": `console.log("app loaded");`,
      "/favicon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">T</text></svg>`,
    },
    entryPoints: ["/server.js"],
    target: "bun",

    run: {
      validate({ stdout }) {
        const manifest = JSON.parse(stdout);
        // Verify manifest has a favicon entry with correct metadata
        const favicon = manifest.files.find((f: any) => f.path.includes("favicon"));
        expect(favicon).toBeDefined();
        expect(favicon.loader).toBe("file");
        expect(favicon.headers["content-type"]).toBe("image/svg+xml");
      },
    },

    onAfterBundle(api) {
      const serverCode = api.readFile("out/server.js");
      const match = serverCode.match(/__jsonParse\("(.+?)"\)/s);
      expect(match).not.toBeNull();
      const manifest = JSON.parse(JSON.parse('"' + match![1] + '"'));
      // The favicon.svg should be in the files array
      const faviconFile = manifest.files.find((f: any) => f.path.includes("favicon"));
      expect(faviconFile).toBeDefined();
      expect(faviconFile.loader).toBe("file");
      expect(faviconFile.headers["content-type"]).toBe("image/svg+xml");
    },
  });

  // Test manifest with multiple HTML imports
  itBundled("html-import/multiple-manifests", {
    outdir: "out/",
    backend: "cli",
    files: {
      "/server.js": `
import homeHtml from "./home.html";
import aboutHtml from "./about.html";
console.log("Home manifest:", homeHtml);
console.log("About manifest:", aboutHtml);
`,
      "/home.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./home.css">
    <script src="./home.js"></script>
  </head>
  <body>
    <h1>Home Page</h1>
  </body>
</html>`,
      "/about.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./about.css">
    <script src="./about.js"></script>
  </head>
  <body>
    <h1>About Page</h1>
  </body>
</html>`,
      "/home.css": "body { background: #fff; }",
      "/home.js": "console.log('Home page');",
      "/about.css": "body { background: #f0f0f0; }",
      "/about.js": "console.log('About page');",
    },
    entryPoints: ["/server.js"],
    target: "bun",

    onAfterBundle(api) {
      const serverCode = api.readFile("out/server.js");

      // The manifests are embedded as escaped JSON strings in __jsonParse calls
      const manifestMatches = [...serverCode.matchAll(/__jsonParse\("(.+?)"\)/gs)];
      expect(manifestMatches.length).toBe(2);
      let manifests = [];
      for (const match of manifestMatches) {
        // The captured group contains the escaped JSON string
        const escapedJson = match[1];
        // Parse the escaped JSON string
        const manifest = JSON.parse(JSON.parse('"' + escapedJson + '"'));
        manifests.push(manifest);
        expect(manifest.index).toBeDefined();
        expect(manifest.files).toBeDefined();
        expect(Array.isArray(manifest.files)).toBe(true);

        // Each manifest should have HTML, JS, and CSS
        const loaders = manifest.files.map((f: any) => f.loader);
        expect(loaders).toContain("html");
        expect(loaders).toContain("js");
        expect(loaders).toContain("css");

        // All files should have enhanced metadata
        for (const file of manifest.files) {
          expect(file).toHaveProperty("headers");
          expect(file).toHaveProperty("isEntry");
          expect(file.headers).toHaveProperty("etag");
          expect(file.headers).toHaveProperty("content-type");
        }
      }

      expect(manifests).toMatchInlineSnapshot(`
        [
          {
            "files": [
              {
                "headers": {
                  "content-type": "text/javascript;charset=utf-8",
                  "etag": "xAZoSOIIQJ8",
                },
                "input": "home.html",
                "isEntry": true,
                "loader": "js",
                "path": "./home-4688280z.js",
              },
              {
                "headers": {
                  "content-type": "text/html;charset=utf-8",
                  "etag": "uIE6dXgvM-4",
                },
                "input": "home.html",
                "isEntry": true,
                "loader": "html",
                "path": "./home.html",
              },
              {
                "headers": {
                  "content-type": "text/css;charset=utf-8",
                  "etag": "ZTZtbLd3364",
                },
                "input": "home.html",
                "isEntry": true,
                "loader": "css",
                "path": "./home-5pdcqqze.css",
              },
            ],
            "index": "./home.html",
          },
          {
            "files": [
              {
                "headers": {
                  "content-type": "text/javascript;charset=utf-8",
                  "etag": "INLwcb4oxw8",
                },
                "input": "about.html",
                "isEntry": true,
                "loader": "js",
                "path": "./about-0jghy87f.js",
              },
              {
                "headers": {
                  "content-type": "text/html;charset=utf-8",
                  "etag": "ZpqlG2wo2xo",
                },
                "input": "about.html",
                "isEntry": true,
                "loader": "html",
                "path": "./about.html",
              },
              {
                "headers": {
                  "content-type": "text/css;charset=utf-8",
                  "etag": "x6pW8hAzxGI",
                },
                "input": "about.html",
                "isEntry": true,
                "loader": "css",
                "path": "./about-7apjgk42.css",
              },
            ],
            "index": "./about.html",
          },
        ]
      `);
    },
  });

  // The HTML chunk's etag must change when only a referenced JS/CSS chunk
  // changes; otherwise the browser 304s to a body that points at chunks the
  // server no longer has.
  test("html-import/etag-changes-with-referenced-chunks", async () => {
    await using dir = tempDir("html-etag", {
      "server.ts": `import m from "./index.html"; console.log(JSON.stringify(m));`,
      "index.html": `<!doctype html><script type="module" src="./app.ts"></script>`,
      "app.ts": `console.log(1);`,
    });

    async function buildAndReadManifest() {
      const out = join(dir, "out");
      const r = await Bun.build({ entrypoints: [join(dir, "server.ts")], outdir: out, target: "bun" });
      expect(r.success).toBe(true);
      const js = readFileSync(join(out, "server.js"), "utf8");
      const m = js.match(/__jsonParse\("(.+?)"\)/s)!;
      return JSON.parse(JSON.parse('"' + m[1] + '"')) as {
        files: Array<{ loader: string; path: string; headers: { etag: string } }>;
      };
    }

    const a = await buildAndReadManifest();
    writeFileSync(join(dir, "app.ts"), `console.log(2);`);
    const b = await buildAndReadManifest();

    const htmlA = a.files.find(f => f.loader === "html")!;
    const htmlB = b.files.find(f => f.loader === "html")!;
    const jsA = a.files.find(f => f.loader === "js")!;
    const jsB = b.files.find(f => f.loader === "js")!;

    expect(jsA.path).not.toBe(jsB.path);
    expect(htmlA.path).toBe(htmlB.path);
    expect(htmlA.headers.etag).not.toBe(htmlB.headers.etag);
  });

  // The server side and the browser side of a build each need their own copy of
  // the bundler runtime (`__toESM`, `__require`, ...): the two are built for
  // different targets and must not share output files. These tests build
  // browser code that needs runtime helpers and check that what the server
  // serves never contains server code, and vice versa.
  type ManifestFile = { input?: string; path: string; loader: string; isEntry: boolean };
  type Manifest = { index: string; files: ManifestFile[] };

  async function buildServerWithHtmlImport(dir: string, options: Partial<Parameters<typeof Bun.build>[0]> = {}) {
    const result = await Bun.build({
      entrypoints: [join(dir, "server.ts")],
      outdir: join(dir, "out"),
      target: "bun",
      ...options,
    });
    expect(result.logs).toBeEmpty();
    expect(result.success).toBe(true);

    const outputs = new Map<string, string>();
    for (const output of result.outputs) {
      if (output.path.endsWith(".js")) {
        outputs.set("./" + basename(output.path), await output.text());
      }
    }
    const server = outputs.get("./server.js")!;
    const manifests = [...server.matchAll(/__jsonParse\("(.+?)"\)/gs)].map(
      m => JSON.parse(JSON.parse('"' + m[1] + '"')) as Manifest,
    );
    return { outputs, server, manifests };
  }

  function importedChunks(code: string): string[] {
    return [...code.matchAll(/^import[^;]*?"(\.\/[^"]+\.js)"/gm)].map(m => m[1]);
  }

  // Browser runtime: `__require` is a shim around a global `require`. Server
  // runtime: `__require = import.meta.require`, and the chunk is tagged `// @bun`.
  const browserRequireShim = "Dynamic require of";

  const runtimeUsers = {
    // A CommonJS dependency makes the importer need `__toESM` and `__commonJS`;
    // a `require()` of something that is not bundled makes it need `__require`.
    "client.html": `<!doctype html><script type="module" src="./client.js"></script>`,
    "client.js": `
      import dep from "./dep.cjs";
      globalThis.load = name => require(name);
      console.log(dep);
    `,
    "dep.cjs": `module.exports = "dep";`,
  };

  test("html-import/browser-chunks-get-the-browser-runtime", async () => {
    await using dir = tempDir("html-import-runtime", {
      "server.ts": `import html from "./client.html"; console.log(JSON.stringify(html));`,
      ...runtimeUsers,
    });
    const { outputs, server, manifests } = await buildServerWithHtmlImport(String(dir));

    const [manifest] = manifests;
    const clientChunk = manifest.files.find(f => f.input === "client.html" && f.loader === "js")!;
    const client = outputs.get(clientChunk.path)!;

    // Browser output is built from the browser runtime.
    expect(client).toContain(browserRequireShim);
    expect(client).not.toContain("import.meta.require");
    expect(client).not.toContain("// @bun");
    // Helpers only the server uses do not leak into the browser output.
    expect(client).not.toContain("__jsonParse");

    // The server entry keeps its own runtime, and does not carry the browser's helpers.
    expect(server).toStartWith("// @bun\n");
    expect(server).toContain("var __jsonParse");
    expect(server).not.toContain("__commonJS");
    expect(server).not.toContain(browserRequireShim);
    expect(importedChunks(server)).toEqual([]);
  });

  test("html-import/splitting-does-not-share-the-runtime-chunk-between-server-and-browser", async () => {
    await using dir = tempDir("html-import-runtime-splitting", {
      "server.ts": `import html from "./client.html"; console.log(JSON.stringify(html));`,
      ...runtimeUsers,
      // A second browser entry point that needs the runtime too, so the browser
      // side's runtime goes into a chunk shared by the two browser entries.
      "client.js": runtimeUsers["client.js"] + `import("./lazy.js").then(m => console.log(m.default));`,
      "lazy.js": `import other from "./other.cjs"; export default other;`,
      "other.cjs": `module.exports = "other";`,
    });
    const { outputs, server, manifests } = await buildServerWithHtmlImport(String(dir), { splitting: true });

    const [manifest] = manifests;
    const browserFiles = manifest.files.filter(f => f.loader === "js").map(f => f.path);
    const sharedChunks = manifest.files.filter(f => f.loader === "js" && !f.isEntry).map(f => f.path);
    expect(sharedChunks).toHaveLength(1);
    const [runtimeChunk] = sharedChunks;

    // Everything the manifest tells the server to serve is browser code.
    for (const path of browserFiles) {
      const code = outputs.get(path)!;
      expect(code).not.toContain("// @bun");
      expect(code).not.toContain("import.meta.require");
      expect(code).not.toContain("__jsonParse");
      for (const imported of importedChunks(code)) {
        expect(browserFiles).toContain(imported);
      }
    }
    expect(outputs.get(runtimeChunk)!).toContain(browserRequireShim);

    // The server entry is the only server-side file: its runtime helper is
    // inlined, and it imports nothing the browser uses.
    expect(server).toStartWith("// @bun\n");
    expect(server).toContain("var __jsonParse");
    expect(server).not.toContain("__commonJS");
    expect(importedChunks(server)).toEqual([]);

    // No output file straddles the two sides.
    for (const path of outputs.keys()) {
      expect(path === "./server.js" || browserFiles.includes(path)).toBe(true);
    }
  });

  test("html-import/runtime-chunk-shared-by-several-html-imports-stays-browser-only", async () => {
    const page = (script: string) => `<!doctype html><script type="module" src="./${script}"></script>`;
    const usesCjs = (dep: string) => `import dep from "./${dep}"; console.log(dep);`;
    await using dir = tempDir("html-import-runtime-multi", {
      "server.ts": `
        import home from "./home.html";
        import about from "./about.html";
        console.log(JSON.stringify([home, about]));
      `,
      "home.html": page("home.js"),
      "about.html": page("about.js"),
      "home.js": usesCjs("home-dep.cjs"),
      "about.js": usesCjs("about-dep.cjs"),
      "home-dep.cjs": `module.exports = "home";`,
      "about-dep.cjs": `module.exports = "about";`,
    });
    const { outputs, server, manifests } = await buildServerWithHtmlImport(String(dir), { splitting: true });
    expect(manifests).toHaveLength(2);

    // Both pages need `__toESM`/`__commonJS`, so the browser runtime is a chunk
    // shared by the two pages and listed in both manifests.
    const [homeShared, aboutShared] = manifests.map(m =>
      m.files.filter(f => f.loader === "js" && !f.isEntry).map(f => f.path),
    );
    expect(homeShared).toHaveLength(1);
    expect(aboutShared).toEqual(homeShared);
    const runtimeChunk = outputs.get(homeShared[0])!;
    expect(runtimeChunk).toContain("__commonJS");
    expect(runtimeChunk).not.toContain("// @bun");
    expect(runtimeChunk).not.toContain("__jsonParse");

    // The server's two manifests are parsed with the server's own `__jsonParse`.
    expect(server).toStartWith("// @bun\n");
    expect(server).toContain("var __jsonParse");
    expect(importedChunks(server)).toEqual([]);
  });

  // Test that import with {type: 'file'} still works as a file import
  itBundled("html-import/with-type-file-attribute", {
    outdir: "out/",
    backend: "cli",
    files: {
      "/entry.js": `
import htmlUrl from "./page.html" with { type: 'file' };
import htmlManifest from "./index.html";

// Test that htmlUrl is a string (file path)
if (typeof htmlUrl !== 'string') {
  throw new Error("Expected htmlUrl to be a string, got " + typeof htmlUrl);
}

// Test that htmlManifest is an object with expected properties
if (typeof htmlManifest !== 'object' || !htmlManifest.index || !Array.isArray(htmlManifest.files)) {
  throw new Error("Expected htmlManifest to be an object with index and files array");
}

console.log("✓ File import returned URL:", htmlUrl);
console.log("✓ HTML import returned manifest with", htmlManifest.files.length, "files");
console.log("✓ Both import types work correctly");
`,
      "/page.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>Page imported as file</title>
  </head>
  <body>
    <h1>This HTML is imported with type: 'file'</h1>
  </body>
</html>`,
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./styles.css">
  </head>
  <body>
    <h1>Test Page</h1>
  </body>
</html>`,
      "/styles.css": `body { background: #fff; }`,
    },
    entryPoints: ["/entry.js"],
    target: "bun",

    run: {
      validate({ stdout }) {
        expect(stdout).toContain("✓ File import returned URL:");
        expect(stdout).toContain("✓ HTML import returned manifest with");
        expect(stdout).toContain("✓ Both import types work correctly");
      },
    },

    onAfterBundle(api) {
      // Check that the generated code correctly handles both import types
      const entryCode = api.readFile("out/entry.js");

      // Should have a file import for page.html
      expect(entryCode).toContain('var page_default = "./page-');
      expect(entryCode).toContain('.html";');

      // Should have a manifest import for index.html
      expect(entryCode).toContain('__jsonParse("');
      expect(entryCode).toContain('\\\"index\\\":\\\"./index.html\\\"');
      expect(entryCode).toContain('\\\"files\\\":[');
    },
  });
});
