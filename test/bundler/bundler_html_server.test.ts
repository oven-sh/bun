import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { itBundled } from "./expectBundled";

describe.concurrent("bundler", () => {
  // The server entry lands in dist/src/ when a second entry point widens the root.
  test.each([
    { name: "esm", format: "esm", entrypoints: ["src/server.ts"], output: "dist/server.js" },
    { name: "cjs", format: "cjs", entrypoints: ["src/server.ts"], output: "dist/server.js" },
    { name: "subdirectory", format: "esm", entrypoints: ["src/server.ts", "other.ts"], output: "dist/src/server.js" },
  ] as const)("HTMLServerRunFromAnotherDirectory/$name", async ({ format, entrypoints, output }) => {
    using dir = tempDir("html-server-cwd", {
      "src/server.ts": `
        import about from "./pages/about.html";
        const server = Bun.serve({ port: 0, development: false, routes: { "/about": about } });
        (async () => {
          const page = await fetch(new URL("/about", server.url));
          const html = await page.text();
          const script = await fetch(new URL(html.match(/src="([^"]+)"/)[1], page.url));
          const css = await fetch(new URL(html.match(/href="([^"]+)"/)[1], page.url));
          console.log(page.status, html.includes("<h1>about</h1>"), script.status, (await script.text()).includes("about.ts ran"), css.status);
          server.stop();
        })();
      `,
      "src/pages/about.html": `<!doctype html><html><head><link rel="stylesheet" href="./about.css"><script type="module" src="./about.ts"></script></head><body><h1>about</h1></body></html>`,
      "src/pages/about.ts": `console.log("about.ts ran");`,
      "src/pages/about.css": `h1 { color: red; }`,
      "other.ts": `console.log("other");`,
    });

    const build = await Bun.build({
      entrypoints: entrypoints.map(entry => join(String(dir), entry)),
      outdir: join(String(dir), "dist"),
      target: "bun",
      format,
    });
    expect(build.success).toBe(true);

    await using proc = Bun.spawn({
      cmd: [bunExe(), output],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim(), stderr).toBe("200 true 200 true 200");
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
