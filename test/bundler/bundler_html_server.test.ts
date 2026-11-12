import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, isDebug, isLinux, isWindows, tempDir } from "harness";
import { copyFileSync, renameSync } from "node:fs";
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
  const served = "200 true 200 true 200";

  type BuildOptions = {
    entrypoints: readonly string[];
    output: string;
    cwd?: string;
    backend?: "api" | "cli";
    format?: "esm" | "cjs" | "iife";
    target?: "bun" | "node";
    publicPath?: string;
    naming?: { entry?: string; chunk?: string; asset?: string };
  };

  async function build(dir: string, options: BuildOptions) {
    const { entrypoints, backend = "api", format = "esm", target = "bun", publicPath, naming } = options;
    if (backend === "api") {
      const build = await Bun.build({
        entrypoints: entrypoints.map(entry => join(dir, entry)),
        outdir: join(dir, "dist"),
        target,
        format,
        publicPath,
        naming,
      });
      expect(build.success).toBe(true);
      return;
    }
    // The documented production command.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        `--target=${target}`,
        `--format=${format}`,
        "--production",
        "--outdir=dist",
        ...entrypoints,
      ],
      env: bunEnv,
      cwd: dir,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(exitCode, stderr).toBe(0);
  }

  async function run(dir: string, output: string, cwd = ".") {
    await using proc = Bun.spawn({
      cmd: [bunExe(), output],
      env: bunEnv,
      cwd: join(dir, cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  async function buildAndRun(dir: string, options: BuildOptions) {
    await build(dir, options);
    return run(dir, options.output, options.cwd);
  }

  // The server entry lands in dist/src/ when a second entry point widens the root.
  const inSubfolder = { entrypoints: ["src/server.ts", "other.ts"], output: "dist/src/server.js" };
  const aboveOutdir = { entrypoints: ["src/server.ts"], output: "server.js" };

  // The server runs from the project folder, not from the outdir.
  test.each([
    { name: "esm", format: "esm", entrypoints: ["src/server.ts"], output: "dist/server.js" },
    { name: "cjs", format: "cjs", entrypoints: ["src/server.ts"], output: "dist/server.js" },
    { name: "cli", backend: "cli", format: "esm", entrypoints: ["src/server.ts"], output: "dist/server.js" },
    { name: "cli-cjs", backend: "cli", format: "cjs", entrypoints: ["src/server.ts"], output: "dist/server.js" },
    { name: "subdirectory", format: "esm", ...inSubfolder },
    { name: "subdirectory-cjs", format: "cjs", ...inSubfolder },
    { name: "subdirectory-cli", backend: "cli", format: "esm", ...inSubfolder },
    { name: "publicPath", format: "esm", publicPath: "/", ...inSubfolder },
    { name: "publicPath-cjs", format: "cjs", publicPath: "/", ...inSubfolder },
    { name: "naming-starts-with-dot", format: "esm", naming: { entry: "./[dir]/[name].[ext]" }, ...inSubfolder },
    {
      name: "naming-two-levels-down",
      format: "esm",
      naming: { entry: "a/b/[name].[ext]" },
      entrypoints: ["src/server.ts"],
      output: "dist/a/b/server.js",
    },
    // A segment that goes up and comes back is no way out of the outdir.
    {
      name: "naming-down-and-up",
      format: "esm",
      naming: { entry: "a/../b/[name].[ext]" },
      entrypoints: ["src/server.ts"],
      output: "dist/b/server.js",
    },
    // The page's files land under the server entry's folder, and the HTML names them from the outdir.
    {
      name: "publicPath-files-below-entry",
      format: "esm",
      publicPath: "/",
      naming: { chunk: "[dir]/[name]-[hash].[ext]", asset: "[dir]/[name]-[hash].[ext]" },
      ...inSubfolder,
    },
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
    // The page's own files sit above the outdir too.
    {
      name: "chunks-above-outdir",
      format: "esm",
      naming: { entry: "../[name].[ext]", chunk: "../[name]-[hash].[ext]", asset: "../[name]-[hash].[ext]" },
      ...aboveOutdir,
    },
  ] as const)("HTMLServerRunFromAnotherDirectory/$name", async ({ name, ...options }) => {
    using dir = tempDir("html-server-cwd", {
      ...htmlServerFiles,
      "src/server.ts": `import about from "./pages/about.html";${serveAbout}`,
    });
    const { stdout, stderr, exitCode } = await buildAndRun(String(dir), options);
    expect(stdout, stderr).toBe(served);
    expect(exitCode).toBe(0);
  });

  // The manifest finds the outdir wherever the output folder is moved to.
  test.each(["esm", "cjs"] as const)("HTMLServerMovedOutdir/%s", async format => {
    using dir = tempDir("html-server-moved", {
      ...htmlServerFiles,
      "src/server.ts": `import about from "./pages/about.html";${serveAbout}`,
    });
    await build(String(dir), { ...inSubfolder, format });
    renameSync(join(String(dir), "dist"), join(String(dir), "deployed"));
    const { stdout, stderr, exitCode } = await run(String(dir), join(String(dir), "deployed/src/server.js"), "src");
    expect(stdout, stderr).toBe(served);
    expect(exitCode).toBe(0);
  });

  // `dir` is the outdir, `root` is gone, and the paths stay relative to the outdir.
  test.each(["esm", "cjs"] as const)("HTMLServerManifestShape/%s", async format => {
    using dir = tempDir("html-server-shape", {
      ...htmlServerFiles,
      "src/server.ts": `
        import about from "./pages/about.html";
        console.log(JSON.stringify([Object.keys(about), "root" in about, about.dir, about.index, about.files.map(file => file.path)]));
      `,
    });
    const { stdout, stderr, exitCode } = await buildAndRun(String(dir), { ...inSubfolder, format });
    const [keys, hasRoot, outdir, index, paths] = JSON.parse(stdout);
    expect([keys, hasRoot, outdir, index], stderr).toEqual([
      ["index", "files"],
      false,
      join(String(dir), "dist"),
      "src/pages/about.html",
    ]);
    expect(paths).toContain(index);
    expect(paths.every((path: string) => !path.startsWith("/") && !path.startsWith(".."))).toBe(true);
    expect(exitCode).toBe(0);
  });

  // A server file that is not next to its page runs from the outdir, as before: `dir` does not hold the page.
  test.each([
    // A copy of the manifest has no `dir`.
    { name: "copied-manifest", setup: (dir: string) => {}, output: "src/server.js", cwd: "dist" },
    {
      name: "copied-server-file",
      setup: (dir: string) => copyFileSync(join(dir, "dist/src/server.js"), join(dir, "server.js")),
      output: "../server.js",
      cwd: "dist",
    },
    // The source page is under the copy's folder at the manifest's path, but the built files are not.
    {
      name: "copied-server-file-beside-source-page",
      entrypoints: ["src/server.ts"],
      setup: (dir: string) => copyFileSync(join(dir, "dist/server.js"), join(dir, "src/server.js")),
      output: "../src/server.js",
      cwd: "dist",
    },
  ])("HTMLServerRunFromOutdir/$name", async ({ name, setup, output, cwd, ...options }) => {
    using dir = tempDir("html-server-outdir", {
      ...htmlServerFiles,
      "src/server.ts":
        name === "copied-manifest"
          ? `import original from "./pages/about.html"; const about = { ...original };${serveAbout}`
          : `import about from "./pages/about.html";${serveAbout}`,
    });
    await build(String(dir), { ...inSubfolder, ...options });
    setup(String(dir));
    const { stdout, stderr, exitCode } = await run(String(dir), output, cwd);
    expect(stdout, stderr).toBe(served);
    expect(exitCode).toBe(0);
  });

  // A second bundle of the server file keeps the manifest, with its own `import.meta.dir`, which holds no page.
  // A CommonJS re-bundle inlines the build machine's outdir instead, which is gone once the outdir is moved.
  test.each(["esm", "cjs"] as const)("HTMLServerRebundled/%s", async format => {
    using dir = tempDir("html-server-rebundled", {
      ...htmlServerFiles,
      "src/server.ts": `import about from "./pages/about.html";${serveAbout}`,
    });
    await build(String(dir), { entrypoints: ["src/server.ts"], output: "dist/server.js" });
    const second = await Bun.build({
      entrypoints: [join(String(dir), "dist/server.js")],
      outdir: join(String(dir), "rebundled"),
      target: "bun",
      format,
    });
    expect(second.success).toBe(true);
    renameSync(join(String(dir), "dist"), join(String(dir), "deployed"));
    const { stdout, stderr, exitCode } = await run(String(dir), "../rebundled/server.js", "deployed");
    expect(stdout, stderr).toBe(served);
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
    expect(stdout, stderr).toBe(served);
    expect(exitCode).toBe(0);
  });

  // A bundled module's `__dirname` is inlined. It must not reach the manifest's `module.path`.
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
    expect(stdout, stderr).toBe(`true\n${served}`);
    expect(exitCode).toBe(0);
  });

  test.each(["", "relative/dir", "nul"])("HTMLServerManifestDirIgnored/%s", async manifestDir => {
    using dir = tempDir("html-server-dir", {
      "index.html": `<!doctype html><h1>hand built</h1>`,
      "server.js": `
        const server = Bun.serve({
          port: 0,
          development: false,
          routes: {
            "/": {
              index: "./index.html",
              dir: ${manifestDir === "nul" ? 'process.cwd() + "\\0"' : JSON.stringify(manifestDir)},
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

  // The path alone stays under the limit, which `Bun.serve()` rejects with ENAMETOOLONG.
  const maxPathBytes = isWindows ? 32767 * 3 + 1 : isLinux ? 4096 : 1024;
  test.each([
    { name: "dir", dirLength: 200_000, pathLength: 1 },
    { name: "dir-and-path", dirLength: 0, pathLength: maxPathBytes - 1 - process.cwd().length },
  ])("HTMLServerManifestPathTooLong/$name", async ({ dirLength, pathLength }) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const path = "./" + Buffer.alloc(${pathLength}, "b").toString();
        try {
          Bun.serve({
            port: 0,
            routes: {
              "/": {
                index: path,
                dir: process.cwd() + "/" + Buffer.alloc(${dirLength}, "a").toString(),
                files: [{ path, loader: "html", isEntry: true, headers: { "content-type": "text/html" } }],
              },
            },
          });
        } catch (error) {
          console.log(error.message);
        }
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim(), stderr).toBe("Bundled file path is too long");
    expect(exitCode).toBe(0);
  });

  // The executable embeds only the server bundle, so the other outputs stay on disk.
  test(
    "HTMLServerCompiledBundleRunFromOutdir",
    async () => {
      using dir = tempDir("html-server-compiled", {
        ...htmlServerFiles,
        "src/server.ts": `import about from "./pages/about.html";${serveAbout}`,
      });
      await build(String(dir), { entrypoints: ["src/server.ts"], output: "dist/server.js" });

      const dist = join(String(dir), "dist");
      await using compile = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "server.js", "--outfile=app"],
        env: bunEnv,
        cwd: dist,
        stdout: "ignore",
        stderr: "pipe",
      });
      const [compileStderr, compileExitCode] = await Promise.all([compile.stderr.text(), compile.exited]);
      expect(compileExitCode, compileStderr).toBe(0);

      await using proc = Bun.spawn({
        cmd: [join(dist, isWindows ? "app.exe" : "app")],
        env: bunEnv,
        cwd: dist,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim(), stderr).toBe(served);
      expect(exitCode).toBe(0);
    },
    // A compile copies the executable, which `itBundled` allows its `compile` tests too.
    isCI ? undefined : isDebug ? Infinity : 30_000,
  );

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
