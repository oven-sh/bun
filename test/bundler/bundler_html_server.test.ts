import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe.concurrent("bundler", () => {
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

    // The script of the page is a browser build. The server's own imports are not.
    itBundled(`compile/${backend}/HTMLServerPageIsABrowserBuild`, {
      compile: true,
      backend: backend,
      files: {
        "/entry.ts": /* js */ `
        import index from "./index.html";
        import impl from "browser-map";

        using server = Bun.serve({
          port: 0,
          routes: {
            "/": index,
          },
        });

        const html = await (await fetch(server.url)).text();
        const script = await (await fetch(new URL(html.match(/src="([^"]+\.js)"/)[1], server.url))).text();
        console.log("server", process.browser, impl);
        console.log("imports left in the script:", new Bun.Transpiler().scanImports(script).length);
        // Run the script.
        await import(URL.createObjectURL(new Blob([script], { type: "text/javascript" })));
      `,
        "/index.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <body>
            <script type="module" src="./app.js"></script>
          </body>
        </html>
      `,
        "/app.js": /* js */ `
        import { join } from "node:path";
        import impl from "browser-map";
        console.log("client", process.browser, impl, join("a", "b"));
      `,
        "/node_modules/browser-map/package.json": JSON.stringify({
          name: "browser-map",
          version: "1.0.0",
          main: "./index.js",
          browser: { "./impl.js": "./impl-browser.js" },
        }),
        "/node_modules/browser-map/index.js": `export { default } from "./impl.js";`,
        "/node_modules/browser-map/impl.js": `export default "impl";`,
        "/node_modules/browser-map/impl-browser.js": `export default "impl-browser";`,
      },
      run: {
        stdout: "server false impl\nimports left in the script: 0\nclient true impl-browser a/b",
      },
    });
  }
});
