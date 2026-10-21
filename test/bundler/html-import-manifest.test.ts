import type { BunPlugin } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { SourceMapConsumer } from "source-map";
import { type BundlerTestBundleAPI, itBundled } from "./expectBundled";

interface ManifestFile {
  input?: string;
  path: string;
  loader: string;
  isEntry: boolean;
  headers: Record<string, string>;
}

interface Manifest {
  index: string;
  files: ManifestFile[];
}

/** The manifests embedded in a bundled server entry point, in import order. */
function readManifests(api: BundlerTestBundleAPI, file: string): Manifest[] {
  const manifests = [...api.readFile(file).matchAll(/__jsonParse\("(.+?)"\)/gs)].map(match =>
    JSON.parse(JSON.parse('"' + match[1] + '"')),
  );
  for (const manifest of manifests) {
    for (const { path } of manifest.files) {
      api.assertFileExists(join("out", path));
    }
  }
  return manifests;
}

/** `[input, loader]` of every manifest entry that came from a source file, sorted. */
function inputs(manifest: Manifest): [string, string][] {
  return manifest.files
    .filter(file => file.input !== undefined)
    .map((file): [string, string] => [file.input!, file.loader])
    .sort();
}

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
                "path": "./client-qjznw47b.js",
                "loader": "js",
                "isEntry": true,
                "headers": {
                  "etag": "l5IfNVyE54s",
                  "content-type": "text/javascript;charset=utf-8"
                }
              },
              {
                "input": "client.html",
                "path": "./client.html",
                "loader": "html",
                "isEntry": true,
                "headers": {
                  "etag": "xh1kdn7wbmI",
                  "content-type": "text/html;charset=utf-8"
                }
              },
              {
                "input": "client.html",
                "path": "./client-gsg59jv4.css",
                "loader": "css",
                "isEntry": true,
                "headers": {
                  "etag": "cJnwBSkS-4Q",
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
      let manifests: any[] = [];
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
                  "etag": "Dl7kT6q7eY4",
                },
                "input": "home.html",
                "isEntry": true,
                "loader": "js",
                "path": "./home-ey4favse.js",
              },
              {
                "headers": {
                  "content-type": "text/html;charset=utf-8",
                  "etag": "IhvRaM9jGDU",
                },
                "input": "home.html",
                "isEntry": true,
                "loader": "html",
                "path": "./home.html",
              },
              {
                "headers": {
                  "content-type": "text/css;charset=utf-8",
                  "etag": "hT1GudlsHgI",
                },
                "input": "home.html",
                "isEntry": true,
                "loader": "css",
                "path": "./home-5x6sscy2.css",
              },
            ],
            "index": "./home.html",
          },
          {
            "files": [
              {
                "headers": {
                  "content-type": "text/javascript;charset=utf-8",
                  "etag": "RCRrF1EbBvo",
                },
                "input": "about.html",
                "isEntry": true,
                "loader": "js",
                "path": "./about-44bqhv6t.js",
              },
              {
                "headers": {
                  "content-type": "text/html;charset=utf-8",
                  "etag": "2OGqRD6vx54",
                },
                "input": "about.html",
                "isEntry": true,
                "loader": "html",
                "path": "./about.html",
              },
              {
                "headers": {
                  "content-type": "text/css;charset=utf-8",
                  "etag": "ti_Q2k-EP3o",
                },
                "input": "about.html",
                "isEntry": true,
                "loader": "css",
                "path": "./about-pfgtf4zt.css",
              },
            ],
            "index": "./about.html",
          },
        ]
      `);
    },
  });

  // With code splitting, each dynamically imported module is an entry point of
  // its own, so the files only it reaches are not attributed to the HTML entry
  // point. The manifest has to follow the page's dynamic imports to find them.
  itBundled("html-import/splitting-lists-assets-of-lazy-chunks", {
    outdir: "out/",
    splitting: true,
    target: "bun",
    entryPoints: ["/server.js"],
    files: {
      "/server.js": `
        import html from "./client.html";
        import serverOnly from "./server-only.png";
        console.log(html.index, serverOnly);
      `,
      "/client.html": `<!DOCTYPE html><html><head><script type="module" src="./client.js"></script></head><body></body></html>`,
      "/client.js": `
        import("./lazy-a.js").then(m => console.log(m.default));
        import("./lazy-b.js").then(m => console.log(m.default));
      `,
      "/lazy-a.js": `
        import a from "./a.png";
        import shared from "./shared.js";
        export default [a, shared, import("./lazier.js")];
      `,
      "/lazy-b.js": `
        import shared from "./shared.js";
        export default shared;
      `,
      "/lazier.js": `
        import deep from "./deep.png";
        export default deep;
      `,
      "/shared.js": `
        import shared from "./shared.png";
        export default shared;
      `,
      "/a.png": "a",
      "/deep.png": "deep",
      "/shared.png": "shared",
      "/server-only.png": "server only",
    },

    onAfterBundle(api) {
      const [manifest] = readManifests(api, "out/server.js");
      expect(inputs(manifest)).toEqual([
        ["a.png", "file"],
        ["client.html", "html"],
        ["client.html", "js"],
        ["deep.png", "file"],
        ["lazier.js", "js"],
        ["lazy-a.js", "js"],
        ["lazy-b.js", "js"],
        ["shared.png", "file"],
      ]);
    },
  });

  // Each page only gets the chunks and assets its own code can load.
  itBundled("html-import/splitting-attributes-lazy-chunks-to-their-page", {
    outdir: "out/",
    splitting: true,
    target: "bun",
    entryPoints: ["/server.js"],
    files: {
      "/server.js": `
        import home from "./home.html";
        import about from "./about.html";
        console.log(home.index, about.index);
      `,
      "/home.html": `<!DOCTYPE html><html><head><script type="module" src="./home.js"></script></head><body></body></html>`,
      "/about.html": `<!DOCTYPE html><html><head><script type="module" src="./about.js"></script></head><body></body></html>`,
      "/home.js": `import("./home-lazy.js").then(m => console.log(m.default));`,
      "/about.js": `import("./about-lazy.js").then(m => console.log(m.default));`,
      "/home-lazy.js": `
        import img from "./home.png";
        export default img;
      `,
      "/about-lazy.js": `
        import img from "./about.png";
        export default img;
      `,
      "/home.png": "home",
      "/about.png": "about",
    },

    onAfterBundle(api) {
      const [home, about] = readManifests(api, "out/server.js");
      expect(inputs(home)).toEqual([
        ["home-lazy.js", "js"],
        ["home.html", "html"],
        ["home.html", "js"],
        ["home.png", "file"],
      ]);
      expect(inputs(about)).toEqual([
        ["about-lazy.js", "js"],
        ["about.html", "html"],
        ["about.html", "js"],
        ["about.png", "file"],
      ]);
    },
  });

  // Pages with identical stylesheets share one CSS output file. It is created
  // for whichever page comes first, but every page whose HTML links to it
  // needs it in its manifest.
  itBundled("html-import/shared-css-chunk-is-in-every-manifest", {
    outdir: "out/",
    target: "bun",
    entryPoints: ["/server.js"],
    files: {
      "/server.js": `
        import home from "./home.html";
        import about from "./about.html";
        console.log(home.index, about.index);
      `,
      "/home.html": `<!DOCTYPE html><html><head><link rel="stylesheet" href="./shared.css"></head><body>home</body></html>`,
      "/about.html": `<!DOCTYPE html><html><head><link rel="stylesheet" href="./shared.css"></head><body>about</body></html>`,
      "/shared.css": `body { margin: 0; }`,
    },

    onAfterBundle(api) {
      const [home, about] = readManifests(api, "out/server.js");
      const homeHref = api.readFile("out/home.html").match(/href="([^"]+)"/)![1];
      const aboutHref = api.readFile("out/about.html").match(/href="([^"]+)"/)![1];
      expect(aboutHref).toBe(homeHref);
      expect(home.files.filter(file => file.loader === "css").map(file => file.path)).toEqual([homeHref]);
      expect(about.files.filter(file => file.loader === "css").map(file => file.path)).toEqual([aboutHref]);
    },
  });

  // A page that server code imports is an entry point of the browser build.
  // The build numbers those pages in the order that the server code imports
  // them in. The first page that uses a shared chunk decides its name and the
  // order of its modules, so the number must not come from the directory of
  // the project or from the order that files are parsed in.
  describe("page order", () => {
    /**
     * Makes the bundler finish one file before it starts another: `held` waits
     * until the bundler asks for `after`, which only the other file imports.
     */
    function parseAfter(held: string, after: string): BunPlugin {
      return {
        name: "parse-after",
        setup(builder) {
          const asked = Promise.withResolvers<void>();
          builder.onLoad({ filter: /\.(ts|js|html)$/ }, async ({ path }) => {
            if (basename(path) === after) asked.resolve();
            if (basename(path) === held) await asked.promise;
            return undefined;
          });
        },
      };
    }

    /** The name and text of each output, in output order. */
    async function outputsOf(build: Bun.BuildOutput) {
      return Promise.all(build.outputs.map(async output => [basename(output.path), await output.text()] as const));
    }
    const pagesOf = (outputs: (readonly [string, string])[]) =>
      outputs.map(([name]) => name).filter(name => name.endsWith(".html"));

    // Page one runs p.js and then q.js, page two runs them the other way around.
    const twoPages = {
      "one.html": `<!DOCTYPE html><html><head><link rel="stylesheet" href="./shared.css"><script type="module" src="./one.js"></script></head><body></body></html>`,
      "two.html": `<!DOCTYPE html><html><head><link rel="stylesheet" href="./shared.css"><script type="module" src="./two.js"></script></head><body></body></html>`,
      "one.js": `import "./p.js"; import { q } from "./q.js"; console.log("one", q);`,
      "two.js": `import { q } from "./q.js"; import "./p.js"; console.log("two", q);`,
      "p.js": `globalThis.P = { v: "P" };`,
      "q.js": `export const q = "q" + (globalThis.P?.v ?? "-noP");`,
      "shared.css": `body { margin: 0; }`,
    };

    // Each page has a file of its own that imports it. The plugin makes the
    // bundler come to the pages in either order.
    test.concurrent("is the order of the imports, whichever page the bundler finds first", async () => {
      using dir = tempDir("html-import-two-importers", {
        "server.ts": `
          import { one } from "./routes/one.ts";
          import { two } from "./routes/two.ts";
          console.log(one.index, two.index);
        `,
        "routes/one.ts": `import one from "../one.html"; export { one };`,
        "routes/two.ts": `import two from "../two.html"; export { two };`,
        ...twoPages,
      });
      const build = async (found: "one" | "two") =>
        outputsOf(
          await Bun.build({
            entrypoints: [join(String(dir), "server.ts")],
            target: "bun",
            splitting: true,
            naming: { chunk: "[name]-[hash].[ext]" },
            plugins: [parseAfter(found === "one" ? "two.ts" : "one.ts", found + ".html")],
          }),
        );
      const [oneFirst, twoFirst] = [await build("one"), await build("two")];
      expect(twoFirst).toEqual(oneFirst);

      expect(pagesOf(oneFirst)).toEqual(["one.html", "two.html"]);
      // The chunk that both pages share runs its modules in the order of page one,
      // and the stylesheet that both pages share has the name of page one.
      const modules = oneFirst.map(([, text]) => [...text.matchAll(/^\/\/ .*\b([pq]\.js)$/gm)].map(match => match[1]));
      expect(modules.filter(names => names.length > 0)).toEqual([["p.js", "q.js"]]);
      expect(oneFirst.map(([name]) => name).filter(name => name.endsWith(".css"))).toEqual([
        expect.stringMatching(/^one-/),
      ]);
    });

    // One file imports every page. The names are not in the order of the
    // imports, and neither is any order that the paths of the pages give.
    test.concurrent("is the order of the imports in every directory", async () => {
      const pages = ["kiwi", "apple", "melon", "cherry", "fig", "banana", "grape"];
      const project = {
        "server.ts":
          pages.map(page => `import ${page} from "./${page}.html";`).join("\n") +
          `\nconsole.log(${pages.map(page => `${page}.index`).join(", ")});\n`,
        ...Object.fromEntries(
          pages.map(page => [`${page}.html`, `<!DOCTYPE html><html><body>${page}</body></html>`]),
        ),
      };
      const directories = ["first", "second-directory"];
      using dir = tempDir(
        "html-import-directories",
        Object.fromEntries(
          directories.flatMap(directory =>
            Object.entries(project).map(([name, contents]) => [directory + "/" + name, contents]),
          ),
        ),
      );
      const listings = await Promise.all(
        directories.map(async directory => {
          await using proc = Bun.spawn({
            cmd: [bunExe(), "build", "--target=bun", "--outdir=out", "./server.ts"],
            cwd: join(String(dir), directory),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          return { pages: [...stdout.matchAll(/(\w+)\.html/g)].map(match => match[1]), stderr, exitCode };
        }),
      );
      expect(listings).toEqual(directories.map(() => ({ pages, stderr: "", exitCode: 0 })));
    });

    // A page that is on the user's list keeps its place there.
    test.concurrent("a page that is also an entry point of the user is not numbered again", async () => {
      using dir = tempDir("html-import-page-is-entry-point", {
        "server.ts": `
          import one from "./one.html";
          import two from "./two.html";
          console.log(one.index, two.index);
        `,
        ...twoPages,
      });
      const build = await Bun.build({
        entrypoints: [join(String(dir), "two.html"), join(String(dir), "server.ts")],
        target: "bun",
      });
      const outputs = await outputsOf(build);
      expect(pagesOf(outputs)).toEqual(["two.html", "one.html"]);
      const server = outputs.find(([name]) => name === "server.js")![1];
      expect([...server.matchAll(/__jsonParse\(/g)]).toHaveLength(2);
    });

    // The page of an in-memory file is built like one that is on disk.
    test.concurrent("a page from the files option is built and has a manifest", async () => {
      const build = await Bun.build({
        entrypoints: ["/app/server.ts"],
        target: "bun",
        files: {
          "/app/server.ts": `import page from "./page.html"; console.log(page.index);`,
          "/app/page.html": `<!DOCTYPE html><html><head><script type="module" src="./client.ts"></script></head><body></body></html>`,
          "/app/client.ts": `console.log("client");`,
        },
      });
      const outputs = await outputsOf(build);
      const server = outputs.find(([name]) => name === "server.js")![1];
      const manifests: Manifest[] = [...server.matchAll(/__jsonParse\("(.+?)"\)/gs)].map(match =>
        JSON.parse(JSON.parse('"' + match[1] + '"')),
      );
      expect(manifests.map(manifest => manifest.files.map(file => file.loader).sort())).toEqual([["html", "js"]]);
      const names = outputs.map(([name]) => name);
      for (const file of manifests[0].files) {
        expect(names).toContain(basename(file.path));
      }
    });

    // The file that imports the page is not bundled when an import next to it
    // does not resolve. The build stops before it looks for the page.
    test.concurrent("a page next to an import that does not resolve fails the build", async () => {
      using dir = tempDir("html-import-unresolved", {
        "server.ts": `
          import one from "./one.html";
          import missing from "./missing.ts";
          console.log(one.index, missing);
        `,
        "one.html": `<!DOCTYPE html><html><body>one</body></html>`,
      });
      const build = await Bun.build({
        entrypoints: [join(String(dir), "server.ts")],
        target: "bun",
        throw: false,
      });
      expect({ success: build.success, logs: build.logs.map(log => log.message) }).toEqual({
        success: false,
        logs: [expect.stringContaining("missing.ts")],
      });
    });

    // One file imports the page with `import` and another with `import()`. The
    // bundle is the same and runs, whichever of the two the bundler parses first.
    test.concurrent("a page with a static and a dynamic import is the same whichever is parsed first", async () => {
      using dir = tempDir("html-import-static-and-dynamic", {
        "server.ts": `
          import { page } from "./static.ts";
          import { load } from "./dynamic.ts";
          console.log(page.index, (await load()).default.index);
        `,
        "static.ts": `import "./static-dep.ts"; import page from "./page.html"; export { page };`,
        "dynamic.ts": `import "./dynamic-dep.ts"; export const load = () => import("./page.html");`,
        "static-dep.ts": `export {};`,
        "dynamic-dep.ts": `export {};`,
        "page.html": `<!DOCTYPE html><html><body>page</body></html>`,
      });
      const build = async (first: "static" | "dynamic") => {
        const outdir = join(String(dir), "out-" + first);
        const build = await Bun.build({
          entrypoints: [join(String(dir), "server.ts")],
          outdir,
          target: "bun",
          plugins: [parseAfter(first === "static" ? "dynamic.ts" : "static.ts", first + "-dep.ts")],
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), join(outdir, "server.js")],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { outputs: await outputsOf(build), stdout, stderr, exitCode };
      };
      const [staticFirst, dynamicFirst] = [await build("static"), await build("dynamic")];
      expect(dynamicFirst).toEqual(staticFirst);
      expect({ ...staticFirst, outputs: undefined }).toEqual({
        outputs: undefined,
        stdout: "./page.html ./page.html\n",
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // The import of a page is an import like any other in the metafile.
  test("html-import/kind-of-the-import-in-the-metafile", async () => {
    using dir = tempDir("html-import-metafile-kind", {
      "server.ts": `import page from "./page.html"; console.log(page.index);`,
      "page.html": `<!DOCTYPE html><html><body>page</body></html>`,
    });
    const build = await Bun.build({
      entrypoints: [join(String(dir), "server.ts")],
      target: "bun",
      metafile: true,
    });
    const inputs = Object.entries(build.metafile!.inputs);
    const [, server] = inputs.find(([file]) => basename(file) === "server.ts")!;
    expect(server.imports.map(({ path, kind }) => ({ path: basename(path), kind }))).toEqual([
      { path: "page.html", kind: "import-statement" },
    ]);
  });

  // The manifest module is a module like any other: `import()` gives its
  // namespace and `require()` gives the manifest, as they do when Bun runs the
  // server code without a build.
  itBundled("html-import/dynamic-import-of-a-page", {
    outdir: "out/",
    target: "bun",
    entryPoints: ["/server.js"],
    files: {
      "/server.js": `
        const page = await import("./page.html");
        console.log(page.default.index, Array.isArray(page.default.files));
      `,
      "/page.html": `<!DOCTYPE html><html><body>page</body></html>`,
    },
    run: { stdout: "./page.html true" },
  });
  itBundled("html-import/require-of-a-page", {
    outdir: "out/",
    target: "bun",
    entryPoints: ["/server.js"],
    files: {
      "/server.js": `
        const page = require("./page.html");
        console.log(page.index, Array.isArray(page.files), typeof page.default);
      `,
      "/page.html": `<!DOCTYPE html><html><body>page</body></html>`,
    },
    run: { stdout: "./page.html true undefined" },
  });

  // Past 127 entry points the entry bits switch to a heap-allocated bitset.
  // The manifest has to size its own bitset from the same entry point list as
  // the files (which, with splitting, includes the dynamic imports), or the
  // two never intersect and every asset goes missing.
  {
    const lazyCount = 130;
    const files: Record<string, string> = {
      "/server.js": `
        import html from "./client.html";
        console.log(html.index);
      `,
      "/client.html": `<!DOCTYPE html><html><head><script type="module" src="./client.js"></script></head><body></body></html>`,
      "/icon.png": "icon",
    };
    let client = `import icon from "./icon.png";\nconsole.log(icon);\n`;
    for (let i = 0; i < lazyCount; i++) {
      files[`/lazy-${i}.js`] = `export default ${i};`;
      client += `import("./lazy-${i}.js").then(m => console.log(m.default));\n`;
    }
    files["/client.js"] = client;

    itBundled("html-import/splitting-more-than-127-entry-points", {
      outdir: "out/",
      splitting: true,
      target: "bun",
      entryPoints: ["/server.js"],
      files,

      onAfterBundle(api) {
        const [manifest] = readManifests(api, "out/server.js");
        const listed = inputs(manifest);
        expect(listed).toContainEqual(["icon.png", "file"]);
        expect(listed).toContainEqual(["client.html", "html"]);
        expect(listed).toContainEqual(["client.html", "js"]);
        expect(listed.filter(([input]) => input.startsWith("lazy-"))).toHaveLength(lazyCount);
      },
    });
  }

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

  // The manifest JSON is spliced into the chunk in place of a 25-byte
  // placeholder after the source map was generated, so the map has to be
  // shifted by the size difference. With whitespace minified, the rest of the
  // chunk shares the manifest's line, so every mapping after it depends on
  // that shift accounting for the full length of each spliced manifest.
  test("html-import/source-map-columns-after-manifest", async () => {
    const source = [
      `import home from "./home.html";`,
      `import about from "./about.html";`,
      `function manifests() { return [home, about]; }`,
      `console.log(manifests());`,
      ``,
    ].join("\n");
    await using dir = tempDir("html-import-sourcemap", {
      "server.ts": source,
      "home.html": `<!doctype html><script type="module" src="./home.ts"></script>`,
      "about.html": `<!doctype html><script type="module" src="./about.ts"></script>`,
      "home.ts": `console.log("home");`,
      "about.ts": `console.log("about");`,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "server.ts")],
      outdir: join(dir, "out"),
      target: "bun",
      sourcemap: "external",
      minify: { whitespace: true },
    });
    expect(build.logs).toBeEmpty();

    const generated = await build.outputs.find(o => o.path.endsWith("server.js"))!.text();
    const map = await build.outputs.find(o => o.path.endsWith("server.js.map"))!.json();

    // 1-based line, 0-based column, as `source-map` reports positions.
    const lineColumn = (text: string, index: number) => {
      expect(index).not.toBe(-1);
      const before = text.slice(0, index);
      return { line: before.split("\n").length, column: index - (before.lastIndexOf("\n") + 1) };
    };

    // Both manifests and the user code end up on one generated line.
    const manifestLine = lineColumn(generated, generated.indexOf("__jsonParse(")).line;
    expect(lineColumn(generated, generated.lastIndexOf("__jsonParse(")).line).toBe(manifestLine);
    expect(lineColumn(generated, generated.indexOf("function manifests(")).line).toBe(manifestLine);

    await SourceMapConsumer.with(map, null, consumer => {
      const positions = ["function manifests(", "return[", "console.log("].map(token => {
        const mapped = consumer.originalPositionFor(lineColumn(generated, generated.indexOf(token)));
        return { token, source: mapped.source?.split(/[\\/]/).pop(), line: mapped.line, column: mapped.column };
      });
      expect(positions).toEqual([
        { token: "function manifests(", source: "server.ts", ...lineColumn(source, source.indexOf("function ")) },
        { token: "return[", source: "server.ts", ...lineColumn(source, source.indexOf("return ")) },
        { token: "console.log(", source: "server.ts", ...lineColumn(source, source.indexOf("console.")) },
      ]);
    });
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
