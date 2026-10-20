import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { itBundled } from "./expectBundled";

describe.concurrent("bundler", () => {
  const htmlServerFiles = {
    "src/pages/about.html": `<!doctype html><html><head><link rel="stylesheet" href="./about.css"><script type="module" src="./about.ts"></script></head><body><h1>about</h1></body></html>`,
    "src/pages/about.ts": `console.log("about.ts ran");`,
    "src/pages/about.css": `h1 { color: red; }`,
    "other.ts": `console.log("other");`,
  };
  const serveAbout = `
    const server = Bun.serve({ port: 0, development: false, routes: { "/about": about } });
    (async () => {
      const page = await fetch(new URL("/about", server.url));
      const html = await page.text();
      const script = await fetch(new URL(html.match(/src="([^"]+)"/)[1], page.url));
      const css = await fetch(new URL(html.match(/href="([^"]+)"/)[1], page.url));
      console.log(page.status, html.includes("<h1>about</h1>"), script.status, (await script.text()).includes("about.ts ran"), css.status);
      server.stop();
    })();
  `;

  async function buildAndRun(
    dir: string,
    options: { entrypoints: readonly string[]; output: string; cwd?: string } & Partial<Bun.BuildConfig>,
  ) {
    const { entrypoints, output, cwd = ".", ...config } = options;
    const build = await Bun.build({
      entrypoints: entrypoints.map(entry => join(dir, entry)),
      outdir: join(dir, "dist"),
      target: "bun",
      ...config,
    } as Bun.BuildConfig);
    expect(build.success).toBe(true);

    await using proc = Bun.spawn({
      cmd: [bunExe(), output],
      env: bunEnv,
      cwd: join(dir, cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // The server entry lands in dist/src/ when a second entry point widens the root.
  const inSubfolder = { entrypoints: ["src/server.ts", "other.ts"], output: "dist/src/server.js" };
  const aboveOutdir = { entrypoints: ["src/server.ts"], output: "server.js" };

  test.each([
    { name: "esm", format: "esm", entrypoints: ["src/server.ts"], output: "dist/server.js" },
    { name: "cjs", format: "cjs", entrypoints: ["src/server.ts"], output: "dist/server.js" },
    { name: "subdirectory", format: "esm", ...inSubfolder },
    { name: "subdirectory-cjs", format: "cjs", ...inSubfolder },
    { name: "publicPath", format: "esm", publicPath: "/", ...inSubfolder },
    { name: "publicPath-cjs", format: "cjs", publicPath: "/", ...inSubfolder },
    { name: "naming-starts-with-dot", format: "esm", naming: { entry: "./[dir]/[name].[ext]" }, ...inSubfolder },
    // The server entry lands above the outdir, or beside it: `root` leads back through the outdir's name.
    // The entry naming moves the page there too, and a public path is what finds its files from there.
    {
      name: "naming-above-outdir",
      format: "esm",
      publicPath: "/",
      naming: { entry: "../[name].[ext]" },
      ...aboveOutdir,
    },
    {
      name: "naming-above-outdir-cjs",
      format: "cjs",
      publicPath: "/",
      naming: { entry: "../[name].[ext]" },
      ...aboveOutdir,
    },
    {
      name: "naming-beside-outdir",
      format: "esm",
      publicPath: "/",
      naming: { entry: "../out/[name].[ext]" },
      entrypoints: ["src/server.ts"],
      output: "out/server.js",
    },
    // A segment that goes up and comes back is no way out of the outdir.
    {
      name: "naming-down-and-up",
      format: "esm",
      naming: { entry: "a/../b/[name].[ext]" },
      entrypoints: ["src/server.ts"],
      output: "dist/b/server.js",
    },
    // The page's own files sit above the outdir too.
    {
      name: "chunks-above-outdir",
      format: "esm",
      naming: { entry: "../[name].[ext]", chunk: "../[name]-[hash].[ext]", asset: "../[name]-[hash].[ext]" },
      ...aboveOutdir,
    },
    // The page's files land under the server entry's folder, and the HTML names them from the outdir.
    {
      name: "publicPath-files-below-entry",
      format: "esm",
      publicPath: "/",
      naming: { chunk: "[dir]/[name]-[hash].[ext]", asset: "[dir]/[name]-[hash].[ext]" },
      ...inSubfolder,
    },
  ] as const)("HTMLServerRunFromAnotherDirectory/$name", async ({ name, ...options }) => {
    using dir = tempDir("html-server-cwd", {
      ...htmlServerFiles,
      "src/server.ts": `import about from "./pages/about.html";${serveAbout}`,
    });
    const { stdout, stderr, exitCode } = await buildAndRun(String(dir), options);
    expect(stdout, stderr).toBe("200 true 200 true 200");
    expect(exitCode).toBe(0);
  });

  test("HTMLServerCopiedManifest", async () => {
    using dir = tempDir("html-server-copy", {
      ...htmlServerFiles,
      "src/server.ts": `import original from "./pages/about.html"; const about = { ...original };${serveAbout}`,
    });
    // A copy loses `dir`, so its paths are relative to the working directory, as without it.
    const { stdout, stderr, exitCode } = await buildAndRun(String(dir), {
      ...inSubfolder,
      output: "src/server.js",
      cwd: "dist",
    });
    expect(stdout, stderr).toBe("200 true 200 true 200");
    expect(exitCode).toBe(0);
  });

  // These outputs have no directory of their own to pass, so the paths stay relative to the outdir.
  test.each([
    { name: "node-esm", target: "node", format: "esm" },
    { name: "node-cjs", target: "node", format: "cjs" },
    { name: "bun-iife", target: "bun", format: "iife" },
  ] as const)("HTMLServerRunFromOutdir/$name", async ({ name, ...options }) => {
    using dir = tempDir("html-server-outdir", {
      ...htmlServerFiles,
      "src/server.ts": `import about from "./pages/about.html";${serveAbout}`,
    });
    const { stdout, stderr, exitCode } = await buildAndRun(String(dir), {
      ...options,
      entrypoints: inSubfolder.entrypoints,
      output: "src/server.js",
      cwd: "dist",
    });
    expect(stdout, stderr).toBe("200 true 200 true 200");
    expect(exitCode).toBe(0);
  });

  test("HTMLServerCommonJSUserDirname", async () => {
    using dir = tempDir("html-server-dirname", {
      ...htmlServerFiles,
      "src/uses-dirname.ts": `console.log(__dirname.endsWith("src"));`,
      "src/server.ts": `import "./uses-dirname.ts"; import about from "./pages/about.html";${serveAbout}`,
    });
    const { stdout, stderr, exitCode } = await buildAndRun(String(dir), {
      format: "cjs",
      entrypoints: ["src/server.ts"],
      output: "dist/server.js",
    });
    expect(stdout, stderr).toBe("true\n200 true 200 true 200");
    expect(exitCode).toBe(0);
  });

  test.each(["esm", "cjs"] as const)("each module keeps its own __dirname and __filename/%s", async format => {
    using dir = tempDir("bundle-dirname", {
      "entry.ts": `import { a } from "./a/a.ts"; import { b } from "./b/b.ts"; console.log(a(), b());`,
      "a/a.ts": `export const a = () => [__dirname.endsWith("a"), __filename.endsWith("a.ts")].join();`,
      "b/b.ts": `export const b = () => [__dirname.endsWith("b"), __filename.endsWith("b.ts")].join();`,
    });
    const { stdout, stderr, exitCode } = await buildAndRun(String(dir), {
      format,
      entrypoints: ["entry.ts"],
      output: "dist/entry.js",
    });
    expect(stdout, stderr).toBe("true,true true,true");
    expect(exitCode).toBe(0);
  });

  test.each(["", "relative/dir"])("HTMLServerManifestDirNotAbsolute/%j", async manifestDir => {
    using dir = tempDir("html-server-dir", {
      "index.html": `<!doctype html><h1>hand built</h1>`,
      "server.js": `
        const server = Bun.serve({
          port: 0,
          development: false,
          routes: {
            "/": {
              index: "./index.html",
              dir: ${JSON.stringify(manifestDir)},
              files: [{ path: "./index.html", loader: "html", isEntry: true, headers: { "content-type": "text/html" } }],
            },
          },
        });
        const page = await fetch(server.url);
        console.log(page.status, await page.text());
        server.stop();
      `,
    });
    await using proc = Bun.spawn({ cmd: [bunExe(), "server.js"], env: bunEnv, cwd: String(dir), stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim(), stderr).toBe("200 <!doctype html><h1>hand built</h1>");
    expect(exitCode).toBe(0);
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
