import { describe, expect } from "bun:test";
import { runInNewContext } from "node:vm";
import { type BundlerTestBundleAPI, itBundled } from "./expectBundled";

// A dependency whose published dist ships esbuild's CommonJS interop prelude. In a browser the
// `typeof require` guard falls through to the fallback function. The bundler folds the guard to its
// own `__require`, so the client chunk is only correct with the browser runtime's `__require`.
const esbuildRequirePrelude = /* js */ `
  var __require = ((x) => typeof require < "u" ? require : typeof Proxy < "u" ? new Proxy(x, { get: (a, b) => (typeof require < "u" ? require : a)[b] }) : x)(function (x) { if (typeof require < "u") return require.apply(this, arguments); throw Error('Dynamic require of "' + x + '" is not supported'); });
  export function lazyRequire(name) { return __require(name); }
  export const greet = () => "dep loaded";
`;

const htmlImportClientFiles = {
  "/index.html": /* html */ `<!DOCTYPE html><html><body><script type="module" src="./app.js"></script></body></html>`,
  "/app.js": /* js */ `
    import { greet, lazyRequire } from "./dep.js";
    globalThis.__lazyRequire = lazyRequire;
    using handle = { [Symbol.dispose]() { globalThis.__disposed = true; } };
    globalThis.__state = greet();
  `,
  "/dep.js": esbuildRequirePrelude,
};

/** The server entry: it keeps the server runtime, whose `__require` is the real `require`. */
const serverEntry = /* js */ `
  import html from "./index.html";
  export const load = (name) => (typeof require !== "undefined" ? require(name) : null);
  console.log(html.index);
`;

/** The `<script>` chunk of the HTML import in the server entry's manifest. */
function clientChunkOf(api: BundlerTestBundleAPI, serverFile: string): string {
  const [, manifestJson] = api.readFile(serverFile).match(/__jsonParse\("(.+?)"\)/s)!;
  const manifest = JSON.parse(JSON.parse('"' + manifestJson + '"'));
  const chunk = manifest.files.find(
    (file: { loader: string; isEntry: boolean }) => file.loader === "js" && file.isEntry,
  );
  return api.readFile("out/" + chunk.path);
}

/** Runs the client chunk the way a browser would: as a module with no `require` in scope. */
function expectClientChunkToRunInBrowser(chunk: string) {
  expect(chunk).not.toContain("import.meta.require");
  expect(chunk).not.toContain("node:module");
  expect(chunk).toContain("typeof require");
  // The browser runtime lowers `using` with a `Symbol.for` fallback; the bun runtime needs the native symbol.
  expect(chunk).toContain("Symbol.for(");
  // The runtime helpers get no file path comment, as in a plain browser build.
  expect(chunk.startsWith("// runtime")).toBe(false);
  const browser: Record<string, unknown> = { Symbol, Proxy, Error, TypeError, Promise, Object };
  browser.globalThis = browser;
  runInNewContext(chunk, browser);
  expect(browser.__state).toBe("dep loaded");
  expect(browser.__disposed).toBe(true);
  expect(() => (browser.__lazyRequire as (name: string) => unknown)("fs")).toThrow(
    'Dynamic require of "fs" is not supported',
  );
}

/** The server chunk still links the runtime of its own target and format. */
function expectServerChunkToKeepServerRuntime(chunk: string, target: "bun" | "node", format: "esm" | "cjs") {
  expect(chunk).not.toContain("Dynamic require of");
  if (format === "cjs") {
    expect(chunk).toContain("require(name)");
  } else if (target === "bun") {
    expect(chunk).toContain("__require = import.meta.require");
  } else {
    expect(chunk).toContain('from "node:module"');
  }
}

describe.concurrent("bundler", () => {
  // The client chunk of an HTML import is browser code whatever the server target and format are.
  // https://github.com/oven-sh/bun/issues/45227
  for (const target of ["bun", "node"] as const) {
    for (const format of ["esm", "cjs"] as const) {
      itBundled(`html-import/client-chunk-uses-browser-runtime-${target}-${format}`, {
        outdir: "out/",
        target,
        format,
        entryPoints: ["/server.js"],
        files: {
          "/server.js": serverEntry,
          ...htmlImportClientFiles,
        },
        onAfterBundle(api) {
          expectClientChunkToRunInBrowser(clientChunkOf(api, "out/server.js"));
          expectServerChunkToKeepServerRuntime(api.readFile("out/server.js"), target, format);
        },
      });
    }
  }

  itBundled("html-import/client-chunk-uses-browser-runtime-splitting", {
    outdir: "out/",
    target: "bun",
    splitting: true,
    entryPoints: ["/server.js"],
    files: {
      "/server.js": serverEntry,
      ...htmlImportClientFiles,
    },
    onAfterBundle(api) {
      expectClientChunkToRunInBrowser(clientChunkOf(api, "out/server.js"));
      const server = api.readFile("out/server.js");
      expectServerChunkToKeepServerRuntime(server, "bun", "esm");
      // No chunk is shared between the two sides.
      expect(server).not.toContain('from "./');
    },
  });

  // The browser side of a CommonJS server build (what `--bytecode` forces) is still ESM: external
  // imports stay `import` statements, `import.meta.url` stays, and top-level `await` is allowed.
  itBundled("html-import/client-chunk-of-cjs-server-build-is-esm", {
    outdir: "out/",
    target: "bun",
    format: "cjs",
    entryPoints: ["/server.js"],
    files: {
      "/server.js": serverEntry,
      "/index.html": /* html */ `<!DOCTYPE html><html><body><script type="module" src="./app.js"></script></body></html>`,
      "/app.js": /* js */ `
        import { greet } from "https://example.com/greet.js";
        const worker = new URL("./worker.js", import.meta.url);
        const state = await greet(worker.href);
        document.body.dataset.state = state;
      `,
    },
    onAfterBundle(api) {
      const chunk = clientChunkOf(api, "out/server.js");
      expect(chunk).toContain('from "https://example.com/greet.js"');
      expect(chunk).not.toContain("require(");
      expect(chunk).not.toContain("__require");
      expect(chunk).toContain("import.meta.url");
      expect(chunk).not.toContain("file://");
      expect(chunk).toContain("await greet(");
      expectServerChunkToKeepServerRuntime(api.readFile("out/server.js"), "bun", "cjs");
    },
  });

  itBundled("compile/html-import-client-chunk-uses-browser-runtime-bytecode", {
    compile: true,
    bytecode: true,
    minifySyntax: true,
    files: {
      "/entry.ts": /* js */ `
        import html from "./index.html";
        // Bytecode forces the CommonJS format, which has no top-level await.
        async function main() {
          using server = Bun.serve({ port: 0, routes: { "/": html } });
          const page = await (await fetch(server.url)).text();
          const src = /<script[^>]*\\ssrc="([^"]+)"/.exec(page)[1];
          const chunk = await (await fetch(new URL(src, server.url))).text();
          console.log("import.meta.require:", chunk.includes("import.meta.require"));
          console.log("typeof require guard:", chunk.includes("typeof require"));
        }
        main();
      `,
      ...htmlImportClientFiles,
    },
    run: {
      stdout: "import.meta.require: false\ntypeof require guard: true",
    },
  });

  for (const backend of ["api", "cli"] as const) {
    itBundled(`compile/${backend}/HTMLServerBasic`, {
      compile: true,
      backend: backend,
      files: {
        "/entry.ts": /* js */ `
        import index from "./index.html";
        
        using server = Bun.serve({
          port: 0,
          routes: {
            "/": index,
          },
        });
        
        const res = await fetch(server.url);
        console.log("Status:", res.status);
        console.log("Content-Type:", res.headers.get("content-type"));
        
        const html = await res.text();
        console.log("Has HTML tag:", html.includes("<html>"));
        console.log("Has h1:", html.includes("Hello HTML"));
      
      `,
        "/index.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <link rel="stylesheet" href="./styles.css">
          </head>
          <body>
            <h1>Hello HTML</h1>
            <script src="./app.js"></script>
          </body>
        </html>
      `,
        "/styles.css": /* css */ `
        body {
          background: blue;
        }
      `,
        "/app.js": /* js */ `
        console.log("Client app loaded");
      `,
      },
      run: {
        stdout: "Status: 200\nContent-Type: text/html;charset=utf-8\nHas HTML tag: true\nHas h1: true",
      },
    });

    itBundled(`compile/${backend}/HTMLServerMultipleRoutes`, {
      compile: true,
      backend: backend,
      files: {
        "/entry.ts": /* js */ `
        import home from "./home.html";
        import about from "./about.html";
        
        using server = Bun.serve({
          port: 0,
          routes: {
            "/": home,
            "/about": about,
          },
        });
        
        // Test home route
        const homeRes = await fetch(server.url);
        console.log("Home status:", homeRes.status);
        const homeHtml = await homeRes.text();
        console.log("Home has content:", homeHtml.includes("Home Page"));
        
        // Test about route  
        const aboutRes = await fetch(server.url + "about");
        console.log("About status:", aboutRes.status);
        const aboutHtml = await aboutRes.text();
        console.log("About has content:", aboutHtml.includes("About Page"));
      `,
        "/home.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Home</title>
            <link rel="stylesheet" href="./styles.css">
          </head>
          <body>
            <h1>Home Page</h1>
            <script src="./app.js"></script>
          </body>
        </html>
      `,
        "/about.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <head>
            <title>About</title>
            <link rel="stylesheet" href="./styles.css">
          </head>
          <body>
            <h1>About Page</h1>
            <script src="./app.js"></script>
          </body>
        </html>
      `,
        "/styles.css": /* css */ `
        body {
          margin: 0;
          font-family: sans-serif;
        }
      `,
        "/app.js": /* js */ `
        console.log("App loaded");
      `,
      },
      run: {
        stdout: "Home status: 200\nHome has content: true\nAbout status: 200\nAbout has content: true",
      },
    });
  }
});
